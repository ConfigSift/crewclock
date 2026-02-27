-- 018_fix_self_signup_role_default_admin.sql
-- Default self-signup users to admin while preserving explicit staff roles from metadata.

CREATE OR REPLACE FUNCTION public.ensure_profile_for_auth_user(
  p_user_id uuid,
  p_email text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_meta jsonb := COALESCE(p_meta, '{}'::jsonb);
  v_profile_id uuid;
  v_role public.user_role := 'admin'::public.user_role;
  v_requested_role_text text := lower(NULLIF(TRIM(COALESCE(v_meta->>'role', '')), ''));
  v_first_name text := '';
  v_last_name text := '';
  v_phone text := NULL;
  v_company_id uuid;
  v_account_id uuid;
  v_company_name text;
  v_slug text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  -- Explicit worker/manager metadata is reserved for staff provisioning.
  IF v_requested_role_text IN ('worker', 'manager') THEN
    v_role := v_requested_role_text::public.user_role;
  ELSE
    v_role := 'admin'::public.user_role;
  END IF;

  -- Preserve existing profiles, but fill missing role safely.
  UPDATE public.profiles
  SET role = COALESCE(role, v_role),
      onboarding_step_completed = CASE
        WHEN role IS NULL AND v_role = 'admin'::public.user_role THEN COALESCE(onboarding_step_completed, 0)
        ELSE onboarding_step_completed
      END,
      is_active = COALESCE(is_active, true),
      updated_at = now()
  WHERE id = p_user_id
  RETURNING id INTO v_profile_id;

  IF v_profile_id IS NOT NULL THEN
    RETURN v_profile_id;
  END IF;

  v_first_name := COALESCE(
    NULLIF(v_meta->>'first_name', ''),
    NULLIF(v_meta->>'firstName', ''),
    ''
  );
  v_last_name := COALESCE(
    NULLIF(v_meta->>'last_name', ''),
    NULLIF(v_meta->>'lastName', ''),
    ''
  );
  v_phone := public.normalize_phone(NULLIF(v_meta->>'phone', ''));

  BEGIN
    IF NULLIF(v_meta->>'company_id', '') IS NOT NULL THEN
      v_company_id := (v_meta->>'company_id')::uuid;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_company_id := NULL;
  END;

  IF v_company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = v_company_id
  ) THEN
    v_company_id := NULL;
  END IF;

  BEGIN
    IF NULLIF(v_meta->>'account_id', '') IS NOT NULL THEN
      v_account_id := (v_meta->>'account_id')::uuid;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_account_id := NULL;
  END;

  IF v_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = v_account_id
  ) THEN
    v_account_id := NULL;
  END IF;

  IF v_company_id IS NULL THEN
    v_company_name := NULLIF(TRIM(COALESCE(
      v_meta->>'company',
      v_meta->>'company_name',
      v_meta->>'companyName'
    )), '');

    IF v_company_name IS NULL THEN
      v_company_name := COALESCE(NULLIF(split_part(COALESCE(p_email, ''), '@', 1), ''), 'CrewClock');
      v_company_name := v_company_name || ' Company';
    END IF;

    v_slug := 'user-' || substr(replace(p_user_id::text, '-', ''), 1, 12);

    INSERT INTO public.companies (name, slug, owner_user_id)
    VALUES (v_company_name, v_slug, p_user_id)
    ON CONFLICT (slug) DO UPDATE
      SET owner_user_id = COALESCE(public.companies.owner_user_id, EXCLUDED.owner_user_id)
    RETURNING id INTO v_company_id;

    IF v_company_id IS NULL THEN
      SELECT c.id INTO v_company_id
      FROM public.companies c
      WHERE c.slug = v_slug
      LIMIT 1;
    END IF;
  END IF;

  IF v_account_id IS NULL AND v_company_id IS NOT NULL THEN
    INSERT INTO public.accounts (id, owner_profile_id)
    VALUES (v_company_id, NULL)
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO v_account_id;

    IF v_account_id IS NULL THEN
      SELECT a.id INTO v_account_id
      FROM public.accounts a
      WHERE a.id = v_company_id
      LIMIT 1;
    END IF;
  END IF;

  IF v_account_id IS NULL THEN
    INSERT INTO public.accounts (owner_profile_id)
    VALUES (NULL)
    RETURNING id INTO v_account_id;
  END IF;

  INSERT INTO public.profiles (
    id,
    role,
    first_name,
    last_name,
    phone,
    is_active,
    onboarding_step_completed,
    account_id,
    company_id,
    created_at,
    updated_at
  )
  VALUES (
    p_user_id,
    v_role,
    v_first_name,
    v_last_name,
    v_phone,
    true,
    0,
    v_account_id,
    v_company_id,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET role = COALESCE(public.profiles.role, EXCLUDED.role),
        onboarding_step_completed = CASE
          WHEN public.profiles.role IS NULL AND EXCLUDED.role = 'admin'::public.user_role
            THEN COALESCE(public.profiles.onboarding_step_completed, 0)
          ELSE public.profiles.onboarding_step_completed
        END,
        is_active = COALESCE(public.profiles.is_active, true),
        updated_at = now()
  RETURNING id INTO v_profile_id;

  UPDATE public.companies
  SET owner_user_id = COALESCE(owner_user_id, p_user_id)
  WHERE id = v_company_id;

  UPDATE public.accounts
  SET owner_profile_id = COALESCE(owner_profile_id, p_user_id),
      updated_at = now()
  WHERE id = v_account_id;

  RETURN v_profile_id;
END;
$function$;

ALTER FUNCTION public.ensure_profile_for_auth_user(uuid, text, jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  PERFORM public.ensure_profile_for_auth_user(NEW.id, NEW.email, NEW.raw_user_meta_data);
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Safe one-time repair for likely self-signups created with worker role.
UPDATE public.profiles p
SET role = 'admin'::public.user_role,
    onboarding_step_completed = COALESCE(p.onboarding_step_completed, 0),
    is_active = true,
    updated_at = now()
WHERE p.role = 'worker'::public.user_role
  AND p.phone IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.business_memberships bm
    WHERE bm.profile_id = p.id
  );

-- 014_fix_handle_new_user_profiles_backfill.sql
-- Ensure every auth.users row has a matching public.profiles row.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.profiles
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.profiles
  ALTER COLUMN updated_at SET NOT NULL;

DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON public.profiles;
CREATE TRIGGER trigger_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

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

  UPDATE public.profiles
  SET updated_at = now()
  WHERE id = p_user_id
  RETURNING id INTO v_profile_id;

  IF v_profile_id IS NOT NULL THEN
    RETURN v_profile_id;
  END IF;

  BEGIN
    IF NULLIF(v_meta->>'role', '') IS NOT NULL THEN
      v_role := (v_meta->>'role')::public.user_role;
    END IF;
  EXCEPTION
    WHEN others THEN
      v_role := 'admin'::public.user_role;
  END;

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
    SET updated_at = now()
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

-- Backfill any auth user currently missing a profile.
SELECT public.ensure_profile_for_auth_user(u.id, u.email, '{}'::jsonb)
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

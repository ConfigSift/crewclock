-- 011_fix_admin_signup_phone_nullable.sql
-- Allow admin email/password signups to create profiles without phone.

ALTER TABLE public.profiles
  ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_phone_e164_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_phone_e164_check
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$');

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_company_id uuid;
  v_account_id uuid;
  v_company_name text;
  v_slug text;
  v_role public.user_role := 'worker'::public.user_role;
  v_company_created boolean := false;
  v_first_name text;
  v_last_name text;
  v_phone text;
BEGIN
  BEGIN
    IF NULLIF(v_meta->>'company_id', '') IS NOT NULL THEN
      v_company_id := (v_meta->>'company_id')::uuid;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_company_id := NULL;
  END;

  BEGIN
    IF NULLIF(v_meta->>'account_id', '') IS NOT NULL THEN
      v_account_id := (v_meta->>'account_id')::uuid;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_account_id := NULL;
  END;

  IF v_company_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.companies c
      WHERE c.id = v_company_id
    ) THEN
      v_company_id := NULL;
    END IF;
  END IF;

  IF v_company_id IS NULL THEN
    v_company_name := NULLIF(TRIM(COALESCE(
      v_meta->>'company',
      v_meta->>'company_name',
      v_meta->>'companyName'
    )), '');

    IF v_company_name IS NULL THEN
      v_company_name := 'Default Company';
    END IF;

    v_slug := lower(regexp_replace(v_company_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    IF v_slug IS NULL OR v_slug = '' THEN
      v_slug := 'company';
    END IF;

    INSERT INTO public.companies (name, slug, owner_user_id)
    VALUES (v_company_name, v_slug, NEW.id)
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO v_company_id;

    IF v_company_id IS NOT NULL THEN
      v_company_created := true;
    ELSE
      SELECT c.id INTO v_company_id
      FROM public.companies c
      WHERE c.slug = v_slug
      LIMIT 1;
    END IF;
  END IF;

  BEGIN
    IF NULLIF(v_meta->>'role', '') IS NOT NULL THEN
      v_role := (v_meta->>'role')::public.user_role;
    END IF;
  EXCEPTION
    WHEN others THEN
      v_role := 'worker'::public.user_role;
  END;

  IF v_company_created THEN
    v_role := 'admin'::public.user_role;
  END IF;

  v_first_name := COALESCE(
    NULLIF(v_meta->>'first_name', ''),
    NULLIF(v_meta->>'firstName', ''),
    CASE
      WHEN v_role = 'admin'::public.user_role THEN 'Owner'
      ELSE ''
    END
  );
  v_last_name := COALESCE(NULLIF(v_meta->>'last_name', ''), NULLIF(v_meta->>'lastName', ''), '');
  v_phone := public.normalize_phone(NULLIF(v_meta->>'phone', ''));

  INSERT INTO public.profiles (
    id,
    company_id,
    account_id,
    first_name,
    last_name,
    phone,
    role,
    is_active
  )
  VALUES (
    NEW.id,
    v_company_id,
    v_account_id,
    COALESCE(v_first_name, ''),
    COALESCE(v_last_name, ''),
    v_phone,
    v_role,
    true
  )
  ON CONFLICT (id)
  DO UPDATE SET
    company_id = EXCLUDED.company_id,
    account_id = COALESCE(EXCLUDED.account_id, public.profiles.account_id),
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    is_active = COALESCE(public.profiles.is_active, true);

  IF v_company_created THEN
    UPDATE public.companies
    SET owner_user_id = COALESCE(owner_user_id, NEW.id)
    WHERE id = v_company_id;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

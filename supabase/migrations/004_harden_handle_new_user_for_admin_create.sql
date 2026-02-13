-- 004_harden_handle_new_user_for_admin_create.sql
-- Harden auth.users trigger path for admin-created users.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_company_id uuid;
  v_company_name text;
  v_slug text;
  v_role user_role := 'worker'::user_role;
BEGIN
  -- Preferred path for internal/admin user creation.
  BEGIN
    IF NULLIF(v_meta->>'company_id', '') IS NOT NULL THEN
      v_company_id := (v_meta->>'company_id')::uuid;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_company_id := NULL;
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

  -- Fallback for non-admin/self-signup metadata shapes.
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

    INSERT INTO public.companies (name, slug)
    VALUES (v_company_name, v_slug)
    ON CONFLICT (slug) DO NOTHING;

    SELECT c.id
    INTO v_company_id
    FROM public.companies c
    WHERE c.slug = v_slug
    LIMIT 1;
  END IF;

  BEGIN
    IF NULLIF(v_meta->>'role', '') IS NOT NULL THEN
      v_role := (v_meta->>'role')::user_role;
    END IF;
  EXCEPTION
    WHEN others THEN
      v_role := 'worker'::user_role;
  END;

  INSERT INTO public.profiles (id, company_id, first_name, last_name, phone, role)
  VALUES (
    NEW.id,
    v_company_id,
    COALESCE(NULLIF(v_meta->>'first_name', ''), ''),
    COALESCE(NULLIF(v_meta->>'last_name', ''), ''),
    COALESCE(NULLIF(v_meta->>'phone', ''), ''),
    v_role
  )
  ON CONFLICT (id)
  DO UPDATE SET
    company_id = EXCLUDED.company_id,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role;

  RETURN NEW;
END;
$function$;

-- Ensure SECURITY DEFINER function runs with owner that bypasses RLS.
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

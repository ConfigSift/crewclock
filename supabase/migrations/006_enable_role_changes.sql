-- 006_enable_role_changes.sql
-- Enable secure role updates for owner/admin and ensure main account ownership/admin status.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Ensure onboarding-created companies store the creator as owner.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_company_id uuid;
  v_company_name text;
  v_slug text;
  v_role user_role := 'worker'::user_role;
  v_company_created boolean := false;
BEGIN
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
      SELECT 1 FROM public.companies c WHERE c.id = v_company_id
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
      v_role := (v_meta->>'role')::user_role;
    END IF;
  EXCEPTION
    WHEN others THEN
      v_role := 'worker'::user_role;
  END;

  IF v_company_created THEN
    v_role := 'admin'::user_role;
  END IF;

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

-- Managers cannot edit admin profiles; owner/admin retain broader edit rights.
CREATE OR REPLACE FUNCTION public.can_edit_profile(target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_actor_company uuid;
  v_target_company uuid;
  v_target_role user_role;
  v_actor_role user_role;
  v_owner_id uuid;
BEGIN
  IF auth.uid() IS NULL OR target_user_id IS NULL THEN
    RETURN false;
  END IF;

  v_actor_company := public.auth_company_id();
  IF v_actor_company IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.company_id, p.role
  INTO v_target_company, v_target_role
  FROM public.profiles p
  WHERE p.id = target_user_id
  LIMIT 1;

  IF v_target_company IS NULL OR v_target_company <> v_actor_company THEN
    RETURN false;
  END IF;

  v_actor_role := public.auth_role();
  v_owner_id := public.company_owner_id();

  IF public.is_company_owner() OR v_actor_role = 'admin' THEN
    RETURN true;
  END IF;

  IF v_actor_role = 'manager' THEN
    RETURN target_user_id <> v_owner_id
      AND v_target_role <> 'admin';
  END IF;

  RETURN false;
END;
$function$;

ALTER FUNCTION public.can_edit_profile(uuid) OWNER TO postgres;

-- Main account bootstrap: make phone 5868831100 admin + owner for its company.
WITH target_main AS (
  SELECT p.id, p.company_id
  FROM public.profiles p
  WHERE public.normalize_phone(p.phone) = public.normalize_phone('5868831100')
  ORDER BY p.created_at ASC
  LIMIT 1
)
UPDATE public.profiles p
SET role = 'admin'::user_role
FROM target_main t
WHERE p.id = t.id;

WITH target_main AS (
  SELECT p.id, p.company_id
  FROM public.profiles p
  WHERE public.normalize_phone(p.phone) = public.normalize_phone('5868831100')
  ORDER BY p.created_at ASC
  LIMIT 1
)
UPDATE public.companies c
SET owner_user_id = t.id
FROM target_main t
WHERE c.id = t.company_id;

-- Secure role change RPC: owner/admin only; owner remains admin.
CREATE OR REPLACE FUNCTION public.update_staff_role(
  p_user_id uuid,
  p_role user_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_company_id uuid;
  v_actor_role user_role;
  v_target_company_id uuid;
  v_owner_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.company_id, p.role
  INTO v_actor_company_id, v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF v_actor_company_id IS NULL THEN
    RAISE EXCEPTION 'Actor profile not found';
  END IF;

  SELECT c.owner_user_id
  INTO v_owner_id
  FROM public.companies c
  WHERE c.id = v_actor_company_id;

  IF NOT (v_actor_id = v_owner_id OR v_actor_role = 'admin') THEN
    RAISE EXCEPTION 'Only owner/admin can change roles';
  END IF;

  SELECT p.company_id
  INTO v_target_company_id
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_target_company_id IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  IF v_target_company_id <> v_actor_company_id THEN
    RAISE EXCEPTION 'Cannot change role outside your company';
  END IF;

  IF p_user_id = v_owner_id AND p_role <> 'admin'::user_role THEN
    RAISE EXCEPTION 'Protected owner account must remain admin';
  END IF;

  UPDATE public.profiles
  SET role = CASE
    WHEN p_user_id = v_owner_id THEN 'admin'::user_role
    ELSE p_role
  END
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
END;
$function$;

ALTER FUNCTION public.update_staff_role(uuid, user_role) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.update_staff_role(uuid, user_role) TO authenticated;

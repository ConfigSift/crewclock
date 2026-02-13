-- 006_admin_owner_and_staff_deletion.sql
-- Promote main account to owner/admin and enforce staff editing/deletion protections.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_companies_owner_user_id ON public.companies(owner_user_id);

-- Promote the main account by phone and assign company ownership.
WITH target_owner AS (
  SELECT p.id, p.company_id
  FROM public.profiles p
  WHERE public.normalize_phone(p.phone) = public.normalize_phone('5868831100')
  ORDER BY p.created_at ASC
  LIMIT 1
)
UPDATE public.profiles p
SET role = 'admin'::user_role
FROM target_owner t
WHERE p.id = t.id;

WITH target_owner AS (
  SELECT p.id, p.company_id
  FROM public.profiles p
  WHERE public.normalize_phone(p.phone) = public.normalize_phone('5868831100')
  ORDER BY p.created_at ASC
  LIMIT 1
)
UPDATE public.companies c
SET owner_user_id = t.id
FROM target_owner t
WHERE c.id = t.company_id;

-- Keep only the protected owner as admin in the target company.
WITH target_owner AS (
  SELECT p.id AS owner_id, p.company_id
  FROM public.profiles p
  WHERE public.normalize_phone(p.phone) = public.normalize_phone('5868831100')
  ORDER BY p.created_at ASC
  LIMIT 1
)
UPDATE public.profiles p
SET role = 'manager'::user_role
FROM target_owner t
WHERE p.company_id = t.company_id
  AND p.id <> t.owner_id
  AND p.role = 'admin'::user_role;

CREATE OR REPLACE FUNCTION public.company_owner_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
  SELECT c.owner_user_id
  FROM public.companies c
  WHERE c.id = public.auth_company_id()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_company_owner()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth.uid() = public.company_owner_id();
$$;

CREATE OR REPLACE FUNCTION public.is_protected_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
  SELECT p_user_id IS NOT NULL
    AND p_user_id = public.company_owner_id();
$$;

CREATE OR REPLACE FUNCTION public.can_edit_profile(target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_company uuid;
  v_actor_role user_role;
  v_target_company uuid;
  v_target_role user_role;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL OR target_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.company_id, p.role
  INTO v_actor_company, v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  SELECT p.company_id, p.role
  INTO v_target_company, v_target_role
  FROM public.profiles p
  WHERE p.id = target_user_id;

  IF v_actor_company IS NULL OR v_target_company IS NULL THEN
    RETURN false;
  END IF;

  IF v_target_company <> v_actor_company THEN
    RETURN false;
  END IF;

  IF target_user_id = public.company_owner_id() THEN
    RETURN false;
  END IF;

  IF v_actor_role = 'manager' AND v_target_role = 'admin' THEN
    RETURN false;
  END IF;

  RETURN v_actor_role IN ('manager', 'admin') OR public.is_company_owner();
END;
$function$;

-- Ensure onboarding-created companies always keep the creating user as owner.
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

-- Managers can edit worker/manager basics; admin/owner can edit non-owner basics.
CREATE OR REPLACE FUNCTION public.update_staff_profile(
  p_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text
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
  v_target_role user_role;
  v_owner_id uuid;
  v_first_name text;
  v_last_name text;
  v_phone text;
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

  IF v_actor_role NOT IN ('manager', 'admin')
    AND v_actor_id <> public.company_owner_id() THEN
    RAISE EXCEPTION 'Manager or admin access required';
  END IF;

  SELECT c.owner_user_id
  INTO v_owner_id
  FROM public.companies c
  WHERE c.id = v_actor_company_id;

  SELECT p.company_id, p.role
  INTO v_target_company_id, v_target_role
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_target_company_id IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  IF v_target_company_id <> v_actor_company_id THEN
    RAISE EXCEPTION 'Cannot edit staff outside your company';
  END IF;

  IF p_user_id = v_owner_id THEN
    RAISE EXCEPTION 'Protected admin account';
  END IF;

  IF v_actor_role = 'manager' AND v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Managers cannot edit admin accounts';
  END IF;

  v_first_name := NULLIF(TRIM(p_first_name), '');
  v_last_name := NULLIF(TRIM(p_last_name), '');
  v_phone := public.normalize_phone(p_phone);

  IF v_first_name IS NULL OR v_last_name IS NULL OR v_phone IS NULL THEN
    RAISE EXCEPTION 'First name, last name, and phone are required';
  END IF;

  UPDATE public.profiles
  SET first_name = v_first_name,
      last_name = v_last_name,
      phone = v_phone
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
END;
$function$;

-- Owner/admin can set only worker/manager; owner account remains admin.
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

  IF p_role NOT IN ('worker'::user_role, 'manager'::user_role) THEN
    RAISE EXCEPTION 'Role must be worker or manager';
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

-- Owner/admin can change active status for worker/manager only.
CREATE OR REPLACE FUNCTION public.set_staff_active(
  p_user_id uuid,
  p_is_active boolean
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
  v_target_role user_role;
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
    RAISE EXCEPTION 'Only owner/admin can change active status';
  END IF;

  SELECT p.company_id, p.role
  INTO v_target_company_id, v_target_role
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_target_company_id IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  IF v_target_company_id <> v_actor_company_id THEN
    RAISE EXCEPTION 'Cannot update staff outside your company';
  END IF;

  IF p_user_id = v_owner_id OR v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Cannot change active status for protected admin account';
  END IF;

  IF p_user_id = v_actor_id AND p_is_active = false THEN
    RAISE EXCEPTION 'Cannot deactivate your own account';
  END IF;

  UPDATE public.profiles
  SET is_active = p_is_active
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
END;
$function$;

-- Permission + cleanup RPC; auth.users/profile rows are removed by server admin API cascade.
CREATE OR REPLACE FUNCTION public.delete_staff(
  p_user_id uuid
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
  v_target_role user_role;
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
    RAISE EXCEPTION 'Only owner/admin can delete staff';
  END IF;

  IF p_user_id = v_actor_id THEN
    RAISE EXCEPTION 'Cannot delete your own account';
  END IF;

  SELECT p.company_id, p.role
  INTO v_target_company_id, v_target_role
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_target_company_id IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  IF v_target_company_id <> v_actor_company_id THEN
    RAISE EXCEPTION 'Cannot delete staff outside your company';
  END IF;

  IF p_user_id = v_owner_id OR v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Cannot delete protected admin account';
  END IF;

  DELETE FROM public.staff_credentials
  WHERE user_id = p_user_id;
END;
$function$;

ALTER FUNCTION public.company_owner_id() OWNER TO postgres;
ALTER FUNCTION public.is_company_owner() OWNER TO postgres;
ALTER FUNCTION public.is_protected_admin(uuid) OWNER TO postgres;
ALTER FUNCTION public.can_edit_profile(uuid) OWNER TO postgres;
ALTER FUNCTION public.update_staff_profile(uuid, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.update_staff_role(uuid, user_role) OWNER TO postgres;
ALTER FUNCTION public.set_staff_active(uuid, boolean) OWNER TO postgres;
ALTER FUNCTION public.delete_staff(uuid) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.company_owner_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_protected_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_staff_profile(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_staff_role(uuid, user_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_staff(uuid) TO authenticated;

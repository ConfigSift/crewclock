-- 005_staff_editing_and_admin_protection.sql
-- Staff editing controls with company owner protection and backend-enforced RPC updates.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A) Add company owner reference.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_companies_owner_user_id ON public.companies(owner_user_id);

-- Keep local normalize helper available for phone and backfill logic.
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_digits text;
BEGIN
  v_digits := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');

  IF v_digits = '' THEN
    RETURN NULL;
  END IF;

  IF length(v_digits) < 8 OR length(v_digits) > 15 THEN
    RETURN NULL;
  END IF;

  IF length(v_digits) = 10 THEN
    RETURN '+1' || v_digits;
  END IF;

  IF length(v_digits) = 11 AND left(v_digits, 1) = '1' THEN
    RETURN '+' || v_digits;
  END IF;

  RETURN '+' || v_digits;
END;
$function$;

-- B) Harden handle_new_user for onboarding + admin-created users.
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
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Backfill legacy rows with null owner_user_id.
WITH ranked_owner AS (
  SELECT
    p.company_id,
    p.id,
    row_number() OVER (
      PARTITION BY p.company_id
      ORDER BY
        CASE WHEN p.role = 'admin' THEN 0 ELSE 1 END,
        p.created_at ASC,
        p.id ASC
    ) AS rn
  FROM public.profiles p
)
UPDATE public.companies c
SET owner_user_id = ro.id
FROM ranked_owner ro
WHERE c.owner_user_id IS NULL
  AND c.id = ro.company_id
  AND ro.rn = 1;

-- F) Explicit existing business owner backfill for Genti Godo (phone 5868831100).
WITH target_owner AS (
  SELECT p.id, p.company_id
  FROM public.profiles p
  WHERE public.normalize_phone(p.phone) = public.normalize_phone('5868831100')
    AND p.role = 'admin'
  ORDER BY p.created_at ASC
  LIMIT 1
)
UPDATE public.companies c
SET owner_user_id = t.id
FROM target_owner t
WHERE c.id = t.company_id;

-- C) Helper permission functions.
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

  SELECT p.company_id
  INTO v_target_company
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
    RETURN target_user_id <> v_owner_id;
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_change_role(target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_actor_company uuid;
  v_target_company uuid;
BEGIN
  IF auth.uid() IS NULL OR target_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (public.is_company_owner() OR public.auth_role() = 'admin') THEN
    RETURN false;
  END IF;

  v_actor_company := public.auth_company_id();
  SELECT p.company_id INTO v_target_company
  FROM public.profiles p
  WHERE p.id = target_user_id;

  IF v_target_company IS NULL OR v_target_company <> v_actor_company THEN
    RETURN false;
  END IF;

  RETURN target_user_id <> public.company_owner_id();
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_change_status(target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_actor_company uuid;
  v_target_company uuid;
BEGIN
  IF auth.uid() IS NULL OR target_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (public.is_company_owner() OR public.auth_role() = 'admin') THEN
    RETURN false;
  END IF;

  v_actor_company := public.auth_company_id();
  SELECT p.company_id INTO v_target_company
  FROM public.profiles p
  WHERE p.id = target_user_id;

  IF v_target_company IS NULL OR v_target_company <> v_actor_company THEN
    RETURN false;
  END IF;

  RETURN target_user_id <> public.company_owner_id();
END;
$function$;

ALTER FUNCTION public.company_owner_id() OWNER TO postgres;
ALTER FUNCTION public.is_company_owner() OWNER TO postgres;
ALTER FUNCTION public.can_edit_profile(uuid) OWNER TO postgres;
ALTER FUNCTION public.can_change_role(uuid) OWNER TO postgres;
ALTER FUNCTION public.can_change_status(uuid) OWNER TO postgres;

-- D) Profiles UPDATE policy + trigger-based field protections.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Managers can update company profiles" ON public.profiles;
DROP POLICY IF EXISTS "Authorized profile updates" ON public.profiles;

CREATE POLICY "Authorized profile updates"
  ON public.profiles
  FOR UPDATE
  USING (public.can_edit_profile(id))
  WITH CHECK (
    company_id = public.auth_company_id()
    AND public.can_edit_profile(id)
  );

CREATE OR REPLACE FUNCTION public.enforce_profile_update_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'Cannot change company_id';
  END IF;

  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Cannot change id';
  END IF;

  IF OLD.id = public.company_owner_id()
    AND NOT (public.is_company_owner() OR public.auth_role() = 'admin') THEN
    RAISE EXCEPTION 'Protected admin account';
  END IF;

  IF NEW.role <> OLD.role AND NOT public.can_change_role(OLD.id) THEN
    RAISE EXCEPTION 'Not allowed to change role';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active
    AND NOT public.can_change_status(OLD.id) THEN
    RAISE EXCEPTION 'Not allowed to change active status';
  END IF;

  IF NEW.phone IS DISTINCT FROM OLD.phone THEN
    NEW.phone := public.normalize_phone(NEW.phone);
    IF NEW.phone IS NULL THEN
      RAISE EXCEPTION 'Phone number is required';
    END IF;
  END IF;

  IF NEW.is_active = false
    AND OLD.id = auth.uid()
    AND (public.is_company_owner() OR public.auth_role() = 'admin') THEN
    RAISE EXCEPTION 'Cannot deactivate your own owner/admin account';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enforce_profile_update_permissions() OWNER TO postgres;

DROP TRIGGER IF EXISTS trigger_profiles_update_permissions ON public.profiles;
CREATE TRIGGER trigger_profiles_update_permissions
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_update_permissions();

-- E) RPC functions for controlled staff editing.
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
  v_phone text;
BEGIN
  IF NOT public.can_edit_profile(p_user_id) THEN
    RAISE EXCEPTION 'Not allowed to edit this profile';
  END IF;

  IF p_user_id = public.company_owner_id()
    AND NOT (public.is_company_owner() OR public.auth_role() = 'admin') THEN
    RAISE EXCEPTION 'Protected admin account';
  END IF;

  v_phone := public.normalize_phone(p_phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Phone number is required';
  END IF;

  UPDATE public.profiles
  SET first_name = COALESCE(NULLIF(TRIM(p_first_name), ''), first_name),
      last_name = COALESCE(NULLIF(TRIM(p_last_name), ''), last_name),
      phone = v_phone
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_staff_role(
  p_user_id uuid,
  p_role user_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF NOT public.can_change_role(p_user_id) THEN
    RAISE EXCEPTION 'Not allowed to change role';
  END IF;

  IF p_user_id = public.company_owner_id() THEN
    RAISE EXCEPTION 'Cannot change protected admin role';
  END IF;

  UPDATE public.profiles
  SET role = p_role
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_staff_active(
  p_user_id uuid,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF NOT public.can_change_status(p_user_id) THEN
    RAISE EXCEPTION 'Not allowed to change active status';
  END IF;

  IF p_user_id = public.company_owner_id() AND p_is_active = false THEN
    RAISE EXCEPTION 'Cannot deactivate protected admin account';
  END IF;

  IF p_user_id = auth.uid()
    AND p_is_active = false
    AND (public.is_company_owner() OR public.auth_role() = 'admin') THEN
    RAISE EXCEPTION 'Cannot deactivate your own owner/admin account';
  END IF;

  UPDATE public.profiles
  SET is_active = p_is_active
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
END;
$function$;

ALTER FUNCTION public.update_staff_profile(uuid, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.update_staff_role(uuid, user_role) OWNER TO postgres;
ALTER FUNCTION public.set_staff_active(uuid, boolean) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.company_owner_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_change_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_change_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_staff_profile(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_staff_role(uuid, user_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_active(uuid, boolean) TO authenticated;

-- 3) Passcode reset protection: managers/admins can reset only non-owner accounts.
CREATE OR REPLACE FUNCTION public.set_staff_passcode(
  p_user_id uuid,
  p_phone text,
  p_passcode text
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
  v_phone text;
  v_owner_id uuid;
BEGIN
  v_phone := public.normalize_phone(p_phone);

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Phone number is required';
  END IF;

  IF p_passcode !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'Passcode must be exactly 6 digits';
  END IF;

  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT company_id, role
  INTO v_actor_company_id, v_actor_role
  FROM public.profiles
  WHERE id = v_actor_id;

  IF v_actor_company_id IS NULL THEN
    RAISE EXCEPTION 'Actor profile not found';
  END IF;

  IF v_actor_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'Insufficient role';
  END IF;

  SELECT company_id
  INTO v_target_company_id
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_target_company_id IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  IF v_target_company_id <> v_actor_company_id THEN
    RAISE EXCEPTION 'Cannot manage staff outside your company';
  END IF;

  SELECT c.owner_user_id
  INTO v_owner_id
  FROM public.companies c
  WHERE c.id = v_actor_company_id;

  IF p_user_id = v_owner_id THEN
    RAISE EXCEPTION 'Cannot reset passcode for protected admin account';
  END IF;

  UPDATE public.profiles
  SET phone = v_phone
  WHERE id = p_user_id;

  INSERT INTO public.staff_credentials (user_id, phone, passcode_hash)
  VALUES (p_user_id, v_phone, crypt(p_passcode, gen_salt('bf')))
  ON CONFLICT (user_id)
  DO UPDATE
    SET phone = EXCLUDED.phone,
        passcode_hash = EXCLUDED.passcode_hash,
        updated_at = now();
END;
$function$;

ALTER FUNCTION public.set_staff_passcode(uuid, text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.set_staff_passcode(uuid, text, text) TO authenticated;

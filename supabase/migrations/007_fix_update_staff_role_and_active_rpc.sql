-- 007_fix_update_staff_role_and_active_rpc.sql
-- Fix canonical RPC signatures used by API routes:
--   update_staff_role(p_user_id uuid, p_role user_role)
--   set_staff_active(p_user_id uuid, p_is_active boolean)

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Verification snippet:
-- select p.proname, pg_get_function_identity_arguments(p.oid) args
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'update_staff_role';
--
-- select p.proname, pg_get_function_identity_arguments(p.oid) args
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'set_staff_active';

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

  IF p_user_id = v_owner_id THEN
    UPDATE public.profiles
    SET role = 'admin'::user_role
    WHERE id = p_user_id;
    RETURN;
  END IF;

  IF p_role NOT IN ('worker'::user_role, 'manager'::user_role) THEN
    RAISE EXCEPTION 'Role must be worker or manager';
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
    RAISE EXCEPTION 'Only owner/admin can change active status';
  END IF;

  SELECT p.company_id
  INTO v_target_company_id
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_target_company_id IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  IF v_target_company_id <> v_actor_company_id THEN
    RAISE EXCEPTION 'Cannot update staff outside your company';
  END IF;

  IF p_is_active = false AND p_user_id = v_owner_id THEN
    RAISE EXCEPTION 'Cannot deactivate protected owner account';
  END IF;

  IF p_is_active = false AND p_user_id = v_actor_id THEN
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

ALTER FUNCTION public.update_staff_role(uuid, user_role) OWNER TO postgres;
ALTER FUNCTION public.set_staff_active(uuid, boolean) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.update_staff_role(uuid, user_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_active(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

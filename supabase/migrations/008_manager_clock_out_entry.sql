-- 008_manager_clock_out_entry.sql
-- Manager/admin/owner-assisted clock-out for an employee's active entry on a specific job.

CREATE OR REPLACE FUNCTION public.manager_clock_out_entry(
  p_employee_id uuid,
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_company_id uuid;
  v_actor_role user_role;
  v_owner_id uuid;
  v_entry public.time_entries%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_employee_id IS NULL OR p_project_id IS NULL THEN
    RAISE EXCEPTION 'employee_id and project_id are required';
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

  IF v_actor_role NOT IN ('manager', 'admin')
    AND v_actor_id <> v_owner_id THEN
    RAISE EXCEPTION 'Manager/admin/owner access required';
  END IF;

  SELECT te.*
  INTO v_entry
  FROM public.time_entries te
  WHERE te.company_id = v_actor_company_id
    AND te.employee_id = p_employee_id
    AND te.project_id = p_project_id
    AND te.clock_out IS NULL
  ORDER BY te.clock_in DESC
  LIMIT 1
  FOR UPDATE;

  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'No active clock-in found for this employee on this job';
  END IF;

  UPDATE public.time_entries te
  SET clock_out = NOW()
  WHERE te.id = v_entry.id
    AND te.clock_out IS NULL
  RETURNING te.* INTO v_entry;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active entry was already clocked out';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'entry_id', v_entry.id,
    'employee_id', v_entry.employee_id,
    'project_id', v_entry.project_id,
    'clock_out', v_entry.clock_out,
    'duration_seconds', EXTRACT(EPOCH FROM (v_entry.clock_out - v_entry.clock_in))
  );
END;
$function$;

ALTER FUNCTION public.manager_clock_out_entry(uuid, uuid) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.manager_clock_out_entry(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

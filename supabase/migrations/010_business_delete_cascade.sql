-- 010_business_delete_cascade.sql
-- Ensure deleting a business hard-deletes all business-scoped rows.

-- projects.business_id -> businesses.id should cascade on business delete.
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_business_id_fkey;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_business_id_fkey
  FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

-- time_entries.business_id -> businesses.id should cascade on business delete.
ALTER TABLE public.time_entries
  DROP CONSTRAINT IF EXISTS time_entries_business_id_fkey;

ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_business_id_fkey
  FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

-- Ensure useful business-scoped indexes exist.
CREATE INDEX IF NOT EXISTS idx_projects_business_status
  ON public.projects(business_id, status);

CREATE INDEX IF NOT EXISTS idx_time_entries_business_employee_clock_in
  ON public.time_entries(business_id, employee_id, clock_in DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_business_project_clock_in
  ON public.time_entries(business_id, project_id, clock_in DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_business_active
  ON public.time_entries(business_id)
  WHERE clock_out IS NULL;

CREATE INDEX IF NOT EXISTS idx_business_memberships_business_active
  ON public.business_memberships(business_id, is_active);

-- Server-side helper for deleting a business and returning basic impact counts.
CREATE OR REPLACE FUNCTION public.delete_business(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_projects_count integer := 0;
  v_time_entries_count integer := 0;
  v_memberships_count integer := 0;
  v_deleted_count integer := 0;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'p_business_id is required';
  END IF;

  SELECT COUNT(*) INTO v_projects_count
  FROM public.projects
  WHERE business_id = p_business_id;

  SELECT COUNT(*) INTO v_time_entries_count
  FROM public.time_entries
  WHERE business_id = p_business_id;

  SELECT COUNT(*) INTO v_memberships_count
  FROM public.business_memberships
  WHERE business_id = p_business_id;

  DELETE FROM public.businesses
  WHERE id = p_business_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted', v_deleted_count = 1,
    'business_id', p_business_id,
    'projects_deleted', v_projects_count,
    'time_entries_deleted', v_time_entries_count,
    'memberships_deleted', v_memberships_count
  );
END;
$function$;

ALTER FUNCTION public.delete_business(uuid) OWNER TO postgres;

-- Do not expose delete_business to anon/authenticated roles.
REVOKE ALL ON FUNCTION public.delete_business(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_business(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.delete_business(uuid) FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.delete_business(uuid) TO service_role;
  END IF;
END
$$;


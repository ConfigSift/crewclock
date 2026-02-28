-- 20260228183000_add_geofence_events.sql
-- Add geofence enter/exit event logging + optional time entry audit logging.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.geofence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  time_entry_id uuid NULL REFERENCES public.time_entries(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('enter', 'exit')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  distance_m double precision NOT NULL,
  inside boolean NOT NULL,
  source text NOT NULL DEFAULT 'mobile',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_geofence_events_business_occurred_at
  ON public.geofence_events(business_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_geofence_events_employee_occurred_at
  ON public.geofence_events(employee_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_geofence_events_project_occurred_at
  ON public.geofence_events(project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_geofence_events_time_entry_id
  ON public.geofence_events(time_entry_id);

CREATE TABLE IF NOT EXISTS public.time_entry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  time_entry_id uuid NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('clock_in', 'clock_out', 'manager_clock_out', 'edit')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  lat double precision NULL,
  lng double precision NULL,
  distance_m double precision NULL,
  inside boolean NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_entry_events_business_occurred_at
  ON public.time_entry_events(business_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_entry_events_time_entry_occurred_at
  ON public.time_entry_events(time_entry_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_entry_events_employee_occurred_at
  ON public.time_entry_events(employee_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.is_active_business_member(
  p_business_id uuid,
  p_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_memberships bm
    WHERE bm.business_id = p_business_id
      AND bm.profile_id = p_profile_id
      AND bm.is_active = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_manager_or_admin_for_business(
  p_business_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role public.user_role;
  v_actor_account_id uuid;
  v_actor_is_active boolean;
  v_business_account_id uuid;
BEGIN
  IF v_actor_id IS NULL OR p_business_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    p.role,
    COALESCE(p.account_id, p.company_id),
    COALESCE(p.is_active, false)
  INTO
    v_actor_role,
    v_actor_account_id,
    v_actor_is_active
  FROM public.profiles p
  WHERE p.id = v_actor_id
  LIMIT 1;

  IF v_actor_role IS NULL OR v_actor_is_active = false THEN
    RETURN false;
  END IF;

  SELECT b.account_id
  INTO v_business_account_id
  FROM public.businesses b
  WHERE b.id = p_business_id
  LIMIT 1;

  IF v_business_account_id IS NULL OR v_actor_account_id IS DISTINCT FROM v_business_account_id THEN
    RETURN false;
  END IF;

  IF v_actor_role = 'admin'::public.user_role THEN
    RETURN true;
  END IF;

  IF v_actor_role = 'manager'::public.user_role THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.business_memberships bm
      WHERE bm.business_id = p_business_id
        AND bm.profile_id = v_actor_id
        AND bm.is_active = true
        AND bm.role = 'manager'::public.business_membership_role
    );
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_for_business(
  p_business_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role public.user_role;
  v_actor_account_id uuid;
  v_actor_is_active boolean;
  v_business_account_id uuid;
BEGIN
  IF v_actor_id IS NULL OR p_business_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    p.role,
    COALESCE(p.account_id, p.company_id),
    COALESCE(p.is_active, false)
  INTO
    v_actor_role,
    v_actor_account_id,
    v_actor_is_active
  FROM public.profiles p
  WHERE p.id = v_actor_id
  LIMIT 1;

  IF v_actor_role IS DISTINCT FROM 'admin'::public.user_role OR v_actor_is_active = false THEN
    RETURN false;
  END IF;

  SELECT b.account_id
  INTO v_business_account_id
  FROM public.businesses b
  WHERE b.id = p_business_id
  LIMIT 1;

  IF v_business_account_id IS NULL OR v_actor_account_id IS DISTINCT FROM v_business_account_id THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_insert_geofence_event(
  p_business_id uuid,
  p_project_id uuid,
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role public.user_role;
  v_actor_account_id uuid;
  v_actor_is_active boolean;
  v_business_account_id uuid;
BEGIN
  IF v_actor_id IS NULL OR p_business_id IS NULL OR p_project_id IS NULL OR p_employee_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    p.role,
    COALESCE(p.account_id, p.company_id),
    COALESCE(p.is_active, false)
  INTO
    v_actor_role,
    v_actor_account_id,
    v_actor_is_active
  FROM public.profiles p
  WHERE p.id = v_actor_id
  LIMIT 1;

  IF v_actor_role IS NULL OR v_actor_is_active = false THEN
    RETURN false;
  END IF;

  SELECT b.account_id
  INTO v_business_account_id
  FROM public.businesses b
  WHERE b.id = p_business_id
  LIMIT 1;

  IF v_business_account_id IS NULL OR v_actor_account_id IS DISTINCT FROM v_business_account_id THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.projects pr
    WHERE pr.id = p_project_id
      AND pr.business_id = p_business_id
  ) THEN
    RETURN false;
  END IF;

  IF v_actor_role = 'worker'::public.user_role THEN
    RETURN v_actor_id = p_employee_id
      AND public.is_active_business_member(p_business_id, v_actor_id);
  END IF;

  IF v_actor_role IN ('manager'::public.user_role, 'admin'::public.user_role) THEN
    RETURN public.is_manager_or_admin_for_business(p_business_id)
      AND public.is_active_business_member(p_business_id, p_employee_id);
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_insert_time_entry_event(
  p_business_id uuid,
  p_time_entry_id uuid,
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role public.user_role;
  v_actor_account_id uuid;
  v_actor_is_active boolean;
  v_business_account_id uuid;
BEGIN
  IF v_actor_id IS NULL OR p_business_id IS NULL OR p_time_entry_id IS NULL OR p_employee_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    p.role,
    COALESCE(p.account_id, p.company_id),
    COALESCE(p.is_active, false)
  INTO
    v_actor_role,
    v_actor_account_id,
    v_actor_is_active
  FROM public.profiles p
  WHERE p.id = v_actor_id
  LIMIT 1;

  IF v_actor_role IS NULL OR v_actor_is_active = false THEN
    RETURN false;
  END IF;

  SELECT b.account_id
  INTO v_business_account_id
  FROM public.businesses b
  WHERE b.id = p_business_id
  LIMIT 1;

  IF v_business_account_id IS NULL OR v_actor_account_id IS DISTINCT FROM v_business_account_id THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.time_entries te
    WHERE te.id = p_time_entry_id
      AND te.business_id = p_business_id
      AND te.employee_id = p_employee_id
  ) THEN
    RETURN false;
  END IF;

  IF v_actor_role = 'worker'::public.user_role THEN
    RETURN v_actor_id = p_employee_id
      AND public.is_active_business_member(p_business_id, v_actor_id);
  END IF;

  IF v_actor_role IN ('manager'::public.user_role, 'admin'::public.user_role) THEN
    RETURN public.is_manager_or_admin_for_business(p_business_id)
      AND public.is_active_business_member(p_business_id, p_employee_id);
  END IF;

  RETURN false;
END;
$function$;

ALTER FUNCTION public.is_active_business_member(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.is_manager_or_admin_for_business(uuid) OWNER TO postgres;
ALTER FUNCTION public.is_admin_for_business(uuid) OWNER TO postgres;
ALTER FUNCTION public.can_insert_geofence_event(uuid, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.can_insert_time_entry_event(uuid, uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_active_business_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_manager_or_admin_for_business(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin_for_business(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_insert_geofence_event(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_insert_time_entry_event(uuid, uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.is_active_business_member(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_manager_or_admin_for_business(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_admin_for_business(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_insert_geofence_event(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_insert_time_entry_event(uuid, uuid, uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.is_active_business_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_or_admin_for_business(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_for_business(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_insert_geofence_event(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_insert_time_entry_event(uuid, uuid, uuid) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.is_active_business_member(uuid, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.is_manager_or_admin_for_business(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.is_admin_for_business(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.can_insert_geofence_event(uuid, uuid, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.can_insert_time_entry_event(uuid, uuid, uuid) TO service_role;
  END IF;
END
$$;

ALTER TABLE public.geofence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entry_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workers can view own geofence events" ON public.geofence_events;
CREATE POLICY "Workers can view own geofence events"
  ON public.geofence_events
  FOR SELECT
  USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "Managers can view business geofence events" ON public.geofence_events;
CREATE POLICY "Managers can view business geofence events"
  ON public.geofence_events
  FOR SELECT
  USING (public.is_manager_or_admin_for_business(business_id));

DROP POLICY IF EXISTS "Workers can insert own geofence events" ON public.geofence_events;
CREATE POLICY "Workers can insert own geofence events"
  ON public.geofence_events
  FOR INSERT
  WITH CHECK (
    employee_id = auth.uid()
    AND public.can_insert_geofence_event(business_id, project_id, employee_id)
  );

DROP POLICY IF EXISTS "Managers can insert business geofence events" ON public.geofence_events;
CREATE POLICY "Managers can insert business geofence events"
  ON public.geofence_events
  FOR INSERT
  WITH CHECK (
    public.is_manager_or_admin_for_business(business_id)
    AND public.can_insert_geofence_event(business_id, project_id, employee_id)
  );

DROP POLICY IF EXISTS "Admins can delete business geofence events" ON public.geofence_events;
CREATE POLICY "Admins can delete business geofence events"
  ON public.geofence_events
  FOR DELETE
  USING (public.is_admin_for_business(business_id));

DROP POLICY IF EXISTS "Workers can view own time entry events" ON public.time_entry_events;
CREATE POLICY "Workers can view own time entry events"
  ON public.time_entry_events
  FOR SELECT
  USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "Managers can view business time entry events" ON public.time_entry_events;
CREATE POLICY "Managers can view business time entry events"
  ON public.time_entry_events
  FOR SELECT
  USING (public.is_manager_or_admin_for_business(business_id));

DROP POLICY IF EXISTS "Workers can insert own time entry events" ON public.time_entry_events;
CREATE POLICY "Workers can insert own time entry events"
  ON public.time_entry_events
  FOR INSERT
  WITH CHECK (
    employee_id = auth.uid()
    AND public.can_insert_time_entry_event(business_id, time_entry_id, employee_id)
  );

DROP POLICY IF EXISTS "Managers can insert business time entry events" ON public.time_entry_events;
CREATE POLICY "Managers can insert business time entry events"
  ON public.time_entry_events
  FOR INSERT
  WITH CHECK (
    public.is_manager_or_admin_for_business(business_id)
    AND public.can_insert_time_entry_event(business_id, time_entry_id, employee_id)
  );

DROP POLICY IF EXISTS "Admins can delete business time entry events" ON public.time_entry_events;
CREATE POLICY "Admins can delete business time entry events"
  ON public.time_entry_events
  FOR DELETE
  USING (public.is_admin_for_business(business_id));

GRANT SELECT, INSERT, DELETE ON public.geofence_events TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.time_entry_events TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.geofence_events TO service_role;
    GRANT ALL ON public.time_entry_events TO service_role;
  END IF;
END
$$;

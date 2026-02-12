-- ============================================================
-- CrewClock: Complete Supabase Database Schema
-- Run this in the Supabase SQL Editor (or via supabase db push)
-- ============================================================

-- ─── EXTENSIONS ──────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "earthdistance" CASCADE; -- requires cube extension

-- ─── ENUMS ───────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('worker', 'manager', 'admin');
CREATE TYPE project_status AS ENUM ('active', 'archived', 'completed');

-- ─── COMPANIES ───────────────────────────────────────
CREATE TABLE companies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  settings    JSONB DEFAULT '{"geo_radius_meters": 300, "timezone": "America/New_York"}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PROFILES (linked to auth.users) ────────────────
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  phone       TEXT NOT NULL,
  role        user_role NOT NULL DEFAULT 'worker',
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_company ON profiles(company_id);
CREATE INDEX idx_profiles_company_role ON profiles(company_id, role);

-- ─── PROJECTS (JOBS) ────────────────────────────────
CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  address       TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  geo_radius_m  INTEGER DEFAULT 300,
  status        project_status DEFAULT 'active',
  created_by    UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_projects_company_status ON projects(company_id, status);

-- ─── TIME ENTRIES ────────────────────────────────────
CREATE TABLE time_entries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clock_in      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clock_out     TIMESTAMPTZ,
  clock_in_lat  DOUBLE PRECISION,
  clock_in_lng  DOUBLE PRECISION,
  clock_out_lat DOUBLE PRECISION,
  clock_out_lng DOUBLE PRECISION,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Generated column for duration (only when clocked out)
ALTER TABLE time_entries
  ADD COLUMN duration_seconds DOUBLE PRECISION
  GENERATED ALWAYS AS (
    CASE WHEN clock_out IS NOT NULL
      THEN EXTRACT(EPOCH FROM clock_out - clock_in)
      ELSE NULL
    END
  ) STORED;

CREATE INDEX idx_time_entries_employee ON time_entries(company_id, employee_id, clock_in DESC);
CREATE INDEX idx_time_entries_project ON time_entries(company_id, project_id, clock_in DESC);
CREATE INDEX idx_time_entries_active ON time_entries(employee_id) WHERE clock_out IS NULL;

-- ─── HELPER FUNCTION: distance in meters ─────────────
CREATE OR REPLACE FUNCTION distance_meters(
  lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION AS $$
BEGIN
  RETURN (
    point(lng1, lat1) <@> point(lng2, lat2)
  ) * 1609.344; -- earth_distance returns statute miles, convert to meters
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── FUNCTION: Clock In (with geo-validation) ────────
CREATE OR REPLACE FUNCTION clock_in(
  p_project_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
) RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_company_id UUID;
  v_project RECORD;
  v_distance DOUBLE PRECISION;
  v_radius INTEGER;
  v_active_count INTEGER;
  v_entry_id UUID;
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Get user's company
  SELECT company_id INTO v_company_id FROM profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Profile not found');
  END IF;

  -- Get project details
  SELECT * INTO v_project FROM projects
  WHERE id = p_project_id AND company_id = v_company_id AND status = 'active';
  IF v_project IS NULL THEN
    RETURN jsonb_build_object('error', 'Project not found or inactive');
  END IF;

  -- Check for existing active clock-in
  SELECT COUNT(*) INTO v_active_count FROM time_entries
  WHERE employee_id = v_user_id AND clock_out IS NULL;
  IF v_active_count > 0 THEN
    RETURN jsonb_build_object('error', 'Already clocked in to a project');
  END IF;

  -- Calculate distance
  v_distance := distance_meters(p_lat, p_lng, v_project.lat, v_project.lng);

  -- Get effective radius (per-job override or company default)
  v_radius := COALESCE(
    v_project.geo_radius_m,
    (SELECT (settings->>'geo_radius_meters')::INTEGER FROM companies WHERE id = v_company_id),
    300
  );

  -- Validate distance
  IF v_distance > v_radius THEN
    RETURN jsonb_build_object(
      'error', 'Too far from job site',
      'distance_m', ROUND(v_distance::NUMERIC),
      'radius_m', v_radius
    );
  END IF;

  -- Insert time entry
  INSERT INTO time_entries (company_id, employee_id, project_id, clock_in, clock_in_lat, clock_in_lng)
  VALUES (v_company_id, v_user_id, p_project_id, NOW(), p_lat, p_lng)
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'entry_id', v_entry_id,
    'distance_m', ROUND(v_distance::NUMERIC)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── FUNCTION: Clock Out ─────────────────────────────
CREATE OR REPLACE FUNCTION clock_out(
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_entry RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Find active entry
  SELECT * INTO v_entry FROM time_entries
  WHERE employee_id = v_user_id AND clock_out IS NULL
  LIMIT 1;

  IF v_entry IS NULL THEN
    RETURN jsonb_build_object('error', 'No active clock-in found');
  END IF;

  -- Update entry
  UPDATE time_entries
  SET clock_out = NOW(),
      clock_out_lat = p_lat,
      clock_out_lng = p_lng
  WHERE id = v_entry.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'entry_id', v_entry.id,
    'duration_seconds', EXTRACT(EPOCH FROM NOW() - v_entry.clock_in)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── FUNCTION: Get hours summary ─────────────────────
CREATE OR REPLACE FUNCTION get_hours_summary(
  p_employee_id UUID DEFAULT NULL,
  p_project_id UUID DEFAULT NULL,
  p_period TEXT DEFAULT 'week'  -- 'week', 'month', 'year'
) RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_company_id UUID;
  v_start_date TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  SELECT company_id INTO v_company_id FROM profiles WHERE id = v_user_id;

  -- Calculate period start
  v_start_date := CASE p_period
    WHEN 'week' THEN date_trunc('week', NOW())
    WHEN 'month' THEN date_trunc('month', NOW())
    WHEN 'year' THEN date_trunc('year', NOW())
    ELSE date_trunc('week', NOW())
  END;

  SELECT jsonb_build_object(
    'total_seconds', COALESCE(SUM(
      EXTRACT(EPOCH FROM COALESCE(te.clock_out, NOW()) - te.clock_in)
    ), 0),
    'entry_count', COUNT(*)
  ) INTO v_result
  FROM time_entries te
  WHERE te.company_id = v_company_id
    AND te.clock_in >= v_start_date
    AND (p_employee_id IS NULL OR te.employee_id = p_employee_id)
    AND (p_project_id IS NULL OR te.project_id = p_project_id);

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── VIEW: Active Sessions ──────────────────────────
CREATE OR REPLACE VIEW v_active_sessions AS
SELECT
  te.id AS entry_id,
  te.company_id,
  te.employee_id,
  te.project_id,
  te.clock_in,
  te.clock_in_lat,
  te.clock_in_lng,
  p.first_name,
  p.last_name,
  p.phone,
  pr.name AS project_name,
  pr.address AS project_address,
  pr.lat AS project_lat,
  pr.lng AS project_lng,
  EXTRACT(EPOCH FROM NOW() - te.clock_in) AS elapsed_seconds
FROM time_entries te
JOIN profiles p ON p.id = te.employee_id
JOIN projects pr ON pr.id = te.project_id
WHERE te.clock_out IS NULL;

-- ─── ROW LEVEL SECURITY ─────────────────────────────

-- Enable RLS on all tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's company_id
CREATE OR REPLACE FUNCTION auth_company_id() RETURNS UUID AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION auth_role() RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- COMPANIES
CREATE POLICY "Users can view own company"
  ON companies FOR SELECT
  USING (id = auth_company_id());

-- PROFILES
CREATE POLICY "Workers can view own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Managers can view company profiles"
  ON profiles FOR SELECT
  USING (
    company_id = auth_company_id()
    AND auth_role() IN ('manager', 'admin')
  );

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Managers can update company profiles"
  ON profiles FOR UPDATE
  USING (
    company_id = auth_company_id()
    AND auth_role() IN ('manager', 'admin')
  );

-- PROJECTS
CREATE POLICY "Workers can view active company projects"
  ON projects FOR SELECT
  USING (
    company_id = auth_company_id()
    AND status = 'active'
  );

CREATE POLICY "Managers can view all company projects"
  ON projects FOR SELECT
  USING (
    company_id = auth_company_id()
    AND auth_role() IN ('manager', 'admin')
  );

CREATE POLICY "Managers can insert company projects"
  ON projects FOR INSERT
  WITH CHECK (
    company_id = auth_company_id()
    AND auth_role() IN ('manager', 'admin')
  );

CREATE POLICY "Managers can update company projects"
  ON projects FOR UPDATE
  USING (
    company_id = auth_company_id()
    AND auth_role() IN ('manager', 'admin')
  );

CREATE POLICY "Managers can delete company projects"
  ON projects FOR DELETE
  USING (
    company_id = auth_company_id()
    AND auth_role() IN ('manager', 'admin')
  );

-- TIME ENTRIES
CREATE POLICY "Workers can view own entries"
  ON time_entries FOR SELECT
  USING (employee_id = auth.uid());

CREATE POLICY "Managers can view company entries"
  ON time_entries FOR SELECT
  USING (
    company_id = auth_company_id()
    AND auth_role() IN ('manager', 'admin')
  );

CREATE POLICY "Workers can insert own entries"
  ON time_entries FOR INSERT
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "Workers can update own active entries"
  ON time_entries FOR UPDATE
  USING (employee_id = auth.uid() AND clock_out IS NULL);

CREATE POLICY "Managers can update company entries"
  ON time_entries FOR UPDATE
  USING (
    company_id = auth_company_id()
    AND auth_role() IN ('manager', 'admin')
  );

-- ─── TRIGGER: auto-update updated_at ─────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── TRIGGER: auto-create profile on signup ──────────
-- This function is called by a Supabase Auth hook
-- You'll configure this in Supabase Dashboard > Auth > Hooks
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_company_id UUID;
  v_meta JSONB;
BEGIN
  v_meta := NEW.raw_user_meta_data;

  -- Find or create company
  SELECT id INTO v_company_id FROM companies
  WHERE slug = lower(replace(v_meta->>'company', ' ', '-'))
  LIMIT 1;

  IF v_company_id IS NULL THEN
    INSERT INTO companies (name, slug)
    VALUES (
      v_meta->>'company',
      lower(replace(v_meta->>'company', ' ', '-'))
    )
    RETURNING id INTO v_company_id;
  END IF;

  -- Create profile
  INSERT INTO profiles (id, company_id, first_name, last_name, phone, role)
  VALUES (
    NEW.id,
    v_company_id,
    COALESCE(v_meta->>'first_name', ''),
    COALESCE(v_meta->>'last_name', ''),
    COALESCE(v_meta->>'phone', ''),
    COALESCE((v_meta->>'role')::user_role, 'worker')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Hook into Supabase Auth
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── GRANT ACCESS ────────────────────────────────────
-- Supabase uses 'authenticated' and 'anon' roles
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION clock_in TO authenticated;
GRANT EXECUTE ON FUNCTION clock_out TO authenticated;
GRANT EXECUTE ON FUNCTION get_hours_summary TO authenticated;
GRANT EXECUTE ON FUNCTION auth_company_id TO authenticated;
GRANT EXECUTE ON FUNCTION auth_role TO authenticated;
GRANT SELECT ON v_active_sessions TO authenticated;

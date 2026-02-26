-- 009_multi_business_billing_schema.sql
-- Multi-business support + per-business billing.

-- Ensure base role enum includes the expected values.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'worker';

-- Account container (owner can manage multiple businesses).
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounts_owner_profile_id
  ON public.accounts(owner_profile_id);

-- Business-level billing data.
CREATE TABLE IF NOT EXISTS public.businesses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  billing_status text NOT NULL DEFAULT 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  billing_started_at timestamptz,
  billing_canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT businesses_account_name_key UNIQUE (account_id, name),
  CONSTRAINT businesses_billing_status_check CHECK (
    billing_status IN ('inactive', 'trialing', 'active', 'past_due', 'canceled', 'unpaid')
  )
);

CREATE INDEX IF NOT EXISTS idx_businesses_account_id
  ON public.businesses(account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_stripe_customer_id
  ON public.businesses(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_stripe_subscription_id
  ON public.businesses(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'business_membership_role'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.business_membership_role AS ENUM ('manager', 'worker');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.business_memberships (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.business_membership_role NOT NULL DEFAULT 'worker',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_memberships_business_profile_key UNIQUE (business_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_business_memberships_profile_id
  ON public.business_memberships(profile_id);

CREATE INDEX IF NOT EXISTS idx_business_memberships_business_active
  ON public.business_memberships(business_id, is_active);

-- Profiles updates.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

UPDATE public.profiles
SET first_name = ''
WHERE first_name IS NULL;

UPDATE public.profiles
SET last_name = ''
WHERE last_name IS NULL;

UPDATE public.profiles
SET is_active = true
WHERE is_active IS NULL;

UPDATE public.profiles p
SET phone = public.normalize_phone(p.phone)
WHERE p.phone IS DISTINCT FROM public.normalize_phone(p.phone);

DO $$
DECLARE
  v_invalid_count integer;
  v_duplicate_count integer;
BEGIN
  SELECT COUNT(*)
  INTO v_invalid_count
  FROM public.profiles p
  WHERE p.phone IS NULL
    OR p.phone !~ '^\+[1-9][0-9]{7,14}$';

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION
      'profiles.phone contains % non-E.164 values; clean data before enforcing phone constraints',
      v_invalid_count;
  END IF;

  SELECT COUNT(*)
  INTO v_duplicate_count
  FROM (
    SELECT p.phone
    FROM public.profiles p
    GROUP BY p.phone
    HAVING COUNT(*) > 1
  ) dup;

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION
      'profiles.phone contains % duplicate values; clean data before enforcing unique phone constraint',
      v_duplicate_count;
  END IF;
END
$$;

ALTER TABLE public.profiles
  ALTER COLUMN first_name SET NOT NULL,
  ALTER COLUMN last_name SET NOT NULL,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN phone SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_phone_e164_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_phone_e164_check
      CHECK (phone ~ '^\+[1-9][0-9]{7,14}$');
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique
  ON public.profiles(phone);

CREATE INDEX IF NOT EXISTS idx_profiles_account_id
  ON public.profiles(account_id);

-- Backfill one account + one default business for each legacy company.
INSERT INTO public.accounts (id, owner_profile_id, created_at, updated_at)
SELECT
  c.id,
  p.id,
  COALESCE(c.created_at, now()),
  now()
FROM public.companies c
LEFT JOIN public.profiles p
  ON p.id = c.owner_user_id
ON CONFLICT (id) DO UPDATE
SET owner_profile_id = COALESCE(accounts.owner_profile_id, EXCLUDED.owner_profile_id),
    updated_at = now();

INSERT INTO public.businesses (
  id,
  account_id,
  name,
  created_at,
  updated_at
)
SELECT
  c.id,
  c.id,
  c.name,
  COALESCE(c.created_at, now()),
  now()
FROM public.companies c
JOIN public.accounts a
  ON a.id = c.id
ON CONFLICT (id) DO UPDATE
SET account_id = EXCLUDED.account_id,
    name = EXCLUDED.name,
    updated_at = now();

UPDATE public.profiles p
SET account_id = p.company_id
WHERE p.account_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = p.company_id
  );

INSERT INTO public.business_memberships (
  business_id,
  profile_id,
  role,
  is_active,
  created_at,
  updated_at
)
SELECT
  p.company_id,
  p.id,
  CASE
    WHEN p.role = 'worker'::public.user_role THEN 'worker'::public.business_membership_role
    ELSE 'manager'::public.business_membership_role
  END AS role,
  COALESCE(p.is_active, true),
  COALESCE(p.created_at, now()),
  now()
FROM public.profiles p
JOIN public.businesses b
  ON b.id = p.company_id
ON CONFLICT (business_id, profile_id) DO UPDATE
SET role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    updated_at = now();

-- Add business FK references to existing domain tables.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS business_id uuid;

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS business_id uuid;

UPDATE public.projects pr
SET business_id = pr.company_id
WHERE pr.business_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.id = pr.company_id
  );

UPDATE public.time_entries te
SET business_id = te.company_id
WHERE te.business_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.id = te.company_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_business_id_fkey'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'time_entries_business_id_fkey'
      AND conrelid = 'public.time_entries'::regclass
  ) THEN
    ALTER TABLE public.time_entries
      ADD CONSTRAINT time_entries_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_projects_business_status
  ON public.projects(business_id, status);

CREATE INDEX IF NOT EXISTS idx_time_entries_business_employee_clock_in
  ON public.time_entries(business_id, employee_id, clock_in DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_business_project_clock_in
  ON public.time_entries(business_id, project_id, clock_in DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_business_active
  ON public.time_entries(business_id)
  WHERE clock_out IS NULL;

-- Keep old write paths working while they still send company_id only.
CREATE OR REPLACE FUNCTION public.set_profile_account_id_from_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF NEW.account_id IS NULL
    AND NEW.company_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = NEW.company_id) THEN
    NEW.account_id := NEW.company_id;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.set_profile_account_id_from_company() OWNER TO postgres;

DROP TRIGGER IF EXISTS trigger_profiles_set_account_id_from_company ON public.profiles;
CREATE TRIGGER trigger_profiles_set_account_id_from_company
  BEFORE INSERT OR UPDATE OF company_id, account_id
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_profile_account_id_from_company();

CREATE OR REPLACE FUNCTION public.set_business_id_from_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF NEW.business_id IS NULL
    AND NEW.company_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = NEW.company_id) THEN
    NEW.business_id := NEW.company_id;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.set_business_id_from_company() OWNER TO postgres;

DROP TRIGGER IF EXISTS trigger_projects_set_business_id_from_company ON public.projects;
CREATE TRIGGER trigger_projects_set_business_id_from_company
  BEFORE INSERT OR UPDATE OF company_id, business_id
  ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_business_id_from_company();

DROP TRIGGER IF EXISTS trigger_time_entries_set_business_id_from_company ON public.time_entries;
CREATE TRIGGER trigger_time_entries_set_business_id_from_company
  BEFORE INSERT OR UPDATE OF company_id, business_id
  ON public.time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_business_id_from_company();

-- Rebuild active sessions view with business-aware joins.
CREATE OR REPLACE VIEW public.v_active_sessions AS
SELECT
  te.id AS entry_id,
  te.company_id,
  COALESCE(te.business_id, pr.business_id, te.company_id) AS business_id,
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
  EXTRACT(EPOCH FROM now() - te.clock_in) AS elapsed_seconds
FROM public.time_entries te
JOIN public.profiles p
  ON p.id = te.employee_id
 AND p.company_id = te.company_id
JOIN public.projects pr
  ON pr.id = te.project_id
 AND pr.company_id = te.company_id
 AND (
   te.business_id IS NULL
   OR pr.business_id IS NULL
   OR pr.business_id = te.business_id
 )
WHERE te.clock_out IS NULL;


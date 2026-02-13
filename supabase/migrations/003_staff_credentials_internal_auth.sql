-- 003_staff_credentials_internal_auth.sql
-- Adds internal staff passcode credentials and company-scoped staff auth helpers.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.staff_credentials (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text UNIQUE NOT NULL,
  passcode_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_credentials_phone ON public.staff_credentials(phone);

DROP TRIGGER IF EXISTS trigger_staff_credentials_updated_at ON public.staff_credentials;
CREATE TRIGGER trigger_staff_credentials_updated_at
  BEFORE UPDATE ON public.staff_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.staff_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can view company staff credentials" ON public.staff_credentials;
CREATE POLICY "Managers can view company staff credentials"
  ON public.staff_credentials
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles actor
      JOIN public.profiles target ON target.id = staff_credentials.user_id
      WHERE actor.id = auth.uid()
        AND actor.company_id = target.company_id
        AND actor.role IN ('manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "Managers can insert company staff credentials" ON public.staff_credentials;
CREATE POLICY "Managers can insert company staff credentials"
  ON public.staff_credentials
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles actor
      JOIN public.profiles target ON target.id = staff_credentials.user_id
      WHERE actor.id = auth.uid()
        AND actor.company_id = target.company_id
        AND actor.role IN ('manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "Managers can update company staff credentials" ON public.staff_credentials;
CREATE POLICY "Managers can update company staff credentials"
  ON public.staff_credentials
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles actor
      JOIN public.profiles target ON target.id = staff_credentials.user_id
      WHERE actor.id = auth.uid()
        AND actor.company_id = target.company_id
        AND actor.role IN ('manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles actor
      JOIN public.profiles target ON target.id = staff_credentials.user_id
      WHERE actor.id = auth.uid()
        AND actor.company_id = target.company_id
        AND actor.role IN ('manager', 'admin')
    )
  );

CREATE OR REPLACE FUNCTION public.set_staff_passcode(
  p_user_id uuid,
  p_phone text,
  p_passcode text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_company_id uuid;
  v_actor_role user_role;
  v_target_company_id uuid;
  v_phone text;
BEGIN
  v_phone := trim(p_phone);

  IF v_phone IS NULL OR v_phone = '' THEN
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

CREATE OR REPLACE FUNCTION public.verify_staff_passcode(
  p_phone text,
  p_passcode text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT sc.user_id
  INTO v_user_id
  FROM public.staff_credentials sc
  JOIN public.profiles p ON p.id = sc.user_id
  WHERE sc.phone = trim(p_phone)
    AND p.is_active = true
    AND sc.passcode_hash = crypt(p_passcode, sc.passcode_hash)
  LIMIT 1;

  RETURN v_user_id;
END;
$function$;

GRANT SELECT, INSERT, UPDATE ON public.staff_credentials TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_passcode(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_staff_passcode(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_company_id uuid;
  v_meta jsonb;
  v_company_name text;
  v_slug text;
  v_role user_role;
BEGIN
  v_meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);

  BEGIN
    v_company_id := NULLIF(v_meta->>'company_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_company_id := NULL;
  END;

  IF v_company_id IS NOT NULL THEN
    PERFORM 1
    FROM public.companies
    WHERE id = v_company_id;

    IF NOT FOUND THEN
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

    SELECT id
    INTO v_company_id
    FROM public.companies
    WHERE slug = v_slug
    LIMIT 1;

    IF v_company_id IS NULL THEN
      INSERT INTO public.companies (name, slug)
      VALUES (v_company_name, v_slug)
      ON CONFLICT (slug) DO NOTHING
      RETURNING id INTO v_company_id;

      IF v_company_id IS NULL THEN
        SELECT id
        INTO v_company_id
        FROM public.companies
        WHERE slug = v_slug
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  BEGIN
    v_role := COALESCE(NULLIF(v_meta->>'role', '')::user_role, 'worker'::user_role);
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

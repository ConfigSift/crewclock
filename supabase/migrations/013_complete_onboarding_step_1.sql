-- 013_complete_onboarding_step_1.sql
-- Complete onboarding step 1 atomically: profile update + business create + membership + step progress.

CREATE OR REPLACE FUNCTION public.complete_onboarding_step_1(
  p_first_name text,
  p_last_name text,
  p_business_name text,
  p_address_line1 text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_country text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_first_name text := trim(COALESCE(p_first_name, ''));
  v_last_name text := trim(COALESCE(p_last_name, ''));
  v_business_name text := trim(COALESCE(p_business_name, ''));
  v_address_line1 text := NULLIF(trim(COALESCE(p_address_line1, '')), '');
  v_city text := NULLIF(trim(COALESCE(p_city, '')), '');
  v_state text := NULLIF(trim(COALESCE(p_state, '')), '');
  v_postal_code text := NULLIF(trim(COALESCE(p_postal_code, '')), '');
  v_country text := NULLIF(trim(COALESCE(p_country, '')), '');
  v_business_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Unable to load your profile.';
  END IF;

  IF v_profile.role <> 'admin' THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  IF v_profile.is_active = false THEN
    RAISE EXCEPTION 'Your account is inactive.';
  END IF;

  IF v_profile.account_id IS NULL THEN
    RAISE EXCEPTION 'Unable to determine account.';
  END IF;

  IF v_first_name = '' THEN
    RAISE EXCEPTION 'First name is required.';
  END IF;

  IF v_last_name = '' THEN
    RAISE EXCEPTION 'Last name is required.';
  END IF;

  IF v_business_name = '' THEN
    RAISE EXCEPTION 'Business name is required.';
  END IF;

  IF COALESCE(v_profile.onboarding_step_completed, 0) >= 1 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_completed', true,
      'onboarding_step_completed', v_profile.onboarding_step_completed,
      'next_path',
      CASE
        WHEN COALESCE(v_profile.onboarding_step_completed, 0) >= 3 THEN '/dashboard'
        ELSE '/onboarding/step-2'
      END
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.account_id = v_profile.account_id
      AND lower(b.name) = lower(v_business_name)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'A business with this name already exists in your account.';
  END IF;

  UPDATE public.profiles
  SET
    first_name = v_first_name,
    last_name = v_last_name
  WHERE id = v_user_id;

  INSERT INTO public.businesses (
    account_id,
    name,
    address_line1,
    city,
    state,
    postal_code,
    country,
    billing_status
  )
  VALUES (
    v_profile.account_id,
    v_business_name,
    v_address_line1,
    v_city,
    v_state,
    v_postal_code,
    v_country,
    'inactive'
  )
  RETURNING id INTO v_business_id;

  INSERT INTO public.business_memberships (
    business_id,
    profile_id,
    role,
    is_active
  )
  VALUES (
    v_business_id,
    v_user_id,
    'manager',
    true
  )
  ON CONFLICT (business_id, profile_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    is_active = true,
    updated_at = now();

  UPDATE public.profiles
  SET onboarding_step_completed = 1
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'business_id', v_business_id,
    'onboarding_step_completed', 1,
    'next_path', '/onboarding/step-2'
  );
END;
$function$;

ALTER FUNCTION public.complete_onboarding_step_1(text, text, text, text, text, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.complete_onboarding_step_1(text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_onboarding_step_1(text, text, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding_step_1(text, text, text, text, text, text, text, text) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.complete_onboarding_step_1(text, text, text, text, text, text, text, text) TO service_role;
  END IF;
END
$$;

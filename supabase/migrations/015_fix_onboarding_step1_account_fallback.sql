-- 015_fix_onboarding_step1_account_fallback.sql
-- Derive account_id for onboarding step 1 from profile.account_id, then profile.company_id, then new account.

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
  v_account_id uuid;
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

  IF v_first_name = '' THEN
    RAISE EXCEPTION 'First name is required.';
  END IF;

  IF v_last_name = '' THEN
    RAISE EXCEPTION 'Last name is required.';
  END IF;

  IF v_business_name = '' THEN
    RAISE EXCEPTION 'Business name is required.';
  END IF;

  -- Account precedence:
  -- 1) profiles.account_id
  -- 2) profiles.company_id (legacy)
  -- 3) create new account
  v_account_id := COALESCE(v_profile.account_id, v_profile.company_id);

  IF v_account_id IS NULL THEN
    INSERT INTO public.accounts (owner_profile_id)
    VALUES (v_user_id)
    RETURNING id INTO v_account_id;
  ELSE
    -- Ensure account row exists for the resolved id (legacy company_id fallback).
    INSERT INTO public.accounts (id, owner_profile_id)
    VALUES (v_account_id, v_user_id)
    ON CONFLICT (id)
    DO UPDATE SET
      owner_profile_id = COALESCE(public.accounts.owner_profile_id, EXCLUDED.owner_profile_id),
      updated_at = now();
  END IF;

  IF v_profile.account_id IS NULL THEN
    UPDATE public.profiles
    SET account_id = v_account_id
    WHERE id = v_user_id;
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
    WHERE b.account_id = v_account_id
      AND lower(b.name) = lower(v_business_name)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'A business with this name already exists in your account.';
  END IF;

  UPDATE public.profiles
  SET
    first_name = v_first_name,
    last_name = v_last_name,
    account_id = COALESCE(account_id, v_account_id)
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
    v_account_id,
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

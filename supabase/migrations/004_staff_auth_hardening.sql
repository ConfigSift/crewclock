-- 004_staff_auth_hardening.sql
-- Hardening updates: canonical phone normalization and passcode verify/set safeguards.

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
  v_phone text;
BEGIN
  IF p_passcode !~ '^[0-9]{6}$' THEN
    RETURN NULL;
  END IF;

  v_phone := public.normalize_phone(p_phone);
  IF v_phone IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT sc.user_id
  INTO v_user_id
  FROM public.staff_credentials sc
  JOIN public.profiles p ON p.id = sc.user_id
  WHERE public.normalize_phone(sc.phone) = v_phone
    AND p.is_active = true
    AND sc.passcode_hash = crypt(p_passcode, sc.passcode_hash)
  LIMIT 1;

  RETURN v_user_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO anon, authenticated;

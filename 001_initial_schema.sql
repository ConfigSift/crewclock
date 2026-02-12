-- Fix handle_new_user: safe company upsert + tolerant metadata keys + safe role parsing
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_company_id   uuid;
  v_meta         jsonb;
  v_company_name text;
  v_slug         text;
  v_role         user_role;
BEGIN
  v_meta := NEW.raw_user_meta_data;

  -- Accept multiple possible keys for company name
  v_company_name :=
    NULLIF(TRIM(COALESCE(
      v_meta->>'company',
      v_meta->>'company_name',
      v_meta->>'companyName'
    )), '');

  IF v_company_name IS NULL THEN
    v_company_name := 'Default Company';
  END IF;

  -- Slugify
  v_slug := lower(regexp_replace(v_company_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  IF v_slug IS NULL OR v_slug = '' THEN
    v_slug := 'company';
  END IF;

  -- Safe role parsing
  v_role := COALESCE(NULLIF(v_meta->>'role','')::user_role, 'worker'::user_role);

  -- Find existing company
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE slug = v_slug
  LIMIT 1;

  -- Insert company (conflict-safe)
  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (name, slug)
    VALUES (v_company_name, v_slug)
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO v_company_id;

    IF v_company_id IS NULL THEN
      SELECT id INTO v_company_id
      FROM public.companies
      WHERE slug = v_slug
      LIMIT 1;
    END IF;
  END IF;

  -- Insert profile
  INSERT INTO public.profiles (id, company_id, first_name, last_name, phone, role)
  VALUES (
    NEW.id,
    v_company_id,
    COALESCE(NULLIF(v_meta->>'first_name',''), ''),
    COALESCE(NULLIF(v_meta->>'last_name',''), ''),
    COALESCE(NULLIF(v_meta->>'phone',''), ''),
    v_role
  );

  RETURN NEW;
END;
$function$;

-- 016_business_subscription_period_fields.sql
-- Add subscription renewal control + period tracking columns for web billing management.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

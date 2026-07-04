-- Add Hispanic/Latino self-identification to autofill profiles.
-- Voluntary EEO question rendered separately from race/ethnicity on many
-- Workday tenants ("Are you Hispanic or Latino?"). Nullable text; only used
-- by the extension when auto_fill_diversity is enabled.
ALTER TABLE "public"."autofill_profiles"
  ADD COLUMN IF NOT EXISTS "hispanic_latino" "text";

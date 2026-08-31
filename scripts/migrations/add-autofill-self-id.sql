-- Pronouns and sexual orientation on the autofill profile.
--
-- Application forms ask these as their own required questions, separately from
-- gender. They were the only self-identification fields with no profile source,
-- so they blocked forms that make them mandatory.
--
-- They are deliberately NOT inferred from `gender`: gender determines neither,
-- and guessing would assert something personal the user never entered. Left
-- null, the existing behaviour stands — the form's own decline option is chosen.
--
-- Disclosure remains gated by auto_fill_diversity, the same consent switch that
-- governs gender, ethnicity, veteran and disability status.

ALTER TABLE public.autofill_profiles
  ADD COLUMN IF NOT EXISTS pronouns           text,
  ADD COLUMN IF NOT EXISTS sexual_orientation text;

COMMENT ON COLUMN public.autofill_profiles.pronouns IS
  'Self-reported pronouns. Never inferred from gender. Disclosure gated by auto_fill_diversity.';
COMMENT ON COLUMN public.autofill_profiles.sexual_orientation IS
  'Self-reported. Never inferred. Disclosure gated by auto_fill_diversity.';

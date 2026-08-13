-- Candidate credential declarations
--
-- What a candidate has told us about a specific credential (a certification,
-- licence, degree or security clearance) — as opposed to what we could or could
-- not find on their résumé.
--
-- This distinction is the point of the table. A résumé that omits a CPA is NOT
-- evidence the candidate lacks one; résumés omit credentials constantly, and
-- resumes.skills.certifications is only as complete as the parse. Without a
-- declaration the correct state is "we did not find it", which must never drive
-- a negative decision. Only an explicit statement from the candidate can
-- establish absence.
--
-- Deliberately keyed on (user_id, credential_key), NOT on a job: asking someone
-- once whether they hold a CPA answers it for every posting that wants one. A
-- per-job store would re-ask the same question forever and train candidates to
-- click through the prompts, which would poison exactly the signal we are trying
-- to collect.
--
-- Reversible by design: a row is updated in place, and deleting it returns the
-- credential to the "not found / unknown" state. Any decision derived from a
-- declaration must be recomputed when the declaration changes.

CREATE TABLE IF NOT EXISTS candidate_credential_declarations (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Normalized, stable lookup key (e.g. 'cpa', 'aws-certified-solutions-architect',
  -- 'clearance-ts-sci'). Produced by normalizeCredentialKey in
  -- lib/candidates/credential-declarations.ts — keep the two in step.
  credential_key    TEXT        NOT NULL,
  -- The wording the candidate actually saw when they answered, so the answer can
  -- be shown back to them in context and audited if the key ever changes.
  credential_label  TEXT        NOT NULL,

  -- true  -> the candidate says they hold it   (RequirementPresence PRESENT)
  -- false -> the candidate says they do not    (RequirementPresence ABSENT_CONFIRMED)
  -- There is no third value: "we don't know" is the absence of a row, not a row.
  held              BOOLEAN     NOT NULL,

  -- Optional, and only meaningful when held = false: a date the candidate
  -- expects to obtain it (e.g. a booked exam). This is the ONLY sanctioned
  -- source of an acquisition estimate — HireOven has no credential catalog, and
  -- a model may never estimate this.
  expected_at       DATE,

  note              TEXT,

  -- Where the answer came from, so a hurried in-flow answer can be weighted or
  -- re-confirmed differently from a deliberate profile edit later if needed.
  source            TEXT        NOT NULL DEFAULT 'prompt'
                                CHECK (source IN ('prompt', 'profile', 'import')),

  declared_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One answer per credential per candidate; re-answering updates in place.
  UNIQUE (user_id, credential_key)
);

-- Primary access path: resolve every declaration for one candidate, then match
-- against the requirements extracted from a posting. The UNIQUE constraint
-- already provides a (user_id, credential_key) btree, which serves both the
-- single-credential lookup and the user-wide scan.

-- Access model: this self-hosted Postgres has no Supabase auth.uid() and is
-- reached only through the app's connection pool (as the table owner), which
-- always filters by user_id explicitly — same as public.cohort_members and
-- public.linkedin_connections. So we leave RLS off here rather than depend on
-- auth.uid(). If this migration is ever run against a Supabase-managed DB,
-- enable RLS + an owner policy there.

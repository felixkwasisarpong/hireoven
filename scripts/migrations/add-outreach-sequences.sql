-- Active outreach engine — schema
-- Multi-touch outreach sequences (initial + follow-ups) to a contact at a
-- target company, with per-step send tracking and reply-stop. Apex drafts;
-- the user sends manually and marks each step. Run against Hireoven Postgres.

DO $$ BEGIN
  CREATE TYPE outreach_sequence_status AS ENUM ('active', 'replied', 'completed', 'stopped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE outreach_step_status AS ENUM ('pending', 'sent', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── outreach_sequences ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.outreach_sequences (
  id              UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID                      NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id      UUID                      REFERENCES public.companies(id) ON DELETE SET NULL,
  job_id          UUID                      REFERENCES public.jobs(id) ON DELETE SET NULL,
  goal            TEXT                      NOT NULL,   -- referral_request | recruiter_intro | hiring_manager
  channel         TEXT                      NOT NULL,   -- linkedin | email
  contact_name    TEXT,
  contact_role    TEXT,
  company_name    TEXT,                                 -- denormalized for display when company_id is null
  job_title       TEXT,
  status          outreach_sequence_status  NOT NULL DEFAULT 'active',
  replied_at      TIMESTAMPTZ,
  -- Earliest pending step's scheduled date — denormalized so "due today" is a
  -- single indexed lookup, never a per-step scan.
  next_due_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ               NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ               NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_sequences_user
  ON public.outreach_sequences(user_id, created_at DESC);
-- Surfacing follow-ups due now, only for live sequences.
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_due
  ON public.outreach_sequences(user_id, next_due_at)
  WHERE status = 'active' AND next_due_at IS NOT NULL;

-- ── outreach_steps ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.outreach_steps (
  id              UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id     UUID                  NOT NULL REFERENCES public.outreach_sequences(id) ON DELETE CASCADE,
  user_id         UUID                  NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  step_number     INTEGER               NOT NULL,
  kind            TEXT                  NOT NULL,        -- initial | follow_up | final
  purpose         TEXT,
  draft           TEXT,                                  -- AI-generated, user-editable
  status          outreach_step_status  NOT NULL DEFAULT 'pending',
  scheduled_for   TIMESTAMPTZ           NOT NULL,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_outreach_steps_sequence
  ON public.outreach_steps(sequence_id, step_number);

-- Scout Outcome Learning Engine V2
-- Proper event table replacing embedded timeline JSON for outcome tracking.
-- Each row is a discrete outcome event in the application lifecycle.

CREATE TABLE IF NOT EXISTS scout_outcomes (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Lifecycle outcome type
  type            TEXT        NOT NULL CHECK (type IN (
    'application_sent',
    'application_reviewed',
    'recruiter_reply',
    'interview_received',
    'interview_passed',
    'offer_received',
    'offer_accepted',
    'application_rejected',
    'workflow_abandoned'
  )),

  -- Optional links to Hireoven records
  related_job_id      UUID        REFERENCES jobs(id)       ON DELETE SET NULL,
  related_company_id  UUID        REFERENCES companies(id)  ON DELETE SET NULL,
  application_id      UUID        REFERENCES job_applications(id) ON DELETE SET NULL,

  -- Enrichment metadata — derived at recording time, never re-inferred later
  role_category   TEXT,        -- "backend" | "platform" | "ml_ai" | "data" | "devops_sre" | etc.
  sector          TEXT,        -- "fintech" | "ai_infra" | "healthtech" | "enterprise_saas" | etc.
  sponsorship_related BOOLEAN  DEFAULT FALSE,
  work_mode       TEXT,        -- "remote" | "hybrid" | "onsite"

  -- Source of this outcome event
  source          TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN (
    'manual',           -- user clicked in Scout UI
    'application_status', -- derived from application status change
    'extension',        -- recorded via the browser extension
    'workflow'          -- emitted when a Scout workflow completes/abandons
  )),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by user + type for aggregation
CREATE INDEX IF NOT EXISTS scout_outcomes_user_type_idx
  ON scout_outcomes (user_id, type, created_at DESC);

-- Lookup by application for dedup
CREATE INDEX IF NOT EXISTS scout_outcomes_application_idx
  ON scout_outcomes (application_id, type)
  WHERE application_id IS NOT NULL;

-- Learning signals are re-computed from this table — only keep the last 12 months
-- (older outcomes are less predictive and avoid unbounded growth)
CREATE INDEX IF NOT EXISTS scout_outcomes_user_recent_idx
  ON scout_outcomes (user_id, created_at DESC);

-- Row-level security
ALTER TABLE scout_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_outcomes_owner ON scout_outcomes
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Signal reactions — lightweight per-signal thumbs-up/down + "what happened"
CREATE TABLE IF NOT EXISTS scout_signal_reactions (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_id   TEXT        NOT NULL,   -- OutcomeLearningSignal.id
  reaction    TEXT        NOT NULL CHECK (reaction IN (
    'helpful',
    'not_helpful',
    'got_interview',
    'applied',
    'rejected',
    'ignore'
  )),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One reaction per signal per user (upsert key)
  UNIQUE (user_id, signal_id)
);

ALTER TABLE scout_signal_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY scout_signal_reactions_owner ON scout_signal_reactions
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

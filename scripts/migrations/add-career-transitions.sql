-- Career transition graph — accumulated from day one so the evidence is there
-- later ("200 similar pivots typically took ~3 months"). Each row is one observed
-- role→role move, mined from parsed résumé work histories (source='resume') and
-- HireOven's own hire outcomes (source='hired_outcome', higher confidence).
-- Roles are normalized to a field (a FIELDS key from lib/resume/signal) so edges
-- aggregate across people. Write-only for now; nothing user-facing reads it until
-- the counts are meaningful. Rebuilt idempotently by api/cron/mine-transitions.

CREATE TABLE IF NOT EXISTS career_transitions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        REFERENCES profiles(id) ON DELETE CASCADE,
  source           TEXT        NOT NULL,          -- 'resume' | 'hired_outcome'
  from_title       TEXT        NOT NULL,          -- normalized (lower, trimmed)
  to_title         TEXT        NOT NULL,
  from_field       TEXT,                          -- FIELDS key, or NULL if unclassifiable
  to_field         TEXT,
  from_seniority   TEXT,
  to_seniority     TEXT,
  seniority_delta  INTEGER,                        -- tier(to) - tier(from)
  gap_months       INTEGER,                        -- months between the two roles
  transition_year  INTEGER     NOT NULL,           -- year the 'to' role started
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, from_title, to_title, transition_year)
);

-- Aggregation access path: "how do people get from field X to field Y?"
CREATE INDEX IF NOT EXISTS idx_career_transitions_fields
  ON career_transitions(from_field, to_field)
  WHERE from_field IS NOT NULL AND to_field IS NOT NULL;

-- Run against your Hireoven Postgres (Coolify / self-hosted).
-- Adds application timing signal tables for smart apply scheduling.

CREATE TABLE IF NOT EXISTS application_timing_signals (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid         REFERENCES companies(id) ON DELETE SET NULL,
  day_of_week      integer      NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  hour_of_day      integer      NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  screen_rate      decimal(6,4) NOT NULL DEFAULT 0.0,
  sample_size      integer      NOT NULL DEFAULT 0,
  ats_type         text,
  last_computed_at timestamptz  DEFAULT now(),
  created_at       timestamptz  DEFAULT now(),
  UNIQUE (company_id, day_of_week, hour_of_day)
);

-- NULL company_id = global average rows (no unique constraint conflict
-- because UNIQUE treats NULLs as distinct — add a partial index instead)
CREATE UNIQUE INDEX IF NOT EXISTS idx_timing_signals_global
  ON application_timing_signals (day_of_week, hour_of_day)
  WHERE company_id IS NULL;

CREATE TABLE IF NOT EXISTS job_timing_scores (
  id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                 uuid         NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  posted_at              timestamptz,
  hours_since_posted     integer,
  timing_recommendation  text         NOT NULL
    CHECK (timing_recommendation IN ('apply_now','schedule_today','schedule_tomorrow','low_priority')),
  timing_reason          text,
  optimal_apply_at       timestamptz,
  screen_rate_multiplier decimal(5,2) NOT NULL DEFAULT 1.0,
  computed_at            timestamptz  NOT NULL DEFAULT now(),
  created_at             timestamptz  DEFAULT now(),
  updated_at             timestamptz  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timing_signals_company
  ON application_timing_signals (company_id);

CREATE INDEX IF NOT EXISTS idx_timing_signals_day_hour
  ON application_timing_signals (day_of_week, hour_of_day);

CREATE INDEX IF NOT EXISTS idx_job_timing_scores_computed
  ON job_timing_scores (computed_at);

COMMENT ON TABLE application_timing_signals IS
  'Per-company (or global) screen-rate signals by day/hour, updated via rolling average as outcomes arrive.';

COMMENT ON TABLE job_timing_scores IS
  'Computed timing recommendation per job: when to apply for maximum screen rate.';

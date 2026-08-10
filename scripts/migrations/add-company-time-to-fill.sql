-- Company time-to-fill: how long a company's roles typically stay open, from the
-- observed posting lifecycle (a job flips is_active=false when the harvester
-- stops seeing it on the board, i.e. the role came down). median_days_open =
-- median of (last_seen_at - first_detected_at) over the company's recently-closed
-- jobs; time_to_fill_sample = how many closed jobs backed that median. Powers the
-- "roles here are typically open ~N days" signal. Recomputed weekly by
-- api/cron/company-time-to-fill.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS median_days_open        INTEGER,
  ADD COLUMN IF NOT EXISTS time_to_fill_sample     INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_to_fill_computed_at TIMESTAMPTZ;

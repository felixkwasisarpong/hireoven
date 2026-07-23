-- Stay outcome feedback flywheel.
--
-- The defensible data loop behind the Stay Score: real job seekers report what
-- actually happened at an employer (got sponsored, won/lost the lottery, got
-- auto-rejected). Aggregated per employer, these outcomes are surfaced as
-- community context next to the modeled score and, over time, calibrate it.
--
-- Privacy-light: an anonymous first-party visitor_id (random, from the client's
-- localStorage — same scheme as page_views), the employer, the outcome, and
-- optional coarse context. No IP, no user-agent, no PII. The free-text note is
-- length-capped and optional.

CREATE TABLE IF NOT EXISTS stay_outcomes (
  id            BIGSERIAL   PRIMARY KEY,
  company_id    UUID        REFERENCES companies(id) ON DELETE SET NULL,
  employer_name TEXT        NOT NULL,
  outcome       TEXT        NOT NULL CHECK (outcome IN (
                  'got_sponsored',
                  'won_lottery',
                  'lost_lottery',
                  'auto_rejected',
                  'offer_no_sponsor',
                  'still_searching'
                )),
  wage_level    SMALLINT    CHECK (wage_level BETWEEN 1 AND 4),
  is_stem       BOOLEAN,
  note          TEXT,
  visitor_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-employer aggregation (the tally shown on the Stay panel).
CREATE INDEX IF NOT EXISTS idx_stay_outcomes_company ON stay_outcomes (company_id);
-- Global counts + light per-visitor abuse guard windows.
CREATE INDEX IF NOT EXISTS idx_stay_outcomes_created_at ON stay_outcomes (created_at);
CREATE INDEX IF NOT EXISTS idx_stay_outcomes_visitor ON stay_outcomes (visitor_id, created_at);

-- Low-volume, user-reported. If it ever grows, prune stale/undated noise, e.g.:
--   DELETE FROM stay_outcomes WHERE created_at < now() - interval '400 days';

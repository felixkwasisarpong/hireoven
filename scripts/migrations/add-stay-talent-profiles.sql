-- Stay reverse marketplace — candidate talent profiles.
--
-- Flips the ATS-rejection dynamic: an international candidate builds ONE profile
-- and only employers with verified DOL sponsorship history can reach them. This
-- is the supply side; the demand side (verified-employer browsing) is gated and
-- built later. Publicly we only ever expose PII-free aggregates (counts by role
-- / visa / location) — never an individual profile.
--
-- Contains contact PII (email), so: unique per email (upsert on re-submit),
-- length-capped free text, an anonymous visitor_id for a light abuse guard, and
-- a `status` so a candidate can withdraw. Handle per your privacy policy.

CREATE TABLE IF NOT EXISTS stay_talent_profiles (
  id            BIGSERIAL   PRIMARY KEY,
  email         TEXT        NOT NULL,
  headline      TEXT,
  soc_group     TEXT,
  target_salary INTEGER,
  wage_level    SMALLINT    CHECK (wage_level BETWEEN 1 AND 4),
  visa_status   TEXT        CHECK (visa_status IN ('f1_student', 'opt', 'stem_opt', 'other')),
  is_stem       BOOLEAN,
  state_abbr    TEXT,
  top_skills    TEXT[]      NOT NULL DEFAULT '{}',
  visitor_id    TEXT,
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One profile per person; re-submitting updates it (see the upsert in lib/stay/talent.ts).
CREATE UNIQUE INDEX IF NOT EXISTS uq_stay_talent_email ON stay_talent_profiles (lower(email));
-- Aggregations for the (PII-free) talent-pool view.
CREATE INDEX IF NOT EXISTS idx_stay_talent_soc ON stay_talent_profiles (soc_group) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_stay_talent_created_at ON stay_talent_profiles (created_at);
CREATE INDEX IF NOT EXISTS idx_stay_talent_visitor ON stay_talent_profiles (visitor_id, created_at);

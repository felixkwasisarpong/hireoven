-- LinkedIn Shadow-Network connections
-- Persists the user's scraped 1st/2nd-degree LinkedIn connections (per target
-- company) so warm referral contacts surface in the job-page Networking Finder.
--
-- Each Shadow Network scan in Apex targets one company and returns the current
-- set of the user's connections there. We replace that (user, company) set on
-- every scrape (DELETE + INSERT), so this table always holds the latest snapshot.

CREATE TABLE IF NOT EXISTS linkedin_connections (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name            TEXT        NOT NULL,
  title           TEXT,
  company         TEXT        NOT NULL,           -- the connection's listed employer (display)
  company_norm    TEXT        NOT NULL,           -- normalized scanned company, used to match jobs
  company_id      UUID        REFERENCES companies(id) ON DELETE SET NULL,

  degree          SMALLINT    NOT NULL DEFAULT 2 CHECK (degree BETWEEN 1 AND 3),
  profile_url     TEXT,
  mutual_count    INTEGER     NOT NULL DEFAULT 0,
  recently_active BOOLEAN     NOT NULL DEFAULT FALSE,
  tenure_months   INTEGER     NOT NULL DEFAULT 0,

  referral_score  INTEGER     NOT NULL DEFAULT 0,
  referral_tier   TEXT        NOT NULL DEFAULT 'cold' CHECK (referral_tier IN ('hot','warm','cold')),

  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary access path: the Networking Finder looks up a user's connections at a
-- given (normalized) company, best referral paths first.
CREATE INDEX IF NOT EXISTS linkedin_connections_user_company_idx
  ON linkedin_connections (user_id, company_norm, referral_score DESC);

-- Access model: this self-hosted Postgres has no Supabase auth.uid() and is
-- reached only through the app's connection pool (as the table owner), which
-- always filters by user_id explicitly — same as public.cohort_members. So we
-- leave RLS off here rather than depend on auth.uid(). If this migration is ever
-- run against a Supabase-managed DB, enable RLS + an owner policy there.

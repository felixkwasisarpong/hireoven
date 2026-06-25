-- Ingest-time company dedup: a normalized-name column so aggregator ingest can match
-- an employer to an EXISTING company (stripping legal suffixes + punctuation) before
-- creating a *.placeholder. Same function is used by ingest queries, so storage and
-- lookup can never drift.

CREATE OR REPLACE FUNCTION company_name_norm(txt text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT trim(
    regexp_replace(                                   -- 4. collapse whitespace
      regexp_replace(                                 -- 3. punctuation -> space
        regexp_replace(                               -- 2. strip ONE trailing legal suffix
          lower(coalesce(txt, '')),                   -- 1. lowercase
          '\s+(inc|corp|corporation|incorporated|llc|l\.l\.c|ltd|limited|lp|l\.p|llp|l\.l\.p|co|company|plc|pc|p\.c|pllc|na|n\.a|holdings|holding|group)\.?\s*$',
          '', 'g'),
        '[^a-z0-9]+', ' ', 'g'),
      '\s+', ' ', 'g')
  )
$$;

-- Generated + stored so it auto-maintains on insert/update and is indexable.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS name_normalized text
  GENERATED ALWAYS AS (company_name_norm(name)) STORED;

CREATE INDEX IF NOT EXISTS idx_companies_name_normalized ON companies (name_normalized);

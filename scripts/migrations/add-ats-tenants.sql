-- ats_tenants: a first-class registry of every (ats_type, ats_identifier) we have
-- ever seen, regardless of whether it became a company yet. This decouples
-- "an ATS board exists" from "we enrolled a company for it", giving discovery a
-- durable work queue (status + next_check_at) and a single dedup key.
--
-- Also hardens companies dedup (partial unique index on the ATS pair) and
-- extends jobs.publication_status with explicit visibility states.
--
-- Fully idempotent: safe to re-run. Raw SQL, node-pg conventions, matches
-- schema.sql (uuid PKs via gen_random_uuid(), public. schema prefix).
--
-- NOTE ON ID TYPES: the spec suggested BIGSERIAL/BIGINT, but companies.id is
-- uuid (see schema.sql:167). To keep the FK valid and match every other table
-- in this codebase, ats_tenants.id is uuid and company_id is uuid.
--
-- PRE-CHECK (run read-only before applying; see accompanying notes file):
--   SELECT ats_type, ats_identifier, COUNT(*) FROM companies
--   WHERE ats_type IS NOT NULL AND ats_identifier IS NOT NULL
--     AND duplicate_of_company_id IS NULL
--   GROUP BY 1,2 HAVING COUNT(*) > 1;
-- Verified 2026-06-28 against prod: 0 rows (25,453 enrollable companies), so the
-- companies partial unique index in section 2 is safe. If this ever returns
-- rows, DO NOT apply section 2 — resolve the dupes by hand first.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New table: ats_tenants
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ats_tenants (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  ats_type             text NOT NULL,
  ats_identifier       text NOT NULL,
  source_url           text,
  source_type          text,  -- 'adzuna' | 'dice' | 'jsearch' | 'crtsh' | 'github' | 'manual' | 'careers-page' | 'apply-url' | 'backfill'
  company_name_guess   text,
  domain_guess         text,
  status               text NOT NULL DEFAULT 'discovered',
    -- 'discovered' | 'validated' | 'enrolled' | 'rejected' | 'retry_later'
  confidence           integer NOT NULL DEFAULT 0,
  job_count            integer NOT NULL DEFAULT 0,
  company_id           uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  error_reason         text,
  attempts             integer NOT NULL DEFAULT 0,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_checked_at      timestamptz,
  next_check_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_ats_tenants PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ats_tenants_ats_pair
  ON public.ats_tenants (ats_type, ats_identifier);

CREATE INDEX IF NOT EXISTS ix_ats_tenants_status_next
  ON public.ats_tenants (status, next_check_at NULLS FIRST);

CREATE INDEX IF NOT EXISTS ix_ats_tenants_company
  ON public.ats_tenants (company_id);

CREATE INDEX IF NOT EXISTS ix_ats_tenants_source
  ON public.ats_tenants (source_type, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Companies dedup hardening — PARTIAL unique index (not a constraint), scoped
--    to non-duplicate rows with a real ATS pair. Pre-check returned 0 dupes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_ats_pair_active
  ON public.companies (ats_type, ats_identifier)
  WHERE ats_type IS NOT NULL
    AND ats_identifier IS NOT NULL
    AND duplicate_of_company_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Extend jobs.publication_status allowed values. Keeps 'published' and
--    'pending_enrichment' for backward compat. Drop-then-add keeps this
--    idempotent (the existing constraint is named jobs_publication_status_check).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_publication_status_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_publication_status_check
  CHECK (publication_status IN (
    'published',
    'pending_enrichment',
    'hidden_low_quality',
    'visible_basic',         -- NEW
    'visible_enriched',      -- NEW (alias-of-published in practice)
    'hidden_invalid',        -- NEW
    'hidden_duplicate',      -- NEW
    'hidden_expired'         -- NEW
  ));

CREATE INDEX IF NOT EXISTS ix_jobs_pub_status_active
  ON public.jobs (publication_status, is_active)
  WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Companies columns for the resolution-priority formula (later prompt).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS resolution_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resolution_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_resolution_failed_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Backfill ats_tenants from existing enrolled companies. DISTINCT ON needs a
--    deterministic ORDER BY; we keep the earliest-created company per ATS pair.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.ats_tenants (
  ats_type, ats_identifier, company_id, status,
  source_type, confidence, first_seen_at, last_checked_at
)
SELECT DISTINCT ON (ats_type, ats_identifier)
  ats_type, ats_identifier, id, 'enrolled', 'backfill', 90,
  created_at, now()
FROM public.companies
WHERE ats_type IS NOT NULL
  AND ats_identifier IS NOT NULL
  AND duplicate_of_company_id IS NULL
ORDER BY ats_type, ats_identifier, created_at ASC
ON CONFLICT (ats_type, ats_identifier) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Backfill publication_status — ONLY jobs newer than 14 days, so we don't
--    flood the feed with old short-description jobs. Older 'pending_enrichment'
--    rows stay hidden by intent.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.jobs SET publication_status = 'visible_enriched', updated_at = now()
WHERE publication_status = 'published'
  AND is_active = true
  AND posted_at > now() - interval '14 days';

UPDATE public.jobs SET publication_status = 'visible_basic', updated_at = now()
WHERE publication_status = 'pending_enrichment'
  AND is_active = true
  AND posted_at > now() - interval '14 days';

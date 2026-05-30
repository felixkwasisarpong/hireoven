-- Staging table for newly-discovered career-source candidates before they
-- are enrolled into the main companies table. Every discovery channel
-- (crt.sh, API probes, Common Crawl CDX) writes here first; a confidence
-- gate decides whether to promote to companies or hold for retry.

CREATE TABLE IF NOT EXISTS "public"."discovered_candidates" (
  "id"                  uuid DEFAULT gen_random_uuid() NOT NULL,
  "raw_url"             text NOT NULL,
  "ats_type"            text,
  "ats_identifier"      text,
  "normalized_url"      text,
  "source"              text NOT NULL,       -- e.g. 'crtsh:greenhouse', 'probe:lever', 'commoncrawl'
  "confidence_score"    integer NOT NULL DEFAULT 0,
  "confidence_factors"  jsonb,               -- breakdown: { ats_match: 30, api_200: 30, ... }
  "usa_confirmed"       boolean,
  "jobs_at_discovery"   integer,
  "http_status"         integer,
  "verified_at"         timestamp with time zone,
  "rejected_reason"     text,
  "next_retry_at"       timestamp with time zone,
  "enrolled_company_id" uuid REFERENCES "public"."companies"("id") ON DELETE SET NULL,
  "created_at"          timestamp with time zone DEFAULT now(),
  "updated_at"          timestamp with time zone DEFAULT now(),
  CONSTRAINT "pk_discovered_candidates" PRIMARY KEY ("id"),
  -- One row per (ats_type, ats_identifier) — prevents duplicate candidates
  -- from different channels competing with each other.
  CONSTRAINT "uq_dc_ats_id" UNIQUE ("ats_type", "ats_identifier")
);

-- Fast lookup for the re-verification worker.
CREATE INDEX IF NOT EXISTS "idx_dc_retry"
  ON "public"."discovered_candidates" ("next_retry_at")
  WHERE "enrolled_company_id" IS NULL AND "rejected_reason" IS NULL;

-- Score-based review queries.
CREATE INDEX IF NOT EXISTS "idx_dc_score"
  ON "public"."discovered_candidates" ("confidence_score" DESC);

-- Source audit / dedup queries.
CREATE INDEX IF NOT EXISTS "idx_dc_source"
  ON "public"."discovered_candidates" ("source", "created_at" DESC);

-- Audit table for discovery channel runs (one row per script execution).
CREATE TABLE IF NOT EXISTS "public"."discovery_runs" (
  "id"                  uuid DEFAULT gen_random_uuid() NOT NULL,
  "channel"             text NOT NULL,       -- 'probe:lever', 'commoncrawl', 'crtsh', etc.
  "candidates_found"    integer DEFAULT 0,
  "candidates_enrolled" integer DEFAULT 0,
  "candidates_held"     integer DEFAULT 0,   -- score 40-59: stored but not enrolled
  "candidates_rejected" integer DEFAULT 0,   -- score < 40
  "duration_ms"         integer,
  "error_message"       text,
  "ran_at"              timestamp with time zone DEFAULT now(),
  CONSTRAINT "pk_discovery_runs" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_discovery_runs_channel"
  ON "public"."discovery_runs" ("channel", "ran_at" DESC);

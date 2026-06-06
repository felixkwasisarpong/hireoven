-- Company-specific ATS candidate evidence and refresh state.
--
-- discovered_candidates is global tenant staging. This table records the
-- evidence for one company -> one possible ATS URL, including uncertain hits
-- that should be retried later instead of discarded.

CREATE TABLE IF NOT EXISTS "public"."company_ats_candidates" (
  "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id"      uuid NOT NULL REFERENCES "public"."companies"("id") ON DELETE CASCADE,
  "ats_type"        text NOT NULL,
  "candidate_url"   text NOT NULL,
  "host"            text,
  "source"          text NOT NULL,
  "confidence"      integer NOT NULL DEFAULT 0,
  "evidence_json"   jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status"          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','verified','verified_no_jobs','rejected','dead')),
  "first_seen_at"   timestamp with time zone DEFAULT now(),
  "last_checked_at" timestamp with time zone,
  "next_check_at"   timestamp with time zone,
  "created_at"      timestamp with time zone DEFAULT now(),
  "updated_at"      timestamp with time zone DEFAULT now(),
  CONSTRAINT "pk_company_ats_candidates" PRIMARY KEY ("id"),
  CONSTRAINT "uq_company_ats_candidate_url" UNIQUE ("company_id", "candidate_url")
);

CREATE INDEX IF NOT EXISTS "idx_company_ats_candidates_company"
  ON "public"."company_ats_candidates" ("company_id", "status", "confidence" DESC);

CREATE INDEX IF NOT EXISTS "idx_company_ats_candidates_refresh"
  ON "public"."company_ats_candidates" ("next_check_at")
  WHERE status IN ('pending','verified','verified_no_jobs');

CREATE INDEX IF NOT EXISTS "idx_company_ats_candidates_host"
  ON "public"."company_ats_candidates" ("host");


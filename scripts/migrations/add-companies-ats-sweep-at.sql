-- companies.ats_sweep_at: when the company-first ATS sweep (discover-ats-sweep)
-- last probed this company against the ATS platforms. The sweep claims the
-- least-recently-swept weak/unmatched companies (ORDER BY ats_sweep_at NULLS
-- FIRST) so it rotates through the whole ~39k backlog without re-probing the
-- same rows every run. NULL = never swept (highest priority).
--
-- Fully idempotent. Raw SQL, node-pg conventions.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS ats_sweep_at timestamptz;

-- Partial index over exactly the claim predicate's candidate set (active,
-- weak/no-ATS), ordered by sweep recency — keeps the claim cheap on ~39k rows.
CREATE INDEX IF NOT EXISTS idx_companies_ats_sweep_candidates
  ON public.companies (ats_sweep_at ASC NULLS FIRST)
  WHERE is_active = true
    AND (ats_type IS NULL OR ats_type IN ('custom', 'jsonld', ''));

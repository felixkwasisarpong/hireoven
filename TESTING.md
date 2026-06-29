# Manual smoke tests — discovery pipeline

Prereqs: `add-ats-tenants` migration applied; `CRON_SECRET` set; an admin
session for the admin endpoint. Replace `$CRON_SECRET`, `$BASE` (e.g.
`http://localhost:3000`), and `$DBURL` accordingly.

## 1. Adzuna ingest → tenant enrolled
Trigger ingest, then confirm a known Lever/Greenhouse-using employer landed in
`ats_tenants` as enrolled.
```bash
curl -fsS -H "authorization: Bearer $CRON_SECRET" "$BASE/api/cron/adzuna-ingest" | jq '{backsolveEnrolled, backsolveRetryLater, backsolvePlaceholder}'
```
```sql
-- enrolled tenants sourced from adzuna in the last hour
SELECT ats_type, ats_identifier, company_name_guess, status, confidence, job_count
FROM ats_tenants
WHERE source_type = 'adzuna' AND status = 'enrolled'
ORDER BY last_checked_at DESC NULLS LAST
LIMIT 10;
```
Expect ≥1 row whose `ats_type` is greenhouse/lever/ashby/etc.

## 2. discover-tenants → placeholders with apply URLs resolved
```bash
curl -fsS -H "authorization: Bearer $CRON_SECRET" "$BASE/api/cron/discover-tenants" | jq '{enrolled, held, rejected, probed}'
```
```sql
-- placeholders that just got a resolution attempt (cooldown stamp)
SELECT id, name, ats_type, resolution_attempts, last_resolution_attempted_at, last_resolution_failed_at
FROM companies
WHERE last_resolution_attempted_at > now() - interval '10 minutes'
ORDER BY last_resolution_attempted_at DESC
LIMIT 20;
```
Expect rows with a fresh `last_resolution_attempted_at`; successes have
`last_resolution_failed_at IS NULL`.

## 3. Spot-check enrolled adzuna tenants
```sql
SELECT * FROM ats_tenants
WHERE status = 'enrolled' AND source_type = 'adzuna'
LIMIT 10;
```
Eyeball: `ats_identifier` looks like a real board slug; `company_id` is set.

## 4. Harvest an enrolled tenant → jobs land as visible_basic
Pick one enrolled tenant's company and harvest it (via the harvester worker /
`run-harvest` path), then:
```sql
SELECT publication_status, COUNT(*)
FROM jobs
WHERE company_id = '<enrolled-company-uuid>' AND is_active = true
GROUP BY 1;
```
Expect new rows at `visible_basic` (or `visible_enriched` if the board returned
rich descriptions). They should NOT be `pending_enrichment`.

## 5. Normalization upgrade → visible_enriched
For a job that came in `visible_basic` then got good content on a later crawl,
confirm it upgraded:
```sql
SELECT id, publication_status, length(description) AS desc_len, array_length(skills,1) AS skills
FROM jobs WHERE company_id = '<enrolled-company-uuid>' AND publication_status = 'visible_enriched'
LIMIT 5;
```
(Inline normalization sets `visible_enriched` at insert when content is good; the
`SQL_UPGRADE_TO_VISIBLE_ENRICHED` statement is for any async enrichment step.)

## 6. Admin stats endpoint
```bash
# admin-authenticated session/cookie required
curl -fsS "$BASE/api/admin/discovery-stats" | jq '{
  generatedAt,
  rate: .last24h.backsolve_success_rate,
  enrolled: .last24h.tenants_enrolled,
  conversion: .last24h.placeholder_to_tenant_conversion,
  pub: .last24h.jobs_publication_status_breakdown,
  by_source: .by_source | keys,
  by_ats: .by_ats | keys
}'
```
Eyeball: `backsolve_success_rate` in [0,1]; `by_source` includes adzuna/dice;
`jobs_publication_status_breakdown` shows `visible_basic`/`visible_enriched`.

## 7. Rate-limiter sanity (optional)
Under load, `last24h.rate_limit_throttled` should be > 0 only when a single ATS
host is hit faster than its bucket allows; steady-state it stays low.

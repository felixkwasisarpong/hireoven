# Application X-Ray Repository Audit

This audit documents current HireOven behavior that can support a future Application X-Ray feature. It is intentionally documentation-only and does not propose production code edits in the facts sections.

## Facts Discovered In The Repository

### Architecture And Major Applications/Services

- The product is a Next.js App Router application. Route groups live under `app/(dashboard)`, `app/(public)`, `app/(admin)`, and API routes live under `app/api`.
- Data access is direct Postgres/Supabase. Shared database helpers are in `lib/db.ts`, `lib/supabase-server.ts`, `lib/supabase-client.ts`, and `lib/supabase-admin.ts`. Shared runtime types are centralized in `types/index.ts`.
- The checked-in database baseline is `schema.sql`. Incremental schema changes live in `scripts/migrations/*.sql` and are applied by `scripts/apply-migrations.mjs`.
- Job ingestion has three active paths:
  - The cron/crawl path in `app/api/crawl/route.ts`.
  - The harvester worker in `scripts/harvester-worker.ts`, `lib/harvester/worker.ts`, `lib/harvester/run-harvest.ts`, and `lib/harvester/persist-bulk.ts`.
  - Aggregator ingestion through `lib/jobs/aggregator-ingest.ts` and source-specific API routes such as `app/api/cron/jsearch-ingest/route.ts`.
- ATS-specific harvesting is adapter based. The shared contract is `AtsAdapter` and `HarvestedJob` in `lib/harvester/adapters/_base.ts`. Registered adapters are exported from `lib/harvester/adapters/index.ts`.
- Job normalization is centralized in `lib/jobs/normalization/*`. Important symbols include `JOB_NORMALIZATION_VERSION`, `CanonicalJob`, `JobPageViewModel`, `JobCardViewModel`, `normalizeCrawlerJobForPersistence`, `normalizePersistedJobRecord`, `resolveJobNormalization`, and `resolveJobCardView`.
- Publication visibility is centralized in `lib/jobs/publication.ts` through `publicationStatusForJob`, `publicationStatusForNormalization`, `publicationStatusForInsert`, `sqlPublishedJob`, and `sqlSeoVisibleJob`.
- Matching is concentrated in `lib/matching/fast-scorer.ts`, `lib/matching/batch-scorer.ts`, `lib/matching/deep-scorer.ts`, and `lib/matching/score-freshness.ts`.
- Resume parsing, scoring, tailoring, and positioning live under `lib/resume/*` and routes under `app/api/resume/*`.
- Applications and pipeline tracking are handled by `app/api/applications/*`, `lib/applications/*`, and `components/applications/*`.
- Immigration, sponsorship, H1B, and LCA intelligence live under `lib/jobs/*`, `lib/h1b/*`, `app/api/h1b/*`, and components under `components/h1b/*` and `components/jobs/*`.
- Company hiring health is handled by `lib/health/score-computer.ts`, `app/api/cron/health-scores/route.ts`, and employer health APIs/components.
- The Chrome extension in `chrome-extension/` supports importing/analyzing external jobs and autofill workflows.

### Complete Flow From Job Ingestion To Job Display

1. Crawl scheduling starts in `app/api/crawl/route.ts`. The route validates cron auth with `requireCronAuth`, loads active companies, reads recent crawl signals with `loadRecentCrawlSignals`, builds a queue via `applyCrawlQueuePolicy`, and selects work through `selectPolicyBatchByLaneShare`.
2. If the harvester flag is enabled by `harvesterFlagEnabled` in `lib/harvester/run-harvest.ts`, `app/api/crawl/route.ts` invokes `runAtsHarvest`. Otherwise, it falls back to the legacy crawler path using `crawlCareersPage` and `persistCrawlJobs`.
3. The long-running harvester service starts from `scripts/harvester-worker.ts`. It launches worker loops from `startWorkerLoop` in `lib/harvester/worker.ts`.
4. `lib/harvester/worker.ts` claims due companies with `claimEligibleCompanies`, resolves adapter limits with `buildAdapterLimits`, maps companies to adapters with `adapterNameFor`, and calls `runAtsHarvest`.
5. `runAtsHarvest` detects an adapter with `detectCompanyAdapter`, fetches jobs through an `AtsAdapter`, persists them with `persistJobsBulk`, sends instant alerts through `triggerInstantNotify`, and updates company freshness, retry, ETag, and crawl interval metadata.
6. `persistJobsBulk` in `lib/harvester/persist-bulk.ts` filters blocked jobs, deduplicates by `externalId`, normalizes each job through `normalizeCrawlerJobForPersistence`, inserts or updates `jobs`, and marks missing source jobs inactive through `deactivateMissingJobs`.
7. The legacy crawler path writes through `persistCrawlJobs` in `lib/crawler/persist.ts`. It normalizes `RawJob` data, optionally backfills missing descriptions with `fetchJobDescription`, writes `raw_data` with normalization/view payloads, updates `last_seen_at`, and marks stale jobs inactive.
8. Aggregator sources call `ingestAggregatorJobs` in `lib/jobs/aggregator-ingest.ts`. This resolves or creates companies, enrolls ATS tenants when possible through `enrollFromApplyUrl`, writes source IDs as `jobs.external_id`, normalizes persisted records, and updates `last_seen_at`.
9. All ingestion paths produce or refresh normalized artifacts in `jobs.raw_data`, `jobs.skills`, `jobs.normalized_title`, `jobs.source_ats`, `jobs.source_ats_slug`, `jobs.content_hash`, `jobs.posted_at`, `jobs.first_detected_at`, and `jobs.last_seen_at` where the relevant migration has been applied.
10. Job feed visibility is filtered by `sqlPublishedJob` from `lib/jobs/publication.ts` and US/Canada helpers such as `sqlJobLocatedInUsa` in list/detail routes.
11. `app/api/jobs/route.ts` returns public/dashboard job lists. It filters active and published jobs, joins `companies` and `ghost_job_scores`, optionally adds cached or computed match scores through `scoreJobsForUser`, deduplicates with `dedupeFeedJobsBySignature`, and returns `card_view`.
12. `app/api/match/feed/route.ts` returns the authenticated personalized feed. It reuses the same publication/location filters, supports cache-first score ordering, joins saved applications, and also returns `card_view`.
13. `app/api/jobs/[id]/route.ts` returns job detail data. It resolves canonical duplicates with `duplicate_of_id`, enforces active and location rules, may enrich short descriptions through `enrichDescription`, and strips sensitive raw payload detail before returning.
14. Public detail rendering is in `app/(public)/jobs/[id]/page.tsx`. Dashboard detail rendering is in `app/(dashboard)/dashboard/jobs/[id]/page.tsx`.
15. Job cards and detail views are rendered by `components/jobs/JobCard.tsx`, `components/jobs/JobDetailPanel.tsx`, `components/jobs/JobTimingSection.tsx`, `components/jobs/GhostJobDetector.tsx`, `components/jobs/VisaIntelTrigger.tsx`, and related components.

### Current Schemas Relevant To Application X-Ray

- `companies` is defined in `schema.sql` and extended by migrations including `scripts/migrations/add-direct-ats-url.sql`, `scripts/migrations/add-harvester-freshness-tiers.sql`, `scripts/migrations/add-job-intelligence-layer.sql`, `scripts/migrations/add-employer-health-score.sql`, and `scripts/migrations/add-company-time-to-fill.sql`.
- `jobs` is defined in `schema.sql` and extended by migrations including `scripts/migrations/add-harvester-freshness-tiers.sql`, `scripts/migrations/add-job-publication-status.sql`, `scripts/migrations/add-ats-tenants.sql`, `scripts/migrations/add-jobs-duplicate-of-id.sql`, `scripts/migrations/add-jobs-unique-external-id.sql`, `scripts/migrations/add-scout-aggregator-columns.sql`, and `scripts/migrations/add-job-intelligence-layer.sql`.
- User profile fields are represented by the `Profile` type in `types/index.ts` and the `profiles` table in `schema.sql`.
- Resume fields are represented by `Resume`, `ParsedResume`, `WorkExperience`, `Education`, `Skills`, `Project`, `ResumeVersion`, `ResumeTailoringAnalysisRecord`, and `ResumeAiEditRecord` in `types/index.ts`. Backend storage is in `resumes`, `resume_versions`, `resume_tailoring_analyses`, `resume_ai_edits`, and `resume_analyses`.
- Application tracking is represented by `JobApplication`, `TimelineEntry`, `InterviewRound`, and `ApplicationStatus` in `types/index.ts`, with persistence in `job_applications`.
- Sponsorship and immigration data is represented across `jobs`, `companies`, H1B/LCA tables in `schema.sql`, field profiles from `scripts/migrations/add-field-skill-profiles.sql` and `scripts/migrations/add-field-profile-sponsorship.sql`, and runtime types such as `VisaIntelligence`, `LcaSalaryIntelligence`, `StemOptReadiness`, `CapExemptSignal`, and `ResumeLcaRoleAlignment`.

### Existing Logic By X-Ray-Relevant Area

- Job matching:
  - `computeFastScore` in `lib/matching/fast-scorer.ts` computes deterministic scores for skills, experience, seniority, role family, title fit, education, semantic alignment, domain, certifications, and sponsorship.
  - `buildCareerFit` in `lib/matching/fast-scorer.ts` separates ATS screen strength from career fit using relevant years, total years, role-family compatibility, and required-years evidence.
  - `scoreJobsForUser` in `lib/matching/batch-scorer.ts` batches score computation and cache reads.
  - `isScoreFreshForResume` in `lib/matching/score-freshness.ts` invalidates stale cached scores using `FAST_SCORE_CACHE_EPOCH_ISO`, resume update time, and resume version.
  - `computeDeepScore` in `lib/matching/deep-scorer.ts` maps AI resume analysis into the `job_match_scores` table.
- Resume analysis and tailoring:
  - `analyzeResumeForJob` in `lib/resume/analyzer.ts` produces deep `ResumeAnalysis`, including `experience_match`, missing skills, keyword density, recommendations, verdict, and `apply_recommendation`.
  - `parseResume` and `parseResumeFromText` in `lib/resume/parser.ts` extract structured resume fields and raw text.
  - `buildResumeScoreBreakdown`, `calculateResumeScore`, `calculateAtsReadability`, and `buildResumeSnapshot` in `lib/resume/hub.ts` and `lib/resume/scoring.ts` support resume quality and ATS readability.
  - `buildLocalTailorAnalysis` in `lib/resume/tailor-analysis.ts` detects present keywords, supported missing keywords, risky suggestions, and JD alignment without fabricating claims.
  - `tailorResumeForAts` and `ATS_PROFILES` in `lib/resume/ats-tailor.ts` apply ATS-specific guidance for Workday, Greenhouse, Lever, Ashby, iCIMS, SmartRecruiters, BambooHR, and generic systems.
- Evidence validation:
  - `buildJobEvidenceFacts` and `buildJobCardFactList` in `lib/jobs/job-evidence-facts.ts` produce source-aware facts for location, work mode, employment type, and salary.
  - Normalization provenance is stored through `CanonicalJob`, `CanonicalFieldProvenance`, and `CanonicalSection` in `lib/jobs/normalization/types.ts`.
  - Resume evidence is currently implicit in `resumes.raw_text`, parsed resume fields, and `score_breakdown` evidence, not stored as claim-level verification records.
- ATS detection:
  - `detectAts`, `detectAtsFromUrl`, and `DetectedAts` are in `lib/companies/detect-ats.ts`.
  - HTML signature detection is in `detectAtsFromHtml` and `AtsEvidence` in `lib/companies/ats-signatures.ts`.
  - Canonical careers URL inference is in `lib/companies/canonical-careers-url.ts`.
  - Harvester adapter detection is in `detectAdapter` from `lib/harvester/adapters/index.ts` and `detectCompanyAdapter` in `lib/harvester/run-harvest.ts`.
- Job freshness, repost detection, and ghost risk:
  - `computeApplyTimingFromPostAge` and `applyTimingBadge` in `lib/jobs/apply-timing.ts` convert posting age into timing guidance.
  - `calculateGhostJobRisk` and `probeApplyUrl` in `lib/jobs/ghost-job-risk.ts` combine age, URL status, reposts, duplicate/title/location signals, salary, description quality, source credibility, ATS type, and hiring-freeze context.
  - `app/api/jobs/[id]/ghost-risk/route.ts` computes and caches ghost risk in `ghost_job_scores`.
  - `scanStaleGhostJobs` in `lib/jobs/ghost-scan-worker.ts` supports scheduled ghost-score refresh.
  - `resolveGhostRepostSignals` and `readJobRepostCount` in `lib/jobs/ghost-repost-flags.ts` derive repost/staleness flags.
- Visa-language, work authorization, and sponsorship:
  - `inferRequiresAuthorization`, `AUTH_REQUIRED_PATTERNS`, `AUTH_NOT_REQUIRED_PATTERNS`, `extractExperienceLabel`, and `extractEducationLabel` are in `lib/jobs/metadata.ts`.
  - `extractVisaLanguage` and `inferSponsorshipFromText` are in `lib/jobs/normalization/normalize.ts`.
  - `calculateVisaFitScore` in `lib/jobs/visa-fit-score.ts` combines job language, employer sponsorship history, LCA data, E-Verify, cap-exempt signals, blockers, and recency.
  - `sqlJobSponsors` in `lib/jobs/sponsorship-sql.ts` is the canonical SQL predicate for sponsorship-capable jobs.
  - `effectiveEmployerSponsorshipScore`, `employerLikelySponsorsH1b`, and `employerSponsorshipCardCopy` in `lib/jobs/sponsorship-employer-signal.ts` support display.
  - `predictForJob` in `lib/h1b/prediction-service.ts` and `predictH1BApproval` in `lib/h1b/predictor.ts` produce H1B prediction payloads.
  - `calculateResumeLcaRoleAlignment` in `lib/jobs/resume-lca-role-alignment.ts` compares resume keywords to role/LCA/company language.
- Application tracking and rejection intelligence:
  - `app/api/applications/route.ts` creates and lists saved/applied jobs.
  - `app/api/applications/[id]/route.ts` patches application status, appends timeline entries, auto-sets `applied_at`, detects offers, and records timing outcomes.
  - `saveJobToPipeline`, `markJobApplied`, `unsaveJobFromPipeline`, and `fetchJobSavedState` are in `lib/applications/save-job-client.ts`.
  - `computePipelineStats` and `fetchPipelineStatsForUser` are in `lib/applications/pipeline-stats.ts`.
  - `computeVariantPerformance` in `lib/applications/variant-performance.ts` compares resume variant outcomes.
  - `calculateApplicationVerdict` in `lib/jobs/application-verdict.ts` combines resume score, visa score, salary alignment, ghost risk, freshness, company health, and preferences into an application verdict.
  - Rejection reporting and pattern computation live in `app/api/rejections/report/route.ts`, `app/api/rejections/patterns/route.ts`, and `lib/rejections/pattern-computer.ts`.
- Career positioning:
  - `buildAndStoreFieldProfiles` and `getFieldProfiles` in `lib/resume/field-profiles.ts` build corpus profiles from active jobs.
  - `scoreResumeAgainstProfiles`, `detectResumeSignal`, `buildPositioningBrief`, and `fieldAffinity` in `lib/resume/signal.ts` compare a resume to field demand.
  - `suggestPivotTarget` in `lib/resume/pivot-suggest.ts` and `computeBridgePath` in `lib/resume/bridge.ts` support career guidance beyond job-by-job tailoring.

### Existing APIs And UI Components That Can Support Application X-Ray

- Candidate backend API/data sources:
  - `app/api/jobs/[id]/route.ts`
  - `app/api/jobs/[id]/ghost-risk/route.ts`
  - `app/api/match/score/route.ts`
  - `app/api/match/score/batch/route.ts`
  - `app/api/resume/analyze/route.ts`
  - `app/api/resume/[id]/tailor/analyze/route.ts`
  - `app/api/resume/signal/route.ts`
  - `app/api/h1b/predict/route.ts`
  - `app/api/rejections/patterns/route.ts`
  - `app/api/employers/[id]/health-score/route.ts`
  - `app/api/applications/route.ts`
- Candidate UI components:
  - `components/jobs/JobDetailPanel.tsx`
  - `components/jobs/JobCard.tsx`
  - `components/matching/MatchScoreBreakdownPopover.tsx`
  - `components/jobs/JobTimingSection.tsx`
  - `components/jobs/GhostJobDetector.tsx`
  - `components/jobs/VisaIntelTrigger.tsx`
  - `components/jobs/VisaIntelDrawer.tsx`
  - `components/jobs/SponsorshipProbabilityCard.tsx`
  - `components/rejections/RejectionIntelligence.tsx`
  - `components/rejections/RejectionBadge.tsx`
  - `components/employers/EmployerHealthBadge.tsx`
  - `components/employers/EmployerHealthScore.tsx`
  - `components/applications/ApplicationDrawer.tsx`
  - `components/applications/ApplicationCard.tsx`
  - `components/applications/PipelineStats.tsx`
  - `components/applications/ResumePerformancePanel.tsx`

### Important Test Suites And Repository Conventions

- Test command in `package.json`: `find lib -name '*.test.ts' -print0 | xargs -0 tsx --test --test-reporter=spec`.
- Matching tests include `lib/matching/fast-scorer.test.ts`, `lib/matching/score-factor-state.test.ts`, and `lib/matching/score-freshness.test.ts`.
- Job normalization/publication/evidence tests include `lib/jobs/normalization/normalize.test.ts`, `lib/jobs/normalization/view-model.test.ts`, `lib/jobs/publication.test.ts`, `lib/jobs/job-evidence-facts.test.ts`, `lib/jobs/match-score-display.test.ts`, `lib/jobs/feed-dedupe.test.ts`, and `lib/jobs/search-sql.test.ts`.
- Freshness, visa, ghost, and verdict tests include `lib/jobs/ghost-job-risk.test.ts`, `lib/jobs/ghost-repost-flags.test.ts`, `lib/jobs/visa-fit-score.test.ts`, `lib/jobs/metadata.authorization.test.ts`, `lib/jobs/metadata.clearance.test.ts`, `lib/jobs/metadata.seniority.test.ts`, `lib/jobs/sponsorship-employer-signal.test.ts`, `lib/jobs/application-verdict.test.ts`, and `lib/jobs/retention.test.ts`.
- Harvester tests include `lib/harvester/persist-bulk.test.ts`, `lib/harvester/worker.test.ts`, `lib/harvester/maintenance.test.ts`, `lib/harvester/freshness-signal.test.ts`, and adapter tests under `lib/harvester/adapters/*.test.ts`.
- Company and ATS tests include `lib/companies/detect-ats.test.ts`, `lib/companies/ats-url-normalization.test.ts`, `lib/companies/canonical-careers-url.test.ts`, `lib/companies/ats-candidates.test.ts`, and `lib/companies/careers-url-discovery.test.ts`.
- Resume and positioning tests include `lib/resume/tailor-analysis.jd-intelligence.test.ts`, `lib/resume/pivot-suggest.test.ts`, `lib/resume/jd-context.test.ts`, and `lib/resume/keyword-lexicon.test.ts`.
- Application tests include `lib/applications/card-meta.test.ts` and `lib/applications/variant-performance.test.ts`.
- Conventions visible in tests and code:
  - Put pure scoring/normalization behavior in `lib/**` with focused `*.test.ts` files.
  - Keep route handlers thin and delegate scoring, persistence, and normalization to `lib/**`.
  - Represent uncertain signals with confidence labels and data gaps rather than binary claims.
  - Store normalized read models in `raw_data.view` and resolve them through `resolveJobNormalization`/`resolveJobCardView`.

### Technical Debt And Data Limitations That Could Make An X-Ray Score Misleading

- `jobs.first_detected_at` is the job-level first-seen field. There is no `jobs.first_seen_at` column.
- `first_seen_at` exists on discovery tables such as `ats_tenants`, `company_ats_candidates`, and `discovered_company_candidates`, but those are not equivalent to a job posting first-seen timestamp.
- `jobs.last_seen_at` semantics differ by ingestion path. `persistCrawlJobs` and aggregator ingestion update it for existing jobs, but `persistJobsBulk` updates rows only when `jobs.content_hash IS DISTINCT FROM EXCLUDED.content_hash`; unchanged harvester rows can be counted as seen without advancing row-level `last_seen_at`.
- The legacy crawler deactivation path in `lib/crawler/persist.ts` sets `is_active = false` but does not consistently set `closed_at` or `publication_status = 'hidden_expired'`.
- The repository stores the latest `jobs.content_hash`, but no durable job-description history or diff table was found. X-Ray should not claim a job description changed unless a separate source proves it.
- Repost counts are derived and cached through `ghost_job_scores.repost_count` or query-time title/company similarity. There is no durable posting-cycle history table.
- `jobs.external_id` is the best requisition-like field, but aggregator jobs use source-scoped IDs such as `<source>:<id>`, which may not be the employer requisition ID.
- Public/feed job APIs intentionally omit full `raw_data`, so a rich X-Ray card will need either a detail fetch or a persisted summary.
- Resume claim evidence is implicit in `resumes.raw_text`, parsed resume structures, and `job_match_scores.score_breakdown`. There is no claim-level evidence table that verifies each resume assertion against source text.
- AI resume analysis in `analyzeResumeForJob` is cached in `resume_analyses`, but LLM outputs can drift and should not be treated as deterministic eligibility evidence.
- Sponsorship signals combine job text, employer history, LCA data, and predictions. `jobs.sponsors_h1b`, `companies.sponsors_h1b`, and sponsorship percentages are probabilistic/contextual signals, not guarantees that a specific role sponsors.
- Field sponsorship density depends on `field_skill_profiles.sponsor_job_count` and `field_skill_profiles.sponsorship_share`, added by `scripts/migrations/add-field-profile-sponsorship.sql` and populated by `app/api/cron/refresh-field-profiles/route.ts`. Before the migration and cron run, field-level visa edge data can be absent.
- Rejection intelligence depends on user-submitted outcomes and `MIN_SUBMISSIONS` thresholds in `app/api/rejections/patterns/route.ts`, so it is subject to reporting bias and sparse samples.
- `app/api/applications/[id]/route.ts` records timing outcomes using a response-status set that includes `"interviewing"`, while `ApplicationStatus` in `types/index.ts` uses `"interview"`. This possible status vocabulary mismatch can undercount response outcomes.
- Company health depends on external/public data importers and cache windows. A stale or missing `company_health_scores` row should be treated as unknown, not negative.

## Recommendations

- Build Application X-Ray as a composition layer over existing scoring and intelligence modules instead of replacing `computeFastScore`, `calculateVisaFitScore`, `calculateGhostJobRisk`, or `calculateApplicationVerdict`.
- Keep X-Ray output dimensional: Hiring Reality, Capability Fit, Evidence Strength, Eligibility, Positioning Quality, Rejection Risks, Recommended Actions, and final action.
- Store every X-Ray finding with a source, confidence, timestamp, and nullable/unknown state. Missing data should not silently become a penalty.
- Treat "ATS screen fit" and "career fit" as separate dimensions. The existing `score_breakdown.careerFit.atsScreenScore` and `score_breakdown.careerFit.careerFitScore` already encode this distinction.
- Prefer deterministic rules for final action selection and use LLMs only for narrative phrasing or resume-tailoring language.
- For job lists, use a compact cached X-Ray summary. For detail pages, compute or refresh the full explanation from existing modules and persisted signals.
- Add a job-description history table before exposing JD-change or repost-cycle claims as high-confidence Hiring Reality signals.
- Add claim-level resume evidence records before presenting Evidence Strength as verified proof rather than an inferred quality score.

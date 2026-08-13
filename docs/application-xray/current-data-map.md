# Application X-Ray Current Data Map

This document maps data currently stored in HireOven to the planned Application X-Ray dimensions. Facts are separated from recommendations.

## Facts Discovered In The Repository

### Core Entity Schemas

| Entity | Storage | Primary symbols and fields |
| --- | --- | --- |
| Job | `jobs` in `schema.sql` plus job migrations | `Job` in `types/index.ts`; `id`, `company_id`, `title`, `department`, `location`, `is_remote`, `is_hybrid`, `employment_type`, `seniority_level`, salary fields, `description`, `apply_url`, `external_id`, `first_detected_at`, `last_seen_at`, `is_active`, `publication_status`, `posted_at`, `closed_at`, `content_hash`, `source_ats`, `source_ats_slug`, `duplicate_of_id`, `sponsors_h1b`, `sponsorship_score`, `visa_language_detected`, `requires_authorization`, `skills`, `normalized_title`, `raw_data`, `h1b_prediction`, `job_intelligence` |
| Company | `companies` in `schema.sql` plus company migrations | `Company` in `types/index.ts`; `id`, `name`, `domain`, `logo_url`, `industry`, `size`, `careers_url`, `direct_ats_url`, `ats_type`, `ats_identifier`, `direct_ats_provider`, `direct_ats_identifier`, `is_active`, `status`, `freshness_tier`, `last_crawled_at`, `next_harvest_at`, `job_count`, `median_days_open`, `time_to_fill_sample`, H1B sponsorship fields, `immigration_profile_summary`, `hiring_health`, `health_score`, `health_verdict`, `raw_ats_config`, `scout_enrichment` |
| User profile | `profiles` in `schema.sql` | `Profile` in `types/index.ts`; `user_id`, desired roles/locations/seniority/employment types, `top_skills`, `remote_only`, `is_international`, `visa_status`, `opt_end_date`, `needs_sponsorship`, alert/push fields, `default_resume_id`, `onboarding_completed`, `last_active_at` |
| Autofill/work authorization profile | `autofill_profiles` in `schema.sql` | `AutofillProfile` in `types/index.ts`; contact fields, `work_authorization`, `requires_sponsorship`, `authorized_to_work`, `sponsorship_statement`, `years_of_experience`, salary/start/relocation preferences, education, diversity, custom answers |
| Resume | `resumes`, `resume_versions`, `resume_tailoring_analyses`, `resume_ai_edits`, `resume_analyses` | `Resume`, `ParsedResume`, `ResumeVersion`, `ResumeTailoringAnalysisRecord`, `ResumeAiEditRecord`, `ResumeAnalysis` in `types/index.ts`; file/storage fields, `parse_status`, `structured fields`, `raw_text`, `resume_score`, `ats_score`, `content_modified`, tailored-resume fields, `target_field` |
| Application | `job_applications` | `JobApplication`, `TimelineEntry`, `InterviewRound`, `ApplicationStatus` in `types/index.ts`; `user_id`, `job_id`, `resume_id`, `status`, company/job fields, `apply_url`, `applied_at`, `match_score`, `timeline`, interviews, `offer_details`, `application_verdict`, `is_archived`, `source` |
| Matching | `job_match_scores` | `JobMatchScore`, `MatchScoreBreakdown` in `types/index.ts`; `overall_score`, dimension scores, `score_breakdown`, `resume_version`, `computed_at` |
| Sponsorship and immigration | `jobs`, `companies`, H1B/LCA tables, `field_skill_profiles` | `VisaIntelligence`, `LcaSalaryIntelligence`, `StemOptReadiness`, `CapExemptSignal`, `ResumeLcaRoleAlignment`, `CompanyImmigrationProfileSummary` in `types/index.ts`; `jobs.h1b_prediction`, company H1B counts, LCA salary intelligence, field sponsorship density |
| Ghost, repost, timing | `ghost_job_scores`, `job_timing_scores`, `application_timing_signals` | `calculateGhostJobRisk`, `resolveGhostRepostSignals`, `computeApplyTimingFromPostAge`; `risk_score`, `risk_level`, `signals`, `repost_count`, `url_status`, `posted_at`, `hours_since_posted`, `timing_recommendation` |
| Company health and hiring activity | `company_health_scores`, `company_funding_data`, layoff/news tables | `CompanyHiringHealth`, `computeHealthScore`, `fillSpeedLabel`; health score/verdict, signals/events, funding, layoffs, headcount, Glassdoor, time-to-fill |
| Rejections | `rejection_submissions`, `rejection_profile_snapshots`, `rejection_patterns` | `computePatternForCompany`, `recomputeStalePatterns`; title/company outcome patterns, missing skill aggregates, visa/referral/early-apply rates |

### Requested Data Items

| Requested data | Current storage and symbols | X-Ray caveat |
| --- | --- | --- |
| `first_seen_at` | Job first seen is `jobs.first_detected_at`, exposed by `Job.first_detected_at` in `types/index.ts`. Discovery tables use literal `first_seen_at`, including `ats_tenants.first_seen_at`, `company_ats_candidates.first_seen_at`, and `discovered_company_candidates.first_seen_at`. | There is no `jobs.first_seen_at`; use `first_detected_at` for jobs and do not mix it with company/ATS discovery timestamps. |
| `last_seen_at` | Job last seen is `jobs.last_seen_at`. Company crawl recency is `companies.last_crawled_at`. ATS discovery tables also have last-seen/checked fields. | Harvester unchanged-content rows may not advance `jobs.last_seen_at` because `persistJobsBulk` updates on content-hash difference. |
| Source/canonical URL | `jobs.apply_url`, `companies.careers_url`, `companies.direct_ats_url`, `companies.direct_ats_provider`, `companies.direct_ats_identifier`, `jobs.source_ats`, `jobs.source_ats_slug`, and `jobs.raw_data.source`/`raw_data.normalized`. URL helpers include `deriveCanonicalCareersUrl`, `deriveCanonicalCareersUrlWithConfidence`, `inferCareersUrlFromApplyUrl`, and `detectAtsFromUrl`. | Aggregator URLs can point to a board or redirect rather than the employer canonical URL. |
| Requisition ID | `jobs.external_id`; uniqueness is enforced by `jobs_company_external_id_uq` from `scripts/migrations/add-jobs-unique-external-id.sql`. Public JSON-LD in `app/(public)/jobs/[id]/page.tsx` uses `job.external_id ?? job.id`. | Aggregator ingestion writes source-scoped IDs like `<source>:<id>`, which may not be employer requisition IDs. |
| Posting status | `jobs.is_active`, `jobs.publication_status`, `jobs.closed_at`, `jobs.posted_at`, `jobs.duplicate_of_id`. Visibility helpers are in `lib/jobs/publication.ts`. | `is_active` means still detected/live; `publication_status` means safe to show. Legacy crawler close behavior may not set `closed_at` or hidden publication status. |
| Reposts | `ghost_job_scores.repost_count`; query-time helpers `readJobRepostCount` and `resolveGhostRepostSignals` in `lib/jobs/ghost-repost-flags.ts`; ghost route title/company similarity query in `app/api/jobs/[id]/ghost-risk/route.ts`; possible source metadata in `raw_data.repost_count` or `raw_data.times_seen`. | No durable repost-cycle history table was found. Repost counts are derived/cached signals. |
| Job-description changes | `jobs.content_hash` stores latest content hash. `raw_data` stores latest normalized payload/view. `app/api/jobs/[id]/route.ts` may add description backfill metadata such as `description_backfilled_at` and `description_source`. | No job-description history or diff table was found. Current data supports "latest hash", not historical change explanation. |
| Company hiring activity | `companies.job_count`, `companies.last_crawled_at`, `companies.freshness_tier`, `companies.next_harvest_at`, `companies.median_days_open`, `companies.time_to_fill_sample`, `company_health_scores`, `company_news_signals`, `crawl_logs`, and `company_layoff_summary`. Key code: `computeHealthScore`, `computeAndStoreTimeToFill`, `detectHiringFreeze`. | Health and hiring data can be sparse, cached, or stale depending on source importers and crawl cadence. |
| Candidate requirements | `jobs.description`, `jobs.skills`, `jobs.seniority_level`, `jobs.employment_type`, salary fields, `jobs.requires_authorization`, canonical requirements sections in `raw_data.structured_job`/`raw_data.normalized`, and helper extractors in `lib/jobs/metadata.ts`. | Requirements are partly parsed from free text. Confidence/provenance should travel with any X-Ray claim. |
| Work authorization | Candidate fields: `profiles.is_international`, `profiles.visa_status`, `profiles.needs_sponsorship`, and `autofill_profiles.work_authorization`/`requires_sponsorship`/`authorized_to_work`. Job/company fields: `jobs.sponsors_h1b`, `jobs.sponsorship_score`, `jobs.visa_language_detected`, `jobs.requires_authorization`, `companies.sponsors_h1b`, company H1B counts. Logic: `calculateVisaFitScore`, `sqlJobSponsors`, `predictForJob`, `calculateResumeLcaRoleAlignment`. | Work authorization is the highest-risk X-Ray area. Treat hard blockers, employer history, and model predictions as separate facts. |
| Resume claims and supporting evidence | `resumes.raw_text`, parsed resume structures (`work_experience`, `education`, `skills`, `projects`, `certifications`), `resume_analyses.experience_match`, `resume_tailoring_analyses`, and `job_match_scores.score_breakdown.careerFit.evidence`. Tailoring support/risk classifications are produced by `buildLocalTailorAnalysis`. | There is no normalized claim-evidence table. Evidence Strength would currently be inferred, not verified claim by claim. |

### Stored Job And Normalization Payloads

- `normalizeCrawlerJobForPersistence` in `lib/jobs/normalization/normalize.ts` produces canonical fields and a read model used by persistence paths.
- `persistJobsBulk` writes `raw_data` with keys such as `source`, `adapter`, `raw`, `normalization`, `normalized`, `structured_job`, and `view`.
- `persistCrawlJobs` writes `raw_data` with crawler source fields, normalized fields, structured job fields, view payloads, and optional AI enrichment metadata.
- `ingestAggregatorJobs` writes `raw_data` with aggregator source/publisher fields and normalized/view payloads.
- `resolveJobNormalization` in `lib/jobs/normalization/read-model.ts` prefers stored canonical payloads and can recompute from persisted fields.
- `resolveJobCardView` in `lib/jobs/normalization/read-model.ts` reads a card display model from stored raw data when available.

### Data Currently Available For X-Ray Dimensions

| X-Ray dimension | Strong existing data | Weak or missing data |
| --- | --- | --- |
| Hiring Reality | `first_detected_at`, `last_seen_at`, `posted_at`, `closed_at`, `publication_status`, `duplicate_of_id`, `ghost_job_scores`, `company_health_scores`, `median_days_open`, `time_to_fill_sample`, URL probe status | Durable repost cycles, JD change history, consistent close timestamps across all ingestion paths |
| Capability Fit | `job_match_scores.score_breakdown`, `computeFastScore`, `buildCareerFit`, resume parsed fields, role-family/relevant-years evidence | Claim-level proof and calibrated outcome-based fit by role/company |
| Evidence Strength | `buildJobEvidenceFacts`, normalization provenance, `resumes.raw_text`, structured resume fields, tailor-analysis support statuses | Normalized resume-claim evidence table, source spans for every inferred claim |
| Eligibility | Profile work-auth fields, job/company sponsorship fields, `calculateVisaFitScore`, H1B/LCA prediction and salary alignment | Guaranteed role-specific sponsorship, legal/immigration certainty, consistent employer policy history |
| Positioning Quality | `buildLocalTailorAnalysis`, `tailorResumeForAts`, `buildPositioningBrief`, field profiles, `suggestPivotTarget`, `computeBridgePath` | Outcome-calibrated positioning scores by company/ATS and complete field sponsorship density before cron/migration |
| Rejection Risks | `calculateApplicationVerdict`, `rejection_patterns`, `ghost_job_scores`, company health, application timing stats | Sparse/crowdsourced rejection data and possible application status vocabulary mismatch |
| Recommended Actions | Existing labels from `calculateApplicationVerdict`, `ResumeAnalysis.apply_recommendation`, `applyTimingBadge`, career-fit recommendations | One unified action contract for `Apply Now`, `Strengthen First`, `Find Access`, and `Skip` |

## Recommendations

- Create a dedicated X-Ray result schema that references source records instead of copying every upstream payload.
- Persist an X-Ray snapshot when showing it in high-traffic feeds, but compute or refresh full detail views on demand.
- Model data confidence explicitly with values such as `high`, `medium`, `low`, and `unknown`, matching existing `IntelligenceConfidence` patterns in `types/index.ts`.
- Preserve nulls for missing data. For example, no `sponsorship_share` should mean "unknown until field profiles are refreshed", not "zero sponsorship".
- Add a durable job-history table before depending on description-change, repost-cycle, or last-seen deltas as strong Hiring Reality inputs.
- Add claim-level resume evidence if Evidence Strength is expected to explain which resume claims are supported by which bullets, dates, projects, or skills.
- Keep hard eligibility blockers separate from weaker employer-history or model-prediction sponsorship signals.

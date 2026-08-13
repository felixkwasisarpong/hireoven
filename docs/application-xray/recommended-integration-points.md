# Application X-Ray Recommended Integration Points

This document identifies where a future Application X-Ray feature can attach to the current codebase. Facts describe existing files and symbols. Recommendations describe a proposed integration shape and should not be read as current implementation.

## Facts Discovered In The Repository

### Backend Signals By Planned X-Ray Output

| X-Ray output | Existing files and symbols that can support it |
| --- | --- |
| Hiring Reality | `getPostedFreshness` in `lib/jobs/intelligence.ts`; `computeApplyTimingFromPostAge` and `applyTimingBadge` in `lib/jobs/apply-timing.ts`; `calculateGhostJobRisk`, `probeApplyUrl`, and `GhostJobRiskInput` in `lib/jobs/ghost-job-risk.ts`; `app/api/jobs/[id]/ghost-risk/route.ts`; `scanStaleGhostJobs` in `lib/jobs/ghost-scan-worker.ts`; `resolveGhostRepostSignals` and `readJobRepostCount` in `lib/jobs/ghost-repost-flags.ts`; `computeAndStoreTimeToFill` and `fillSpeedLabel` in `lib/companies/time-to-fill.ts`; `computeHealthScore` in `lib/health/score-computer.ts`; `detectHiringFreeze` in `lib/jobs/signals/hiring-freeze-detector.ts` |
| Capability Fit | `computeFastScore`, `buildCareerFit`, `scoreRelevantExperience`, `classifyRoleFamily`, `isRoleFamilyCompatible`, and `buildFastScoreResumeContext` in `lib/matching/fast-scorer.ts`; `scoreJobsForUser` in `lib/matching/batch-scorer.ts`; `computeDeepScore` in `lib/matching/deep-scorer.ts`; `analyzeResumeForJob` in `lib/resume/analyzer.ts`; `calculateResumeLcaRoleAlignment` in `lib/jobs/resume-lca-role-alignment.ts`; `scoreResumeAgainstProfiles` in `lib/resume/signal.ts` |
| Evidence Strength | `buildJobEvidenceFacts`, `buildJobCardFactList`, and `labelEvidenceSource` in `lib/jobs/job-evidence-facts.ts`; normalization provenance types in `lib/jobs/normalization/types.ts`; `resolveJobNormalization` in `lib/jobs/normalization/read-model.ts`; resume parsed fields from `parseResume` in `lib/resume/parser.ts`; support/risk statuses from `buildLocalTailorAnalysis` in `lib/resume/tailor-analysis.ts`; career-fit evidence in `MatchScoreBreakdown.careerFit` |
| Eligibility | `inferRequiresAuthorization`, `AUTH_REQUIRED_PATTERNS`, `AUTH_NOT_REQUIRED_PATTERNS`, and `inferJobMetadata` in `lib/jobs/metadata.ts`; `extractVisaLanguage` and `inferSponsorshipFromText` in `lib/jobs/normalization/normalize.ts`; `calculateVisaFitScore` in `lib/jobs/visa-fit-score.ts`; `sqlJobSponsors` in `lib/jobs/sponsorship-sql.ts`; `effectiveEmployerSponsorshipScore` and `employerSponsorshipCardCopy` in `lib/jobs/sponsorship-employer-signal.ts`; `predictForJob` in `lib/h1b/prediction-service.ts`; `predictH1BApproval` in `lib/h1b/predictor.ts`; candidate work-auth fields in `Profile` and `AutofillProfile` from `types/index.ts` |
| Positioning Quality | `buildLocalTailorAnalysis`, `mergeTailorResults`, and `normalizeTailorAnalysis` in `lib/resume/tailor-analysis.ts`; `tailorResumeForAts`, `getAtsProfile`, and `ATS_PROFILES` in `lib/resume/ats-tailor.ts`; `buildPositioningBrief`, `detectResumeSignal`, `scoreResumeAgainstProfiles`, and `fieldAffinity` in `lib/resume/signal.ts`; `suggestPivotTarget` in `lib/resume/pivot-suggest.ts`; `computeBridgePath` in `lib/resume/bridge.ts`; `buildAndStoreFieldProfiles` in `lib/resume/field-profiles.ts` |
| Rejection Risks | `calculateApplicationVerdict` and `applicationVerdictResultToIntelligence` in `lib/jobs/application-verdict.ts`; `computePatternForCompany` and `recomputeStalePatterns` in `lib/rejections/pattern-computer.ts`; `app/api/rejections/patterns/route.ts`; `recordApplicationOutcome` usage in `app/api/applications/[id]/route.ts`; `computeVariantPerformance` in `lib/applications/variant-performance.ts`; ghost risk and company health signals listed above |
| Recommended Actions | Existing action-like outputs include `ApplicationVerdict.recommendation` from `calculateApplicationVerdict`, `ResumeAnalysis.apply_recommendation` from `analyzeResumeForJob`, timing labels from `applyTimingBadge`, and career-fit recommendations from `buildCareerFit`. |

### API Routes That Can Feed Or Host X-Ray

- `app/api/jobs/[id]/route.ts` is the strongest detail-page anchor because it already loads the job, company, canonical duplicate, normalized read model, and description enrichment.
- `app/api/match/score/route.ts` computes or returns a single job match score for an authenticated user/resume.
- `app/api/match/score/batch/route.ts` and `app/api/match/feed/route.ts` support feed/list contexts where cached summaries matter.
- `app/api/jobs/[id]/ghost-risk/route.ts` computes and caches ghost risk.
- `app/api/h1b/predict/route.ts` computes or returns H1B prediction payloads.
- `app/api/rejections/patterns/route.ts` returns rejection intelligence with sample-size safeguards.
- `app/api/employers/[id]/health-score/route.ts` returns cached or computed company health.
- `app/api/resume/analyze/route.ts` runs deep resume-job analysis.
- `app/api/resume/[id]/tailor/analyze/route.ts` runs resume tailoring analysis for a specific job.
- `app/api/resume/signal/route.ts` returns resume field positioning and target-field brief data.
- `app/api/applications/route.ts` and `app/api/applications/[id]/route.ts` can attach X-Ray output to saved/applied workflow states through `job_applications.application_verdict` or a future X-Ray snapshot.

### UI Components That Can Display Or Reuse X-Ray

- `components/jobs/JobDetailPanel.tsx` is the primary place for full X-Ray detail because it already combines match factors, apply actions, salary, visa, ghost risk, rejection intelligence, employer context, and APEX panels.
- `components/jobs/JobCard.tsx` is the primary compact surface for an X-Ray summary or final action badge.
- `components/matching/MatchScoreBreakdownPopover.tsx` already displays score dimensions and `score_breakdown.careerFit`.
- `components/jobs/JobTimingSection.tsx` can support Hiring Reality timing explanations.
- `components/jobs/GhostJobDetector.tsx` can support ghost/repost/hiring-freeze parts of Hiring Reality.
- `components/jobs/VisaIntelTrigger.tsx`, `components/jobs/VisaIntelDrawer.tsx`, and `components/jobs/SponsorshipProbabilityCard.tsx` can support Eligibility.
- `components/h1b/H1BPredictionBadge.tsx`, `components/h1b/H1BPredictionDrawer.tsx`, `components/h1b/badges/CapExemptBadge.tsx`, and `components/h1b/badges/EverifyBadge.tsx` can support sponsorship/H1B detail.
- `components/rejections/RejectionIntelligence.tsx` and `components/rejections/RejectionBadge.tsx` can support Rejection Risks.
- `components/employers/EmployerHealthBadge.tsx` and `components/employers/EmployerHealthScore.tsx` can support Hiring Reality.
- `components/applications/ApplicationDrawer.tsx`, `components/applications/ApplicationCard.tsx`, `components/applications/PipelineStats.tsx`, and `components/applications/ResumePerformancePanel.tsx` can support post-apply tracking and feedback loops.

### Data Contracts Already Close To X-Ray

- `ApplicationVerdict` in `types/index.ts` already stores final recommendation, confidence, reasons, blockers, opportunities, next steps, data gaps, and component scores.
- `JobIntelligence` in `types/index.ts` can hold visa, LCA salary, ghost risk, company health, immigration profile, match score, application verdict, and freshness.
- `MatchScoreBreakdown` in `types/index.ts` already includes dimension scores and a `careerFit` object with ATS screen score, career fit score, relevant years, total years, required years, label, recommendation, and evidence.
- `ResumeAnalysis` in `types/index.ts` already includes score dimensions, keyword density, `experience_match`, recommendations, verdict, and `apply_recommendation`.
- `JobEvidenceFact` in `lib/jobs/job-evidence-facts.ts` has a useful shape for source, confidence, and evidence-backed facts.

## Recommendations

### Suggested First Integration Shape

- Add a dedicated X-Ray composition module later, for example `lib/application-xray/scorer.ts`, that accepts a job, company, profile, resume context, cached match score, ghost risk, visa intelligence, rejection pattern, and company health.
- Add a single authenticated route later, for example `app/api/jobs/[id]/xray/route.ts`, for full detail-page X-Ray output. Keep route logic thin and call the composition module.
- Keep feed usage separate from detail usage. A feed/card should read a compact cached summary, while the detail page can compute or refresh richer explanations.
- Reuse existing output types where practical, but create an explicit X-Ray response contract for:
  - `hiringReality`
  - `capabilityFit`
  - `evidenceStrength`
  - `eligibility`
  - `positioningQuality`
  - `rejectionRisks`
  - `recommendedActions`
  - `finalAction`
  - `confidence`
  - `dataGaps`
  - `sourceFacts`

### Suggested Mapping To Final Actions

- `Apply Now`: live/published job, low or medium-low ghost risk, strong ATS screen score, acceptable career fit, no hard eligibility blocker, and enough evidence to support the resume positioning.
- `Strengthen First`: viable job, but missing supported keywords, weak evidence strength, poor tailoring, or career-fit concerns that can be improved before applying.
- `Find Access`: job is viable but cold-apply risk is high because of rejection patterns, employer competitiveness, low response timing, referral-sensitive company behavior, or marginal fit that could benefit from a referral or recruiter contact.
- `Skip`: hard work-authorization blocker, dead/expired posting, high ghost risk, severe role-family mismatch, severe relevant-years mismatch, or unsupported resume claims would make tailoring misleading.

### Suggested Guardrails

- Do not collapse unknown data into negative scores. Preserve `unknown` when ghost risk, company health, rejection samples, LCA data, or field sponsorship density are missing.
- Keep `Capability Fit` separate from `Eligibility`. A candidate can be strong technically but blocked by authorization or location constraints.
- Keep `ATS screen score` separate from `career fit`. The existing `careerFit` object in `MatchScoreBreakdown` is built for this distinction.
- Keep `Evidence Strength` separate from keyword matching. Missing a keyword is different from lacking evidence for a claim.
- Treat sponsorship predictions and employer history as probabilistic. Only explicit no-sponsorship, citizenship, clearance, or location requirements should be hard blockers.
- Show sample size and freshness for rejection, health, H1B/LCA, field profiles, and timing data.
- Avoid presenting JD-change, repost-cycle, or stale-posting explanations as high confidence until durable history exists.

### Suggested Test Coverage When Implementation Begins

- Add pure scorer tests beside the new module, following the repository convention of `lib/**/*.test.ts`.
- Cover at least these cases:
  - Strong ATS fit but weak career fit returns `Strengthen First` or `Skip`, not blindly `Apply Now`.
  - Strong fit with hard no-sponsorship language returns an eligibility blocker for users needing sponsorship.
  - Missing ghost/rejection/company-health data produces lower confidence and data gaps, not negative assumptions.
  - Reposted/stale/dead URL jobs lower Hiring Reality.
  - Supported missing keywords improve Positioning Quality recommendations without fabricating resume claims.
  - Rejection samples below threshold remain advisory or unknown.
  - Field sponsorship data missing before `refresh-field-profiles` does not produce a false visa-edge score.

# Application X-Ray Adversarial Review — Revision 2

Written against the design, not for it. Revision 2 adds §13, which attacks the
revision-2 corrections themselves — a correction that removes one failure mode
and quietly installs another is not an improvement.

Severity: **S1** could cause a materially wrong career or immigration decision ·
**S2** systematically misleads · **S3** erodes trust or wastes effort.

Status column: **fixed in r2** · **guarded** (structural mitigation in the
contract) · **open** (procedural mitigation only, needs a test or a code change).

---

## 0. Repository-claim classification (correction 8)

This review cites repository modules as evidence. Each claim is classified so a
reader can tell inspected fact from proposal. Full table and disclosure in
`product-contract.md` §1a; summary:

| Class | Items |
| --- | --- |
| **VERIFIED_EXISTING_BEFORE_THIS_DESIGN** | Every module cited as evidence below — `fast-scorer.ts`, `metadata.ts`, `ghost-job-risk.ts`, `score-computer.ts`, `job-contact-finder.ts`, `visa-fit-score.ts`, `application-verdict.ts`, `persist-bulk.ts`, the ghost-risk route, and the schema defaults. Read directly; unmodified. |
| **OBSERVED_UNCOMMITTED_CHANGE** *(present in the working tree when this work began; not authored here; since committed and merged)* | `lib/applications/statuses.ts`; the `last_seen_at` fix in `lib/harvester/persist-bulk.ts`. |
| **REPO_PRESENT_NOT_APPLIED_BY_XRAY_CORE** | `scripts/migrations/add-candidate-credential-declarations.sql`; `candidate_credential_declarations` persistence is not assumed by the pure core. |
| **REPO_PRESENT_NOT_IMPORTED_BY_XRAY_CORE** | `lib/candidates/credential-declarations.ts`; `lib/jobs/last-seen-trust.ts` and `HARVESTER_LAST_SEEN_EPOCH_ISO`. X-Ray receives their semantics as explicit structured input. |

Every "fixed" marker in §1–§13 below refers to a fix in the design or pure
`lib/application-xray/` core, not to UI/API/database integration.

---

## 1. Ways X-Ray could mislead candidates

### 1.1 (S1) A soft signal reads as a closed door — *guarded*

`probeApplyUrl` maps HTTP **401 and 403 to `"dead"`**, contributing +35 to ghost
risk and a red "Dead (404/410)" card. 403 is the routine answer many ATS and
bot-mitigation layers give a `HEAD` request. A candidate sees "dead link" on a
job posted this morning and skips it.

**Mitigation.** `applyUrlStatus` is `basis: "inference"` with a mandatory
caveat; it can never satisfy `G_CLOSED`; a live row with a dead probe resolves
to `UNCERTAIN` and routes to `RI1`. "Dead link" and "this job is gone" are
prohibited. **Code fix wanted:** probe with `GET` and a browser `User-Agent`,
and map 401/403 to `unknown`. **Test:** C2.

### 1.2 (S2) "Reposted N times" that is N concurrent openings — *guarded*

`queryRepostCount` counts *other currently active* similar-title jobs at the
same company within 90 days. Six parallel "Software Engineer" requisitions
produce `repostCount = 6` → +18 risk and the copy "Reposted 6 times recently.
Repeated postings are a strong ghost job indicator." The UI label also says
"reposts in **60d**" while the query uses 90.

`readJobRepostCount` compounds it by falling back to `raw_data.times_seen`, a
*discovery-table* counter meaning "how many crawls saw this candidate row".

**Mitigation.** The field is named `concurrentSimilarOpenings` and carries
`repostHistoryUnavailable: true`. "Reposted N times" is prohibited. Permitted:
"this company currently has N similar openings." **Test:** C4.

### 1.3 (S1) A missing employer signal reads as negative — *guarded*

`companies.sponsors_h1b` is `boolean DEFAULT false`; `calculateVisaFitScore`
scores `false` at −8 with "Employer is not currently marked as an H-1B sponsor."
For every company never enriched with LCA data, this reads to a
sponsorship-needing candidate as evidence the employer will not sponsor.

**Mitigation.** `employerHasSponsored` is tri-state; `false` + zero counts +
zero confidence ⇒ `"unknown"`. Layer B can never reach a conflict band.
**Test:** B11.

### 1.4 (S2) A missing employer signal reads as *positive* — *guarded*

`computeHealthScore` neutral defaults: funding 10, layoff **25** ("no layoffs =
great"), Glassdoor 12, headcount 12 → **59 → `"healthy"`**. A company we know
nothing about renders as healthy, with a card reading "No layoff history found".

**Mitigation.** `healthUsable` gates on `observedSubScoreCount`, not row
existence. **Test:** C10.

### 1.5 (S1) An empty candidate profile reads as "fully authorized" — *guarded*

`autofill_profiles.authorized_to_work DEFAULT true`,
`requires_sponsorship DEFAULT false`, `profiles.needs_sponsorship DEFAULT false`,
`profiles.is_international DEFAULT false`. A user who never completed onboarding
is byte-identical to a citizen, so the eligibility check silently does not run
for exactly the users who need it.

**Mitigation.** `derivedFromDefaultsOnly` forces every timeline field to
`unknown`; the §5.3 matrix's unknown column is `needs_clarification`, never
`no_conflict`; `G_BLOCKING_CONFIRMATION` stops and asks. **Tests:** B3b, D2a.

### 1.6 (S2) Blocker kinds collapsed into one label — *fixed in r2*

`AUTH_REQUIRED_PATTERNS` merges no-sponsorship, citizenship and clearance into
one boolean written to `jobs.requires_authorization` (`DEFAULT false`, so
`inferRequiresAuthorization`'s `null` is lost), and
`createVisaIntelligenceFallback` labels every hit
`requires_unrestricted_work_authorization`.

**Mitigation.** `PostingAuthorizationLanguageCategory` has nine members, each
requiring a literal excerpt and each recording the `temporalScope` marker that
placed it. **Tests:** B3a, B5, B7a, B8, B9 produce five distinct categories and
five distinct copy paths.

### 1.7 (S1) Bare authorization boilerplate flagged as a blocker — *fixed in r2, code fix open*

The `must ... (possess|have|hold) ... (valid|current|unrestricted|valid and
unrestricted)? (u.s.)? (work|employment) authorization` pattern makes
"unrestricted" **optional**. So "You must currently possess valid U.S. work
authorization" — which an F-1 OPT holder satisfies — matches and is flagged.
`lib/jobs/metadata.authorization.test.ts` asserts the non-flagging behavior for
"authorized to work" / "eligible to work" phrasings, but not for this one, so
the gap is untested.

**Mitigation.** X-Ray requires the literal word "unrestricted" or a named visa
list before reaching `UNRESTRICTED_AUTHORIZATION_REQUIRED`; otherwise the
category is `AMBIGUOUS_GENERAL`, which can never produce a conflict alone.
**Code fix wanted:** tighten the pattern in `lib/jobs/metadata.ts` and add the
negative case to the test. **Tests:** B7 (ambiguous), B7a (named list).

### 1.8 (S1) "On OPT" treated as "needs sponsorship now" — *fixed in r2*

Revision 1 collapsed work authorization into one `needsSponsorship` flag, so an
OPT holder with two years of runway was skipped from postings that only barred
*current* sponsorship. That is a wrong answer on a large and vulnerable
population, delivered with high confidence.

**Mitigation.** `CandidateAuthorizationTimeline` keyed on
`canWorkForTargetEmployerWithoutNewImmigrationAction`, plus the §5.3 matrix.
**Tests:** B3a (scope ambiguous → needs clarification), B3c (future conflict),
B5a (H-1B transfer → `NEEDS_EMPLOYER_ACTION`, never `YES`).

### 1.9 (S2) "Not seen since" on a live job — *guarded, improved*

`persistJobsBulk` historically wrote only on content-hash change, so a live
unchanged harvester job kept a stale `last_seen_at`. **A working-tree fix now
also writes when `jobs.last_seen_at < EXCLUDED.last_seen_at`.** It is
forward-only.

**Mitigation.** `HARVESTER_LAST_SEEN_EPOCH_ISO` (mirroring
`FAST_SCORE_CACHE_EPOCH_ISO`); below the epoch the field backs no finding.
**New risk introduced by the fix:** see §13.6. **Tests:** C5, C5a.

### 1.10 (S3) Card and detail disagree — *guarded*

**Mitigation.** `XRaySummary` is a projection of the same object, never an
independent computation; snapshots carry `inputsHash` and a "last computed"
stamp. **Test:** assert `summary.bands` deep-equals the dimension bands for
every fixture.

---

## 2. Visa and immigration-risk language

The highest-stakes area. A wrong sentence can cost an opportunity or push
someone toward a bad decision on a clock.

| Risk | Origin | Mitigation | Status |
| --- | --- | --- | --- |
| **(S1)** Implying legal ineligibility | The natural phrasing of a blocker | Bands are observational (`EXPLICIT_REQUIREMENT_CONFLICT`, not "blocked"); "you are (not) eligible" is prohibited outright | fixed in r2 |
| **(S1)** Implying a sponsorship promise | `employerLikelySponsors`, `sponsors_h1b`, `employerSponsorshipCardCopy` all read forward-looking | `notARolePromise: true` is mandatory; copy is past-tense with a count and window | guarded |
| **(S1)** Predicting an H-1B outcome | `predictH1BApproval` produces probability-shaped payloads | Display-only, never a decision input, always with `dataAsOf` | guarded |
| **(S1)** Blending cap-exempt into lottery odds | `calculateVisaFitScore` warns about this itself | `CapExemptSignal` stays a separate field; no arithmetic combines them | guarded |
| **(S1)** An uncitable requirement | A regex hit with no excerpt is unfalsifiable | `PostingAuthorizationRequirement.excerpt` is non-optional | guarded |
| **(S1)** Conflating "authorized now" with "authorized forever" | Both directions are wrong: skipping an OPT holder who can work today, and reassuring one whose EAD expires in three months | The timeline carries `canWorkForTargetEmployerWithoutNewImmigrationAction` alongside an ordered `futureEmployerActions[]`; `EMPLOYER_ACTION_MAY_BE_NEEDED` exists precisely to say both at once | fixed in r2 |
| **(S1)** Inferring clearance from immigration status | Revision 1 skipped a TS/SCI posting based on `visa_status` | Clearance is `needs_clarification` for every timeline state; there is no candidate clearance field to infer from | fixed in r2 |
| **(S2)** Aggregate history overriding posting text | LCA volume is persuasive | Layer A wins the band; Layer B is context | guarded |
| **(S2)** Absence of role-family filings read as refusal | `calculateVisaFitScore` applies −14 | Reported as a gap | guarded |
| **(S2)** An employer attribute treated as a posting requirement | Non-E-Verify is materially bad for STEM OPT, which makes it tempting to skip | §5.5: employer attributes can never reach a conflict band | fixed in r2 (B4a) |
| **(S2)** Unknown E-Verify read as absent | `buildStemOptReadiness` sets `employerTrainingPlanRisk: "high"` only on explicit `false`, but a UI could conflate | Tri-state `eVerify` | guarded |
| **(S2)** OPT-clock urgency distorting the recommendation | `opt_end_date` is emotionally loaded | `futureActionHorizonDays` may reorder and soften copy; a test asserts `finalAction` equality across two `opt_end_date` values | guarded (E13) |
| **(S1)** Missing disclaimer | Easy to drop in a redesign | `disclaimerRequired: true` is a literal type | guarded |

Standing rule: X-Ray describes **postings** and **employer histories**. It never
describes a candidate's legal standing.

---

## 3. Bias and fairness

### 3.1 (S1) Double-penalizing candidates who need sponsorship — *guarded*

`computeFastScore` folds a sponsorship rank delta into `overall_score`
(−18 for a hard "must already be authorized" signal). Reading `overall_score` as
Capability while reading posting language as Eligibility would give two
byte-identical résumés different **capability** verdicts based on immigration
status.

**Mitigation.** Capability reads `careerFitScore` only; `overall_score` lives in
`XRayInternalScores`. **Test:** E11.

### 3.2 (S2) Proxy variables — *guarded*

`autofill_profiles` stores `gender`, `ethnicity`, `hispanic_latino`,
`veteran_status`, `disability_status`. Graduation year is an age proxy;
`is_international` is a direct proxy.

**Mitigation.** The diversity fields are never read.
`is_international` is used only as a *last* fallback for sponsorship need, never
alone (B12b shows it producing `unknown`, not an answer). No cohort features in
v0. **Test:** a static check that `lib/application-xray/**` contains no
reference to those columns.

### 3.3 (S2) Role-family classifier bias against non-linear careers — *guarded*

`classifyRoleFamily` works from title and description text. Career changers,
bootcamp graduates, military transitions and non-US title conventions classify
poorly. `computeFastScore` relaxed its own cap to 55 for this reason.

**Mitigation.** `RE1` requires two of the four closed corroborations.
**Tests:** A10, A8.

### 3.4 (S2) Community rejection data measures who reports — *fixed in r2*

`rejection_submissions` is voluntary and skews toward engaged users, negative
outcomes and visible companies. `h1b_screen_rate` vs `citizen_screen_rate`, if
surfaced, would tell an H-1B candidate their odds are lower from data that
mostly measures reporting behavior.

**Mitigation.** In r2 these rates cannot gate anything at all
(`gatesFinalAction: false`); visa-segmented rates are not consumed on any path;
display requires `MIN_SUBMISSIONS` and the 180-day horizon.
**Tests:** E1, E2, E5, E6.

### 3.5 (S2) Network-based access advantages the already-networked — *new in r2*

Making `FIND_ACCESS` depend on `ActionableAccessRoute` is correct on accuracy
grounds and regressive on distribution: routes come from
`linkedin_connections` (populated by a Shadow Network scan the user must run),
`cohort_members` (layoff cohorts), and `employer_cohort_requests`. Candidates
new to the country, early in their careers, or outside the layoff cohorts will
essentially never see a route.

**Why it is still right.** The alternative — telling someone with no network to
"get a referral" — is worse: it is unactionable advice that reads as a personal
failing.

**Mitigations.**
1. Absence of a route is never a penalty. `G_ROUTE = false` only prevents
   `FIND_ACCESS`; `RI2` still returns `APPLY_NOW` (E1, E2, E3b).
2. No copy anywhere may imply that applying without a referral is futile.
3. The `consider_referral_generally` advisory is capped at low priority and can
   never be the headline.
4. Track `FIND_ACCESS` rate by candidate segment. If it correlates with
   `is_international`, that is a product problem to solve by *sourcing more
   routes*, not by loosening the gate.

**Test:** E3b asserts a channel-less contact does not become a route.

### 3.6 (S3) Keyword coverage rewards résumé-gaming — *guarded*

**Mitigation.** Coverage sets Positioning only. Evidence counts support
*status*, not term frequency, so stuffing raises Positioning without raising
Evidence — and Evidence outranks Positioning. **Test:** D6.

### 3.7 (S3) English-language and formatting bias — *guarded*

Parsers and ATS heuristics favor US-style English documents. A strong candidate
with a European CV can land in `UNREADABLE`.

**Mitigation.** The band is named for our reading, not the candidate. Copy is
"we could not read your résumé", never "your résumé is weak".

---

## 4. False precision

### 4.1 (S1) Any interview probability — *guarded*

Prohibited absolutely. Outcome capture was broken until very recently (§11),
rejection samples are self-selected, nothing is calibrated. **Test:** a regex
guard over all rendered strings rejecting `\d+%` adjacent to
interview/callback/response/screen/offer vocabulary.

### 4.2 (S2) Uncited screen-rate multipliers — *guarded*

`computeApplyTimingFromPostAge` returns 3.1×, 2.4×, 1.8×, 1.0×, 0.7× and
`applyTimingBadge` renders "3.1× screen rate" on cards. The repository contains
no derivation or citation. Printing them gives a hardcoded constant the
appearance of measurement and manufactures urgency.

**Mitigation.** X-Ray uses the *ordering* via `G_WINDOW` and never prints the
multipliers. The existing card badge is a pre-existing surface, not an X-Ray
claim, and should be revisited separately.

### 4.3 (S2) Decimal precision on inferred quantities — *guarded*

`careerFit.relevantYears` is a weighted sum of
`exp.years × relevanceFactor × recencyMultiplier` — a construct, not a
measurement. "2.1 years" reads as precise.

**Mitigation.** Round to whole years in copy for values ≥ 2; ranges elsewhere.
The precise value stays in `XRayInternalScores` and the expandable evidence.

### 4.4 (S2) Acquisition-time estimates — *fixed in r2*

Revision 1 asserted `acquirableWithinDays ≤ 30` with no source. HireOven has no
credential catalog: `CERT_REQUIRED_RE` is an extraction regex over a closed
token set and says nothing about how long anything takes.

**Mitigation.** `AcquirabilitySource` must be `candidate_declared` or
`credential_catalog`; the catalog does not exist, so v0 reaches non-`unknown`
only through the candidate. **An LLM may not populate `estimatedDays`.**
**Tests:** A7 (declared), A7a (not declared → `RE4` cannot fire).

### 4.5 (S2) Bands implying uniform granularity — *guarded*

Six Hiring Reality bands suggest six distinguishable states; between
`LIKELY_LIVE` and `UNCERTAIN` the real difference is often one timestamp.

**Mitigation.** Every band carries `oldestInputObservedAt` and
`staleInputsDowngraded`, and the UI shows what moved it.

### 4.6 (S3) A computed number implying a fresh observation — *guarded*

**Mitigation.** Every finding carries `observedAt` **and** `computedAt`; the two
are never conflated; the staleness table governs when a stale input stops
counting.

---

## 5. Circular scoring

### 5.1 (S2) Recommendation feeding back as evidence — *guarded*

X-Ray recommends `STRENGTHEN_FIRST` → the candidate tailors → Positioning
improves → X-Ray says `APPLY_NOW` citing the improvement as evidence of fit.
Nothing about the candidate changed.

**Mitigation.** `XRayBasis` has no `recommendation` member, so a recommendation
cannot be a `XRaySourceFact` at the type level. Evidence counts support status,
which tailoring does not change. Capability ignores keyword coverage.
**Test:** D6.

### 5.2 (S2) `ApplicationVerdict` round-tripping — *guarded*

**Mitigation.** `legacyVerdictProjection` is write-only and carries
`derivedFrom: "application_xray"`. **Test:** a static check that the module never
imports `calculateApplicationVerdict` or reads `application_verdict`.

### 5.3 (S2) Ghost risk absorbing its own consequences — *guarded*

`calculateGhostJobRisk` takes `hasHiringFreeze` from layoff data, which also
drives `computeHealthScore`'s layoff sub-score and
`CompanyHiringHealth.hasActiveFreezeFromLayoffs`. Three paths, one observation.

**Mitigation.** The §12.1 claim ledger; `alreadyCountedInGhostRisk`.
**Test:** E10.

### 5.4 (S3) Epoch invalidation hiding drift — *guarded*

`FAST_SCORE_CACHE_EPOCH_ISO` is bumped when scoring changes, but an X-Ray
snapshot computed from a pre-epoch `score_breakdown` would not automatically
invalidate.

**Mitigation.** `inputsHash` includes the epoch, `engineVersion`, the résumé
version and the job `content_hash`.

---

## 6. Double-counted signals

Full ledger in `decision-table.md` §12.1. The three most consequential:

### 6.1 (S1) Sponsorship in the match score

§3.1. Fairness-critical. **Test:** E11.

### 6.2 (S2) `repostCount` and `duplicateCount`

`calculateGhostJobRisk` takes both; both derive from "similar title at the same
company"; each adds +18. One fact, +36. **Mitigation:** counted once as
`concurrentSimilarOpenings`. **Test:** C4 plus a unit assertion that toggling
`duplicateCount` with `repostCount` fixed does not move the band.

### 6.3 (S2) Posting age

Age appears in `calculateGhostJobRisk` (up to +28), in
`calculateApplicationVerdict` as a separate `jobFreshnessDays` term (guarded
only when ghost is `high`), in `getPostedFreshness.score`, and in
`applyTimingBadge`. Four consumers of one timestamp.

**Mitigation.** Hiring Reality owns age; the others are display-only; `G_WINDOW`
is the only age-derived decision input and it gates the repair window, not a
band.

---

## 7. Stale data

| Data | Staleness mode | Consequence | Mitigation |
| --- | --- | --- | --- |
| `jobs.last_seen_at` pre-epoch | Never advanced on unchanged content | False "gone" claims | Excluded below the epoch (§1.9) |
| `ghost_job_scores` | 24h TTL; `scanStaleGhostJobs` can lag | A dead job reads live for a day | `cacheAgeHours` exposed; > 24h ⇒ recompute or `unknown` |
| `company_health_scores` | Cron-driven; importers fail silently | A pre-layoff snapshot renders healthy | 30-day threshold ⇒ `healthUsable = false` |
| LCA / H-1B | Fiscal-year releases, 1–3 years behind | Employer looks like a sponsor after policy changed | 1095-day threshold; always show `dataAsOf` |
| `field_skill_profiles` | Depends on `refresh-field-profiles`; `sponsorship_share` only exists post-migration | A false "visa edge" or a zero fit | `corpusAvailable: false` |
| `job_match_scores` | Epoch/version gated | Capability computed against an old résumé | Recompute, else `UNKNOWN` |
| `rejection_patterns` | Recomputed only on new submissions, limit 200 | Year-old behavior phrasing a route | 180-day horizon (E6) |
| **Access routes** | `linkedin_connections` is a point-in-time scrape; people change jobs | Telling a candidate to contact someone who left | Per-type horizons (§7.3); dropped, not downgraded. **See §13.3** |
| The job description | Employers edit in place; only the latest `content_hash` is stored | Requirements shift under a snapshot | No JD-change claims; `inputsHash` includes `content_hash` |
| The X-Ray snapshot | Cached for feed cards | A stale action on a card | "Last computed" stamp; detail always recomputes |

Underlying gap: **no durable job-description history table.** Any "requirements
changed" or "reposted at a lower salary" feature is blocked on one.

---

## 8. Where `ApplicationVerdict` and X-Ray will disagree

They will disagree often, and mostly X-Ray is right. Enumerated so QA is not
surprised.

| Case | `calculateApplicationVerdict` | X-Ray | Who is right |
| --- | --- | --- | --- |
| Strong match, no-sponsorship text, candidate not authorized | 50 + 22 − 45 = 27 → `High Risk`/`Skip` | `SKIP` with a cited excerpt | agree; X-Ray gives the reason |
| Strong match, no-sponsorship text, candidate is a citizen | `visaRelevant` derives from **employer** fields (`sponsors_h1b \|\| requires_authorization`), so the blocker can still fire | `APPLY_NOW` | **X-Ray** |
| OPT candidate, posting bars only *current* sponsorship | blocker fires → `Skip`/`High Risk` | `APPLY_NOW`, band `EMPLOYER_ACTION_MAY_BE_NEEDED` | **X-Ray** (the r2 correction) |
| Everything unknown but one match score | `coverage = 1` → a directive verdict | `INSUFFICIENT_DATA` | **X-Ray** |
| Duplicate row | scores the duplicate's own fields | evaluates the canonical | **X-Ray** |
| No-data company | a defaulted `growing` health adds +8 | `healthUsable = false`, no effect | **X-Ray** |
| Fresh job, ghost `high` | −22 and +10 partly cancel → `Maybe` | `UNCERTAIN` + `APPLY_NOW` at low confidence, both signals shown | **X-Ray** — cancellation hides the conflict |
| A named route exists | no concept; likely `Apply Today` | `FIND_ACCESS` | **X-Ray** |
| Buried evidence | high match ⇒ `Apply Today` | `STRENGTHEN_FIRST` | **X-Ray** |
| Match 68, everything else clean | ≥58 and <70 → `Apply, But Customize Resume` | `APPLY_NOW` if career fit and evidence are strong | **X-Ray** — 70 is arbitrary on a blended score |
| Salary below LCA market | −6, can tip the verdict | display-only | **X-Ray** |
| `minimumMatchScore` unmet | −8 | annotation only | **X-Ray** |

**Mitigations.** One engine renders per surface during migration; the projection
is tagged `derivedFrom: "application_xray"`; log disagreements for one release to
size the rollout; delete `calculateApplicationVerdict` once surfaces migrate.

---

## 9. When `FIND_ACCESS` degenerates into generic networking advice

**Failure modes.** Prestige as a proxy. Low fit relabeled as an access problem.
Sub-threshold statistics ("100% of referred candidates got a screen", n=1).
An unactionable route ("find someone at the company"). A route the candidate
cannot use, which correlates with immigration status (§3.5).

**Mitigation — structural in r2.** `G_ROUTE` requires a valid
`ActionableAccessRoute`: a route type, a named person or concrete channel, the
relationship context, the exact next step, `sourceFactIds`, and freshness inside
the type's horizon. A `FIND_ACCESS` with an empty or channel-less
`accessRoutes[]` is **invalid output**. Referral statistics
carry `gatesFinalAction: false` and can only rank and phrase a route that
already qualifies.

**Tests.** E1a and E3a (valid), E1 (statistics alone rejected), E2 (prestige
rejected), E3 (prior application without a stored contact rejected), E3b
(channel-less contact rejected), E4 (small effect), E5 (small sample), E6
(stale advisory).

---

## 10. When `STRENGTHEN_FIRST` costs the candidate a fresh job

The strongest signal in the repository is that early applications matter.
`STRENGTHEN_FIRST` on a 6-hour-old posting for a 20-minute fix converts a day-one
application into a day-three one, and many candidates never return. On a
120-day-old posting the repair is real and the opportunity is probably gone.

**Mitigation.** `repairFitsWindow` is a hard precondition on every
`STRENGTHEN_FIRST` rule except `RF1` and `RE3`, which are information requests
rather than document work. `hot` + effort > `minutes` ⇒ `APPLY_NOW` with the
repair deferred and the trade-off stated. `stale` ⇒ never.
`repairEstimate.estimatedMinutes` comes from counts of *supported* edits, not
from a model.

**Product follow-up:** a "strengthen and apply in one pass" flow removes the
trade-off for `minutes`-effort repairs. The window test is the guard until then.

**Tests.** A3 (hot + minutes, allowed), A3a (hot + hours, flips to `APPLY_NOW`),
C3 (stale, blocked).

---

## 11. Outcome-data integrity

Since revision 1, the status-vocabulary fix has partially landed:
`lib/applications/statuses.ts` exists, and
`app/api/applications/[id]/route.ts` now consumes
`isApplicationTimingOutcomeStatus` / `timingOutcomeGotRecruiterResponse` instead
of the `["interviewing", …]` set that nothing wrote.

**(S2) Still open.**

1. `lib/apex/timing/queue-manager.ts` still queries
   `status IN ('applied','interviewing','offer','rejected')`;
   `app/api/apex/pipeline-sim/route.ts` and `app/api/apex/chat/route.ts` still
   reference `interviewing`; `lib/resume/version-outcomes.ts` still accepts both
   vocabularies and defines "responded" a third way (including `rejected` and
   `withdrawn`).
2. The trigger still requires the previous status to be exactly `applied`, so a
   progression that skips that state records nothing.
3. `application_timing_signals` still holds pre-fix rolling averages biased
   toward non-response. The upsert cannot be corrected in place; it needs a
   recompute from a `timeline` replay.
4. `job_applications.status` still has no `CHECK` constraint.

**Mitigation for X-Ray:** under §8 of the decision table these signals cannot
gate anything, so the exposure is a display-accuracy problem rather than a
decision problem. That is structural, not procedural — but the backfill is still
required before any outcome-learned weighting is considered.

---

## 12. Other risks

### 12.1 (S2) Anchoring on the first X-Ray a candidate sees — *open*

If early results skew toward `SKIP` — easy when explicit conflicts are common
for international candidates — the product reads as discouraging and users
disengage before it helps them.

**Mitigation.** Every `SKIP` must carry at least one forward action:
`choose_different_target`, or a pointer to `suggestPivotTarget` /
`computeBridgePath`, both of which already exist. `SKIP` is never a dead end.
**Test obligation:** assert `actions.length ≥ 1` on every `SKIP` fixture.

### 12.2 (S3) Automation bias — *guarded*

A confident verdict discourages the candidate from checking the posting
themselves, which given §1.1 and §1.2 is exactly backwards.

**Mitigation.** Every `SKIP` and every low-confidence action includes a
"verify on the employer's site" affordance and the source link. Confidence is
displayed, not buried.

### 12.3 (S2) LLM drift in requirement extraction — *fixed in r2*

`analyzeResumeForJob` is cached but model outputs drift; a requirement extracted
on Monday may vanish on Friday, silently flipping a `SKIP` to an `APPLY_NOW`.

**Mitigation.** `llm_only` provenance caps `RequirementStrength` at `INFERRED`,
so an LLM-only requirement can never satisfy `G_HARD_REQ_ABSENT` or
`G_CONFLICT_DECISIVE`. `engineVersion` and the model id belong in `inputsHash`.
**Test:** A12.

### 12.4 (S1) Snapshot mutation after the candidate decided — *guarded*

**Mitigation.** `XRayOutcomeLink.snapshotFrozenAt`; post-apply snapshots are
immutable and a recomputation is stored as a diff.

### 12.5 (S3) Cost and latency — *open*

The full path can touch a URL probe (5s timeout), a hiring-freeze query, a
repost query with `similarity()`, an LCA lookup, the networking finder (four
parallel queries), and optionally an LLM call. The web box has documented memory
pressure.

**Mitigation.** Feed reads cached summaries only. Detail reuses existing caches.
The URL probe stays behind the ghost-risk 24h cache. The networking finder is
already bounded (`LIMIT 6/4/80/8`). No X-Ray query may run without an indexed
predicate.

### 12.6 (S2) Copy rules decaying — *open*

Some prohibitions are enforceable in types (`disclaimerRequired`,
`notARolePromise`, `repostHistoryUnavailable`, `verificationLevel: "inferred"`,
`mayEstablishCapabilityAbsence: false`, `gatesFinalAction: false`); the rest are
prose.

**Mitigation.** A rendered-string guard in CI over every fixture's output. Each
new prohibition is added to the guard in the same commit that adds it to the
document.

---

## 13. Attacks on the revision-2 corrections themselves

Each correction removed a real failure mode. Each also created surface area.

### 13.1 (S2) `NOT_FOUND` becomes a nag — *guarded*

Correction 3 is right: a résumé omitting a CPA is not evidence the candidate
lacks one. But the consequence is that every unmatched `MANDATORY_EXPLICIT`
requirement produces a `confirm_requirement_status` action (`RE3`). A posting
listing eight certifications produces eight questions, and the candidate
abandons the flow — or worse, clicks through them carelessly, poisoning the
declaration store that `ABSENT_CONFIRMED` depends on.

**Mitigations.**
1. Cap `confirm_requirement_status` actions at 3 per X-Ray, ordered by
   requirement severity, and say how many were suppressed.
2. Declarations are **per credential, not per job** — asking once about a CPA
   answers it everywhere. Store them on the candidate, not the application.
3. Never pre-check or default a declaration; an unanswered question stays
   `NOT_FOUND`, never decays into `ABSENT_CONFIRMED`.
4. A declaration must be reversible, and reversing it must invalidate any
   `SKIP` derived from it.

**Test obligation:** assert the 3-cap and the suppression note.

### 13.2 (S1) `ABSENT_CONFIRMED` weaponizes the candidate's own answer — *open*

`RC3` skips on the candidate's statement. A candidate who answers "no" quickly —
misreading the question, or not realizing an equivalent credential counts — has
just been told to skip a job they could have gotten. This is now the *only*
requirement-based skip path, so all the weight sits on one click.

**Mitigations.**
1. The question must name the requirement verbatim from the posting and show the
   excerpt, so the candidate is answering the employer's question, not ours.
2. A `SKIP` from `RC3` must state that it came from the candidate's own answer
   and offer a one-click reversal.
3. Never ask in a way that implies the "correct" answer.
4. Consider an "I have an equivalent" third option that maps to
   `needs_clarification`, not to `ABSENT_CONFIRMED`.

### 13.3 (S2) Access routes point at people who left — *open*

`linkedin_connections` is a point-in-time scrape (`scraped_at`), and
`cohort_members` and `employer_cohort_requests` are older still. Telling a
candidate to contact someone who left the company six months ago wastes a social
credit they cannot get back, and it is embarrassing in a way a wrong band is not.

**Mitigations.**
1. Per-type freshness horizons; routes past them are dropped.
2. Route copy always states when the connection was observed: "as of your scan
   9 days ago".
3. `nextStep` must be written so it survives being wrong — "ask Priya whether
   she is still on that team" degrades gracefully; "ask Priya to refer you" does
   not.
4. Never present `parseEmailName`'s output as a verified identity: it derives a
   display name from an email local part, so "Jane Doe" from `jane.doe@…` is a
   guess (E3a asserts hedged copy).

### 13.4 (S2) "We could not check" fatigue — *open*

Correction 10 sends decision-blocking ambiguity to `INSUFFICIENT_DATA`. That is
right, and it means a candidate with an incomplete profile may see
`INSUFFICIENT_DATA` on every job in their feed — which reads as the product
being broken rather than as a prompt.

**Mitigations.**
1. `confirm_authorization_timeline` is answered **once**, on the profile, not
   per job. One answer clears the whole feed.
2. The feed card for `INSUFFICIENT_DATA` due to a profile gap must show the
   profile prompt, not a per-job one.
3. Consider deferring X-Ray entirely until the timeline is set, rather than
   rendering a feed of shrugs.

### 13.5 (S3) Observational band names are unreadable — *open*

`NO_EXPLICIT_CONFLICT_FOUND` and `EMPLOYER_ACTION_MAY_BE_NEEDED` are precise and
unpleasant. The risk is that a designer, reasonably, relabels them "Eligible" and
"May need sponsorship" in the UI, restoring the exact claim correction 7
removed.

**Mitigations.**
1. The band enum is never rendered directly. The UI renders `headline`, which is
   generated from a fixed phrase table reviewed against §6.2/§6.3.
2. The prohibited-language CI guard covers the words "eligible", "ineligible",
   "qualify" and "cannot work" in all rendered output.
3. Group B fixtures assert the absence of those words.

### 13.6 (S2) The `last_seen_at` fix makes staleness newly meaningful — *open*

Before the working-tree fix, a stale `last_seen_at` meant nothing. After it, a
stale value against a fresh `companies.last_crawled_at` genuinely suggests the
job was not seen on the last pass. The risk is over-trusting that immediately:
the fix is forward-only, deploy timing is uncertain, and rows not yet
re-harvested still carry pre-fix values.

**Mitigations.**
1. `HARVESTER_LAST_SEEN_EPOCH_ISO` must be set to the actual deploy timestamp,
   not the commit date, and must be a constant a test can assert.
2. Even post-epoch, a stale `last_seen_at` produces at most `LIKELY_CLOSED` and
   routes to `RI1` — never `G_CLOSED` (C5a).
3. Re-verify the epoch after the harvester box redeploys; two boxes are involved
   and they do not deploy together.

### 13.7 (S2) Canonical resolution can hide a better posting — *open*

Correction 2 evaluates the canonical. But `duplicate_of_id` is assigned by a
dedup process that has been wrong before — the documented dedup mis-merges
picked a survivor by domain quality rather than by working adapter, stranding
live records behind a duplicate flag. If the canonical is the *worse* row (stale
description, aggregator apply URL), X-Ray now evaluates the worse one.

**Mitigations.**
1. When the requested row and the canonical materially disagree on
   `content_hash` age or apply-URL directness, say so and surface both links.
2. `CanonicalResolution.note` is mandatory whenever
   `outcome !== "not_a_duplicate"`; the candidate always knows a swap occurred.
3. A dangling or invalid canonical goes to `INSUFFICIENT_DATA`, never a silent
   fallback (C7c).
4. Log canonical swaps where the canonical is older than the duplicate; a
   sustained rate is a dedup bug, not an X-Ray bug.

### 13.9 (S2) Scope-ambiguity fatigue — *new in this pass, open*

Correction 2 is right: a bare no-sponsorship line does not establish scope. But
that phrasing is extremely common, so a sponsorship-needing candidate may now
see `NEEDS_CLARIFICATION` and a `confirm_future_sponsorship_policy` action on a
large fraction of their feed. Advice that appears everywhere is read as noise,
and the candidate stops seeing the cases where it matters.

**Mitigations.**
1. The action is per employer, not per posting — one answer about a company's
   sponsorship posture resolves every one of its listings.
2. Suppress the prompt entirely when `futureEmployerActions` is empty, i.e. for
   candidates who will never need employer action. They are the majority, and
   ambiguity is irrelevant to them.
3. Rank it below any concrete positioning or evidence action; it is a question
   for later, not a blocker now.
4. Never let it change the final action on its own — the matrix routes it to
   `APPLY_NOW` at low confidence precisely so it informs without obstructing.

### 13.10 (S1) Confirmed non-enrolment sliding into a legal claim — *new in this pass, open*

Correction 5C creates the first path where an employer attribute reaches `SKIP`
(fixture B4c). The failure mode is the copy: "this employer is not enrolled in
E-Verify, so you cannot work here" is both wrong and frightening. The candidate's
current EAD may have a year left; what cannot be arranged is a *future*
extension at *this* employer.

**Mitigations.**
1. `B4c` requires **two** confirmations from the two parties who own the facts —
   the candidate that STEM OPT is the path they need, the employer that it will
   neither participate nor enrol. Neither alone fires, and the candidate's
   current target-employer work authorization remains `YES` when the unexpired
   OPT EAD otherwise permits work today.
2. Confidence is capped at `medium`, never `high`, because either confirmation
   can be revised.
3. The copy describes an arrangement that cannot be made, never a status:
   "this employer says it will not enrol in E-Verify, and you've told us you'll
   need STEM OPT for this role."
4. B4b exists specifically to hold the one-sided case at `APPLY_NOW`.

### 13.8 (S3) The 3-of-5-unknown sufficiency threshold is arbitrary — *open*

`G_SUFFICIENT` trips at three `UNKNOWN` dimensions. Two is fine; three is not.
There is no evidence for that line, and D4 vs D3 turns on it.

**Mitigation.** It is documented as a chosen constant, exposed in
`decisionTrace.inputs`, and covered by fixtures on either side of the boundary
(D3, D4, A6a). Revisit once real distributions exist. This is honest
arbitrariness, not hidden arbitrariness.

Correction 7 tightened one edge of it: `evidence.band = UNREADABLE` now counts
toward the unknown tally, which is what makes A6a resolve coherently instead of
claiming a stage-E rule fired while the stage-D gate was failing.

---

## 14. Pre-implementation checklist

| # | Item | Blocks implementation? |
| --- | --- | --- |
| 1 | Capability reads `careerFitScore`, never `overall_score` (E11) | Yes |
| 2 | Tri-state derivation for candidate authorization; defaults never read as answers | Yes |
| 3 | Tri-state derivation for `companies.sponsors_h1b` | Yes |
| 4 | `healthUsable` gates on `observedSubScoreCount` | Yes |
| 5 | Posting-language categories re-derived with excerpts; `requires_authorization` demoted to a hint | Yes |
| 6 | The §5.3 matrix implemented cell-by-cell and asserted (45 cells) | Yes |
| 7 | `RequirementPresence` implemented; `NOT_FOUND` can never set `supportsHardSkip` | Yes |
| 8 | `llm_only` provenance caps strength at `INFERRED` | Yes |
| 9 | Acquirability requires a source; no model estimates | Yes |
| 10 | `ActionableAccessRoute` validity enforced; `FIND_ACCESS` invalid without a channel | Yes |
| 11 | Referral advisory carries `gatesFinalAction: false` and cannot reach the decision | Yes |
| 12 | Canonical resolution as preprocessing; duplicate equivalence test (E12) | Yes |
| 13 | `repairFitsWindow` enforced on every `STRENGTHEN_FIRST` rule except `RF1`/`RE3` | Yes |
| 14 | Double-count ledger; E10 and E11 green | Yes |
| 15 | Prohibited-language guard in CI, including "eligible"/"ineligible" | Yes |
| 16 | `HARVESTER_LAST_SEEN_EPOCH_ISO` defined and asserted | Yes |
| 17 | `FAST_SCORE_CACHE_EPOCH_ISO` folded into `inputsHash` | Yes |
| 18 | Static check: no diversity-column reads; no `calculateApplicationVerdict` import | Yes |
| 19 | Every `SKIP` carries ≥1 forward action (§12.1) | Yes |
| 20 | Declaration store is repo-present but not required by the pure core; DB-backed persistence remains an integration milestone | No — core accepts structured declarations |
| 21 | `probeApplyUrl` 401/403 reclassified as `unknown` | No — X-Ray's caveat covers it; fix separately |
| 22 | `must possess valid work authorization` pattern tightened in `lib/jobs/metadata.ts` | No — X-Ray re-derives; fix separately |
| 23 | Remaining status-vocabulary consumers migrated; `application_timing_signals` recomputed | No — not a v0 decision input |
| 24 | Job-description history table | No — blocks JD-change claims only |
| 25 | Claim-level evidence table | No — blocks the word "verified" only |
| 26 | Credential acquirability catalog | No — blocks `RE4` without a declaration only |

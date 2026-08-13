# Application X-Ray Product Contract — Revision 2

Design proposal, v0. No production code is implied. Revision 2 supersedes
revision 1 in full; change log at §12.

Companions: `xray-contract.ts`, `decision-table.md`, `test-fixtures.md`,
`adversarial-review.md`, and the three prior audits in this directory.

---

## 1. Product promise

**Application X-Ray tells a candidate what is actually observable about one job,
one résumé, and one declared situation — and then names the single next action
that follows from those observations.**

Four constraints, each binding on what may ship:

1. **Separable.** The candidate always sees which of the five realities produced
   the recommendation: is the job real, can they do the work, does their paper
   show it, does the posting say anything that conflicts with what they told us,
   and is the résumé aimed correctly. One blended number is not the product.
2. **Honest about ignorance.** Where HireOven does not know something, X-Ray says
   so and shows what would resolve it. Unknown never becomes a penalty, and —
   equally — never becomes a reassurance.
3. **Deterministic where it matters.** The final action comes from a rule table a
   test can assert against. An LLM may phrase a sentence; it may never pick the
   action, and it may never establish that a requirement is mandatory or that a
   credential is obtainable.
4. **Observational, not adjudicative.** X-Ray reports what a posting *says* and
   what a candidate *told us*. It never states that a candidate is or is not
   eligible, qualified, or legally permitted to hold a role.

### What X-Ray is not

- Not an interview-probability estimator. There is no calibrated outcome data.
- Not a replacement for `computeFastScore`, `calculateVisaFitScore`,
  `calculateGhostJobRisk`, `analyzeResumeForJob`, or `computeHealthScore`. X-Ray
  composes and adjudicates over them.
- Not a rewrite of `calculateApplicationVerdict`; see §9.
- Not immigration, legal, or employment advice.
- Not a background check. X-Ray never asserts that a candidate lacks a
  credential; at most it reports that it did not find one, or that the candidate
  said they do not have it.

---

## 1a. Repository-claim classification (correction 8)

Earlier drafts referred to repository artefacts without saying which were
pre-existing, which were observed uncommitted in the working tree, and which
this design work created. Every claim is classified below, and each was
confirmed by inspecting the repository at the time of writing — not from
memory.

| Artefact | Classification | Evidence |
| --- | --- | --- |
| `lib/applications/statuses.ts` | **OBSERVED_UNCOMMITTED_CHANGE**, since committed | Present as an untracked file when this design work began; not authored here. Committed as `53868c61`, merged to `main` via PR #496, and confirmed present in `origin/main`. |
| The `last_seen_at` fix in `lib/harvester/persist-bulk.ts` | **OBSERVED_UNCOMMITTED_CHANGE**, since committed and deployed | Present as an uncommitted diff when this work began; not authored here. Merged via #496 and verified running on both boxes. |
| `scripts/migrations/add-candidate-credential-declarations.sql` | **PROPOSED_NOT_IMPLEMENTED** *(file authored, unmerged)* | Written during this engagement. Confirmed **absent from `origin/main`**; sits in open PR #497. |
| `candidate_credential_declarations` (the table) | **PROPOSED_NOT_IMPLEMENTED** | The migration is not in `main`, and the startup runner only applies migrations present in the deployed image, so the table cannot exist in any environment. No manual application was performed. |
| `lib/candidates/credential-declarations.ts` | **PROPOSED_NOT_IMPLEMENTED** *(file authored, unmerged)* | Written during this engagement. Confirmed absent from `origin/main`; in open PR #497. |
| `lib/jobs/last-seen-trust.ts` and `HARVESTER_LAST_SEEN_EPOCH_ISO` | **PROPOSED_NOT_IMPLEMENTED** *(file authored, unmerged)* | Written during this engagement. Confirmed absent from `origin/main`; in open PR #497. |
| `lib/matching/fast-scorer.ts`, `lib/jobs/metadata.ts`, `lib/jobs/ghost-job-risk.ts`, `lib/health/score-computer.ts`, `lib/networking/job-contact-finder.ts`, `app/api/jobs/[id]/ghost-risk/route.ts` and every other module cited as evidence | **VERIFIED_EXISTING_BEFORE_THIS_DESIGN** | Read directly; unmodified by this work. |

**Disclosure.** The original brief said not to implement production code. That
held through the design passes. It was then set aside at explicit user
direction in later turns — the user asked for the uncommitted work to be
committed and pushed, and for the epoch constant to be determined and set. The
four files marked *file authored* above are the result. They are additive, they
are behind an unmerged PR, and no pre-existing production behaviour was altered
by them. **No production code was created or modified during this final
correction pass.**

**Consequence for implementation.** Anything Codex builds against the
declaration store depends on PR #497 merging first. Branching from `main` today
gives a repository where `RC3`, `RE4` and the resolution path of `RD2` have no
backing store.

---

## 2. User inputs

X-Ray is computed for a `(user, resume, job)` triple. Everything else is
resolved server-side.

### 2.1 Required

| Input | Source | If missing |
| --- | --- | --- |
| `jobId` | route param | hard error |
| `userId` | session | hard error |
| `resumeId` | explicit → `profiles.default_resume_id` → primary résumé | `INSUFFICIENT_DATA`; Capability, Evidence, Positioning all `UNKNOWN`. Hiring Reality and Eligibility still compute. |

### 2.2 Optional candidate inputs

| Input | Effect |
| --- | --- |
| `resumes.target_field` | Changes the Positioning reference frame only. Must not touch Capability or Eligibility. |
| Declared work-authorization timeline (§4.4) | Enables Eligibility conflict evaluation. |
| **Requirement declarations** (new in r2) | "I hold / do not hold a CPA." The only way to reach `ABSENT_CONFIRMED`, and the only way to reach a non-`unknown` acquirability. See §3.3. |
| **Candidate-supplied contact** (new in r2) | A named person or channel at the employer. Creates an `ActionableAccessRoute`. |
| Preference floor (`minimumMatchScore`) | Advisory annotation only. Preference is not capability. |

### 2.3 System inputs

Job/company: `jobs.*`, `companies.*`, `ghost_job_scores`,
`company_health_scores`, `company_layoff_summary`, `field_skill_profiles`.
Candidate: `resumes.*`, `profiles.*`, `autofill_profiles.*`, `job_match_scores`,
`resume_tailoring_analyses`, `job_applications`.
Network: `linkedin_connections`, `cohort_members`, `employer_cohort_requests`
via `lib/networking/job-contact-finder.ts`.
Aggregate (advisory only): `rejection_patterns`, `application_timing_signals`.

### 2.4 Schema defaults are not answers

```sql
autofill_profiles.requires_sponsorship  boolean DEFAULT false
autofill_profiles.authorized_to_work    boolean DEFAULT true
profiles.needs_sponsorship              boolean DEFAULT false
profiles.is_international               boolean DEFAULT false
companies.sponsors_h1b                  boolean DEFAULT false
jobs.requires_authorization             boolean DEFAULT false
```

An empty candidate profile is byte-identical to a US citizen's. An unenriched
company is byte-identical to one that refuses to sponsor. X-Ray therefore never
reads these columns as answers: it derives tri-state values and sets
`derivedFromDefaultsOnly` / `employerHasSponsored: "unknown"` when only defaults
were available.

The two candidate vocabularies also disagree — `Profile.visa_status` has
`'citizen'` and no `tn_visa`; `AutofillProfile.work_authorization` has
`'us_citizen'` and `'tn_visa'` — so both are read through one normalizer that
records which field it used.

---

## 3. Complete X-Ray output

Full shape in `xray-contract.ts`. In prose:

```
ApplicationXRay
├── canonical        Stage A: which job was actually evaluated, and why      (§3.1)
├── hiringReality    band + facts   "Is this opportunity worth pursuing?"    (Q1)
├── capability       band + facts   "Can the candidate do the work?"         (Q2)
├── evidence         band + facts   "Does existing paper show it?"           (Q3)
├── eligibility      band + facts   "Does the posting conflict with what
│                                    the candidate told us?"                 (Q4)
├── positioning      band + facts   "Is the résumé aimed at THIS role?"      (Q5)
├── accessRoutes     named routes   (empty ⇒ FIND_ACCESS unreachable)
├── referralAdvisory advisory only  (never gates an action)
├── rejectionRisks   ranked         "What is most likely to kill this?"      (Q6)
├── actions          ranked         "What would materially improve it?"      (Q7)
├── finalAction      one enum       APPLY_NOW | STRENGTHEN_FIRST | FIND_ACCESS
│                                   | SKIP | INSUFFICIENT_DATA               (Q8)
├── confidence       high | medium | low | unknown, derived (decision-table §13.1)
├── dataGaps         every unknown that changed or could change the answer
└── sourceFacts      the provenance ledger every finding points into
```

### 3.1 Canonical resolution happens first

A duplicate row is resolved to its canonical job **before** any dimension is
computed, and the whole X-Ray runs against the canonical. A duplicate never
returns an action of its own — it returns the canonical job's answer, including
`SKIP`. When the canonical apply URL differs, an `apply_to_canonical_posting`
action rides along. When resolution fails, Hiring Reality is `UNKNOWN` and the
case goes to the sufficiency gate; it never falls back to the duplicate row and
never produces `SKIP` on a failed pointer lookup.

`publication_status = 'hidden_duplicate'` is a display instruction, not a
closure signal.

### 3.2 Why there is a fifth action

The brief specifies four. `INSUFFICIENT_DATA` is added deliberately, and
principle 2 requires it: with only four, a case with no résumé, an unparsed
résumé, an unreadable posting, or an unresolvable duplicate must collapse into a
judgment. Each collapse is wrong — `SKIP` turns ignorance into a negative,
`APPLY_NOW` into an endorsement, `STRENGTHEN_FIRST` invents a weakness,
`FIND_ACCESS` invents an access problem. `calculateApplicationVerdict` already
returns `"Unknown"` at `coverage === 0`, so there is repository precedent.

It renders as a neutral state with a concrete unblock list, never as a
band-styled negative.

### 3.3 Requirement declarations

A requirement is evaluated on three independent axes that are never collapsed:

| Axis | Values | Who establishes it |
| --- | --- | --- |
| **Strength** — how firmly the posting states it | `MANDATORY_EXPLICIT` · `PREFERRED_EXPLICIT` · `INFERRED` · `UNKNOWN` | deterministic patterns or structured ATS fields. **An LLM extraction alone caps strength at `INFERRED`.** |
| **Presence** — what we know about the candidate | `PRESENT` · `ABSENT_CONFIRMED` · `NOT_FOUND` · `CONTRADICTED` · `UNKNOWN` | résumé fields, raw text, or a candidate declaration |
| **Acquirability** — could they obtain it in time | source ∈ `candidate_declared` · `credential_catalog` · `unknown` | **never a model.** No catalog exists in this repository, so v0 reaches non-`unknown` only via a candidate declaration. |

**`NOT_FOUND` is not `ABSENT_CONFIRMED`.** A résumé that omits a CPA is not
evidence the candidate lacks a CPA — résumés omit credentials constantly, and
`resumes.skills.certifications` is only as complete as the parse. Only
`ABSENT_CONFIRMED`, or `CONTRADICTED` at `declaration_vs_structured_field`
reliability, may support a requirement-based `SKIP`.

### 3.4 Dimension bands

Bands are the only dimension-level values the UI renders. Underlying 0–100
scores stay in `XRayInternalScores`.

| Dimension | Bands |
| --- | --- |
| Hiring Reality | `LIVE` · `LIKELY_LIVE` · `UNCERTAIN` · `LIKELY_CLOSED` · `CLOSED` · `UNKNOWN` |
| Capability | `EXCEEDS` · `MEETS` · `NEAR_MISS` · `STRETCH` · `MISMATCH` · `UNKNOWN` |
| Evidence | `STRONG` · `ADEQUATE` · `BURIED` · `THIN` · `UNREADABLE` |
| Eligibility | `NO_EXPLICIT_CONFLICT_FOUND` · `EMPLOYER_ACTION_MAY_BE_NEEDED` · `NEEDS_CLARIFICATION` · `EXPLICIT_REQUIREMENT_CONFLICT` · `UNKNOWN` |
| Positioning | `ALIGNED` · `TUNABLE` · `MISALIGNED` · `UNKNOWN` |

`BURIED` is a first-class Evidence band, not a weak `THIN`: they prescribe
opposite actions. `UNREADABLE` replaces revision 1's `unverifiable` because it
is a statement about our reading, not about the candidate.

The Eligibility bands are deliberately clumsy. They are observations, not
verdicts, and no shorter name preserved that.

---

## 4. Meaning of each dimension

### 4.1 Hiring Reality — "Is this opportunity worth pursuing?"

**Asks:** is there a real, currently-open requisition behind this row.

**Composed from:** `jobs.is_active`, `publication_status`, `closed_at`,
`first_detected_at`, `companies.last_crawled_at`, `calculateGhostJobRisk` (band
only), `probeApplyUrl` (with §4.1.2's caveat), `detectHiringFreeze`,
`computeHealthScore` (verdict + coverage), `median_days_open`.

**Deliberately excluded:** salary attractiveness, company prestige, candidate
preference. "Worth pursuing" means *the opportunity exists and is fillable*, not
*is desirable*. Folding desirability in is how `calculateApplicationVerdict` ends
up mixing a salary band into a liveness judgment.

#### 4.1.1 `last_seen_at`

`persistJobsBulk` historically wrote only when `content_hash` changed, so a live
unchanged harvester job kept a stale `last_seen_at`. **A working-tree fix now
also writes when `jobs.last_seen_at < EXCLUDED.last_seen_at`**, restoring it as a
liveness signal going forward. Because the fix is forward-only, trust requires
`last_seen_at ≥ HARVESTER_LAST_SEEN_EPOCH_ISO` (following the existing
`FAST_SCORE_CACHE_EPOCH_ISO` idiom). Below the epoch the field backs no finding
and "not seen since …" stays prohibited. Details in `decision-table.md` §9.2.

#### 4.1.2 A dead apply URL is not proof of a dead job

`probeApplyUrl` maps HTTP **401 and 403 to `"dead"`**, and 403 is the routine
answer many ATS and bot-mitigation layers give a `HEAD` request. It contributes
+35 to ghost risk. X-Ray treats `applyUrlStatus` as an inference, never a fact;
it can never satisfy `G_CLOSED`. Only `is_active = false` with `closed_at`, or
`publication_status ∈ {hidden_expired, hidden_invalid}`, is definitive.

### 4.2 Capability — "Can the candidate do the work?"

**Composed from:** `MatchScoreBreakdown.careerFit` (`careerFitScore`,
`relevantYears`, `totalYears`, `requiredYears`, `relevantYearsRatio`, `label`,
`evidence`), `roleFamilyScore`, `candidateRoleFamilies`, and the evaluated
requirement list.

**Must not use `job_match_scores.overall_score`.** `computeFastScore` folds a
sponsorship rank delta into `overall` when `profile.needs_sponsorship`:

```ts
sponsorshipRankDelta = sponsorship.compatible ? (+8|+5|+2) : (sponsorship.score === 0 ? -18 : -6)
overall = overall + sponsorshipRankDelta
```

That is a defensible *feed-ranking* choice and an indefensible capability claim.
Reading it as Capability while reading posting language as Eligibility would give
two identical résumés different capability verdicts based on immigration status.

**Also excluded:** `atsScreenScore`, which is screen strength and belongs to
Positioning — the split `buildCareerFit` already encodes.

**A capability mismatch needs corroboration.** `capability.mismatchCorroborations`
may contain only `role_family_incompatible`, `severe_years_shortfall`,
`career_fit_below_floor`, and `mandatory_absent_confirmed`. Keyword coverage is
not on that list, and evidence absence is not on that list. Two corroborations
are required before `SKIP`, because `classifyRoleFamily` mis-fires on
multidisciplinary roles — the documented reason `computeFastScore` relaxed its
own role-family cap to 55.

### 4.3 Evidence Strength — "Does existing evidence show it?"

**Asks:** if a human read this résumé today, could they *locate* the proof.

**v0 definition — legibility and coverage, always inferred.** There is no
claim-level evidence table, so Evidence Strength is built from four deterministic
sources: `skillSuggestions[].status` from `buildLocalTailorAnalysis`;
`careerFit` years; `buildPositioningBrief().surface` (terms in `raw_text` absent
from structured fields — the burial signal); and `parse_status` / dated-role
count. Band cascade in `decision-table.md` §10.

**Absence is typed, and absence proves nothing about the candidate.**

| `EvidenceAbsenceKind` | Means | May support a capability `SKIP`? |
| --- | --- | --- |
| `NOT_FOUND_IN_READABLE_DATA` | we looked, did not find it | **No** |
| `CANDIDATE_CONFIRMED_ABSENT` | they told us they lack it | Yes, and only for a `MANDATORY_EXPLICIT` requirement |
| `EXPLICIT_CONTRADICTION` | candidate statements conflict | Only at `declaration_vs_structured_field` |
| `UNREADABLE_DATA` | we could not look | **No** |

`mayEstablishCapabilityAbsence` is the literal type `false`, so changing this is
an explicit contract change rather than an implementation drift.

Every Evidence finding carries `basis: "inference"` and
`verificationLevel: "inferred"`. X-Ray may say "your résumé does not show
Kubernetes anywhere we can read". It may never say verified, proven, or
confirmed, and may never name a specific bullet as proof of a specific claim.

**Consistency observations** — a summary claiming more years than the dated
history spans — are phrased as questions to the candidate, never as accusations,
never shared outward, never a `SKIP` reason.

### 4.4 Eligibility — "Does the posting conflict with what the candidate told us?"

The question is deliberately *not* "is the candidate eligible". We cannot answer
that and must not appear to.

**Candidate side is a timeline against the target employer.**

The field is `canWorkForTargetEmployerWithoutNewImmigrationAction` — deliberately
long, because the short version invites the error. It is not "does the candidate
hold a status"; it is "can they start work *here* without someone filing
something first".

| Field | Meaning |
| --- | --- |
| `canWorkForTargetEmployerWithoutNewImmigrationAction` | `YES` · `NO` · `NEEDS_EMPLOYER_ACTION` · `UNKNOWN` |
| `declaredVisaStatus` / `declaredWorkAuthorization` | What the candidate told us, from either vocabulary |
| `authorizationEndDate` | e.g. `profiles.opt_end_date`; null when unbounded *or* unknown |
| `futureEmployerActions[]` | Ordered, most imminent first — each with type, horizon, status, source, confidence and gaps |

**An H-1B holder employed elsewhere is `NEEDS_EMPLOYER_ACTION`, never `YES`.**
Being in H-1B status authorizes work for the *petitioning* employer; starting at
a new one requires a transfer petition. Reading "currently in H-1B status" as
"can start here" would let a posting barring sponsorship *and transfer* read as
no-conflict, and would tell an H-1B holder they can simply begin.

**An OPT holder is `YES`** while the EAD is unexpired and the role relates to the
degree — subject to that relation, which stays `UNKNOWN` when unestablished.
**A STEM OPT holder is `NEEDS_EMPLOYER_ACTION`** until the target employer is
known to enrol in E-Verify and complete the I-983.

**Future actions are a list, and initial OPT does not imply H-1B.** Someone on
initial OPT may extend via STEM OPT, may go to H-1B, may do neither — and which
paths are open turns on facts we often lack, above all STEM-degree eligibility.
Missing eligibility stays `UNKNOWN`; it is never resolved by assumption. Types:
`STEM_OPT_EVERIFY_PARTICIPATION`, `STEM_OPT_I983`, `H1B_PETITION`,
`H1B_TRANSFER`, `OTHER`, `UNKNOWN` — each carrying `REQUIRED` / `POSSIBLE` /
`UNKNOWN` with its own source and data gaps.

**E-Verify participation is four-state.** `CONFIRMED_PARTICIPATING`,
`CONFIRMED_NOT_ENROLLED`, `NOT_FOUND_IN_SOURCE`, `UNKNOWN`. A miss in an
incomplete index is a fact about the index: `NOT_FOUND_IN_SOURCE` must render
with the source named and its coverage disclosed. Only `CONFIRMED_NOT_ENROLLED`
is substantive, and even then it constrains a *future* path rather than present
work.

**Posting side is categorized, not booleanized.**
`SPONSORSHIP_SCOPE_AMBIGUOUS` · `NO_CURRENT_SPONSORSHIP` · `NO_FUTURE_SPONSORSHIP` ·
`NO_CURRENT_OR_FUTURE_SPONSORSHIP` · `UNRESTRICTED_AUTHORIZATION_REQUIRED` ·
`CITIZENSHIP_REQUIRED` · `CLEARANCE_REQUIRED` · `AMBIGUOUS_GENERAL` ·
`SPONSORSHIP_OFFERED`.

**Scope is read, never assumed.** "We are unable to provide visa sponsorship for
this position" says nothing about whether the bar extends past today. Absent a
temporal marker — "currently", "at this time", "now", "in the future", "now or
in the future" — the category is `SPONSORSHIP_SCOPE_AMBIGUOUS`. For a candidate
authorized today who will need employer action later, that yields
`NEEDS_CLARIFICATION` — not `NO_EXPLICIT_CONFLICT_FOUND`, and not an automatic
skip. It continues to `APPLY_NOW` at low confidence with a prominent
`confirm_future_sponsorship_policy` action, unless another rule fires.

The repository collapses all of these into `jobs.requires_authorization`
(`boolean DEFAULT false`, so `inferRequiresAuthorization`'s `null` is lost), and
`createVisaIntelligenceFallback` then labels every hit
`requires_unrestricted_work_authorization` regardless of cause. X-Ray re-derives
the category from the pattern families and requires a literal excerpt.

One correction to a live behavior: the `must ... possess ...
(valid|current|unrestricted|valid and unrestricted)? work authorization` pattern
makes "unrestricted" **optional**, so "You must currently possess valid U.S.
work authorization" — which an OPT holder satisfies — currently matches as a
blocker. The module's own comment says bare authorization boilerplate must never
flag, and `metadata.authorization.test.ts` asserts that for "authorized to work"
phrasings but not this one. X-Ray requires the word "unrestricted" or a named
visa list before reaching `UNRESTRICTED_AUTHORIZATION_REQUIRED`; otherwise the
category is `AMBIGUOUS_GENERAL`, which can never produce a conflict alone.

The candidate-timeline × posting-category matrix is in `decision-table.md` §5.3
and is asserted cell by cell in tests.

**Employer history is structurally separate.** `SponsorshipHistorySignal` may
raise the band to `EMPLOYER_ACTION_MAY_BE_NEEDED` and may add commentary. It can
never reach `EXPLICIT_REQUIREMENT_CONFLICT`, and it can never reach
`NO_EXPLICIT_CONFLICT_FOUND` either — absence of filings is not absence of
willingness, and presence of filings is not a promise about this requisition.

### 4.5 Positioning — "Is the résumé aimed at this role?"

**Composed from:** `careerFit.atsScreenScore`, `buildLocalTailorAnalysis`,
`tailorResumeForAts` / `ATS_PROFILES` keyed on the detected ATS,
`buildPositioningBrief`, `calculateAtsReadability`.

**Hard rule:** Positioning may only recommend surfacing evidence Evidence
Strength has already located. A `missing_needs_confirmation` term may be
mentioned ("the posting asks for X; we could not find X in your résumé") but
never becomes an "add this" action — the contract `buildLocalTailorAnalysis`
already encodes via `requiresConfirmation`.

**Positioning is never a reason for `SKIP`.** Presentation is repairable by
definition.

---

## 5. Facts, inferences, predictions, recommendations

Every finding declares `basis`. It determines the verb the UI may use.

| Basis | Definition | Verbs | Examples |
| --- | --- | --- | --- |
| `fact` | A stored value, or a literal span we can show. Reproducible without a model or a threshold. | "says", "lists", "is set to", "we last checked" | `is_active = false` with `closed_at`; a matched posting excerpt; `parse_status = 'failed'`; a candidate declaration; `rejection_patterns.total_submissions = 34` |
| `inference` | A deterministic derivation using a rule or threshold **we** chose. | "suggests", "appears", "we read this as" | ghost band; `applyUrlStatus`; `careerFit.label`; Evidence band; role-family classification; `requiredYears` from `extractMinYears` |
| `prediction` | A statement about an unobserved outcome. Always carries a sample size. | "historically", "in N reported cases", "may" | `predictH1BApproval`; `rejection_patterns` rates; `median_days_open` |
| `recommendation` | An action derived from bands by the decision table. Never a claim about the world. | "consider", "before you apply", "worth doing" | every `actions[]` entry; `finalAction` |

Rules:

1. A `fact` may cite a value or a span; never a threshold outcome.
2. An `inference` must name its rule in `explanation`, so a user who disagrees
   can discount it.
3. A `prediction` without `sampleSize` is dropped, not downgraded.
   `rejection_patterns` below `MIN_SUBMISSIONS = 10` is dropped.
4. **A `recommendation` may never be a `XRaySourceFact`.** No finding may cite
   `finalAction`. This is the circularity guard, and it is enforced by the type:
   `XRayBasis` has no `recommendation` member.
5. A finding whose only support is an LLM output is `basis: "inference"`,
   `sources: ["llm_extraction"]`, confidence capped at `medium`, and it can
   never establish `MANDATORY_EXPLICIT` or populate acquirability.

---

## 6. Display language and prohibited language

### 6.1 Required elements

Every rendered finding shows, or reveals on expand: the basis chip; the source;
`observedAt` / `computedAt`; sample size for predictions; and a freshness
qualifier when the input is past its staleness threshold.

### 6.2 Permitted phrasing

| Dimension | Say | Not |
| --- | --- | --- |
| Hiring Reality | "Still listed; the board was checked 6 hours ago." | "This job is real." |
| Hiring Reality | "We could not reach the apply link. That is often bot-blocking, not a closed role — open it yourself." | "Dead link — this job is gone." |
| Canonical | "This listing is a copy. We checked the employer's original posting." | (silently swapping the job) |
| Capability | "You show 2 relevant years toward the 5 this posting asks for." | "You are not qualified." |
| Requirement | "This posting requires a CPA. We could not find one in your résumé — do you hold one?" | "You do not have a CPA." |
| Requirement | "You told us you do not hold a CPA, and this posting requires one." | "You are unqualified." |
| Evidence | "Your résumé mentions Airflow only in the raw text, not in your skills or titles." | "You lack Airflow experience." |
| Evidence | "We could not find anything supporting Kubernetes. Only add it if it is true." | "Add Kubernetes to pass the ATS." |
| Eligibility | "This posting says: 'we are unable to sponsor employment visas.' You told us you are authorized through August 2027 and may need employer action after that." | "You are not eligible." |
| Eligibility | "This posting bars sponsorship now **and** in the future. Your status is likely to need employer action later." | "You cannot work here." |
| Eligibility | "This employer filed 240 LCAs over three years. That is history, not a commitment for this role." | "This company will sponsor you." |
| Eligibility | "We do not know your work-authorization timeline, so we could not check this." | (silently skipping the check) |
| Positioning | "Your title reads 'Analytics Engineer'; the posting screens for 'Data Engineer'." | "Your résumé will be rejected." |
| Access | "Priya S., a 1st-degree connection, is a Staff Engineer there. Ask her about the team before you apply." | "Try to get a referral." |
| Referral advisory | "In 34 self-reported applications here, referred candidates reached a screen 41% of the time vs 12% cold." | "You have a 12% chance." |

### 6.3 Prohibited (hard rules)

Never, on any surface, at any confidence:

1. **A numeric interview, offer, or hire probability.**
2. **Any statement of legal eligibility or ineligibility.** Never "you are (not)
   eligible", "you do not qualify for H-1B", "you cannot work here", "this visa
   will be approved". Only report what the posting says and what the employer
   has done before. This is why the Eligibility bands are observational.
3. **Any claim that HireOven verified a résumé claim.** Never verified,
   confirmed, proven, validated.
4. **Any claim that the candidate lacks a credential we merely did not find.**
   `NOT_FOUND` renders as a question, never as an absence.
5. **Any accusation.** Never false claim, exaggerated, misrepresented, lying.
6. **Any instruction to add a skill, tool, employer, title, degree, or date the
   résumé does not support.** `missing_needs_confirmation` suggestions are
   "only if true" and never one-click applicable.
7. **Any claim that a description changed, or that a role was reposted N times.**
   No JD-history table exists, and `queryRepostCount` counts *concurrently
   active similar-title postings*. Permitted: "this company currently has N
   similar openings."
8. **"Not seen since <date>"** for any row below the harvester last-seen epoch.
9. **Any estimate of how long a credential takes to obtain**, unless the
   candidate declared it or a curated catalog supplied it. No model estimates.
10. **Any claim about a specific requisition from employer aggregate history.**
    "This company sponsors" is prohibited; "has sponsored, N times, FY20xx–FY20xx"
    is permitted.
11. **Protected-attribute reasoning.** No finding may reference or derive from
    name, nationality, ethnicity, gender, age, graduation year as an age proxy,
    veteran status, or disability. The `autofill_profiles` diversity fields are
    never read.
12. **"Ghost job"** as an assertion. Permitted only as a named risk band with
    its inputs shown.
13. **Generic networking advice presented as the recommended action.** See §6.4.

### 6.4 Action copy

| Action | Headline | Required subtext |
| --- | --- | --- |
| `APPLY_NOW` | "Apply now" | why the window matters; any deferred repair |
| `STRENGTHEN_FIRST` | "Strengthen first" | the specific repair and the deadline logic |
| `FIND_ACCESS` | "Reach out first" | **the named person or channel**, the relationship, and the exact next step |
| `SKIP` | "Skip this one" | the quoted posting language, or the candidate's own declaration |
| `INSUFFICIENT_DATA` | "Not enough to judge" | exactly what would unblock it |

`FIND_ACCESS` copy that does not name a person or a concrete channel is invalid
output, not a style problem. See §7.

---

## 7. Access routes

`FIND_ACCESS` fires only when at least one `ActionableAccessRoute` exists. A
route requires a route type, a named person or concrete channel, the
relationship context, the exact next step, `sourceFactIds`, and a freshness
stamp inside its type's horizon.

**Referral statistics are not a route.** Revision 1 gated `FIND_ACCESS` on
`rejection_patterns` referral-vs-cold rates while simultaneously declaring those
rates off-limits as decision inputs. That contradiction is resolved: the rates
are advisory only, carry the literal type `gatesFinalAction: false`, and may at
most rank and phrase a route that already exists on its own merits.

**A prior application is not a route** unless a reachable person or channel is
stored with it. `job_applications` has no recruiter-contact fields, so a past
interview alone cannot produce `FIND_ACCESS` in v0.

**The repository can produce real routes.** `getJobNetworkingContacts`
(`lib/networking/job-contact-finder.ts`, exposed at
`app/api/jobs/[id]/networking/route.ts`) returns named contacts with LinkedIn
URLs or email addresses from `linkedin_connections`, `cohort_members`, and
`employer_cohort_requests`. So `FIND_ACCESS` is reachable in v0 — narrowly.

One important exclusion: `job-contact-finder` anonymizes cohort-alumni names and
nulls `linkedinUrl` when the viewer is not a cohort member. Those contacts have
no channel and are therefore **not routes**. They may appear as an advisory
("join the cohort to reach company alumni"), never as `FIND_ACCESS`.

Full validity conditions and freshness horizons: `decision-table.md` §7.

---

## 8. Tone

X-Ray talks to someone who is often being rejected repeatedly and may be on an
immigration clock.

1. **Conflicts are about the posting.** "This posting excludes candidates who
   would need sponsorship in the future" — not "you are excluded".
2. **Gaps are about the document.** "Your résumé does not show X" — not "you
   lack X". And when we simply did not find something, ask rather than assert.
3. **No urgency theater.** The `screenRateMultiplier` constants in
   `computeApplyTimingFromPostAge` (3.1×, 2.4×, 1.8×) have no citation in the
   repository. X-Ray uses their *ordering* to prioritize and never prints them.
4. **Timeline pressure informs phrasing, never the decision.**
   `futureActionHorizonDays` may reorder actions and soften copy. It may not
   move a band or the final action, and a test asserts equality of `finalAction`
   across two runs differing only in `opt_end_date`.

---

## 9. Relationship to ApplicationVerdict

**X-Ray owns the final action; `ApplicationVerdict` becomes a write-only
projection.** Argument in `decision-table.md`; summary:

`calculateApplicationVerdict` is one additive `priorityScore` from 50, mixing
match (±22), sponsorship blocker (−45), salary (±6), ghost (±22), freshness
(±12), health (±8) and a preference floor (−8). A strong match can offset a
sponsorship blocker; freshness can offset capability. Its label space has no
`FIND_ACCESS` and no repairability test. And it reads the same upstream modules
X-Ray reads, so consuming it would land every signal twice.
`applicationVerdictResultToIntelligence` also derives `blockers` by regexing its
own warning strings (`/blocker|high risk|weak|low/i`), which is not a dependable
boundary.

Migration: a one-way `xrayToApplicationVerdict(xray)` adapter keeps
`job_applications.application_verdict` and `JobIntelligence.applicationVerdict`
populated for existing UI. X-Ray never reads it back;
`derivedFrom: "application_xray"` makes any read path greppable. Deprecate
`calculateApplicationVerdict` once surfaces migrate.

---

## 10. Surfaces

| Surface | Payload | Freshness |
| --- | --- | --- |
| Feed / `JobCard` | `XRaySummary` — action, confidence, five bands, top risk, `resolvedFromDuplicate`. No prose. Cached snapshot. | "last computed" stamp beyond 24h |
| Detail / `JobDetailPanel` | Full `ApplicationXRay`, computed or refreshed on demand | recomputed on résumé-version change (`isScoreFreshForResume`), ghost-cache expiry, or explicit refresh |
| Post-apply / `ApplicationDrawer` | Snapshot frozen at apply time, plus a diff if recomputed | never silently mutated |

A card may not display a band the detail view would contradict: `XRaySummary` is
a projection of the same object, never an independent computation.

---

## 11. Explicitly outside v0

1. Numeric interview/offer probability.
2. Claim-level evidence verification (needs a claim ↔ source-span table).
3. JD-change detection and true repost cycles (needs a JD-history table).
4. **A credential acquirability catalog.** Until one exists, acquirability is
   `unknown` unless the candidate declares it. The declaration path *is* built
   (`candidate_credential_declarations` +
   `lib/candidates/credential-declarations.ts`), so `RE4` is reachable — but
   only through an explicit candidate answer, never an estimate of ours.
5. Cross-employer or cohort benchmarking ("candidates like you").
6. Salary negotiation guidance. LCA wages are a legal floor, not a market rate;
   salary is displayed context only.
7. Automatic résumé edits from X-Ray. X-Ray recommends; the existing tailor flow
   executes behind its confirmation gates.
8. Employer-facing or shareable X-Ray output.
9. Outcome-learned weights. All thresholds are hand-set and documented.
10. Non-US jurisdictions. The posting categories are US-specific; non-US postings
    return Eligibility `UNKNOWN`, never `NO_EXPLICIT_CONFLICT_FOUND`.
11. Deep/LLM analysis as a decision input. `analyzeResumeForJob`'s `verdict` and
    `apply_recommendation` are display-only.
12. Visa-segmented rejection rates (`h1b_screen_rate`, `citizen_screen_rate`).
    Not consumed at all.

---

## 12. Revision 2 change log

| # | Correction | Section |
| --- | --- | --- |
| 1 | `xray-contract.ts` produced and compiling | separate file |
| 2 | Duplicate resolution is preprocessing; a duplicate never returns its own action | §3.1 |
| 3 | `RequirementPresence` replaces boolean presence | §3.3, §4.3 |
| 4 | `RequirementStrength` + provenance; LLM cannot set `MANDATORY_EXPLICIT` | §3.3 |
| 5 | Acquirability needs a source; no model estimates; no catalog in v0 | §3.3, §11.4 |
| 6 | `ActionableAccessRoute` gates `FIND_ACCESS` | §7, §6.4 |
| 7 | Observational Eligibility bands | §3.4, §4.4 |
| 8 | Authorization timeline + posting-language categories | §4.4 |
| 9 | Precedence A–I | `decision-table.md` §1, §4 |
| 10 | Ambiguous blocker never yields `STRENGTHEN_FIRST` | `decision-table.md` §6.2 |
| 11 | Typed evidence absence; absence cannot prove capability absence | §4.3 |
| 12 | Rejection-rate contradiction resolved — advisory only | §7 |
| — | `last_seen_at` guidance updated for the working-tree fix | §4.1.1 |
| — | Prohibited-language list extended (items 4, 9, 13) | §6.3 |

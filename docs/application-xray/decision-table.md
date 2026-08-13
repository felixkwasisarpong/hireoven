# Application X-Ray Decision Table — Revision 2

Deterministic action selection for `XRayFinalAction`. Everything here is a pure
function of Stage-A output, the five dimension bands, and a small set of named
gates — no I/O, no model call, no randomness. `XRayDecisionTrace` records the
stage and rule so a test can replay it.

Revision 2 supersedes revision 1 in full. Change log at §14.

---

## 1. Precedence — normative statement

The following ordering is normative. §4 is the executable form of exactly this
list, and §15 proves they match.

| | Stage | Purpose | Can select |
| --- | --- | --- | --- |
| **A** | Resolve canonical job | Preprocessing. Not a decision stage. | nothing |
| **B** | Definitive closure | The requisition demonstrably no longer exists | `SKIP` |
| **C** | Explicit candidate-specific requirement conflict, **when candidate data is known** | The posting states a requirement that conflicts with what the candidate told us | `SKIP` |
| **D** | Sufficiency gate | We cannot responsibly judge | `INSUFFICIENT_DATA` |
| **E** | Capability | Can they do the work | `SKIP`, `STRENGTHEN_FIRST` |
| **F** | Evidence | Can a reader find the proof | `STRENGTHEN_FIRST`, `INSUFFICIENT_DATA` |
| **G** | Positioning | Is the document aimed correctly | `STRENGTHEN_FIRST` |
| **H** | Actionable access | Is there a named route worth using | `FIND_ACCESS` |
| **I** | Apply | Default | `APPLY_NOW` |

Two notes on the ordering, both required by the corrections:

- **C precedes D.** An explicit, cited posting requirement that conflicts with
  *known* candidate data is decisive whether or not we can read the résumé. The
  qualifier "when candidate data is known" is load-bearing: if the candidate's
  data is unknown or the requirement is low-confidence, C does not fire, and the
  case falls to D where the ambiguity is handled properly (§6).
- **A is not a stage that can act.** A duplicate row produces the canonical
  job's answer, never its own. §2.

---

## 2. Stage A — canonical resolution (preprocessing)

```
requested job
  → follow jobs.duplicate_of_id (max 3 hops, cycle-detected)
  → evaluatedJobId
  → run the COMPLETE X-Ray against evaluatedJobId
```

**Rules.**

1. Every dimension, gate, band, risk and action is computed against
   `evaluatedJobId`. Nothing is computed against the duplicate.
2. A duplicate **never** returns an action of its own. Whatever the canonical
   job produces — `SKIP`, `STRENGTHEN_FIRST`, `INSUFFICIENT_DATA` — is the
   answer.
3. When the canonical apply URL differs from the requested one, an
   `apply_to_canonical_posting` action is attached. It is an *action*, not an
   outcome; it rides along with whatever the canonical decision was.
4. Resolution failure does **not** fall back to the duplicate row:

   | `CanonicalResolutionOutcome` | Effect |
   | --- | --- |
   | `not_a_duplicate` | proceed normally |
   | `resolved` | proceed against the canonical |
   | `unresolved_dangling` | Hiring Reality `UNKNOWN`, gap `canonical-row-missing` (dimension_blocking) |
   | `unresolved_chain_limit` | as above, gap `duplicate-chain-too-deep` |
   | `unresolved_canonical_invalid` | as above, gap `canonical-row-invalid` |

   In all three failure cases Hiring Reality is `UNKNOWN`, which contributes to
   the D sufficiency gate. It does **not** produce `SKIP`: we failed to resolve
   a pointer, which says nothing about the job.
5. `publication_status = 'hidden_duplicate'` on the requested row is a display
   instruction, not a closure signal. It can never satisfy `G_CLOSED`.

**Revision-1 defect corrected.** R1's `R1.2` returned `APPLY_NOW` on a
duplicate whose canonical was live — bypassing every other stage. That is now
structurally impossible: resolution happens before any rule runs.

---

## 3. Inputs to the decision function

### 3.1 Bands

`hiringReality.band`, `capability.band`, `evidence.band`, `eligibility.band`,
`positioning.band`, plus each dimension's `confidence`.

### 3.2 Named gates

Every gate names a repository source or a declared-user source. Gates with
neither are not permitted (proved in §15.2).

| Gate | Values | Derivation | Source |
| --- | --- | --- | --- |
| `G_CLOSED` | bool | `is_active = false` **and** (`closed_at` non-null **or** `publication_status ∈ {hidden_expired, hidden_invalid}`) | `jobs` |
| `G_CONFLICT` | `none` \| `now` \| `future` \| `needs_clarification` | worst outcome across `eligibility.conflicts[]`, per the §5.3 matrix | posting text + candidate declaration |
| `G_CONFLICT_DECISIVE` | bool | `G_CONFLICT ∈ {now, future}` **and** the driving requirement has `deterministicMatch = true` **and** `confidence ≥ medium` **and** `candidateDataSufficient = true` | as above |
| `G_HARD_REQ_ABSENT` | bool | ≥1 `EvaluatedRequirement` with `supportsHardSkip = true` | posting text + candidate declaration |
| `G_REQ_UNCONFIRMED` | bool | ≥1 requirement with `strength = MANDATORY_EXPLICIT` and `presence ∈ {NOT_FOUND, UNKNOWN}` | as above |
| `G_YEARS` | `none` \| `moderate` \| `severe` | from `relevantYearsRatio`, **only when `requiredYearsStated`** | `careerFit` |
| `G_MISMATCH_CORROBORATED` | bool | `capability.mismatchCorroborationCount ≥ 2` | `careerFit`, requirements |
| `G_EVIDENCE_REPAIRABLE` | bool | `evidence.band = BURIED` **or** (`positioning.repairEstimate.supportedEditCount > 0` **and** `requiresNewEvidence = false`) | tailor analysis, positioning brief |
| `G_ROUTE` | bool | ≥1 valid `ActionableAccessRoute` (§7) | `lib/networking/job-contact-finder.ts` |
| `G_WINDOW` | `hot` ≤48h \| `open` ≤7d \| `aging` ≤45d \| `stale` >45d \| `unknown` | `jobs.first_detected_at` | `jobs` |
| `G_SUFFICIENT` | bool | §6.1 | composite |
| `G_BLOCKING_CONFIRMATION` | bool | §6.2 | composite |

### 3.3 Prohibited inputs

- `job_match_scores.overall_score` — contains `sponsorshipRankDelta`; would
  double-count Eligibility against Capability.
- `ResumeAnalysis.verdict` / `apply_recommendation` — LLM output.
- `ApplicationVerdict.*` — X-Ray writes it, never reads it.
- `rejection_patterns` rates and `application_timing_signals` — advisory only
  (§8), never a gate.
- `autofill_profiles` diversity fields — never, on any path.
- `userPreferences.minimumMatchScore` — may annotate, never decide.
- Anything the candidate did not say, inferred from a schema default (§5.2).

---

## 4. The executable table

Evaluated top to bottom within stage order B → C → D → E → F → G → H → I. The
first rule whose condition holds selects; later matches go to
`suppressedRuleIds`.

| Stage | Rule | Condition | Action | Min confidence |
| --- | --- | --- | --- | --- |
| **B** | `RB1` | `G_CLOSED` | `SKIP` | any — stored fact |
| **C** | `RC1` | `G_CONFLICT_DECISIVE` and `G_CONFLICT = now` | `SKIP` | `medium` |
| | `RC2` | `G_CONFLICT_DECISIVE` and `G_CONFLICT = future` | `SKIP` | `medium` |
| | `RC3` | `G_HARD_REQ_ABSENT` | `SKIP` | `medium` |
| **D** | `RD1` | `G_SUFFICIENT = false` | `INSUFFICIENT_DATA` | any |
| | `RD2` | `G_BLOCKING_CONFIRMATION` | `INSUFFICIENT_DATA` | any |
| **E** | `RE1` | `G_MISMATCH_CORROBORATED` | `SKIP` | `medium` |
| | `RE2` | `capability.band = STRETCH` and `G_YEARS = severe` | `STRENGTHEN_FIRST` if `repairFitsWindow`, else `APPLY_NOW` with a deferred repair | `medium` |
| | `RE3` | `G_REQ_UNCONFIRMED` | `STRENGTHEN_FIRST` with a `confirm_requirement_status` action (`requiresCandidateConfirmation = true`) | `medium` |
| | `RE4` | ≥1 requirement `ABSENT_CONFIRMED` with `acquirability.source ≠ unknown` and `estimatedDays` inside the window | `STRENGTHEN_FIRST`, kind `acquire_missing_requirement` | `medium` |
| **F** | `RF1` | `evidence.band = UNREADABLE` | `STRENGTHEN_FIRST`, kind `upload_or_reparse_resume` | any |
| | `RF2` | `evidence.band = BURIED` | `STRENGTHEN_FIRST` if `repairFitsWindow`, else `APPLY_NOW` with a deferred repair | `medium` |
| | `RF3` | `evidence.band = THIN` and `capability.band ∈ {NEAR_MISS, STRETCH}` | `STRENGTHEN_FIRST` if `G_EVIDENCE_REPAIRABLE`, else fall through | `medium` |
| | `RF4` | `evidence.band = THIN` and `capability.band ∈ {MEETS, EXCEEDS}` | fall through to G — capability is established by capability evidence, so thin keyword coverage is a positioning matter | — |
| **G** | `RG1` | `positioning.band = MISALIGNED` and `G_EVIDENCE_REPAIRABLE` | `STRENGTHEN_FIRST` if `repairFitsWindow`, else `APPLY_NOW` with a deferred repair | `medium` |
| | `RG2` | `positioning.band = TUNABLE` and `repairEstimate.estimatedMinutes ≤ 30` and `repairFitsWindow` | `STRENGTHEN_FIRST` | `medium` |
| | `RG3` | `positioning.band = MISALIGNED` and **not** `G_EVIDENCE_REPAIRABLE` | fall through — the only available "repair" would require inventing evidence | — |
| **H** | `RH1` | `G_ROUTE` and `capability.band ∈ {MEETS, EXCEEDS, NEAR_MISS}` and `evidence.band ∈ {STRONG, ADEQUATE, BURIED}` | `FIND_ACCESS` | `medium` |
| **I** | `RI1` | `hiringReality.band ∈ {UNCERTAIN, LIKELY_CLOSED}` (soft signals only) | `APPLY_NOW` with a `verify_posting` action, confidence capped `low` | `low` |
| | `RI2` | everything else | `APPLY_NOW` | derived (§9) |

### 4.1 `repairFitsWindow`

Every `STRENGTHEN_FIRST` rule is conditioned on this. It is what stops X-Ray
from talking a candidate out of a same-day application over a 20-minute fix.

```
repairFitsWindow =
    G_WINDOW = "aging"                                  → true
  | G_WINDOW = "open"    && effort ∈ {minutes, hours}   → true
  | G_WINDOW = "hot"     && effort = "minutes"          → true
  | G_WINDOW = "hot"     && effort ∈ {hours, days, weeks_or_more} → false
  | G_WINDOW = "stale"                                  → false
  | G_WINDOW = "unknown"                                → treat as "open"
```

When false:
- `hot` → `APPLY_NOW`, repair carried as a `RecommendedAction` for the next
  application, with an explicit note that speed was chosen over polish.
- `stale` → the repair is moot for this posting; fall through.

`RF1` (`UNREADABLE`) and `RE3` (`G_REQ_UNCONFIRMED`) are exempt: both are
requests for information, not document work, and both remain correct in any
window.

---

## 5. Eligibility — observational, timeline-aware

### 5.1 Bands are observations, never legal conclusions

| Band | Means |
| --- | --- |
| `NO_EXPLICIT_CONFLICT_FOUND` | We read the posting language and nothing in it conflicts with what the candidate told us |
| `EMPLOYER_ACTION_MAY_BE_NEEDED` | No conflict now, but the candidate's timeline implies the employer would have to act later |
| `NEEDS_CLARIFICATION` | The posting wording, the candidate's data, or their interaction is ambiguous |
| `EXPLICIT_REQUIREMENT_CONFLICT` | The posting states a requirement that conflicts with known candidate data. Requires a literal excerpt |
| `UNKNOWN` | Posting unreadable, or the candidate never told us |

The UI may never render any of these as "you are eligible" or "you are not
eligible". Permitted copy is in `product-contract.md` §6.

### 5.2 Candidate authorization is a timeline, not a boolean

`CandidateAuthorizationTimeline` carries `currentlyAuthorized`,
`currentAuthorizationType`, `authorizationEndDate`,
`futureEmployerActionLikely`, `futureActionType`.

**Being on OPT does not mean "needs sponsorship now."** An F-1 OPT holder is
authorized to work today; the employer need do nothing until the EAD expires.
Revision 1 collapsed this into a single `needsSponsorship` flag, which produced
`SKIP` on postings that only bar *current* sponsorship.

Derivation:

| `currentAuthorizationType` | `currentlyAuthorized` | `futureEmployerActionLikely` | `futureActionType` |
| --- | --- | --- | --- |
| `citizen` / `us_citizen` | true | false | — |
| `green_card` | true | false | — |
| `opt` | true (until `opt_end_date`) | true | `h1b_petition` |
| `stem_opt` | true (until `opt_end_date`) | true | `h1b_petition` |
| `h1b` | true | true | `visa_transfer` |
| `tn_visa` | true | `unknown` | `unknown` |
| `require_sponsorship` | **false** | true | `h1b_petition` |
| `other` | `unknown` | `unknown` | `unknown` |
| nothing set | `unknown` | `unknown` | `unknown` |

**The defaults trap.** `autofill_profiles.authorized_to_work DEFAULT true`,
`requires_sponsorship DEFAULT false`, `profiles.needs_sponsorship DEFAULT false`,
`profiles.is_international DEFAULT false`. An empty profile is byte-identical to
a citizen's. `derivedFromDefaultsOnly = true` forces every field to `unknown`.

### 5.3 The conflict matrix

Rows: posting language category. Columns: candidate timeline state. Every cell
is deterministic; no model participates.

| Posting category | Currently authorized, no future action | Currently authorized, future action likely | Not currently authorized | Timeline unknown |
| --- | --- | --- | --- | --- |
| `NO_CURRENT_SPONSORSHIP` | no_conflict | **no_conflict** | conflict_now | needs_clarification |
| `NO_FUTURE_SPONSORSHIP` | no_conflict | **conflict_future** | conflict_now | needs_clarification |
| `NO_CURRENT_OR_FUTURE_SPONSORSHIP` | no_conflict | **conflict_future** | conflict_now | needs_clarification |
| `UNRESTRICTED_AUTHORIZATION_REQUIRED` | no_conflict | conflict_now | conflict_now | needs_clarification |
| `CITIZENSHIP_REQUIRED` | no_conflict *(citizen only)* | conflict_now | conflict_now | needs_clarification |
| `CLEARANCE_REQUIRED` | needs_clarification *(unless clearance declared)* | needs_clarification | needs_clarification | needs_clarification |
| `AMBIGUOUS_GENERAL` | no_conflict | needs_clarification | needs_clarification | needs_clarification |
| `SPONSORSHIP_OFFERED` | no_conflict | no_conflict | no_conflict | no_conflict |

The three bold cells are the correction. An OPT candidate against a posting that
says only "we cannot sponsor **for this role right now**" is **not** a conflict
today, and revision 1 got that wrong.

Band mapping: any `conflict_now` or `conflict_future` →
`EXPLICIT_REQUIREMENT_CONFLICT`. Otherwise any `needs_clarification` →
`NEEDS_CLARIFICATION`. Otherwise `futureEmployerActionLikely = true` →
`EMPLOYER_ACTION_MAY_BE_NEEDED`. Otherwise `NO_EXPLICIT_CONFLICT_FOUND`.
Posting unreadable or timeline unknown with no requirement found → `UNKNOWN`.

Note on `CITIZENSHIP_REQUIRED`: green-card holders and citizens differ here, so
the first column is conditioned on `currentAuthorizationType = citizen`. A
green-card holder against a citizenship requirement is `conflict_now`.

Note on `CLEARANCE_REQUIRED`: we have no candidate clearance field. Everything
is `needs_clarification` until the candidate declares, because a clearance
requirement is not inferable from `visa_status`.

### 5.4 Categorizing the posting language

Categories are re-derived from `lib/jobs/metadata.ts` pattern families. They are
**not** read from `jobs.requires_authorization`, which is
`boolean DEFAULT false` (so `inferRequiresAuthorization`'s `null` is lost) and
which merges all categories into one bit that
`createVisaIntelligenceFallback` then labels
`requires_unrestricted_work_authorization` regardless of cause.

| Pattern (from `AUTH_REQUIRED_PATTERNS`) | Category |
| --- | --- |
| `sponsorship ... not available/provided/offered` | `NO_CURRENT_SPONSORSHIP` |
| `do(es) not / will not / cannot ... sponsor` | `NO_CURRENT_SPONSORSHIP` |
| `without (current\|future) sponsorship` with "future" present | `NO_FUTURE_SPONSORSHIP` |
| `requires sponsorship ... now or in the future ... will not be considered` | `NO_CURRENT_OR_FUTURE_SPONSORSHIP` |
| `temporary visas ... will not be considered` | `NO_CURRENT_OR_FUTURE_SPONSORSHIP` |
| `must possess ... **unrestricted** work authorization`, **or** the excerpt names F-1/OPT/CPT/STEM/H-1B/TN | `UNRESTRICTED_AUTHORIZATION_REQUIRED` |
| `must possess valid work authorization` with **no** "unrestricted" and **no** visa list | `AMBIGUOUS_GENERAL` |
| citizenship patterns | `CITIZENSHIP_REQUIRED` |
| `CLEARANCE_REQUIRED_PATTERNS` | `CLEARANCE_REQUIRED` |
| `AUTH_NOT_REQUIRED_PATTERNS` | `SPONSORSHIP_OFFERED` |

The second-to-last row is a correction to a live repository behavior. The
`must ... possess ... (valid|current|unrestricted|valid and unrestricted)?
work authorization` pattern makes "unrestricted" **optional**, so
"You must currently possess valid U.S. work authorization" — which an OPT
holder satisfies — matches and is flagged as a blocker. The module's own
comment says bare authorization boilerplate must never flag, and
`lib/jobs/metadata.authorization.test.ts` asserts that for "authorized to work"
phrasings but not for "possess valid work authorization". X-Ray therefore
requires the word "unrestricted" or a named visa list before reaching
`UNRESTRICTED_AUTHORIZATION_REQUIRED`; otherwise it is `AMBIGUOUS_GENERAL`,
which can never produce a conflict on its own.

`SPONSORSHIP_OFFERED` wins over every other category when both are present,
matching `inferRequiresAuthorization`'s precedence.

### 5.5 What can never produce a conflict

Employer sponsorship history, `companies.sponsors_h1b`, LCA counts, H-1B
prediction output, `CapExemptSignal`, E-Verify status, ghost risk, company
health, salary, rejection patterns, or company prestige. `SponsorshipHistorySignal`
can raise the band to `EMPLOYER_ACTION_MAY_BE_NEEDED` and can add commentary. It
can never reach `EXPLICIT_REQUIREMENT_CONFLICT`, and it can never reach
`NO_EXPLICIT_CONFLICT_FOUND` either — absence of filings is not absence of
willingness.

`companies.sponsors_h1b` is `boolean DEFAULT false`, and `calculateVisaFitScore`
scores `false` at −8 with "Employer is not currently marked as an H-1B sponsor."
X-Ray treats `false` + zero counts + zero confidence as **unknown**.

---

## 6. Stage D — sufficiency and blocking confirmation

### 6.1 `G_SUFFICIENT`

False when any of:

| Condition | Reason |
| --- | --- |
| No resume resolvable | Capability, Evidence and Positioning all `UNKNOWN` |
| `parse_status ≠ 'complete'` **and** `raw_text` empty | We cannot read the candidate |
| `description` null/empty **and** `raw_data.structured_job` absent | We cannot read the posting |
| Stage A returned any `unresolved_*` outcome | We do not know which job this is |
| ≥3 of the 5 dimensions `UNKNOWN` | Too little to adjudicate |
| ≥2 `dimension_blocking` gaps in different dimensions | Same |

### 6.2 `G_BLOCKING_CONFIRMATION` — correction 10

A low-confidence or ambiguous authorization requirement must **never** produce
`STRENGTHEN_FIRST`. Rewriting a résumé does not resolve a question about work
authorization, and presenting it as a résumé problem is actively misleading.

`G_BLOCKING_CONFIRMATION` is true when **both**:

1. At least one `PostingAuthorizationRequirement` exists whose category is
   *not* `SPONSORSHIP_OFFERED` and *not* `AMBIGUOUS_GENERAL`; **and**
2. The conflict evaluation is `needs_clarification` because
   `candidateDataSufficient = false` — i.e. the candidate's timeline is
   `unknown` or `derivedFromDefaultsOnly`.

That is the decision-blocking case: knowing the answer would flip between
`SKIP` and `APPLY_NOW`. It returns `INSUFFICIENT_DATA` (`RD2`) with a
`confirm_authorization_timeline` action carrying
`isDecisionBlockingConfirmation = true`.

**Not decision-blocking**, and therefore *not* handled here:

| Case | Handling |
| --- | --- |
| Requirement is `AMBIGUOUS_GENERAL` and the candidate is known-authorized with no future action | Continue. No finding beyond a note |
| Requirement is `AMBIGUOUS_GENERAL` and the candidate's timeline is known but implies future action | Continue to E–I; attach a prominent, non-blocking `confirm_authorization_timeline` action; cap overall confidence at `low` |
| Requirement is low-confidence (`deterministicMatch = false`, i.e. LLM-only) but candidate data is known | Continue; attach `verify_posting`; the requirement may not reach `EXPLICIT_REQUIREMENT_CONFLICT` |
| `CLEARANCE_REQUIRED` with no candidate clearance field | Continue with a prominent `confirm_requirement_status`; clearance is not inferable, so this is a question, not a conflict |

The distinction in one line: **if the answer would change the action, stop and
ask (`RD2`); if it would only change the wording, continue and ask
prominently.**

---

## 7. Stage H — actionable access

### 7.1 What qualifies

`G_ROUTE` is true only when `accessRoutes[]` contains at least one route
satisfying **all** of:

1. `channel` is present and concrete — a LinkedIn profile URL, an email
   address, an internal referral form URL, or a cohort thread id. A name with
   no channel is not a route.
2. `relationshipContext` is non-empty and specific to this candidate and this
   company.
3. `nextStep` is a single imperative sentence the candidate can perform today.
4. `sourceFactIds` is non-empty.
5. `stale = false` against the route type's freshness horizon (§7.3).

A `FIND_ACCESS` output with an empty `accessRoutes[]`, or with a route missing
any of the above, is **invalid output** and must fail a test.

### 7.2 The repository can produce these

Revision 1 gated `FIND_ACCESS` on referral *statistics*, which is not a route.
The instruction offered a fallback of making `FIND_ACCESS` unreachable in v0 if
the repository cannot produce a real route. It can, so the fallback does not
apply — but the gate is now the route, not the statistic.

`getJobNetworkingContacts` (`lib/networking/job-contact-finder.ts`, exposed at
`app/api/jobs/[id]/networking/route.ts`) returns `NetworkingContact[]` with
`name`, `role`, `team`, `confidence`, `reason`, `linkedinUrl`, `email`, from
four sources:

| Source table | Route type | Channel available? |
| --- | --- | --- |
| `linkedin_connections` (degree 1) | `direct_connection` | `profile_url` → yes when non-null |
| `linkedin_connections` (degree 2–3) | `second_degree_connection` | as above |
| `cohort_members` at the target company | `company_alumni` | `linkedin_url`, **but nulled unless the viewer is a cohort member** |
| `cohort_members` via a shared cohort | `cohort_peer` | `linkedin_url` when present |
| `employer_cohort_requests.contact_email` | `employer_recruiter_contact` | email → yes |

The alumni row is the important one: `job-contact-finder` deliberately
anonymizes the name (`anonymizeDisplayName`) and sets `linkedinUrl: null` when
the viewer is not a cohort member. Those contacts have **no channel**, so they
are **not routes**. They may appear as an advisory ("join the cohort to reach
company alumni"), never as `FIND_ACCESS`.

### 7.3 Freshness horizons

| Route type | Horizon | Field |
| --- | --- | --- |
| `direct_connection`, `second_degree_connection` | 180 days | `linkedin_connections.scraped_at` |
| `employer_recruiter_contact` | 240 days | `employer_cohort_requests.created_at` |
| `company_alumni`, `cohort_peer` | 365 days | `cohort_members.joined_at` |
| `candidate_supplied_contact` | none | candidate-declared |

Past the horizon the route is dropped, not downgraded.

### 7.4 Explicitly not a route

- Referral-vs-cold screen-rate statistics (§8).
- A prior application at the company, at any stage, **unless** a reachable
  person or channel is stored alongside it. `job_applications` has no recruiter
  contact fields, so a past interview alone is **not** a route in v0.
- Company size, prestige, brand, applicant volume, or "competitiveness".
- A low match score reframed as an access problem.
- Generic advice to "find someone at the company".

The revision-1 `warm_pipeline` gate is deleted for exactly this reason.

---

## 8. Rejection-pattern data — advisory only (correction 12)

Revision 1 contradicted itself: it declared `rejection_patterns` off-limits as a
decision input and then used referral-vs-cold rates to gate `FIND_ACCESS`.
Resolved as follows, with no exceptions:

1. `rejection_patterns` rates are **never** a gate. `ReferralAdvantageAdvisory`
   carries the literal type `gatesFinalAction: false`.
2. They may be **displayed** only when `total_submissions ≥ MIN_SUBMISSIONS`
   (10, from `app/api/rejections/patterns/route.ts`) and
   `last_computed_at` is within 180 days. Otherwise dropped entirely — not
   shown at low confidence.
3. When displayed, they always carry the sample size and the window, and are
   `basis: "prediction"`.
4. They may produce at most one advisory action of kind
   `consider_referral_generally`, which can never be the final action.
5. When a valid `ActionableAccessRoute` also exists, the advisory may be used to
   *rank* that route higher and to phrase its rationale. That is the only way
   referral statistics touch the output.
6. Visa-segmented rates (`h1b_screen_rate`, `citizen_screen_rate`) are not
   consumed at all in v0 — see `adversarial-review.md` §3.4.

---

## 9. Unknown-data behavior

### 9.1 The universal rule

A missing input produces `UNKNOWN` / `NOT_FOUND` plus an `XRayDataGap`. It never
produces a score of 0, a negative finding, or a band shifted toward the negative
end. Proved exhaustively in §15.6.

| Missing | Correct | What the repo does today |
| --- | --- | --- |
| `companies.sponsors_h1b` unset | `employerHasSponsored: "unknown"` | `calculateVisaFitScore` reads the `false` default as −8 + "not currently marked as an H-1B sponsor" |
| No/defaulted `company_health_scores` | `healthVerdict: "unknown"`, `healthUsable: false` | `computeHealthScore` defaults (10+25+12+12 = 59) render a no-data company as **"healthy"** |
| `rejection_patterns` below 10 | drop the advisory | — |
| `field_skill_profiles` not refreshed | `corpusAvailable: false` | a 0 field-fit score |
| `requiredYears` not stated | `requiredYearsStated: false`, no shortfall computable | scoring a shortfall against 0 |
| Candidate authorization never set | every timeline field `unknown` | reading the `false`/`true` defaults as answers |
| `first_detected_at` null | `G_WINDOW = unknown` → treated as `open` | `computeApplyTimingFromPostAge` substitutes 9999 hours → `low_priority` |
| Certification not on the résumé | `presence: NOT_FOUND` | `scoreCerts` returns 0.1 and sets `certGate` |
| Résumé term not found | `absenceKind: NOT_FOUND_IN_READABLE_DATA` | — |

### 9.2 `last_seen_at` (repository question 6, revised)

`persistJobsBulk` historically updated rows only when
`content_hash IS DISTINCT FROM EXCLUDED.content_hash`, so an unchanged live
harvester job kept a stale `last_seen_at`.

**A fix is present in the working tree** (uncommitted). The upsert now also
fires when `jobs.last_seen_at IS NULL OR jobs.last_seen_at < EXCLUDED.last_seen_at`
(plus reactivation conditions), and writes
`GREATEST(COALESCE(jobs.last_seen_at, EXCLUDED.last_seen_at), EXCLUDED.last_seen_at)`.
That makes `last_seen_at` a genuine liveness signal again — **going forward**.

Rules, which hold both before and after the fix deploys:

1. Introduce `HARVESTER_LAST_SEEN_EPOCH_ISO`, following the existing
   `FAST_SCORE_CACHE_EPOCH_ISO` idiom in `lib/matching/score-freshness.ts`. Set
   it to the fix's deploy timestamp.
2. `lastSeenAtTrustworthy = ingestionPath ≠ "harvester" || last_seen_at ≥ epoch`.
   Legacy-crawler and aggregator paths always advanced it, so they are
   trustworthy regardless.
3. When untrustworthy, `last_seen_at` may back **no** finding, and "not seen
   since …" is prohibited.
4. `companies.last_crawled_at` remains the board-level "we checked" proxy, and
   `jobs.is_active` remains the disappearance signal — `deactivateMissingJobs`
   is what actually observes a job vanishing.
5. A stale board check caps `hiringReality.band` at `LIKELY_LIVE`. It can never
   push toward `LIKELY_CLOSED`: not-checked is not evidence of closure.
6. The ghost `isReverified` bonus stays suppressed for pre-epoch harvester rows.

### 9.3 Staleness thresholds

| Input | Threshold | On breach |
| --- | --- | --- |
| Ghost score cache | 24h (`CACHE_TTL_MS`) | recompute, else band `UNKNOWN` |
| `companies.last_crawled_at` | 2× freshness-tier cadence | cap at `LIKELY_LIVE` |
| `company_health_scores` | 30 days | `healthUsable = false` |
| LCA / H-1B | 1095 days (matches `calculateVisaFitScore`) | `dataStale = true`, commentary only |
| `job_match_scores` | `isScoreFreshForResume` | recompute, else Capability `UNKNOWN` |
| `rejection_patterns` | 180 days | drop |
| `field_skill_profiles` | 30 days | `corpusAvailable = false` |
| Access routes | §7.3 | drop the route |

---

## 10. Evidence Strength v0 (repository question 4, revised)

No claim-level evidence table exists, so Evidence Strength is a **legibility and
coverage** measure, always `verificationLevel: "inferred"`.

Inputs, all deterministic and already present:
`buildLocalTailorAnalysis().skillSuggestions[].status`;
`buildPositioningBrief().surface`; `careerFit` years; `parse_status`,
`parse_error`, dated-role count.

```
if parse_status != 'complete' or !hasRawText or datedRoleCount == 0
      → UNREADABLE
if N_terms == 0
      → UNREADABLE   (no denominator; never report 0% or 100% coverage)

presentRatio = presentCount / N_terms

if presentRatio >= 0.70 and (!requiredYearsStated or relevantYears >= requiredYears)
      → STRONG
if presentRatio >= 0.50 and supportedCount >= notFoundCount
      → ADEQUATE
if capability.band in {MEETS, EXCEEDS} and surface.length > 0
   and structuredCoverage < rawTextCoverage - 0.15
      → BURIED
if notFoundCount > presentCount
      → THIN
otherwise
      → ADEQUATE
```

`BURIED` is checked before `THIN` because they prescribe opposite actions.

### 10.1 Evidence absence never establishes capability absence (correction 11)

Four distinct states, carried in `EvidenceAbsenceKind`:

| State | Meaning | May support a capability SKIP? |
| --- | --- | --- |
| `NOT_FOUND_IN_READABLE_DATA` | we looked and did not find it | **No** |
| `CANDIDATE_CONFIRMED_ABSENT` | the candidate told us they lack it | Yes, via `RC3`, and only for a `MANDATORY_EXPLICIT` requirement |
| `EXPLICIT_CONTRADICTION` | candidate-sourced statements conflict | Only at `declaration_vs_structured_field` reliability |
| `UNREADABLE_DATA` | we could not look | **No** — routes to `RF1` |

`EvidenceStrengthAssessment.mayEstablishCapabilityAbsence` is the literal type
`false`, so any future change is an explicit contract change. Correspondingly,
`capability.mismatchCorroborations` may only contain
`role_family_incompatible`, `severe_years_shortfall`, `career_fit_below_floor`,
and `mandatory_absent_confirmed` — never a keyword-coverage term.

### 10.2 Prohibited in v0

Naming a specific bullet as proof of a specific claim; the words
verified/confirmed/proven/validated applied to candidate evidence; a numeric
evidence score shown to the user; treating `missing_supported` as proof (it is
a *wording* hint from `hasIndirectEvidence`).

---

## 11. Requirements — the three axes (corrections 3, 4, 5)

### 11.1 Presence

`PRESENT | ABSENT_CONFIRMED | NOT_FOUND | CONTRADICTED | UNKNOWN`.

Derivation, in order:

1. Candidate declaration for this requirement exists → `PRESENT` or
   `ABSENT_CONFIRMED`.
2. Declaration exists **and** disagrees with a parsed structured field
   (`resumes.skills.certifications`, `education`, `work_experience`) →
   `CONTRADICTED`, reliability `declaration_vs_structured_field`.
3. Declaration disagrees with a free-text mention only → `CONTRADICTED`,
   reliability `declaration_vs_free_text`.
4. No declaration; found in a structured field or raw text → `PRESENT`.
5. No declaration; readable data searched, not found → `NOT_FOUND`.
6. Data unreadable, or the requirement itself unparsed → `UNKNOWN`.

`supportsHardSkip` is true only for `ABSENT_CONFIRMED`, or `CONTRADICTED` at
`declaration_vs_structured_field` reliability. `NOT_FOUND` and `UNKNOWN` can
never make it true. This is the correction: a résumé that omits a CPA is not
evidence the candidate lacks a CPA.

### 11.2 Strength

`MANDATORY_EXPLICIT | PREFERRED_EXPLICIT | INFERRED | UNKNOWN`, each with a
`RequirementStrengthProvenance`.

`MANDATORY_EXPLICIT` requires `strengthProvenance ∈ {deterministic_pattern,
structured_ats_field, section_header_plus_pattern}` **and** a non-null
`strengthExcerpt`. `llm_only` caps strength at `INFERRED`, always.

Qualifying deterministic sources in this repository: `CERT_REQUIRED_RE` in
`lib/matching/fast-scorer.ts` (which anchors on "required|must have|minimum"
before a credential token), `EXPERIENCE_MIN_RE` and `EXPERIENCE_RANGE_RE` in
`lib/jobs/metadata.ts`, `CLEARANCE_REQUIRED_PATTERNS`, and the
requirements-section extraction in `extractRequirementsText`.

### 11.3 Acquirability

`AcquirabilitySource ∈ {candidate_declared, credential_catalog, unknown}`.

**This repository has no credential catalog.** `CERT_REQUIRED_RE` is an
extraction regex over a closed token set (aws certified\*, cka, ckad, cks, pmp,
cissp, ceh, ccna, ccnp, azure certified\*, google certified\*); it says nothing
about how long any of them takes to obtain. So:

- `credential_catalog` is unreachable in v0.
- `candidate_declared` is the only reachable non-unknown source.
- Everything else is `unknown`, and `RE4` therefore cannot fire without a
  candidate declaration.
- **An LLM may not populate `estimatedDays` under any provenance.**

Revision 1's `acquirableWithinDays ≤ 30` gate is deleted: it asserted knowledge
HireOven does not have.

---

## 12. Conflicting signals and double counting

### 12.1 Double-count suppression (repository question 2)

Before banding, a claim ledger runs over `sourceFacts`. When two dimensions
would consume facts tracing to the same observation, only the **owner** may
score it.

| Shared observation | Owner | Suppressed in | Evidence |
| --- | --- | --- | --- |
| Posting age | Hiring Reality | ghost band already includes age; no separate freshness term; `applyTimingBadge` display-only | `calculateApplicationVerdict` adds ghost **and** `jobFreshnessDays`, guarded only when ghost is `high` |
| Layoffs / hiring freeze | Employer capacity | ghost `hasHiringFreeze` flagged `alreadyCountedInGhostRisk` | `calculateGhostJobRisk` and `computeLayoffScore` read the same tables |
| Concurrent similar openings | Hiring Reality (once) | `repostCount` and `duplicateCount` are the same phenomenon at +18 each | `queryRepostCount` vs `duplicateCount` |
| Work authorization | Eligibility | Capability uses `careerFitScore`, never `overall_score`; `MatchScoreBreakdown.sponsorshipScore` display-only | `computeFastScore` `sponsorshipRankDelta` |
| Posting requirement text | Eligibility / Capability requirement, once | `calculateVisaFitScore`'s blocker short-circuit to score 12 is not read | `calculateVisaFitScore` early return |
| Skill / keyword overlap | Positioning | Capability uses years + role family; Evidence uses support *status* | `skills.score` feeds `atsScreenScore` at 0.55 **and** `overall` |
| `title.score` | Positioning | in `atsScreenScore` (0.15) and `careerFitScore` (0.05); Capability ignores the title term | `buildCareerFit` |
| Referral advantage | advisory | may rank a route, never gate one | §8 |

### 12.2 Contradiction rules

| Conflict | Resolution |
| --- | --- |
| Active + published, but `applyUrlStatus = dead` | `UNCERTAIN`, never `CLOSED`. Emit `verify_posting` noting 401/403 are commonly bot-blocking |
| Fresh `first_detected_at` but ghost `high` | `UNCERTAIN`; list both; never average |
| Explicit conflict text but strong employer LCA history | The requirement wins the band; history is context |
| Strong ATS screen, weak career fit | Never `APPLY_NOW` on the screen score alone — `RE1`/`RE2` |
| Strong capability, weak keywords | `RF4` falls through to positioning; never `SKIP` |
| Health `critical` but `healthUsable = false` | Ignore entirely |
| Two dimensions `UNKNOWN` and decision-relevant | Stage D |
| `profiles` and `autofill_profiles` disagree on authorization | `NEEDS_CLARIFICATION`; never pick the more permissive value |
| Candidate declaration disagrees with the résumé | `CONTRADICTED` with a reliability level; never silently prefer one |

---

## 13. Confidence and tie-breaking

### 13.1 Confidence

**Step 1 — base:** `min(confidence of each dimension named in the firing rule's
condition)`. A rule reading only stored facts (`RB1`) starts at `high`.

**Step 2 — coverage:** dimensions with band ≠ `UNKNOWN`: 5 or 4 → no change;
3 → −1 step; ≤2 → forced `unknown` (Stage D should already have caught it).

**Step 3 — penalties, cumulative, −1 step each:**
a `decision_relevant` gap in a dimension the rule read; `staleInputsDowngraded`
on such a dimension; a non-blocking confirmation attached (§6.2); a §12.2
contradiction was resolved; the action rests on a `prediction`-basis finding.

**Step 4 — caps:**

| Situation | Cap |
| --- | --- |
| Any `llm_only` provenance in the firing path | `medium` |
| `SKIP` from `RE1` (corroborated capability mismatch) | `medium` — our threshold, not the employer's |
| `SKIP` from `RB1`, `RC1`, `RC2`, `RC3` with a cited excerpt | may be `high` |
| `RI1` (soft hiring-reality path) | `low` |
| `FIND_ACCESS` where the route's own `confidence` is `low` | `low` |
| Stage A `resolved` with `applyUrlDiffers` | `medium` |

Steps never raise confidence above the base.

### 13.2 Tie-breaking

- **T1 — two rules in one stage.** Fixed priority by rule id ascending
  (`RC1` before `RC2` before `RC3`). Ids are stable; reordering bumps
  `engineVersion`.
- **T2 — equal-severity risks.** Order by dimension precedence, then
  `fact` → `inference` → `prediction`, then stable id sort.
- **There is no cross-stage override.** Revision 1's `STRENGTHEN_FIRST` vs
  `FIND_ACCESS` exception (its "T2") is **deleted**: it was a prose exception
  that contradicted the rule ordering, which §15.5 now forbids. Positioning (G)
  precedes access (H) unconditionally. If a positioning fix fires, the access
  route is still emitted as `actions[0]` with kind `contact_named_route`, so
  nothing is lost — but the precedence is not violated.

**Determinism requirement:** identical `inputsHash` ⇒ identical `finalAction`,
`confidence`, and `selectedRuleId`. No dependence on map iteration order or on
wall-clock time except through an explicitly passed `now`.

---

## 14. Revision 2 change log

| # | Correction | Where |
| --- | --- | --- |
| 1 | `xray-contract.ts` produced as a compilable contract | file exists, `tsc --noEmit` clean |
| 2 | Duplicate resolution moved to preprocessing; `R1.2` deleted | §2 |
| 3 | `RequirementPresence` replaces boolean `candidateHas` | §11.1 |
| 4 | `RequirementStrength` + provenance; LLM cannot set `MANDATORY_EXPLICIT` | §11.2 |
| 5 | `AcquirabilitySource`; the 30-day gate deleted | §11.3 |
| 6 | `ActionableAccessRoute`; statistics no longer gate `FIND_ACCESS` | §7 |
| 7 | Observational eligibility bands | §5.1 |
| 8 | Authorization timeline + posting-language categories + matrix | §5.2–5.4 |
| 9 | Stages renamed A–I; prose and table reconciled | §1, §4, §15.5 |
| 10 | Ambiguous blocker → `INSUFFICIENT_DATA` or prominent confirmation, never `STRENGTHEN_FIRST` | §6.2 |
| 11 | `EvidenceAbsenceKind`; evidence absence cannot establish capability absence | §10.1 |
| 12 | Rejection-pattern contradiction resolved — advisory only | §8 |
| 13–15 | Fixtures | `test-fixtures.md` |
| 16 | Consistency matrix | §15 |

Also corrected from revision 1:

- `last_seen_at` guidance updated for the working-tree fix in
  `lib/harvester/persist-bulk.ts`, with a forward-only epoch (§9.2).
- Status-vocabulary answer updated: `lib/applications/statuses.ts` now exists
  and the route consumes it (§16).
- The cross-stage tie-break exception deleted (§13.2).

---

## 15. Contract consistency matrix (correction 16)

### 15.1 Every final action has executable prerequisites

| Action | Reachable via | Prerequisites, all machine-checkable |
| --- | --- | --- |
| `SKIP` | `RB1` | `G_CLOSED` from `jobs.is_active`, `closed_at`, `publication_status` |
| | `RC1` / `RC2` | `G_CONFLICT_DECISIVE`: matrix outcome + `deterministicMatch` + confidence ≥ medium + `candidateDataSufficient` + non-null excerpt |
| | `RC3` | `G_HARD_REQ_ABSENT`: `supportsHardSkip = true`, which itself requires `MANDATORY_EXPLICIT` + non-`llm_only` provenance + `ABSENT_CONFIRMED`/reliable `CONTRADICTED` |
| | `RE1` | `mismatchCorroborationCount ≥ 2` from the closed corroboration list |
| `INSUFFICIENT_DATA` | `RD1` | `G_SUFFICIENT = false`, six enumerated conditions |
| | `RD2` | `G_BLOCKING_CONFIRMATION`, two enumerated conditions |
| `STRENGTHEN_FIRST` | `RE2`, `RE3`, `RE4`, `RF1`, `RF2`, `RF3`, `RG1`, `RG2` | each named above; all except `RF1`/`RE3` additionally require `repairFitsWindow` |
| `FIND_ACCESS` | `RH1` | `G_ROUTE` — five route validity conditions in §7.1, all field-checkable |
| `APPLY_NOW` | `RI1` | soft hiring-reality bands; confidence forced `low` |
| | `RI2` | default; reached only when no earlier rule fired |

No action is reachable by a path that is not in this table.

### 15.2 Every gate has a repository or declared-user source

| Gate | Source | Kind |
| --- | --- | --- |
| `G_CLOSED` | `jobs.is_active`, `jobs.closed_at`, `jobs.publication_status` | repository column |
| `G_CONFLICT`, `G_CONFLICT_DECISIVE` | `jobs.description` spans via `AUTH_REQUIRED_PATTERNS` / `CLEARANCE_REQUIRED_PATTERNS` / `AUTH_NOT_REQUIRED_PATTERNS`; `profiles.visa_status`; `autofill_profiles.work_authorization`; candidate declaration | repository + declared-user |
| `G_HARD_REQ_ABSENT` | `CERT_REQUIRED_RE`, `EXPERIENCE_MIN_RE`, `extractRequirementsText`; `resumes.skills.certifications`; candidate declaration | repository + declared-user |
| `G_REQ_UNCONFIRMED` | same, with `presence ∈ {NOT_FOUND, UNKNOWN}` | repository |
| `G_YEARS` | `careerFit.relevantYearsRatio`, `requiredYearsStated` | repository (`lib/matching/fast-scorer.ts`) |
| `G_MISMATCH_CORROBORATED` | `careerFit`, `classifyRoleFamily`, requirements | repository |
| `G_EVIDENCE_REPAIRABLE` | `buildLocalTailorAnalysis`, `buildPositioningBrief` | repository |
| `G_ROUTE` | `linkedin_connections`, `cohort_members`, `employer_cohort_requests` via `getJobNetworkingContacts`; candidate-supplied contact | repository + declared-user |
| `G_WINDOW` | `jobs.first_detected_at` | repository column |
| `G_SUFFICIENT` | `resumes.parse_status`/`raw_text`, `jobs.description`, Stage A outcome, band count | repository |
| `G_BLOCKING_CONFIRMATION` | posting categories + `CandidateAuthorizationTimeline.derivedFromDefaultsOnly` | repository + declared-user |
| `repairFitsWindow` | `G_WINDOW` × `RecommendedAction.effort` | derived |

No gate reads a value that is neither stored nor declared. In particular, no
gate reads an LLM estimate.

### 15.3 Every enum in this table exists in `xray-contract.ts`

| Enum used here | Type in the contract |
| --- | --- |
| `APPLY_NOW`, `STRENGTHEN_FIRST`, `FIND_ACCESS`, `SKIP`, `INSUFFICIENT_DATA` | `XRayFinalAction` |
| `LIVE`, `LIKELY_LIVE`, `UNCERTAIN`, `LIKELY_CLOSED`, `CLOSED`, `UNKNOWN` | `HiringRealityBand` |
| `EXCEEDS`, `MEETS`, `NEAR_MISS`, `STRETCH`, `MISMATCH`, `UNKNOWN` | `CapabilityBand` |
| `STRONG`, `ADEQUATE`, `BURIED`, `THIN`, `UNREADABLE` | `EvidenceBand` |
| `NO_EXPLICIT_CONFLICT_FOUND`, `EMPLOYER_ACTION_MAY_BE_NEEDED`, `NEEDS_CLARIFICATION`, `EXPLICIT_REQUIREMENT_CONFLICT`, `UNKNOWN` | `EligibilityObservationBand` |
| `ALIGNED`, `TUNABLE`, `MISALIGNED`, `UNKNOWN` | `PositioningBand` |
| `PRESENT`, `ABSENT_CONFIRMED`, `NOT_FOUND`, `CONTRADICTED`, `UNKNOWN` | `RequirementPresence` |
| `MANDATORY_EXPLICIT`, `PREFERRED_EXPLICIT`, `INFERRED`, `UNKNOWN` | `RequirementStrength` |
| `deterministic_pattern`, `structured_ats_field`, `section_header_plus_pattern`, `llm_only`, `none` | `RequirementStrengthProvenance` |
| `candidate_declared`, `credential_catalog`, `unknown` | `AcquirabilitySource` |
| `declaration_vs_structured_field`, `declaration_vs_free_text`, `free_text_internal` | `ContradictionReliability` |
| `NO_CURRENT_SPONSORSHIP`, `NO_FUTURE_SPONSORSHIP`, `NO_CURRENT_OR_FUTURE_SPONSORSHIP`, `UNRESTRICTED_AUTHORIZATION_REQUIRED`, `CITIZENSHIP_REQUIRED`, `CLEARANCE_REQUIRED`, `AMBIGUOUS_GENERAL`, `SPONSORSHIP_OFFERED` | `PostingAuthorizationLanguageCategory` |
| `conflict_now`, `conflict_future`, `no_conflict`, `needs_clarification`, `unknown` | `AuthorizationConflictEvaluation["outcome"]` |
| `NOT_FOUND_IN_READABLE_DATA`, `CANDIDATE_CONFIRMED_ABSENT`, `EXPLICIT_CONTRADICTION`, `UNREADABLE_DATA` | `EvidenceAbsenceKind` |
| `direct_connection`, `second_degree_connection`, `company_alumni`, `cohort_peer`, `employer_recruiter_contact`, `candidate_supplied_contact` | `AccessRouteType` |
| `linkedin_profile`, `email`, `internal_referral_form`, `cohort_thread` | `AccessRouteChannel["kind"]` |
| `not_a_duplicate`, `resolved`, `unresolved_dangling`, `unresolved_chain_limit`, `unresolved_canonical_invalid` | `CanonicalResolutionOutcome` |
| `A_canonical_resolution` … `I_apply` | `XRayDecisionStage` |
| `minutes`, `hours`, `days`, `weeks_or_more` | `RecommendedAction["effort"]` |
| `dimension_blocking`, `decision_relevant`, `cosmetic` | `XRayGapSeverity` |
| `fact`, `inference`, `prediction` | `XRayBasis` |
| `high`, `medium`, `low`, `unknown` | `XRayConfidence` |

No enum value appears in this document that is absent from the contract.

### 15.4 Every rule has a positive and a suppression fixture

| Rule | Positive (rule fires) | Suppression (a higher-precedence rule wins, or the rule correctly does not fire) |
| --- | --- | --- |
| `RB1` | C1 | C2, C5a, E8 |
| `RC1` | B1, B5, B7a, B8, C7a, D2 | B6, B7, B3b |
| `RC2` | B3c, B5a | B3, B3a |
| `RC3` | A6b, D5a | A6, A7, D5b |
| `RD1` | C7c, C11, D1, D3, E7 | D2, D4 |
| `RD2` | B3b, B9, D2a | B4, B7, B9a, B12b |
| `RE1` | A5, C7b | A5a, A8, A10 |
| `RE2` | A2, A8, A10 | A9, D8 |
| `RE3` | A6, A6a, A7a, D5b | A6b |
| `RE4` | A7 | A6, A7a |
| `RF1` | D4 | D1, D3 |
| `RF2` | A3 | A3a |
| `RF3` | A5c | A5a, A5 |
| `RF4` | D7a | A5, A5c |
| `RG1` | D8 | A5b, D7a |
| `RG2` | A4, D5, E3 | A3a |
| `RG3` | A5b, D7a | D8 |
| `RH1` | E1a, E3a, E5, E6 | E1, E2, E3, E3b, E4 |
| `RI1` | C2, C3, C4, C5a, C8, C9, E8 | C1 |
| `RI2` | A1, A3a, A5a, A5b, A9, A11, A12, B3, B3a, B4, B4a, B6, B7, B9a, B10, B11, B12, B12b, C6, C7, C10, D6, D7, D7a, E1, E2, E3b, E4 | every `SKIP` and `INSUFFICIENT_DATA` fixture |

### 15.5 No prose exception contradicts rule ordering

Revision 1 contained one: a `FIND_ACCESS`-beats-`STRENGTHEN_FIRST` override
described in prose while the table gave positioning precedence. **Deleted**
(§13.2). A grep of this document for the words "exception", "override",
"notwithstanding" and "unless" against the stage order returns nothing
inconsistent with §1 and §4.

The three conditional behaviors that remain are *inside* rules, not exceptions
to ordering:

| Behavior | Why it is not an ordering exception |
| --- | --- |
| `repairFitsWindow = false` → `APPLY_NOW` | The `STRENGTHEN_FIRST` rule's condition is unmet, so it does not fire; evaluation continues to I as normal |
| `RF4` falls through | An explicit fall-through row in the table, not prose |
| `RG3` falls through | Same |

### 15.6 No `UNKNOWN` or `NOT_FOUND` becomes a negative fact

| State | Where it could leak negative | Structural guard |
| --- | --- | --- |
| `RequirementPresence.NOT_FOUND` | a skip on a missing credential | `supportsHardSkip` excludes it; `RC3` reads only that field |
| `RequirementPresence.UNKNOWN` | same | same |
| `EvidenceAbsenceKind.NOT_FOUND_IN_READABLE_DATA` | capability mismatch | `mayEstablishCapabilityAbsence: false`; corroboration list excludes evidence terms |
| `EvidenceBand.UNREADABLE` | a negative résumé verdict | routes to `RF1`, an information request; copy is "we could not read", never "your résumé is weak" |
| `CandidateAuthorizationTimeline` all-unknown | a silent "does not need sponsorship" | `derivedFromDefaultsOnly` forces `unknown`; matrix column 4 is `needs_clarification`, never `no_conflict` |
| `SponsorshipHistorySignal.employerHasSponsored = "unknown"` | "does not sponsor" | tri-state; Layer B can never reach a conflict band |
| `EmployerCapacitySignal.healthVerdict = "unknown"` | rendering "healthy" | `healthUsable` gates on `observedSubScoreCount`, not row existence |
| `GhostRiskAssessment.band = "unknown"` | a risk finding | soft signals can only reach `RI1`, which still returns `APPLY_NOW` |
| `G_WINDOW = "unknown"` | `low_priority` | treated as `open` |
| `requiredYearsStated = false` | a years shortfall | `G_YEARS` is only computed when stated |
| `fieldContext.corpusAvailable = false` | a zero field fit | `fieldFitScore` stays null |
| `CanonicalResolutionOutcome.unresolved_*` | a skip | Hiring Reality `UNKNOWN` → Stage D, never `RB1` |
| `ReferralAdvantageAdvisory.displayable = false` | a cold-apply penalty | dropped entirely; `gatesFinalAction: false` |
| Access route absent | a penalty for having no network | `G_ROUTE` false only prevents `FIND_ACCESS`; `RI2` still returns `APPLY_NOW` |

---

## 16. Repository question 5 — status vocabulary, updated

Since revision 1 was written, a fix has landed in the working tree:

- `lib/applications/statuses.ts` now exists, exporting
  `APPLICATION_RESPONSE_STATUSES` (`phone_screen`, `interview`, `final_round`,
  `offer`), `APPLICATION_NEGATIVE_OUTCOME_STATUSES` (`rejected`, `withdrawn`),
  their union, and `timingOutcomeGotRecruiterResponse`, all
  `satisfies readonly ApplicationStatus[]`.
- `app/api/applications/[id]/route.ts` consumes it, replacing the
  `["interviewing", "offer", "rejected", "withdrawn"]` set that never matched
  what the UI writes.
- `lib/applications/variant-performance.ts` re-exports the shared constant.

**Remaining, before outcome data may become a decision input:**

1. Route the other consumers through it —
   `lib/apex/timing/queue-manager.ts` (still queries
   `status IN ('applied','interviewing','offer','rejected')`),
   `app/api/apex/pipeline-sim/route.ts`, `app/api/apex/chat/route.ts`, and
   `lib/resume/version-outcomes.ts` (which still accepts both vocabularies and
   defines "responded" differently again, including `rejected` and `withdrawn`).
2. Keep the trigger's `ghostStatuses = {applied}` guard from dropping multi-step
   progressions (`applied → phone_screen → offer` still records once, but
   `phone_screen → offer` after a missed first hop records nothing).
3. Backfill by replaying `job_applications.timeline` `status_change` entries,
   and recompute `application_timing_signals` from scratch — the rolling-average
   upsert in `signal-learner.ts` cannot be corrected in place.
4. Add the DB `CHECK` constraint; `job_applications.status` is still bare
   `text DEFAULT 'saved'`.
5. Audit: compare the recomputed response rate across two recomputations.

Until step 5 passes, X-Ray reads no `application_timing_signals` and no
`rejection_patterns` rates as decision inputs. Under §8 it never reads them as
gates at all, so this constraint is now structural rather than procedural.

---

## 17. Test obligations

1. Every rule id fires at least once, asserted **by id**, not by action.
2. Every rule id is suppressed at least once (§15.4).
3. Determinism: same `inputsHash` ⇒ same `selectedRuleId` across 100 runs with
   shuffled input key order.
4. Every §9.1 unknown case yields `UNKNOWN`/`NOT_FOUND` + a gap, never a
   negative band.
5. Every §12.1 double-count pair: toggling the shared fact does not move the
   suppressed dimension's band.
6. Every fixture in `test-fixtures.md`, by id.
7. Prohibited-language guard over every rendered string.
8. `FIND_ACCESS` with an empty or channel-less `accessRoutes[]` is invalid.
9. `STRENGTHEN_FIRST` never returned when `repairFitsWindow = false`, except
   `RF1`/`RE3`.
10. Confidence never exceeds the §13.1 step-1 base.
11. A duplicate row and its canonical produce byte-identical bands, actions and
    rule ids, differing only in `canonical` and the extra action.
12. `NOT_FOUND` never sets `supportsHardSkip`; property-tested across all
    `RequirementPresence` × `RequirementStrength` combinations.
13. The §5.3 matrix is asserted cell by cell (8 categories × 4 timeline states =
    32 assertions).

Per repository convention these live at `lib/application-xray/*.test.ts` and run
under `find lib -name '*.test.ts' -print0 | xargs -0 tsx --test`.

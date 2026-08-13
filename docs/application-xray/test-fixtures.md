# Application X-Ray Test Fixtures — Revision 2

51 scenarios. Every company, person and posting is invented. Each fixture is
written to be implementable directly as a `lib/application-xray/*.test.ts` case,
asserting the **rule id** from `XRayDecisionTrace.selectedRuleId` — two rules
producing the same action is a real defect the action alone would hide.

Rule ids, gates and bands are defined in `decision-table.md`. Revision 2 change
log at the end; the coverage map is §Coverage.

Shorthand: `HR` hiring reality · `CAP` capability · `EV` evidence ·
`EL` eligibility · `POS` positioning · `G_WINDOW` hot ≤48h / open ≤7d /
aging ≤45d / stale >45d. "Forbidden" asserts the output does **not** contain it.

---

## Group A — Capability, requirements, evidence

### A1. Active job, strong candidate

**Signals.** `is_active=true`, `visible_enriched`, detected 6h ago, board crawled
2h ago, apply URL 200. Résumé parsed, 6.2 relevant years vs 5 required, same role
family, 82% of terms present, title mirrors posting. `visa_status='citizen'`. No
access routes.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `high`. **Gaps.** none.
**Forbidden.** Any probability; `STRENGTHEN_FIRST` for cosmetic polish; any
printed screen-rate multiplier.
**Why.** Clean baseline: every stage passes through to I.

### A2. Strong ATS screen, weak career fit

**Signals.** `atsScreenScore` 86, `careerFitScore` 46, 1.9 relevant years vs 5
required (ratio 0.38), candidate family `data_analyst`, job family
`data_engineer` (adjacent, compatible). Job 4 days old. Repair effort `hours`.
**Bands.** HR `LIVE` · CAP `STRETCH` · EV `ADEQUATE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `STRENGTHEN_FIRST` (`RE2`) — `open` window + `hours` effort passes
`repairFitsWindow`. **Confidence.** `medium`. **Gaps.** none.
**Forbidden.** `APPLY_NOW` justified by the 86 screen score; `SKIP` — only one
mismatch corroboration (severe years) exists, and `RE1` needs two.
**Why.** The case `buildCareerFit` exists to separate.

### A3. Strong capability, buried evidence

**Signals.** `careerFitScore` 78, 5.5 relevant vs 4 required.
`buildPositioningBrief().surface = ["Airflow","dbt","Snowflake"]`; structured
coverage 0.41 vs raw-text 0.79. Job 5 days old. Repair effort `minutes`.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `BURIED` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `TUNABLE`.
**Action.** `STRENGTHEN_FIRST` (`RF2`), `surface_buried_evidence`.
**Confidence.** `medium`. **Gaps.** none.
**Forbidden.** "You lack Airflow experience"; treating `BURIED` as `THIN`;
suggesting the candidate *add* skills they already have.
**Why.** `BURIED` and `THIN` prescribe opposite actions.

### A3a. Same, but hot window and hours of work *(new)*

**Signals.** As A3, but detected 5h ago (`hot`) and the repair requires bullet
rewrites, effort `hours`.
**Bands.** identical to A3.
**Action.** `APPLY_NOW` (`RI2`) with the surface-evidence repair deferred as
`actions[0]` and an explicit "we chose speed over polish" note.
**Confidence.** `medium`.
**Forbidden.** `STRENGTHEN_FIRST` — `repairFitsWindow` is false for
`hot` × `hours`.
**Why.** Suppression fixture for `RF2`; guards the miss-a-fresh-job failure mode.

### A4. Supported missing keywords

**Signals.** 12 terms: 6 `present`, 5 `missing_supported` (each with a
`hasIndirectEvidence` string, e.g. résumé says "K8s" for "Kubernetes"), 1
`missing_needs_confirmation`. Job 10 days old (`aging`). Repair ≤ 30 min.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `ADEQUATE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `TUNABLE`.
**Action.** `STRENGTHEN_FIRST` (`RG2`), `add_supported_keywords`.
**Confidence.** `medium`. **Gaps.** none.
**Forbidden.** Proposing the unsupported term as a one-click add; the phrasing
"add these to pass the ATS".
**Why.** Supported gaps are wording alignment; the unsupported term is mentioned
"only if true" with `requiresCandidateConfirmation = true`.

### A5. Unsupported missing requirements, corroborated mismatch

**Signals.** 10 terms: 3 `present`, 1 `missing_supported`, 6
`missing_needs_confirmation` (embedded systems, RTOS, CAN bus…) with
`absenceKind = NOT_FOUND_IN_READABLE_DATA`. `careerFitScore` 34, role family
incompatible, `relevantYearsRatio` 0.2.
`mismatchCorroborations = [role_family_incompatible, severe_years_shortfall,
career_fit_below_floor]` → count 3.
**Bands.** HR `LIVE` · CAP `MISMATCH` · EV `THIN` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `MISALIGNED`.
**Action.** `SKIP` (`RE1`). **Confidence.** `medium` (capped: our threshold, not
the employer's). **Gaps.** none.
**Forbidden.** `STRENGTHEN_FIRST`; `confidence: high`; **any corroboration entry
derived from keyword coverage** — the three corroborations must all come from
the closed capability list.
**Why.** `RE1` fires on capability evidence. The thin keyword coverage is a
*consequence*, not a cause. **Changed in r2:** revision 1 let evidence thinness
participate in the mismatch; it no longer can.

### A5a. Same résumé, thin evidence, no capability corroboration *(new)*

**Signals.** 10 terms: 3 `present`, **0** `missing_supported`, 7
`missing_needs_confirmation`; `surface` empty. `notFoundCount` (7) >
`presentCount` (3) → `THIN`, and with no supported gaps and nothing buried,
`G_EVIDENCE_REPAIRABLE` is **false**. But the candidate is in-lane: role family
compatible, `careerFitScore` 58, `relevantYearsRatio` 0.8 → corroboration
count 0.
**Bands.** HR `LIVE` · CAP `NEAR_MISS` · EV `THIN` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `MISALIGNED`.
**Action.** `RF3` evaluates and falls through (`G_EVIDENCE_REPAIRABLE` false);
`RG1` also falls through; `RG3` records the fall-through → **`APPLY_NOW` (`RI2`)**
with the unsupported terms listed as "only if true".
**Confidence.** `medium`. **Gaps.** none.
**Forbidden.** `SKIP` — thin evidence with no capability corroboration cannot
skip; `STRENGTHEN_FIRST` — the only "repair" would be fabrication.
**Why.** Correction 11's central case: evidence absence must not become
capability absence. Suppression fixture for `RE1`.

### A5c. Thin evidence, near-miss capability, repair available *(new)*

**Signals.** 12 terms: 3 `present`, 4 `missing_supported` (each with a
`hasIndirectEvidence` string), 5 `missing_needs_confirmation`. `presentRatio`
0.25 fails the `ADEQUATE` gate, and `notFoundCount` (5) exceeds `presentCount`
(3), so the band is `THIN`. The 4 supported gaps make
`G_EVIDENCE_REPAIRABLE` **true**. Candidate is
in-lane: family compatible, `careerFitScore` 55, `relevantYearsRatio` 0.7 →
`NEAR_MISS`. Job 12 days old, repair effort `minutes`.
**Bands.** HR `LIVE` · CAP `NEAR_MISS` · EV `THIN` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `TUNABLE`.
**Action.** `STRENGTHEN_FIRST` (`RF3`). **Confidence.** `medium`. **Gaps.** none.
**Forbidden.** `SKIP`; any action proposing the 2 `missing_needs_confirmation`
terms as edits.
**Why.** Positive fixture for `RF3`. The contrast with A5a is the only
difference that matters: there the gaps had no supporting context anywhere, so
there was nothing honest to repair; here four of them do.

### A5b. Misaligned positioning with no supported repair *(new)*

**Signals.** POS `MISALIGNED` (title mismatch, 30% coverage), but every gap is
`missing_needs_confirmation` and `surface` is empty →
`G_EVIDENCE_REPAIRABLE = false`. CAP `MEETS`, EV `ADEQUATE`.
**Action.** `RG1` does not fire; `RG3` records the fall-through →
**`APPLY_NOW` (`RI2`)**.
**Confidence.** `medium`.
**Forbidden.** `STRENGTHEN_FIRST` via `RG1`.
**Why.** Positive fixture for `RG3`; a positioning problem whose only fix is
fabrication is not a repair.

### A6. Required certification not mentioned in résumé, candidate status unknown *(new / replaces r1 A6)*

**Signals.** Description: "Active CPA license required."
`strength = MANDATORY_EXPLICIT`, `strengthProvenance = deterministic_pattern`,
excerpt captured. `resumes.skills.certifications` does not list a CPA and raw
text does not mention one → `presence = NOT_FOUND`. No candidate declaration.
`acquirability.source = unknown`. Everything else strong.
**Bands.** HR `LIVE` · CAP `NEAR_MISS` · EV `ADEQUATE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `STRENGTHEN_FIRST` (`RE3`) with a `confirm_requirement_status`
action: "This posting requires an active CPA. We could not find one in your
résumé — do you hold one?" `requiresCandidateConfirmation = true`.
**Confidence.** `medium`. **Gaps.** `cpa-status-unknown` (decision-relevant).
**Forbidden.** `SKIP` — `NOT_FOUND` can never set `supportsHardSkip`; the copy
"you do not have a CPA"; any acquisition-time estimate.
**Why.** **The headline correction.** Revision 1 returned `SKIP` here on a
boolean `candidateHas = false`. A résumé omitting a credential is not evidence
the candidate lacks it.

### A6a. Same posting, résumé unreadable *(new)*

**Signals.** As A6, but `parse_status = 'failed'` and `raw_text` null →
`presence = UNKNOWN`, `searchedIn = []`. Only two other dimensions are
`UNKNOWN`, so the sufficiency gate does not trip.
**Bands.** HR `LIVE` · CAP `UNKNOWN` · EV `UNREADABLE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `UNKNOWN`.
**Action.** `STRENGTHEN_FIRST` (`RF1`), `upload_or_reparse_resume`. `RE3` also
matched and is recorded in `suppressedRuleIds`… **no** — `RE3` is stage E and
precedes F, so `RE3` fires first with the confirmation action, and `RF1`'s
`upload_or_reparse_resume` is attached as `actions[1]`.
**Corrected expectation.** `selectedRuleId = "RE3"`; `actions` contains both
`confirm_requirement_status` and `upload_or_reparse_resume`.
**Confidence.** `low` (CAP and POS unknown → coverage 3 → −1 step).
**Forbidden.** `SKIP`; `presence = NOT_FOUND` (we could not look, so it is
`UNKNOWN`).
**Why.** Distinguishes "we looked and did not find" from "we could not look",
and pins stage-E-before-F ordering.

### A6b. Candidate explicitly confirms certification absent *(new)*

**Signals.** As A6, plus a candidate declaration: "I do not hold a CPA." →
`presence = ABSENT_CONFIRMED`. `strength = MANDATORY_EXPLICIT`,
`strengthProvenance = deterministic_pattern`. `acquirability.source = unknown`
(no catalog, no declared date) → `supportsHardSkip = true`.
**Bands.** HR `LIVE` · CAP `NEAR_MISS` · EV `ADEQUATE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `SKIP` (`RC3`). **Confidence.** `high` (cited posting excerpt +
candidate's own statement). **Gaps.** none.
**Forbidden.** `STRENGTHEN_FIRST`; framing the CPA as a keyword gap; any
acquisition-time estimate.
**Why.** The only shape in which a requirement-based `SKIP` is legitimate:
explicit posting language + the candidate's own confirmation.

### A7. Candidate declares an acquisition date *(revised)*

**Signals.** Posting requires an AWS Solutions Architect Associate certification
(`MANDATORY_EXPLICIT`, `deterministic_pattern` — `CERT_REQUIRED_RE` matches
"required … aws certified"). Candidate declares: "Not yet — exam booked for the
21st," → `presence = ABSENT_CONFIRMED`,
`acquirability = { source: "candidate_declared", estimatedDays: 21 }`. Job 20
days old (`aging`).
**Bands.** HR `LIVE` · CAP `NEAR_MISS` · EV `ADEQUATE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `STRENGTHEN_FIRST` (`RE4`), `acquire_missing_requirement`, effort
`days`. `supportsHardSkip` is **false** because a declared in-window acquisition
date is present, so `RC3` does not fire.
**Confidence.** `medium`. **Gaps.** none.
**Forbidden.** `SKIP`; HireOven originating the 21-day figure.
**Why.** **Changed in r2:** revision 1 asserted `acquirableWithinDays = 21` from
nowhere. The number must come from the candidate.

### A7a. Same posting, no declaration *(new)*

**Signals.** As A7 but the candidate says nothing; the cert is not on the
résumé. `presence = NOT_FOUND`, `acquirability.source = unknown`.
**Action.** `STRENGTHEN_FIRST` (`RE3`) with `confirm_requirement_status`.
**Confidence.** `medium`. **Gaps.** `aws-cert-status-unknown`.
**Forbidden.** `RE4` firing; `SKIP`; any estimate of how long the cert takes.
**Why.** Suppression fixture for `RE4`. There is no credential catalog in this
repository, so `credential_catalog` is unreachable and the estimate cannot exist.

### A8. Required years materially absent

**Signals.** "Minimum 10 years of platform engineering."
`relevantYearsRatio` 0.34 (3.4 relevant, 4.1 total). Role family compatible,
`careerFitScore` 51, 61% terms present. Job 12 days old.
Corroborations: `severe_years_shortfall` only → count 1.
**Bands.** HR `LIVE` · CAP `STRETCH` · EV `ADEQUATE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `TUNABLE`.
**Action.** `STRENGTHEN_FIRST` (`RE2`). **Confidence.** `medium`.
**Forbidden.** `SKIP` — one corroboration is not two.
**Why.** Suppression fixture for `RE1`.

### A9. Required years not stated

**Signals.** No years requirement; `extractMinYears` returns 0 →
`requiredYearsStated = false`. Candidate has 2.0 relevant years. Family
compatible, 70% terms present.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `high`.
**Gaps.** `years-requirement-unstated` (cosmetic).
**Forbidden.** Any shortfall finding; any `relevantYearsRatio` in the output
(it is null); `G_YEARS` being computed at all.
**Why.** `requiredYears = 0` means "not stated", not "zero required".

### A10. Adjacent-role career switch

**Signals.** 7 years mechanical engineering, 1.2 years self-directed data work
with two shipped projects. Target: data analyst. Families incompatible per
`classifyRoleFamily`, but `careerFitScore` 44, `atsScreenScore` 58, 5 of 9 terms
present. Corroborations: `role_family_incompatible` only → count 1.
**Bands.** HR `LIVE` · CAP `STRETCH` · EV `ADEQUATE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `TUNABLE`.
**Action.** `STRENGTHEN_FIRST` (`RE2`), `reframe_transferable_experience`.
**Confidence.** `medium`.
**Forbidden.** `SKIP` — one classifier disagreement is not a mismatch.
**Why.** `computeFastScore` relaxed its own role-family cap to 55 because the
classifier mis-fires on multidisciplinary roles. X-Ray inherits the caution.

### A11. Overqualified candidate

**Signals.** 14 years, director-level. Posting is a mid-level IC,
`seniorityGap = +3`. `careerFitScore` 81, 90% terms present. No stated maximum.
**Bands.** HR `LIVE` · CAP `EXCEEDS` · EV `STRONG` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`) with an `overqualification` risk (severity
`moderate`, basis `inference`). **Confidence.** `high`.
**Forbidden.** `SKIP`; claiming the employer will reject them; any compensation
inference.
**Why.** Overqualification is a risk to disclose, not a blocker.

### A12. LLM-only "requirement" *(new)*

**Signals.** A model extraction reports "requires 8 years of Kubernetes at
scale". No deterministic pattern matches — the description says only "deep
Kubernetes experience". `strength = INFERRED`,
`strengthProvenance = llm_only`. Candidate has 3 years.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `ADEQUATE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`), confidence capped `medium` by the `llm_only`
rule in the firing path.
**Forbidden.** `strength = MANDATORY_EXPLICIT`; `RC3` or `RE1` firing;
`supportsHardSkip = true`; `G_YEARS` computed from the model's "8 years".
**Why.** Correction 4: an LLM extraction alone cannot establish a mandatory
requirement.

---

## Group B — Eligibility as observation, authorization as timeline

All Group B fixtures assert that no output string contains "eligible",
"ineligible", "qualify" or "cannot work".

### B1. Location conflict

**Signals.** "This role is onsite in Metro City, 5 days per week."
`is_remote=false`, `is_hybrid=false`. Candidate 1,900 km away,
`willing_to_relocate=false` explicitly set.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `EXPLICIT_REQUIREMENT_CONFLICT` · POS `ALIGNED`.
**Action.** `SKIP` (`RC1`, via `otherConstraints` with a cited excerpt).
**Confidence.** `high`.
**Forbidden.** Framing this as a work-authorization matter; "you are not
eligible".
**Why.** Location conflicts live in `otherConstraints`, not
`postingRequirements`, so copy and severity differ.

### B2. Remote ambiguity

**Signals.** `location = "Remote — US"`; description says "hybrid, 3 days in
office". `inferWorkModel` → `isHybrid=true`, `isRemote=false`. Candidate is
`remote_only`.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `NEEDS_CLARIFICATION` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`) with `verify_posting`; confidence stepped to
`medium` by the contradiction penalty.
**Gaps.** `work-mode-conflict` (decision-relevant).
**Forbidden.** `SKIP` on an inferred conflict; asserting either mode as fact.
**Why.** Contradictions widen toward uncertainty, never toward the stricter read.

### B3. OPT authorized now, posting says nothing *(revised)*

**Signals.** `visa_status='opt'`, `opt_end_date` in 9 months →
`currentlyAuthorized = true`, `futureEmployerActionLikely = true`,
`futureActionType = h1b_petition`. Description long and readable, **no**
authorization language at all (`postingRequirements = []`). Employer: 180 LCAs
over 3 years, 40 in this role family, E-Verify `participates`.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `EMPLOYER_ACTION_MAY_BE_NEEDED` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `medium` (history is
prediction-basis).
**Gaps.** `role-specific-sponsorship-unknown` (decision-relevant).
**Forbidden.** `SKIP`; "this company will sponsor you";
`NO_EXPLICIT_CONFLICT_FOUND` as the band (future action *is* likely);
`opt_end_date` changing the action.
**Why.** History raises the band to `EMPLOYER_ACTION_MAY_BE_NEEDED`, never
further. The OPT clock is phrasing context only.

### B3a. OPT authorized now, posting bars only *current* sponsorship *(new)*

**Signals.** As B3, but the description says: "We are not able to provide visa
sponsorship for this position." → category `NO_CURRENT_SPONSORSHIP`,
`deterministicMatch = true`, excerpt captured. Candidate is currently authorized
with future action likely.
**Matrix cell.** `NO_CURRENT_SPONSORSHIP` × "authorized now, future action
likely" → **`no_conflict`**.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `EMPLOYER_ACTION_MAY_BE_NEEDED` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `medium`.
**Gaps.** `future-sponsorship-posture-unknown` (decision-relevant).
**Forbidden.** `SKIP`; `EXPLICIT_REQUIREMENT_CONFLICT`; any copy implying the
candidate cannot take the job.
**Why.** **The second headline correction.** Revision 1 would have skipped this.
The candidate can work today; the posting says nothing about renewal. The honest
output names the open question instead of closing it.

### B3b. Same posting, candidate timeline unknown *(new)*

**Signals.** As B3a, but the candidate never set `visa_status` or
`work_authorization`; only schema defaults exist →
`derivedFromDefaultsOnly = true`, every timeline field `unknown`.
**Matrix cell.** `NO_CURRENT_SPONSORSHIP` × "timeline unknown" →
`needs_clarification`, `candidateDataSufficient = false`.
`G_BLOCKING_CONFIRMATION` is true (category is not `AMBIGUOUS_GENERAL`, and the
clarification is due to insufficient candidate data).
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `NEEDS_CLARIFICATION` · POS `ALIGNED`.
**Action.** `INSUFFICIENT_DATA` (`RD2`) with
`confirm_authorization_timeline`, `isDecisionBlockingConfirmation = true`.
**Confidence.** `unknown`.
**Gaps.** `candidate-authorization-timeline-unknown` (decision-relevant).
**Forbidden.** `SKIP`; `APPLY_NOW`; **`STRENGTHEN_FIRST`** (correction 10 —
rewriting a résumé does not answer a work-authorization question); reading the
`false`/`true` defaults as an answer.
**Why.** The most dangerous case in the set. Knowing the answer flips between
`SKIP` and `APPLY_NOW`, so we stop and ask.

### B3c. OPT authorized now, posting bars future sponsorship *(new)*

**Signals.** `visa_status='opt'`, authorized for 9 more months. Description:
"Candidates who require sponsorship, now or in the future, will not be
considered for this role." → `NO_CURRENT_OR_FUTURE_SPONSORSHIP`,
`deterministicMatch = true`.
**Matrix cell.** × "authorized now, future action likely" → **`conflict_future`**.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `EXPLICIT_REQUIREMENT_CONFLICT` · POS `ALIGNED`.
**Action.** `SKIP` (`RC2`). **Confidence.** `high` (cited excerpt + declared
status). **Gaps.** none.
**Forbidden.** "You are not eligible"; describing this as a *current*
authorization problem — the copy must say the candidate can work now but the
posting rules out the renewal they will need; the employer's LCA history
flipping the band.
**Why.** Distinguishes `RC2` (future conflict) from `RC1` (current). The copy
difference is the whole point of the correction.

### B4. STEM OPT at an employer with unknown E-Verify *(revised)*

**Signals.** `visa_status='stem_opt'`, authorized 14 more months. Employer
E-Verify `unknown`. STEM-related role. No posting authorization language.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `ADEQUATE` · EL `EMPLOYER_ACTION_MAY_BE_NEEDED` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`) with a non-blocking
`confirm_authorization_timeline` action aimed at the employer's E-Verify
participation. **Confidence.** `medium`.
**Gaps.** `everify-unknown` (decision-relevant).
**Forbidden.** `SKIP`; "STEM OPT will not work here"; treating
`eVerify = null` as `false`; `RD2` firing (the candidate's data is known — it is
the *employer's* that is not, which is not decision-blocking here because no
posting requirement exists).
**Why.** `futureActionType = stem_opt_everify_participation` is the honest
framing.

### B4a. STEM OPT at a confirmed non-E-Verify employer *(new)*

**Signals.** As B4, but `EVerifySignal.status = 'not_found'` from an independent
source, and the employer has zero LCA history. Still no posting language.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `ADEQUATE` · EL `EMPLOYER_ACTION_MAY_BE_NEEDED` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`) with a prominent risk of kind
`authorization_language` (severity `high`, basis `inference`) explaining that
STEM OPT extension requires an E-Verify employer and this employer was not found
in E-Verify data. **Confidence.** `medium`.
**Gaps.** `everify-source-coverage` (cosmetic — "not found" is not "not
participating").
**Forbidden.** `SKIP`; `EXPLICIT_REQUIREMENT_CONFLICT` — the posting says
nothing, and employer attributes can never reach that band; the copy "you cannot
extend your STEM OPT here".
**Why.** Correction 7 and §5.5: an employer *attribute*, however material, is
not a posting requirement and cannot produce a conflict band or a skip.

### B5. Explicit no-current-sponsorship, candidate not currently authorized *(revised)*

**Signals.** "We are not able to sponsor or transfer visas for this position."
→ `NO_CURRENT_SPONSORSHIP`. Candidate `work_authorization='require_sponsorship'`
explicitly declared → `currentlyAuthorized = false`.
**Matrix cell.** × "not currently authorized" → `conflict_now`.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `EXPLICIT_REQUIREMENT_CONFLICT` · POS `ALIGNED`.
**Action.** `SKIP` (`RC1`). **Confidence.** `high`. **Gaps.** none.
**Forbidden.** LCA history flipping the band; "you are not eligible for this
job"; omitting the excerpt.
**Why.** **Changed in r2:** revision 1 used an H-1B holder here and skipped,
which was wrong — an H-1B holder is currently authorized and needs a *transfer*,
which "not able to sponsor **or transfer**" does bar, but only because the
excerpt says so. This fixture now uses the unambiguous case; B5a covers transfer.

### B5a. H-1B holder, posting bars transfer *(new)*

**Signals.** Same excerpt as B5 ("sponsor **or transfer**"). Candidate
`visa_status='h1b'` → `currentlyAuthorized = true`,
`futureEmployerActionLikely = true`, `futureActionType = visa_transfer`.
**Matrix.** The excerpt names transfer, so the category is
`NO_CURRENT_OR_FUTURE_SPONSORSHIP`; × "authorized now, future action likely" →
`conflict_future`.
**Bands.** EL `EXPLICIT_REQUIREMENT_CONFLICT`.
**Action.** `SKIP` (`RC2`). **Confidence.** `high`.
**Forbidden.** `RC1` — the conflict is about the transfer this employer would
have to file, not about the candidate's present authorization; copy implying the
candidate is not authorized today.
**Why.** An H-1B holder is authorized *for their current employer*. Changing
employers requires a petition, which this posting rules out. The distinction is
`RC1` vs `RC2`.

### B6. Same posting as B5, candidate is a citizen

**Signals.** As B5, `visa_status='citizen'`.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `high`.
**Forbidden.** Any mention of the sponsorship clause as a risk for this
candidate.
**Why.** Suppression fixture for `RC1`. B5/B6 differ only in the candidate.

### B7. Bare authorization boilerplate, complete profile *(revised)*

**Signals.** Description: "You must currently possess valid U.S. work
authorization." No "unrestricted", no visa list. Per §5.4 the category is
**`AMBIGUOUS_GENERAL`**, not `UNRESTRICTED_AUTHORIZATION_REQUIRED`.
Candidate `visa_status='opt'`, authorized 9 more months, future action likely.
**Matrix cell.** `AMBIGUOUS_GENERAL` × "authorized now, future action likely" →
`needs_clarification`, but `candidateDataSufficient = true`, and the category is
`AMBIGUOUS_GENERAL`, so `G_BLOCKING_CONFIRMATION` is **false**.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `NEEDS_CLARIFICATION` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`) with a prominent, non-blocking
`confirm_authorization_timeline` action; confidence capped `low`.
**Gaps.** `posting-authorization-language-ambiguous` (decision-relevant).
**Forbidden.** `SKIP`; `RD2` firing; `STRENGTHEN_FIRST`;
`UNRESTRICTED_AUTHORIZATION_REQUIRED` as the category.
**Why.** Corrects a live repository behavior: the `must ... possess ... work
authorization` pattern makes "unrestricted" optional, so this sentence — which
an OPT holder satisfies — currently flags as a blocker. Suppression fixture for
`RD2`.

### B7a. Same wording plus an explicit visa exclusion list *(new)*

**Signals.** "You must currently possess valid and unrestricted U.S. work
authorization. Individuals with temporary visas including F-1 (OPT, CPT, STEM),
H-1B, H-2 or TN will not be considered." → `namesVisaCategories` non-empty →
category `UNRESTRICTED_AUTHORIZATION_REQUIRED`. Candidate on OPT.
**Matrix cell.** × "authorized now, future action likely" → `conflict_now`.
**Action.** `SKIP` (`RC1`). **Confidence.** `high`.
**Forbidden.** `AMBIGUOUS_GENERAL`; `APPLY_NOW`.
**Why.** The named visa list is what upgrades the category. This is the exact
sentence asserted in `lib/jobs/metadata.authorization.test.ts`, so the two agree.

### B8. Citizenship requirement, green-card holder

**Signals.** "Applicants must be U.S. citizens." → `CITIZENSHIP_REQUIRED`.
Candidate `visa_status='green_card'` explicitly set.
**Matrix.** First column applies only to `currentAuthorizationType = citizen`,
so a green-card holder is `conflict_now`.
**Bands.** EL `EXPLICIT_REQUIREMENT_CONFLICT`.
**Action.** `SKIP` (`RC1`). **Confidence.** `high`.
**Forbidden.** Categorizing as `NO_CURRENT_SPONSORSHIP`; suggesting the
candidate "ask about sponsorship" — sponsorship is irrelevant to a citizenship
bar.
**Why.** `AUTH_REQUIRED_PATTERNS` merges citizenship with no-sponsorship, and
`createVisaIntelligenceFallback` labels every hit
`requires_unrestricted_work_authorization`. This asserts re-derivation.

### B9. Security clearance, no candidate clearance field

**Signals.** "Active TS/SCI with full-scope polygraph required."
`CLEARANCE_REQUIRED_PATTERNS` match. There is no candidate clearance field in
the schema and no declaration.
**Matrix.** `CLEARANCE_REQUIRED` × any state → `needs_clarification`.
`G_BLOCKING_CONFIRMATION` is **true** (category is not `AMBIGUOUS_GENERAL`, and
the clarification is due to missing candidate data).
**Bands.** EL `NEEDS_CLARIFICATION`.
**Action.** `INSUFFICIENT_DATA` (`RD2`) with a
`confirm_requirement_status` action asking whether the candidate holds an active
TS/SCI. **Confidence.** `unknown`.
**Forbidden.** `SKIP` inferred from `visa_status`; sponsorship framing;
suggesting the candidate "obtain a clearance" (it requires employer sponsorship
of the clearance and citizenship); merging into the citizenship subReason.
**Why.** **Changed in r2:** revision 1 skipped here on an inference from
immigration status. Clearance is not inferable from `visa_status`; it is a
question.

### B9a. Same posting, candidate declares an active clearance *(new)*

**Signals.** As B9, plus a declaration: "I hold an active TS/SCI."
**Matrix.** `CLEARANCE_REQUIRED` with a declared clearance → `no_conflict`.
**Bands.** EL `NO_EXPLICIT_CONFLICT_FOUND`.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `high`.
**Forbidden.** `RD2`; any residual clearance risk.
**Why.** Suppression fixture for `RD2`; shows the declaration channel closing a
gap.

### B10. Employer sponsorship history with no role-family filings

**Signals.** 90 LCAs total, `roleFamilyLcaCount = 0`. No posting language.
Candidate on OPT, future action likely.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `EMPLOYER_ACTION_MAY_BE_NEEDED` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`), confidence `medium`, with an
`authorization_language` risk (severity `moderate`, basis `prediction`, sample
90, window stated).
**Gaps.** `role-family-sponsorship-absent` (decision-relevant).
**Forbidden.** `SKIP`; `NO_EXPLICIT_CONFLICT_FOUND`; presenting the zero as
proof the role will not be sponsored.
**Why.** `calculateVisaFitScore` applies −14 here. Absence of filings for a
family is weak evidence, not a conflict.

### B11. Missing sponsorship data entirely

**Signals.** `companies.sponsors_h1b = false` (schema default),
`sponsorship_confidence = 0`, both H-1B counts 0, no LCA rows,
`immigration_profile_summary` null. Candidate on OPT. No posting language.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `EMPLOYER_ACTION_MAY_BE_NEEDED` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`), confidence `low`.
**Gaps.** `employer-sponsorship-unknown` with `whyNotDefaulted:
"companies.sponsors_h1b is boolean DEFAULT false; false with zero counts and
zero confidence is indistinguishable from never-populated."`
**Forbidden.** "This employer does not sponsor"; a negative Eligibility finding;
`calculateVisaFitScore`'s "not currently marked as an H-1B sponsor" warning
reaching the user; `employerHasSponsored = false`.
**Why.** The clearest unknown-becomes-negative trap in the codebase.

### B12. Non-US posting

**Signals.** Berlin role, English description, no US authorization language.
Candidate in the US.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `UNKNOWN` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`), confidence `low`.
**Gaps.** `jurisdiction-out-of-scope`.
**Forbidden.** `NO_EXPLICIT_CONFLICT_FOUND`; running H-1B/OPT/E-Verify logic;
any US immigration commentary.
**Why.** The categories are US-specific; out of scope must be `UNKNOWN`.

### B12b. Ambiguous language and an incomplete profile *(new)*

**Signals.** Description: "Applicants must be legally authorized to work in the
United States." → `AMBIGUOUS_GENERAL`. Candidate profile has
`is_international = true` explicitly set but no `visa_status` and no
`work_authorization` → `currentlyAuthorized = "unknown"`,
`derivedFromDefaultsOnly = false` (one field was set) but the timeline is still
insufficient.
**Matrix cell.** `AMBIGUOUS_GENERAL` × "timeline unknown" →
`needs_clarification`, `candidateDataSufficient = false`. But the category **is**
`AMBIGUOUS_GENERAL`, so `G_BLOCKING_CONFIRMATION` is **false** by its first
condition.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `ADEQUATE` · EL `NEEDS_CLARIFICATION` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`) with a prominent non-blocking
`confirm_authorization_timeline`; confidence `low`.
**Gaps.** `candidate-authorization-timeline-incomplete` (decision-relevant).
**Forbidden.** `RD2` (the ambiguity is in wording that bars nobody, so knowing
the answer would not flip the action); `SKIP`; `STRENGTHEN_FIRST`.
**Why.** Pins the exact boundary of `G_BLOCKING_CONFIRMATION`: compare with
B3b, where the category was specific and the same missing candidate data *was*
decision-blocking.

---

## Group C — Hiring reality and canonical resolution

### C1. Definitively closed

**Signals.** `is_active=false`, `closed_at` 3 days ago,
`publication_status='hidden_expired'`. Apply URL 404.
**Bands.** HR `CLOSED`.
**Action.** `SKIP` (`RB1`). **Confidence.** `high`.
**Forbidden.** `INSUFFICIENT_DATA` even with no résumé — B precedes D;
ghost-risk language.
**Why.** The only definitive closure path.

### C2. Dead probe on a live row (the 403 trap)

**Signals.** `is_active=true`, `visible_enriched`, 2 days old, board crawled 3h
ago. `probeApplyUrl` → `dead` because the ATS host answers `HEAD` with **403**.
**Bands.** HR `UNCERTAIN` · CAP `MEETS` · EV `STRONG` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI1`) with `verify_posting`; confidence capped `low`.
**Gaps.** `apply-url-unverified`.
**Forbidden.** `SKIP`; "this job is gone"; "dead link"; `applyUrlStatus` as
`basis: "fact"`.
**Why.** Suppression fixture for `RB1`.

### C3. Very old posting, still active

**Signals.** 120 days old, `is_active=true`, board crawled 6h ago, apply URL 200,
ghost band `high`. Candidate strong.
**Bands.** HR `UNCERTAIN` · CAP `MEETS` · EV `STRONG` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI1`), confidence `low`, with `verify_posting`.
`G_WINDOW = stale` blocks every `STRENGTHEN_FIRST`.
**Forbidden.** `SKIP` on age; `STRENGTHEN_FIRST`; asserting the role is a ghost.
**Why.** Age is soft. It degrades confidence and blocks investment.

### C4. Suspected repost — actually concurrent openings

**Signals.** `queryRepostCount` returns 6 (six other active similar-title rows at
the same company in 90 days). Ghost band `high` (+18). All six are distinct
requisitions with different `external_id`s and locations.
**Bands.** HR `UNCERTAIN` · CAP `MEETS` · EV `STRONG` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI1`), confidence `low`.
**Gaps.** `repost-history-unavailable`.
**Forbidden.** The string "reposted 6 times"; "repeated postings are a strong
ghost job indicator"; `basis: "fact"` on the count.
**Why.** The contract names it `concurrentSimilarOpenings` and sets
`repostHistoryUnavailable: true`.

### C5. Pre-epoch `last_seen_at` on a harvester row *(revised)*

**Signals.** `source_ats='greenhouse'`, `ingestionPath='harvester'`,
`last_seen_at` 47 days old and **below** `HARVESTER_LAST_SEEN_EPOCH_ISO`.
`is_active=true`, `companies.last_crawled_at` 4h ago.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `high`.
**Gaps.** none — the field is excluded, not missing.
**Forbidden.** "Not seen in 47 days"; any finding citing `last_seen_at`; the
ghost re-verified bonus; a `LIKELY_CLOSED` band.
**Why.** `persistJobsBulk` historically wrote only on content-hash change.
**Changed in r2:** the working-tree fix makes this forward-only, so the guard is
now an epoch comparison rather than a blanket exclusion.

### C5a. Post-epoch `last_seen_at`, genuinely stale *(new)*

**Signals.** Same row, but `last_seen_at` is **above** the epoch and 30 days old,
while `companies.last_crawled_at` is 2h ago — i.e. the board was crawled and this
job was not seen. `is_active` still true (deactivation lags).
**Bands.** HR `LIKELY_CLOSED` · others as computed.
**Action.** `APPLY_NOW` (`RI1`) with `verify_posting`, confidence `low`.
**Forbidden.** `SKIP` via `RB1` — `G_CLOSED` requires `is_active=false` plus a
closure marker; `CLOSED` as the band.
**Why.** Post-fix, a stale `last_seen_at` against a fresh board crawl *is*
meaningful — but it is still a soft signal, not definitive closure.

### C6. Stale board crawl

**Signals.** `is_active=true`, `visible_enriched`, `companies.last_crawled_at` 21
days ago against a 2-day freshness-tier cadence. Age 25 days.
**Bands.** HR `LIKELY_LIVE` (capped) · rest clean.
**Action.** `APPLY_NOW` (`RI2`), confidence stepped to `medium`.
**Gaps.** `board-check-stale`.
**Forbidden.** `LIKELY_CLOSED` or `UNCERTAIN` from a stale crawl.
**Why.** Not-checked is not evidence of closure. Staleness caps the positive
band and never pushes toward the negative.

### C7. Duplicate row, canonical is live *(revised)*

**Signals.** Requested row has `duplicate_of_id` → a live canonical with a direct
employer apply URL; the requested row is an aggregator copy with a redirect URL
and `publication_status='hidden_duplicate'`. The canonical, evaluated fully,
yields CAP `MEETS`, EV `STRONG`, EL `NO_EXPLICIT_CONFLICT_FOUND`, POS `ALIGNED`,
HR `LIVE`.
**Stage A.** `outcome = "resolved"`, `hops = 1`, `applyUrlDiffers = true`.
**Action.** `APPLY_NOW` (`RI2`) — **produced by the canonical's own full
evaluation**, not by a duplicate-redirect rule. `apply_to_canonical_posting`
attached as `actions[0]`. **Confidence.** `medium` (Stage-A cap for
`applyUrlDiffers`).
**Forbidden.** A rule id in the `RB*`/`RC*` range; **any `selectedStage` of
`A_canonical_resolution`** — Stage A never selects; `SKIP` because the requested
row is `hidden_duplicate`; scoring the duplicate's own apply URL or ghost score.
**Why.** **Changed in r2:** revision 1's `R1.2` returned `APPLY_NOW` directly
from a duplicate, bypassing every other stage. Now the canonical is evaluated in
full and its answer is the answer.

### C7a. Duplicate whose canonical has an eligibility conflict *(new)*

**Signals.** As C7, but the canonical's description contains "Applicants must be
U.S. citizens" and the candidate declared `visa_status='opt'`.
**Stage A.** `resolved`, `hops = 1`.
**Bands.** EL `EXPLICIT_REQUIREMENT_CONFLICT`, computed against the canonical.
**Action.** `SKIP` (`RC1`). **Confidence.** `high`.
**Forbidden.** `APPLY_NOW`; any suggestion to apply to the canonical; the
duplicate's own description being read (aggregator copies are frequently
truncated and may omit the clause).
**Why.** The decisive proof that duplicates cannot independently return
`APPLY_NOW`. If the canonical says skip, the answer is skip.

### C7b. Duplicate whose canonical has a capability mismatch *(new)*

**Signals.** As C7, but against the canonical the candidate is
`careerFitScore` 31, role family incompatible, `relevantYearsRatio` 0.18 →
three corroborations.
**Action.** `SKIP` (`RE1`). **Confidence.** `medium`.
**Forbidden.** `APPLY_NOW`; `apply_to_canonical_posting` as the headline action
(it may still appear, but a skip has no apply step, so it must be suppressed).
**Why.** Second duplicate-resolution proof, through a different stage.

### C7c. Duplicate with a dangling canonical pointer *(new)*

**Signals.** `duplicate_of_id` points at a row that no longer exists.
**Stage A.** `outcome = "unresolved_dangling"`, `evaluatedJobId = null`.
**Bands.** HR `UNKNOWN`; CAP/EV/POS computed against nothing → `UNKNOWN`;
EL `UNKNOWN`.
**Action.** `INSUFFICIENT_DATA` (`RD1`) — `G_SUFFICIENT` false via the Stage-A
condition. **Confidence.** `unknown`.
**Gaps.** `canonical-row-missing` (dimension_blocking).
**Forbidden.** Falling back to the duplicate row; `SKIP`; `APPLY_NOW`.
**Why.** A failed pointer lookup says nothing about the job.

### C8. Conflicting ghost and freshness signals

**Signals.** Detected 8h ago, but ghost band `high`: apply URL `dead` (403),
`concurrentSimilarOpenings = 7`, and a `possible` hiring freeze.
**Bands.** HR `UNCERTAIN` · rest clean.
**Action.** `APPLY_NOW` (`RI1`), confidence `low`, both signal sets listed.
**Gaps.** `apply-url-unverified`, `repost-history-unavailable`.
**Forbidden.** Averaging into a middling score; `SKIP`; presenting the freeze as
confirmed.
**Why.** Contradictions are listed, not resolved numerically. Also asserts the
freeze is counted once and flagged `alreadyCountedInGhostRisk`.

### C9. Weak company health, well evidenced

**Signals.** funding 3, layoff 3 (two rounds in 12 months, latest 40 days ago),
glassdoor 8, headcount 4 → total 18, `critical`. All four sub-scores observed →
`healthUsable=true`. Computed 6 days ago.
**Bands.** HR `UNCERTAIN` · rest clean.
**Action.** `APPLY_NOW` (`RI1`), confidence `low`, with an `employer_capacity`
risk (severity `high`, each sub-signal dated).
**Forbidden.** `SKIP` on company health; advising against working there;
treating the total as a probability.
**Why.** Health is a soft signal about the employer, not about this application.

### C10. Missing company health (healthy-by-default trap)

**Signals.** No funding, layoff, Glassdoor or headcount data. `computeHealthScore`
returns 10+25+12+12 = **59 → `healthy`**. `observedSubScoreCount = 0`.
**Bands.** HR `LIVE` · rest clean.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `high`.
**Gaps.** `company-health-unknown` (cosmetic).
**Forbidden.** Rendering "Healthy" or a green badge; any positive stability
finding; `healthUsable=true`.
**Why.** The mirror of B11 — here missing data produces a false *positive*.

### C11. No description

**Signals.** `description` null, `raw_data.structured_job` absent, `skills`
empty, `normalized_title` null. Row active and recent. Résumé strong.
**Bands.** HR `LIVE` · CAP `UNKNOWN` · EV `UNREADABLE` · EL `UNKNOWN` · POS `UNKNOWN`.
**Action.** `INSUFFICIENT_DATA` (`RD1`). **Confidence.** `unknown`.
**Gaps.** `job-description-absent` (dimension_blocking ×3).
**Forbidden.** `APPLY_NOW` because the job is fresh; `SKIP`; any capability or
eligibility claim; `EV: THIN` — with no denominator the band is `UNREADABLE`.
**Why.** Three dimensions blocked by one missing input.

---

## Group D — Résumé and evidence edge cases

### D1. Missing résumé, no posting requirements *(revised)*

**Signals.** No résumé row. Job live, description readable, **no** authorization
language, candidate declared `visa_status='citizen'`.
**Bands.** HR `LIVE` · CAP `UNKNOWN` · EV `UNREADABLE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `UNKNOWN`.
**Action.** `INSUFFICIENT_DATA` (`RD1`), action `upload_or_reparse_resume`.
**Confidence.** `unknown`.
**Gaps.** `resume-absent` (dimension_blocking ×3).
**Forbidden.** `SKIP`; `APPLY_NOW`; `STRENGTHEN_FIRST` via `RF1` — three
dimensions are `UNKNOWN`, so D catches it before F; a red/negative treatment.
**Why.** Canonical Stage-D case. **Changed in r2:** the rule id moved from
`R0.1` to `RD1` and the stage now sits after B and C.

### D2. Missing résumé, but an explicit conflict applies *(revised)*

**Signals.** As D1, but the posting says "Candidates who require sponsorship,
now or in the future, will not be considered", and the candidate declared
`work_authorization='require_sponsorship'` → `currentlyAuthorized = false`.
**Matrix.** `NO_CURRENT_OR_FUTURE_SPONSORSHIP` × "not currently authorized" →
`conflict_now`.
**Bands.** EL `EXPLICIT_REQUIREMENT_CONFLICT`; CAP/EV/POS `UNKNOWN`.
**Action.** `SKIP` (`RC1`). **Confidence.** `high`.
**Gaps.** `resume-absent` (still reported).
**Forbidden.** `INSUFFICIENT_DATA` — stage C precedes D, and the conflict is
decisive without a résumé.
**Why.** **Changed in r2:** revision 1 handled this as a special-case exception
to a Stage-0 gate. Now it is plain precedence: C before D. Suppression fixture
for `RD1`.

### D2a. Missing résumé, conflict present, candidate data unknown *(new)*

**Signals.** As D2, but the candidate never declared anything
(`derivedFromDefaultsOnly = true`).
**Matrix.** × "timeline unknown" → `needs_clarification`,
`candidateDataSufficient = false`; `G_BLOCKING_CONFIRMATION` true.
**Action.** `INSUFFICIENT_DATA` (`RD2`) with **two** unblock actions:
`confirm_authorization_timeline` (`isDecisionBlockingConfirmation = true`) and
`upload_or_reparse_resume`. **Confidence.** `unknown`.
**Forbidden.** `SKIP` (we do not know the candidate needs sponsorship);
`APPLY_NOW`; `STRENGTHEN_FIRST`.
**Why.** Completes the D1/D2 triangle: résumé missing + conflict present +
candidate unknown. Correction 10's decision-blocking branch.

### D3. Unparsed résumé

**Signals.** `parse_status='failed'`, `parse_error='encrypted pdf'`, `raw_text`
null, no structured fields. Job fine, no posting requirements.
**Bands.** HR `LIVE` · CAP `UNKNOWN` · EV `UNREADABLE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `UNKNOWN`.
**Action.** `INSUFFICIENT_DATA` (`RD1`) — three `UNKNOWN` dimensions trip the
gate before `RF1` is reached. **Confidence.** `unknown`.
**Gaps.** `resume-unparsed` (dimension_blocking).
**Forbidden.** Scoring capability from `top_skills` alone; `STRENGTHEN_FIRST`
via `RF1` (assert the **rule id** — the action would be plausible).
**Why.** Guards the D/F boundary.

### D4. Partially parsed résumé

**Signals.** `parse_status='complete'` but `work_experience` empty, `raw_text`
long, `datedRoleCount = 0`, skills parsed.
**Bands.** HR `LIVE` · CAP `UNKNOWN` · EV `UNREADABLE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `TUNABLE`.
**Action.** `STRENGTHEN_FIRST` (`RF1`), `upload_or_reparse_resume` — only two
dimensions `UNKNOWN`, so D does not trip. **Confidence.** `low`.
**Gaps.** `work-history-unparsed` (dimension_blocking for CAP).
**Forbidden.** `INSUFFICIENT_DATA`; any `relevantYears` value; `EV: THIN`.
**Why.** Asserts the ≥3-unknown threshold is a real boundary. Positive fixture
for `RF1`, suppression fixture for `RD1`.

### D5. Potential unsupported résumé claim

**Signals.** Summary says "10+ years of Kubernetes in production"; dated history
spans 4.1 years; `raw_text` mentions Kubernetes twice, both in a 2-year role.
Job asks for 5 years Kubernetes.
**Bands.** HR `LIVE` · CAP `NEAR_MISS` · EV `ADEQUATE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `TUNABLE`.
**Action.** `STRENGTHEN_FIRST` (`RG2`), with a `consistencyNotes` entry phrased
as a question. **Confidence.** `medium`.
**Forbidden.** "False claim", "exaggerated", "misrepresented", "inflated"; any
fraud framing; sharing the note outward; `SKIP`; **`presence = CONTRADICTED`**
— this is a free-text internal inconsistency, which is `free_text_internal`
reliability and is never decision-grade.
**Why.** Copy must read: "your dated history spans about 4 years, but the
summary says 10+ — which do you want to lead with?"

### D5a. Declaration contradicts a structured field *(new)*

**Signals.** Posting requires a PMP (`MANDATORY_EXPLICIT`).
`resumes.skills.certifications` lists "PMP", but the candidate declares "I do not
hold a PMP" → `presence = CONTRADICTED`,
`contradictionReliability = declaration_vs_structured_field` →
`supportsHardSkip = true`.
**Bands.** EL `NO_EXPLICIT_CONFLICT_FOUND` · CAP `NEAR_MISS`.
**Action.** `SKIP` (`RC3`). **Confidence.** `medium` (a contradiction is
inherently less clean than a plain `ABSENT_CONFIRMED`; the §13.1 contradiction
penalty applies). **Gaps.** `resume-lists-credential-candidate-denies`.
**Forbidden.** `confidence: high`; any accusation of résumé falsification; a
`SKIP` from `declaration_vs_free_text` reliability (see D5b).
**Why.** The only `CONTRADICTED` shape that is decision-grade, and it still
carries a confidence penalty. The user-facing copy flags that the résumé should
probably be corrected.

### D5b. Declaration contradicts free text only *(new)*

**Signals.** As D5a, but "PMP" appears only in a raw-text project description,
not in `skills.certifications` → `contradictionReliability =
declaration_vs_free_text` → `supportsHardSkip = false`.
**Action.** `STRENGTHEN_FIRST` (`RE3`) with `confirm_requirement_status`.
**Confidence.** `medium`.
**Forbidden.** `SKIP` via `RC3`.
**Why.** Suppression fixture for `RC3`; pins the reliability threshold.

### D6. Résumé already tailored for this job

**Signals.** `tailored_for_job_id` matches, `content_modified=true`, 100% of
terms `present`, `atsScreenScore` 94.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `STRONG` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `ALIGNED`.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `high`.
**Forbidden.** Any further `STRENGTHEN_FIRST`; keyword recommendations on an
already-tailored document.
**Why.** Guards the tailor→re-recommend loop (circular scoring).

### D7. Sparse job-skill extraction

**Signals.** The JD yields 2 terms, both soft skills, pruned by
`pruneSkillNoiseFromAnalysis` → `N_terms = 0`. `computeFastScore`'s
`low_signal_skills_lt5` gate caps `overall` at 65. Résumé is a strong domain
match on prose.
**Bands.** HR `LIVE` · CAP `MEETS` (from years + role family) · EV `UNREADABLE`
· EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `UNKNOWN`.
**Action.** `APPLY_NOW` (`RI2`), confidence `medium`.
**Gaps.** `job-requirements-unextractable`.
**Forbidden.** `EV: STRONG` from 2/2 soft-skill coverage; a 100% match claim; a
positioning recommendation built on two soft skills; `presentRatio` being
non-null.
**Why.** A tiny denominator makes ratios meaningless.

### D7a. Thin evidence, strong capability *(new)*

**Signals.** 10 terms: 3 `present`, 7 `missing_needs_confirmation`
(`NOT_FOUND_IN_READABLE_DATA`). But the candidate has 8 relevant years vs 5
required, role family identical, `careerFitScore` 84. `surface` empty, so not
`BURIED`. `G_EVIDENCE_REPAIRABLE` false.
**Bands.** HR `LIVE` · CAP `MEETS` · EV `THIN` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `MISALIGNED`.
**Action.** `RF4` explicitly falls through (CAP is `MEETS`); `RG1` does not fire
(`G_EVIDENCE_REPAIRABLE` false); `RG3` records the fall-through →
**`APPLY_NOW` (`RI2`)** with the missing terms shown "only if true".
**Confidence.** `medium`.
**Forbidden.** `SKIP`; `STRENGTHEN_FIRST`; any statement that the candidate
lacks the seven terms.
**Why.** Positive fixture for `RF4`. The résumé is written for a different
audience, but the capability is established by capability evidence.

### D8. Résumé targeted at a different field

**Signals.** `target_field='data_engineering'`; the job is product management.
`fieldAffinity` 0.1. Against *this* job the candidate is `STRETCH`,
`relevantYearsRatio` 0.6 (moderate, not severe). Supported edits exist
(`G_EVIDENCE_REPAIRABLE` true). Job 15 days old.
**Bands.** HR `LIVE` · CAP `STRETCH` · EV `ADEQUATE` · EL `NO_EXPLICIT_CONFLICT_FOUND` · POS `MISALIGNED`.
**Action.** `RE2` does not fire (`G_YEARS = moderate`, not severe) →
`STRENGTHEN_FIRST` (`RG1`) with a `choose_different_target` action noting the
declared target. **Confidence.** `medium`.
**Forbidden.** `target_field` altering the Capability or Eligibility bands.
**Why.** Positive fixture for `RG1`; guards target-field isolation.

---

## Group E — Access routes and system states

### E1. Referral advantage data, no named route *(revised)*

**Signals.** CAP `EXCEEDS`, EV `STRONG`, POS `ALIGNED`, HR `LIVE`,
EL `NO_EXPLICIT_CONFLICT_FOUND`. `rejection_patterns`: 34 submissions,
referral 41%, cold 12% (Δ 29pp), computed 20 days ago →
`ReferralAdvantageAdvisory.displayable = true`.
`getJobNetworkingContacts` returns **nothing** → `accessRoutes = []`,
`G_ROUTE = false`.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `high`.
**Gaps.** none.
**Forbidden.** **`FIND_ACCESS`**; "get a referral" as the headline; the advisory
appearing as the final action.
**Why.** **The headline correction for Group E.** Revision 1 returned
`FIND_ACCESS` here on statistics alone. A rate is not a person. The advisory may
be *displayed* with its sample and may add a `consider_referral_generally`
action at low priority, but it cannot gate. Suppression fixture for `RH1`.

### E1a. Same, plus a named 1st-degree connection *(new)*

**Signals.** As E1, plus `linkedin_connections` has a degree-1 row: name
"Priya S.", title "Staff Engineer", `profile_url` non-null,
`referral_tier='hot'`, `mutual_count = 12`, `scraped_at` 9 days ago →
a valid `ActionableAccessRoute` (`direct_connection`, channel
`linkedin_profile`, relationship "1st-degree connection, 12 mutuals", next step
"Ask Priya about the team before you apply", fresh).
**Action.** `FIND_ACCESS` (`RH1`). **Confidence.** `medium` (prediction-basis
penalty from the advisory used to phrase it).
**Forbidden.** Generic networking copy; omitting the name or the channel; a
route with `sourceFactIds: []`; a probability figure.
**Why.** The only legitimate `FIND_ACCESS` shape. The statistics now do what
they should: rank and phrase a route that stands on its own.

### E2. Competitive company, no route, sub-threshold data

**Signals.** As E1 but `total_submissions = 4` (< `MIN_SUBMISSIONS = 10`) →
advisory dropped entirely. Company is large and well known. No contacts.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `high`.
**Gaps.** `rejection-sample-insufficient` (cosmetic).
**Forbidden.** `FIND_ACCESS`; "this is a competitive employer, get a referral";
showing the 4-sample rates at low confidence.
**Why.** Prestige is not a route; sub-threshold predictions are dropped, not
downgraded.

### E3. Previous interview, no stored contact *(revised)*

**Signals.** CAP `MEETS`, EV `ADEQUATE`, POS `TUNABLE`
(`estimatedMinutes = 25`), HR `LIVE`. The user has a `job_applications` row at
the same `company_id` that reached `phone_screen` 4 months ago.
`job_applications` stores no recruiter name, email or channel.
`getJobNetworkingContacts` returns nothing → `accessRoutes = []`.
**Action.** `STRENGTHEN_FIRST` (`RG2`). **Confidence.** `medium`.
**Forbidden.** **`FIND_ACCESS`**; "reach back out to your previous recruiter" —
we do not have one; any cross-stage override of G by H.
**Why.** **Changed in r2 twice.** Revision 1 (a) treated a prior application as
a `warm_pipeline` route, and (b) let `FIND_ACCESS` override `STRENGTHEN_FIRST`
via a prose tie-break. Both are gone: a prior application without a stored
person is not a route, and G precedes H unconditionally. Suppression fixture
for `RH1`.

### E3a. Named prior recruiter with recent contact *(new)*

**Signals.** As E3, but `employer_cohort_requests` has a row for this
`company_id` with `contact_email` and `created_at` 26 days ago →
`employer_recruiter_contact` route, channel `email`, relationship "posted a
hiring request for this company 26 days ago", next step "Email them referencing
the open role", fresh (26 < 240-day horizon).
POS is `ALIGNED` here (no positioning fix pending), so G does not fire.
**Action.** `FIND_ACCESS` (`RH1`). **Confidence.** `medium`.
**Forbidden.** Presenting the parsed-from-email display name as verified
identity — `parseEmailName` derives it from the local part, so the copy must be
hedged; asserting the recruiter will reply.
**Why.** Positive fixture for the `employer_recruiter_contact` route type, and
the deliberate contrast with E3: a stored channel is what makes it a route.

### E3b. Cohort alumni with no reachable channel *(new)*

**Signals.** `cohort_members` returns two alumni at the target company, but the
viewer is not a cohort member, so `job-contact-finder` anonymizes the names
("Jane D.") and sets `linkedinUrl: null` → **no channel** → not a route.
`accessRoutes = []`. Everything else clean.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `high`.
**Forbidden.** `FIND_ACCESS`; presenting "Jane D." as a contact; an
`ActionableAccessRoute` with a null channel.
**Why.** Suppression fixture for `RH1` on the channel condition specifically.
An advisory ("join the cohort to reach company alumni") is permitted.

### E4. Referral data with a small effect

**Signals.** 40 submissions, referral 22%, cold 17% (Δ 5pp). No contacts.
**Action.** `APPLY_NOW` (`RI2`). **Confidence.** `high`.
**Forbidden.** `FIND_ACCESS`.
**Why.** In r2 this is doubly suppressed — no route, *and* a small effect. It
remains as a regression guard in case route gating is ever weakened.

### E5. Sparse rejection data with a dramatic apparent effect

**Signals.** 6 submissions, referral 1.00 (1 of 1), cold 0.00 (0 of 5). A valid
`direct_connection` route also exists.
**Action.** `FIND_ACCESS` (`RH1`) — **on the route**, with the advisory
**dropped** (`displayable = false`, below `MIN_SUBMISSIONS`).
**Confidence.** `medium`.
**Forbidden.** Rendering "100% of referred candidates got a screen"; any rate
from a 6-row sample; the advisory phrasing the route.
**Why.** The most tempting false signal in the rejection dataset. The route is
what justifies the action; the statistic contributes nothing.

### E6. Referral advantage data past the staleness horizon *(reworded)*

**Signals.** `rejection_patterns`: **60 submissions** (well above
`MIN_SUBMISSIONS = 10`), Δ 25pp, but `last_computed_at` is **240 days old**,
past the 180-day horizon → `displayable = false`. A valid
`second_degree_connection` route exists, `scraped_at` 12 days ago.
**Action.** `FIND_ACCESS` (`RH1`) on the route. **Confidence.** `medium`.
**Gaps.** `rejection-pattern-stale`.
**Forbidden.** Displaying the 240-day-old rates; using them to phrase the route.
**Why.** **Reworded in r2.** Revision 1's E6 said "the pattern is dropped for
staleness" while E1 simultaneously described a sample-size confidence cap that
did not apply at n=34 — two different mechanisms described as one. The sample
size here (60) is deliberately large so the fixture isolates *staleness* as the
sole reason for dropping, with no sample-size ambiguity.

### E7. Everything unknown

**Signals.** No résumé; the job row has a title and an apply URL and nothing
else — no description, no company row, no health, no ghost score, no crawl
signal.
**Bands.** all five `UNKNOWN`.
**Action.** `INSUFFICIENT_DATA` (`RD1`). **Confidence.** `unknown`.
**Gaps.** five dimension_blocking gaps.
**Forbidden.** Any other action; any band with a negative treatment; a headline
implying the job is bad.
**Why.** The floor case.

### E8. Legacy-crawler row deactivated without `closed_at`

**Signals.** `ingestionPath='legacy_crawler'`, `is_active=false`,
`closed_at` null, `publication_status='published'` (never updated).
`closedAtReliable = false`.
**Bands.** HR `LIKELY_CLOSED` · rest computed.
**Action.** **Not** `SKIP` — `G_CLOSED` is false (no `closed_at`, no `hidden_*`).
Falls to `RI1` → `APPLY_NOW` with `verify_posting`, confidence `low`.
**Gaps.** `closure-timestamp-unreliable`.
**Forbidden.** `SKIP` via `RB1`; asserting the role closed on a date.
**Why.** `lib/crawler/persist.ts` deactivates without reliably setting
`closed_at` or `publication_status`. The fixture most likely to fail a naive
implementation. *If a migration later backfills those fields, this fixture's
expected action becomes `SKIP` via `RB1`.*

### E9. Determinism

**Signals.** Take A2's inputs. Serialize, shuffle every object key order,
re-run with the same explicit `now`.
**Expected.** Identical `finalAction`, `selectedRuleId`, `confidence`,
`suppressedRuleIds` (same order), `inputsHash`.
**Forbidden.** Any dependence on map iteration order, `Date.now()`, or
`Math.random()`.

### E10. Double-count suppression — hiring freeze

**Signals.** A company with a `confirmed` WARN-Act freeze. Run twice: (a) the
freeze visible to both ghost risk and employer capacity; (b) visible only to
ghost risk.
**Expected.** `hiringReality.band` identical.
`employerCapacity.hiringFreeze.alreadyCountedInGhostRisk = true` in (a).
**Why.** `calculateGhostJobRisk` and `computeLayoffScore` read the same tables.

### E11. Double-count suppression — sponsorship in the match score

**Signals.** Identical job and résumé, two candidates differing only in
`needs_sponsorship`. `computeFastScore` yields `overall_score` 78 vs 60
(−18 delta), identical `careerFit.careerFitScore`.
**Expected.** `capability.band` identical. Only `eligibility` differs.
**Forbidden.** A capability band tracking `overall_score`; a
sponsorship-needing candidate receiving a worse *capability* verdict for the
same résumé.
**Why.** The fairness-critical double-count.

### E12. Duplicate equivalence *(new)*

**Signals.** Job X (canonical) and job Y (`duplicate_of_id = X`). Run X directly
and run Y.
**Expected.** Identical bands, `finalAction`, `confidence` and
`selectedRuleId`. Y differs only in `canonical` (`outcome='resolved'`,
`hops=1`), `requestedJobId`, `summary.resolvedFromDuplicate = true`, and the
extra `apply_to_canonical_posting` action when the URLs differ.
**Forbidden.** Any divergence in bands or rule id; `selectedStage =
"A_canonical_resolution"`.
**Why.** The structural proof of correction 2.

### E13. Timeline pressure does not move the decision *(new)*

**Signals.** Two runs identical except `opt_end_date`: 26 months out vs 4 months
out. Posting has no authorization language.
**Expected.** Identical `finalAction`, `selectedRuleId`, and every band. Only
`futureActionHorizonDays`, action ordering, and copy differ.
**Forbidden.** A band or action that changes with the clock.
**Why.** Urgency is real and must not be laundered into a recommendation.

---

## Coverage map

| Required scenario | Fixtures |
| --- | --- |
| Active job and strong candidate | A1 |
| Strong ATS match but weak career fit | A2 |
| Strong capability but buried evidence | A3, A3a |
| Supported missing keywords | A4 |
| Unsupported missing requirements | A5, A5a, A5b |
| Mandatory certification absent | A6, A6a, A6b, A7, A7a |
| Required years materially absent | A8, A9 |
| Adjacent-role / career-switch | A10, D8 |
| Overqualified | A11 |
| Location conflict | B1 |
| Remote ambiguity | B2 |
| OPT / STEM OPT | B3, B3a, B3b, B3c, B4, B4a |
| Explicit no-sponsorship language | B5, B5a, B6, B7, B7a, D2, D2a |
| Citizenship requirement | B8 |
| Security-clearance requirement | B9, B9a |
| Employer history, no role-specific promise | B3, B10 |
| Missing sponsorship data | B11 |
| Dead apply URL | C1, C2 |
| Very old posting | C3 |
| Suspected repost | C4 |
| Missing job history | C11 |
| Weak company health | C9 |
| Sparse rejection samples | E2, E5, E6 |
| Strong application with an actionable route | E1a, E3a |
| Competitive company without a route | E1, E2, E3, E3b, E4 |
| Conflicting ghost / freshness signals | C8 |
| Missing résumé | D1, D2, D2a |
| Unparsed résumé | D3, D4, A6a |
| Potential unsupported résumé claim | D5, D5a, D5b |
| Insufficient overall data | E7, C11, C7c |

### Correction-14 additions

| Requested fixture | Id |
| --- | --- |
| Required certification not mentioned, candidate status unknown | **A6** |
| Candidate explicitly confirms certification absent | **A6b** |
| OPT authorized now, future sponsorship prohibited | **B3c** |
| OPT authorized now, posting says only no *current* sponsorship | **B3a** |
| STEM OPT candidate at a non-E-Verify employer | **B4a** |
| Duplicate whose canonical has an eligibility conflict | **C7a** |
| Duplicate whose canonical has a capability mismatch | **C7b** |
| Referral advantage data but no named route | **E1** |
| Previous interview but no stored recruiter contact | **E3** |
| Named prior recruiter with recent contact | **E3a** |
| Ambiguous authorization language and incomplete candidate profile | **B12b** |

### Other r2 additions

A3a, A5a, A5b, A6a, A7a, A12, B5a, B7a, B9a, B3b, C5a, C7c, D2a, D5a, D5b,
D7a, E1a, E3b, E12, E13.

### Fixtures materially changed from r1

| Id | Change |
| --- | --- |
| A5 | Mismatch corroborations must all come from the capability list; evidence thinness no longer participates |
| A6 | Was `SKIP` on a boolean absence → now `STRENGTHEN_FIRST` + confirmation on `NOT_FOUND` |
| A7 | The 21-day figure now comes from the candidate, not from HireOven |
| B3 | Band is `EMPLOYER_ACTION_MAY_BE_NEEDED`; OPT no longer implies current sponsorship need |
| B4 | Reframed around `futureActionType`; `RD2` explicitly does not fire |
| B5 | Candidate changed to an unambiguous not-currently-authorized case; H-1B transfer split into B5a |
| B7 | Was `APPLY_NOW` with an ambiguous blocker → now `AMBIGUOUS_GENERAL`, and the blocking case moved to B3b |
| B9 | Was `SKIP` inferred from immigration status → now `INSUFFICIENT_DATA` + confirmation |
| C5 | Blanket `last_seen_at` exclusion → epoch comparison, post-fix |
| C7 | Was a duplicate-redirect rule returning `APPLY_NOW` → now full canonical evaluation |
| D1/D2 | Rule ids and stage moved (`R0.1` → `RD1`; the Stage-0 exception is now plain C-before-D precedence) |
| E1 | Was `FIND_ACCESS` on statistics → now `APPLY_NOW`; the route case is E1a |
| E3 | Was `FIND_ACCESS` via `warm_pipeline` and a cross-stage override → now `STRENGTHEN_FIRST` |
| E6 | Sample size raised to 60 so staleness is the sole isolated reason |

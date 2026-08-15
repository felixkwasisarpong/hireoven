import { validAccessRoutes } from "./access-routes"
import { hasDecisiveConflict, hasRequiredEmployerActionRefusal, worstConflict } from "./authorization-conflict"
import { capConfidence, confidenceFromCoverage, minConfidence } from "./confidence"
import { isDefinitivelyClosed } from "./hiring-reality"
import { hasAcquirableAbsentRequirement, hasUnconfirmedMandatoryRequirement } from "./requirements"
import { isStructuralCorroboration, mismatchIsCorroborated } from "./capability"
import type { AssessabilityVerdict } from "./assessability"
import type {
  ApplicationXRay,
  CapabilityAssessment,
  EvidenceStrengthAssessment,
  HiringRealityAssessment,
  RecommendedAction,
  RecommendedActionEffort,
  RejectionRisk,
  XRayConfidence,
  XRayDecisionStage,
  XRayDecisionTrace,
  XRayFinalAction,
} from "./types"

export type XRayDecisionContext = Pick<
  ApplicationXRay,
  | "canonical"
  | "hiringReality"
  | "capability"
  | "evidence"
  | "eligibility"
  | "positioning"
  | "accessRoutes"
  | "dataGaps"
> & {
  computedAt: string
  /** Stage-B0 posting assessability. Computed before sufficiency, because
   *  "no conflict found" means nothing when there was nothing to search. */
  assessability?: AssessabilityVerdict
}

export type XRayDecision = {
  finalAction: XRayFinalAction
  confidence: XRayConfidence
  headline: string
  trace: XRayDecisionTrace
  actions: RecommendedAction[]
  rejectionRisks: RejectionRisk[]
}

type RuleId =
  | "RB1"
  | "RC1"
  | "RC2"
  | "RC3"
  | "RC4"
  | "RD0"
  | "RD1"
  | "RD2"
  | "RE1"
  | "RE2"
  | "RE3"
  | "RE4"
  | "RF1"
  | "RF2"
  | "RF3"
  | "RF4"
  | "RG1"
  | "RG2"
  | "RG3"
  | "RH1"
  | "RI1"
  | "RI2"

type Rule = {
  id: RuleId
  stage: XRayDecisionStage
  action: XRayFinalAction | "FALL_THROUGH"
  condition: boolean
  confidence: XRayConfidence
  /**
   * Every value this rule's condition reads, recorded so the decision is
   * replayable from the trace alone. An empty object is a bug: it means the
   * trace cannot explain why the rule fired, which defeats the point of
   * having one.
   */
  inputs: Record<string, string | number | boolean | null>
}

const STAGE_ORDER: XRayDecisionStage[] = [
  "A_canonical_resolution",
  "B_definitive_closure",
  "C_explicit_requirement_conflict",
  "D_sufficiency",
  "E_capability",
  "F_evidence",
  "G_positioning",
  "H_actionable_access",
  "I_apply",
]

export function decideApplicationXRay(context: XRayDecisionContext): XRayDecision {
  const routes = validAccessRoutes(context.accessRoutes)
  const window = windowFromHiringReality(context.hiringReality)
  const capabilityRepairEffort = effortFromMinutes(context.positioning.repairEstimate.estimatedMinutes, "hours")
  const positioningRepairEffort = effortFromMinutes(context.positioning.repairEstimate.estimatedMinutes, "minutes")
  const repairable = evidenceRepairable(context.evidence, context.positioning)
  const assessabilityBlocks = context.assessability?.blocksDecision === true
  // An unassessable posting cannot be judged, so sufficiency is moot.
  const sufficient = !assessabilityBlocks && isSufficient(context)
  const blockingConfirmation = hasBlockingConfirmation(context)
  const conflict = worstConflict(context.eligibility.conflicts)
  const conflictDecisive = hasDecisiveConflict(context.eligibility.conflicts)
  const requiredActionRefused = hasRequiredEmployerActionRefusal(context.eligibility.employerActionFeasibility)
  const hardReqAbsent = context.capability.requirements.some((requirement) => requirement.supportsHardSkip)
  const reqUnconfirmed = hasUnconfirmedMandatoryRequirement(context.capability.requirements)
  const acquirableAbsent = hasAcquirableAbsentRequirement(context.capability.requirements)
  const years = yearsGate(context.capability)
  // Two corroborations, at least one structural. A low career-fit score may
  // corroborate a mismatch but may not establish one on its own.
  const mismatchCorroborated = mismatchIsCorroborated(context.capability.mismatchCorroborations)
  const structuralCorroborations = context.capability.mismatchCorroborations.filter(isStructuralCorroboration)
  const routePresent = routes.length > 0

  const rules: Rule[] = [
    {
      id: "RB1",
      stage: "B_definitive_closure",
      action: "SKIP",
      condition: isDefinitivelyClosed(context.hiringReality.availability),
      confidence: "high",
      inputs: { isActive: context.hiringReality.availability.isActive, closedAt: context.hiringReality.availability.closedAt, publicationStatus: context.hiringReality.availability.publicationStatus, closedAtReliable: context.hiringReality.availability.closedAtReliable },
    },
    {
      id: "RC1",
      stage: "C_explicit_requirement_conflict",
      action: "SKIP",
      condition: conflictDecisive && conflict === "conflict_now",
      confidence: context.eligibility.confidence,
      inputs: { conflictDecisive, conflict, eligibilityBand: context.eligibility.band, canWork: context.eligibility.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction },
    },
    {
      id: "RC2",
      stage: "C_explicit_requirement_conflict",
      action: "SKIP",
      condition: conflictDecisive && conflict === "conflict_future",
      confidence: context.eligibility.confidence,
      inputs: { conflictDecisive, conflict, eligibilityBand: context.eligibility.band, canWork: context.eligibility.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction },
    },
    {
      id: "RC3",
      stage: "C_explicit_requirement_conflict",
      action: "SKIP",
      condition: hardReqAbsent,
      confidence: hardRequirementConfidence(context.capability),
      inputs: { hardReqAbsent, requirementCount: context.capability.requirements.length, hardSkipCount: context.capability.requirements.filter((r) => r.supportsHardSkip).length },
    },
    {
      id: "RC4",
      stage: "C_explicit_requirement_conflict",
      action: "SKIP",
      condition: requiredActionRefused,
      confidence: capConfidence(context.eligibility.confidence, "medium"),
      inputs: { requiredActionRefused, canWork: context.eligibility.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction },
    },
    {
      id: "RD0",
      stage: "D_sufficiency",
      action: "INSUFFICIENT_DATA",
      confidence: "unknown",
      condition: assessabilityBlocks,
      inputs: {
        assessability: context.assessability?.state ?? "UNKNOWN",
        ...(context.assessability?.inputs ?? {}),
      },
    },
    {
      id: "RD1",
      stage: "D_sufficiency",
      action: "INSUFFICIENT_DATA",
      condition: !sufficient,
      confidence: "unknown",
      inputs: { sufficient, capabilityBand: context.capability.band, evidenceBand: context.evidence.band, positioningBand: context.positioning.band, eligibilityBand: context.eligibility.band, hiringRealityBand: context.hiringReality.band },
    },
    {
      id: "RD2",
      stage: "D_sufficiency",
      action: "INSUFFICIENT_DATA",
      condition: sufficient && blockingConfirmation,
      confidence: "unknown",
      inputs: { sufficient, blockingConfirmation },
    },
    {
      id: "RE1",
      stage: "E_capability",
      action: "SKIP",
      condition: mismatchCorroborated,
      confidence: "medium",
      inputs: {
        mismatchCorroborated,
        corroborationCount: context.capability.mismatchCorroborationCount,
        corroborations: context.capability.mismatchCorroborations.join(","),
        structuralCorroborations: structuralCorroborations.join(","),
        structuralCount: structuralCorroborations.length,
        capabilityBand: context.capability.band,
      },
    },
    {
      id: "RE2",
      stage: "E_capability",
      action: repairFitsWindow(window, capabilityRepairEffort) ? "STRENGTHEN_FIRST" : "FALL_THROUGH",
      condition: context.capability.band === "STRETCH" && years === "severe",
      confidence: "medium",
      inputs: { capabilityBand: context.capability.band, years },
    },
    {
      id: "RE3",
      stage: "E_capability",
      action: "STRENGTHEN_FIRST",
      condition: reqUnconfirmed && sufficient,
      confidence: "medium",
      inputs: { reqUnconfirmed, sufficient },
    },
    {
      id: "RE4",
      stage: "E_capability",
      action: "STRENGTHEN_FIRST",
      condition: acquirableAbsent,
      confidence: "medium",
      inputs: { acquirableAbsent },
    },
    {
      id: "RF1",
      stage: "F_evidence",
      action: "STRENGTHEN_FIRST",
      condition: context.evidence.band === "UNREADABLE" && context.evidence.legibility.blocksAssessment,
      confidence: context.evidence.confidence,
      inputs: { evidenceBand: context.evidence.band, blocksAssessment: context.evidence.legibility.blocksAssessment, parseStatus: context.evidence.legibility.parseStatus },
    },
    {
      id: "RF2",
      stage: "F_evidence",
      action: repairFitsWindow(window, positioningRepairEffort) ? "STRENGTHEN_FIRST" : "FALL_THROUGH",
      condition: context.evidence.band === "BURIED",
      confidence: "medium",
      inputs: { evidenceBand: context.evidence.band, buriedCount: context.evidence.buriedEvidence.length },
    },
    {
      id: "RF3",
      stage: "F_evidence",
      action: repairFitsWindow(window, positioningRepairEffort) && repairable ? "STRENGTHEN_FIRST" : "FALL_THROUGH",
      condition:
        context.evidence.band === "THIN" &&
        (context.capability.band === "NEAR_MISS" || context.capability.band === "STRETCH"),
      confidence: "medium",
      inputs: { evidenceBand: context.evidence.band, capabilityBand: context.capability.band, repairable },
    },
    {
      id: "RF4",
      stage: "F_evidence",
      action: "FALL_THROUGH",
      condition:
        context.evidence.band === "THIN" &&
        (context.capability.band === "MEETS" || context.capability.band === "EXCEEDS"),
      confidence: "medium",
      inputs: { evidenceBand: context.evidence.band, capabilityBand: context.capability.band },
    },
    {
      id: "RG1",
      stage: "G_positioning",
      action: repairFitsWindow(window, positioningRepairEffort) && repairable ? "STRENGTHEN_FIRST" : "FALL_THROUGH",
      condition: context.positioning.band === "MISALIGNED" && repairable,
      confidence: "medium",
      inputs: { positioningBand: context.positioning.band, repairable },
    },
    {
      id: "RG2",
      stage: "G_positioning",
      action: "STRENGTHEN_FIRST",
      condition:
        context.positioning.band === "TUNABLE" &&
        (context.positioning.repairEstimate.estimatedMinutes ?? 31) <= 30 &&
        repairFitsWindow(window, "minutes"),
      confidence: "medium",
      inputs: { positioningBand: context.positioning.band, estimatedMinutes: context.positioning.repairEstimate.estimatedMinutes, repairFitsWindow: repairable },
    },
    {
      id: "RG3",
      stage: "G_positioning",
      action: "FALL_THROUGH",
      condition: context.positioning.band === "MISALIGNED" && !repairable,
      confidence: "medium",
      inputs: { positioningBand: context.positioning.band, repairable },
    },
    {
      id: "RH1",
      stage: "H_actionable_access",
      action: "FIND_ACCESS",
      condition:
        routePresent &&
        ["MEETS", "EXCEEDS", "NEAR_MISS"].includes(context.capability.band) &&
        ["STRONG", "ADEQUATE", "BURIED"].includes(context.evidence.band),
      confidence: routes[0]?.confidence ?? "unknown",
      inputs: { routeCount: routes.length, capabilityBand: context.capability.band, evidenceBand: context.evidence.band },
    },
    {
      id: "RI1",
      stage: "I_apply",
      action: "APPLY_NOW",
      condition: context.hiringReality.band === "UNCERTAIN" || context.hiringReality.band === "LIKELY_CLOSED",
      confidence: "low",
      inputs: { hiringRealityBand: context.hiringReality.band },
    },
    {
      id: "RI2",
      stage: "I_apply",
      action: "APPLY_NOW",
      condition: true,
      confidence: "high",
      inputs: { hiringRealityBand: context.hiringReality.band, capabilityBand: context.capability.band, evidenceBand: context.evidence.band, eligibilityBand: context.eligibility.band, positioningBand: context.positioning.band },
    },
  ]

  const selected = rules.find((rule) => rule.condition && rule.action !== "FALL_THROUGH") ?? rules[rules.length - 1]
  const selectedAction = selected.action === "FALL_THROUGH" ? "APPLY_NOW" : selected.action
  const suppressedRuleIds = rules
    .filter((rule) => rule !== selected && rule.condition && rule.action !== "FALL_THROUGH")
    .map((rule) => rule.id)

  const actions = buildActions({
    context,
    finalAction: selectedAction,
    ruleId: selected.id,
    routes,
    window,
    repairable,
  })
  const rejectionRisks = buildRisks(context, actions)
  const confidence = finalConfidence({
    rule: selected,
    finalAction: selectedAction,
    context,
    actions,
  })

  return {
    finalAction: selectedAction,
    confidence,
    headline: headlineForAction(selectedAction),
    trace: {
      engineVersion: "application-xray-core-2026-08-13.1",
      evaluated: buildTraceRows(rules, selected),
      selectedStage: selected.stage,
      selectedRuleId: selected.id,
      suppressedRuleIds,
      tieBreak: null,
    },
    actions,
    rejectionRisks,
  }
}

export function windowFromHiringReality(hiringReality: HiringRealityAssessment): "hot" | "open" | "aging" | "stale" | "unknown" {
  const ageDays = hiringReality.availability.ageDays
  if (typeof ageDays !== "number" || !Number.isFinite(ageDays)) return "unknown"
  if (ageDays <= 2) return "hot"
  if (ageDays <= 7) return "open"
  if (ageDays <= 45) return "aging"
  return "stale"
}

export function repairFitsWindow(
  window: ReturnType<typeof windowFromHiringReality>,
  effort: RecommendedActionEffort,
): boolean {
  if (window === "aging") return true
  if (window === "open" || window === "unknown") return effort === "minutes" || effort === "hours"
  if (window === "hot") return effort === "minutes"
  return false
}

function isSufficient(context: XRayDecisionContext): boolean {
  if (context.canonical.outcome.startsWith("unresolved_")) return false
  if (context.capability.careerFitScore === null && context.capability.band === "UNKNOWN") return false
  if (
    context.evidence.legibility.parseStatus !== "complete" &&
    !context.evidence.legibility.hasRawText
  ) {
    return false
  }
  if (!context.eligibility.descriptionWasReadable) return false
  const unknownCount = [
    context.hiringReality.band === "UNKNOWN",
    context.capability.band === "UNKNOWN",
    context.evidence.band === "UNREADABLE",
    context.eligibility.band === "UNKNOWN",
    context.positioning.band === "UNKNOWN",
  ].filter(Boolean).length
  if (unknownCount >= 3) return false
  const blockingDimensions = new Set(
    context.dataGaps
      .concat(context.hiringReality.dataGaps, context.capability.dataGaps, context.evidence.dataGaps, context.eligibility.dataGaps, context.positioning.dataGaps)
      .filter((gap) => gap.severity === "dimension_blocking" && gap.dimension !== "overall")
      .map((gap) => gap.dimension),
  )
  return blockingDimensions.size < 2
}

function hasBlockingConfirmation(context: XRayDecisionContext): boolean {
  const authBlocking = context.eligibility.conflicts.some(
    (conflict) =>
      conflict.outcome === "needs_clarification" &&
      conflict.candidateDataSufficient === false &&
      conflict.requirement.category !== "AMBIGUOUS_GENERAL" &&
      conflict.requirement.category !== "SPONSORSHIP_OFFERED",
  )
  const clearanceBlocking = context.eligibility.postingRequirements.some(
    (requirement) =>
      requirement.category === "CLEARANCE_REQUIRED" &&
      !context.eligibility.candidate.readFrom.includes("candidate_declaration"),
  )
  return authBlocking || clearanceBlocking
}

function yearsGate(capability: CapabilityAssessment): "none" | "moderate" | "severe" {
  if (!capability.requiredYearsStated || capability.relevantYearsRatio === null) return "none"
  if (capability.relevantYearsRatio < 0.5) return "severe"
  if (capability.relevantYearsRatio < 0.8) return "moderate"
  return "none"
}

function evidenceRepairable(
  evidence: EvidenceStrengthAssessment,
  positioning: XRayDecisionContext["positioning"],
): boolean {
  return (
    evidence.band === "BURIED" ||
    (positioning.repairEstimate.supportedEditCount > 0 && !positioning.repairEstimate.requiresNewEvidence)
  )
}

function effortFromMinutes(minutes: number | null, fallback: RecommendedActionEffort): RecommendedActionEffort {
  if (minutes === null || !Number.isFinite(minutes)) return fallback
  if (minutes <= 30) return "minutes"
  if (minutes <= 240) return "hours"
  if (minutes <= 1_440) return "days"
  return "weeks_or_more"
}

function hardRequirementConfidence(capability: CapabilityAssessment): XRayConfidence {
  const hard = capability.requirements.filter((requirement) => requirement.supportsHardSkip)
  if (hard.some((requirement) => requirement.presence === "CONTRADICTED")) return "medium"
  return minConfidence(hard.map((requirement) => requirement.confidence).concat("high"))
}

function finalConfidence(input: {
  rule: Rule
  finalAction: XRayFinalAction
  context: XRayDecisionContext
  actions: RecommendedAction[]
}): XRayConfidence {
  let value = input.rule.confidence
  if (input.rule.id === "RI2") {
    value = minConfidence([
      input.context.hiringReality.confidence,
      input.context.capability.confidence,
      input.context.evidence.confidence,
      input.context.eligibility.confidence,
      input.context.positioning.confidence,
    ])
  }
  const knownCount = [
    input.context.hiringReality.band !== "UNKNOWN",
    input.context.capability.band !== "UNKNOWN",
    input.context.evidence.band !== "UNREADABLE",
    input.context.eligibility.band !== "UNKNOWN",
    input.context.positioning.band !== "UNKNOWN",
  ].filter(Boolean).length
  value = confidenceFromCoverage(value, knownCount)
  if (input.context.canonical.outcome === "resolved" && input.context.canonical.applyUrlDiffers) {
    value = capConfidence(value, "medium")
  }
  if (input.rule.id === "RE1" || input.rule.id === "RC4") value = capConfidence(value, "medium")
  if (input.rule.id === "RI1") value = "low"
  if (
    input.actions.some(
      (action) =>
        !action.isDecisionBlockingConfirmation &&
        (action.kind === "confirm_authorization_timeline" ||
          action.kind === "confirm_future_sponsorship_policy" ||
          action.kind === "confirm_stem_opt_requirement"),
    )
  ) {
    value = capConfidence(value, "low")
  }
  return value
}

function buildTraceRows(rules: Rule[], selected: Rule): XRayDecisionTrace["evaluated"] {
  const rows: XRayDecisionTrace["evaluated"] = [{
    stage: "A_canonical_resolution",
    firedRuleId: null,
    outcome: "passed_through",
    inputs: {},
  }]
  for (const stage of STAGE_ORDER.filter((stage) => stage !== "A_canonical_resolution")) {
    const stageRules = rules.filter((rule) => rule.stage === stage && rule.condition)
    const winner = selected.stage === stage ? selected : null
    const fallThrough = stageRules.find((rule) => rule.action === "FALL_THROUGH") ?? null
    const attributed = winner ?? fallThrough
    rows.push({
      stage,
      firedRuleId: attributed?.id ?? null,
      outcome: winner ? "selected_action" : "passed_through",
      // Carry the values the attributed rule actually read. For a stage that
      // merely passed through, record the inputs of every rule that was
      // evaluated there, so the trace explains the non-firing too.
      inputs: attributed
        ? { ...attributed.inputs }
        : rules
            .filter((rule) => rule.stage === stage)
            .reduce<Record<string, string | number | boolean | null>>(
              (acc, rule) => Object.assign(acc, rule.inputs),
              {},
            ),
    })
    if (winner) break
  }
  return rows
}

function buildActions(input: {
  context: XRayDecisionContext
  finalAction: XRayFinalAction
  ruleId: RuleId
  routes: ReturnType<typeof validAccessRoutes>
  window: ReturnType<typeof windowFromHiringReality>
  repairable: boolean
}): RecommendedAction[] {
  const actions: RecommendedAction[] = []
  const add = (action: RecommendedAction) => {
    if (!actions.some((existing) => existing.id === action.id)) actions.push(action)
  }

  if (
    input.context.canonical.outcome === "resolved" &&
    input.context.canonical.applyUrlDiffers &&
    input.finalAction !== "SKIP"
  ) {
    add(action("apply-to-canonical", "apply_to_canonical_posting", "Use employer posting", "Use the canonical employer posting link for this application.", ["hiringReality"], "minutes", false))
  }

  if (input.ruleId === "RI1") {
    add(action("verify-posting", "verify_posting", "Verify posting", "Open the employer posting directly before relying on this listing.", ["hiringReality"], "minutes", false))
  }
  if (input.ruleId === "RD0") {
    // The blocker is the posting, not the candidate. Sending them to complete a
    // profile here would be both useless and misdirected — nothing they do to
    // their own data makes an unreadable listing readable.
    const state = input.context.assessability?.state ?? "UNKNOWN"
    add(action(
      "verify-posting",
      "verify_posting",
      state === "CORRUPT_TIMING_DATA" ? "Check this posting is still open" : "Open the employer posting",
      input.context.assessability?.explanation ??
        "We could not read enough of this listing to assess it. Open the employer posting directly.",
      ["hiringReality"],
      "minutes",
      false,
      true,
    ))
  }
  if (input.ruleId === "RE2") {
    add(action("reframe-experience", "reframe_transferable_experience", "Reframe experience", "Foreground relevant experience before investing heavily in this role.", ["capability", "positioning"], "hours", false))
  }
  if (input.ruleId === "RE3") {
    add(action("confirm-requirement", "confirm_requirement_status", "Confirm requirement", "Answer the posting requirement question before deciding how to proceed.", ["capability", "evidence"], "minutes", true, true))
  }
  if (input.ruleId === "RE4") {
    add(action("acquire-requirement", "acquire_missing_requirement", "Finish declared credential", "Use the candidate-declared credential timeline before applying.", ["capability"], "days", true))
  }
  if (input.ruleId === "RF1") {
    add(action("upload-resume", "upload_or_reparse_resume", "Upload readable resume", "Provide a readable resume so X-Ray can assess the document.", ["evidence"], "minutes", true, input.finalAction === "INSUFFICIENT_DATA"))
  }
  if (input.ruleId === "RF2") {
    add(action("surface-evidence", "surface_buried_evidence", "Surface buried evidence", "Move relevant evidence into visible resume sections.", ["evidence", "positioning"], "minutes", false))
  }
  if (input.ruleId === "RF3" || input.ruleId === "RG2") {
    add(action("add-supported-keywords", "add_supported_keywords", "Add supported wording", "Use wording already supported by the resume.", ["positioning", "evidence"], "minutes", false))
  }
  if (input.ruleId === "RG1") {
    add(action("choose-target", "choose_different_target", "Choose a better target", "Align the resume target with this role before applying.", ["positioning"], "hours", false))
  }
  if (input.ruleId === "RH1" && input.routes[0]) {
    const route = input.routes[0]
    add({
      ...action("contact-route", "contact_named_route", "Reach out first", route.nextStep, ["positioning"], "minutes", false),
      routeId: route.id,
      sourceFactIds: route.sourceFactIds,
    })
  }
  if (input.context.eligibility.employerActionFeasibility.some((item) => item.actionType === "STEM_OPT_EVERIFY_PARTICIPATION" && item.status !== "AVAILABLE")) {
    add(action("confirm-everify", "confirm_everify_participation", "Confirm E-Verify", "Ask whether the employer can support the required E-Verify step.", ["eligibility"], "minutes", true, false))
  }
  if (
    input.context.eligibility.employerActionFeasibility.some(
      (item) => item.status === "REFUSED_CONFIRMED" && item.candidateRequiresAction === "unknown",
    )
  ) {
    add(action("confirm-stem-opt-need", "confirm_stem_opt_requirement", "Confirm STEM OPT need", "Confirm whether this employer action is required for this job.", ["eligibility"], "minutes", true, false))
    add(action("confirm-employer-action-policy", "confirm_future_sponsorship_policy", "Confirm employer action policy", "Ask whether the employer would perform the required future action for this role.", ["eligibility"], "minutes", true, false))
  }
  if (
    input.context.eligibility.band === "NEEDS_CLARIFICATION" &&
    input.context.eligibility.postingRequirements.some((requirement) => requirement.category === "SPONSORSHIP_SCOPE_AMBIGUOUS")
  ) {
    add(action("confirm-future-sponsorship", "confirm_future_sponsorship_policy", "Confirm future sponsorship", "Ask whether the sponsorship statement applies to future employer actions.", ["eligibility"], "minutes", true, false))
  }
  if (input.context.eligibility.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction === "UNKNOWN") {
    add(action("confirm-auth-timeline", "confirm_authorization_timeline", "Confirm work timeline", "Complete the target-employer work authorization timeline.", ["eligibility"], "minutes", true, input.finalAction === "INSUFFICIENT_DATA"))
  }
  if (input.context.capability.requirements.some((requirement) => requirement.strength === "MANDATORY_EXPLICIT" && requirement.presence === "UNKNOWN")) {
    add(action("confirm-requirement-status", "confirm_requirement_status", "Confirm requirement", "Answer the posting requirement question before deciding how to proceed.", ["capability"], "minutes", true, input.finalAction === "INSUFFICIENT_DATA"))
  }
  if (input.finalAction === "SKIP") {
    add(action("choose-different-target", "choose_different_target", "Choose another target", "Use this signal to focus on roles without this blocker.", ["capability"], "minutes", false))
  }
  if (input.finalAction === "INSUFFICIENT_DATA" && actions.length === 0) {
    add(action("complete-inputs", "complete_profile", "Complete missing inputs", "Provide the missing data before using X-Ray for this job.", ["eligibility"], "minutes", true, true))
  }
  if (input.finalAction === "APPLY_NOW" && !input.repairable && (input.context.evidence.band === "THIN" || input.context.positioning.band === "MISALIGNED")) {
    add(action("only-if-true", "confirm_requirement_status", "Review missing terms", "Only add missing terms when the resume already supports them.", ["evidence", "positioning"], "minutes", true, false))
  }

  return actions
}

function action(
  id: string,
  kind: RecommendedAction["kind"],
  label: string,
  rationale: string,
  addresses: RecommendedAction["addresses"],
  effort: RecommendedActionEffort,
  requiresCandidateConfirmation: boolean,
  isDecisionBlockingConfirmation = false,
): RecommendedAction {
  return {
    id,
    kind,
    label,
    rationale,
    addresses,
    addressesRiskIds: [],
    effort,
    doableNow: true,
    requiresCandidateConfirmation,
    isDecisionBlockingConfirmation,
    sourceFactIds: [],
    target: null,
  }
}

function buildRisks(context: XRayDecisionContext, actions: RecommendedAction[]): RejectionRisk[] {
  const risks: RejectionRisk[] = []
  const add = (risk: RejectionRisk) => risks.push(risk)
  if (context.capability.band === "STRETCH" || context.capability.band === "MISMATCH") {
    add(risk("risk-years", "years_shortfall", "high", "Capability evidence is below the role baseline.", "capability", actions[0]?.id ?? null))
  }
  if (context.eligibility.band === "EXPLICIT_REQUIREMENT_CONFLICT") {
    add(risk("risk-auth", "authorization_language", "critical", "The posting or employer statement conflicts with supplied candidate facts.", "eligibility", actions[0]?.id ?? null))
  }
  if (context.hiringReality.band === "UNCERTAIN" || context.hiringReality.band === "LIKELY_CLOSED") {
    add(risk("risk-posting", "posting_may_be_closed", "high", "Soft posting signals should be checked directly.", "hiringReality", actions[0]?.id ?? null))
  }
  if (context.evidence.band === "UNREADABLE") {
    add(risk("risk-legibility", "resume_legibility", "high", "The resume could not be read completely.", "evidence", actions[0]?.id ?? null))
  }
  return risks.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.id.localeCompare(b.id))
}

function risk(
  id: string,
  kind: RejectionRisk["kind"],
  severity: RejectionRisk["severity"],
  statement: string,
  dimension: RejectionRisk["dimension"],
  addressableByActionId: string | null,
): RejectionRisk {
  return {
    id,
    kind,
    severity,
    likelihoodBasis: "inference",
    statement,
    dimension,
    sourceFactIds: [],
    confidence: severity === "critical" ? "medium" : "low",
    addressableByActionId,
  }
}

function severityRank(severity: RejectionRisk["severity"]): number {
  switch (severity) {
    case "critical":
      return 4
    case "high":
      return 3
    case "moderate":
      return 2
    case "low":
      return 1
  }
}

function headlineForAction(action: XRayFinalAction): string {
  switch (action) {
    case "APPLY_NOW":
      return "Apply now"
    case "STRENGTHEN_FIRST":
      return "Strengthen first"
    case "FIND_ACCESS":
      return "Reach out first"
    case "SKIP":
      return "Skip this one"
    case "INSUFFICIENT_DATA":
      return "Not enough to judge"
  }
}

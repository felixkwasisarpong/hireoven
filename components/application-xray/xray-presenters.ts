import type {
  AccessRouteChannel,
  ActionableAccessRoute,
  ApplicationXRay,
  RecommendedAction,
  RejectionRisk,
  XRayBasis,
  XRayConfidence,
  XRayDimensionKey,
  XRayFinalAction,
  XRaySourceFact,
} from "../../lib/application-xray/types"

export type XRayTone = "positive" | "attention" | "critical" | "neutral" | "info"

export type PresentedFinalAction = {
  label: string
  headline: string
  description: string
  tone: XRayTone
}

export type PresentedDimension = {
  key: XRayDimensionKey
  title: string
  question: string
  bandLabel: string
  explanation: string
  tone: XRayTone
  confidenceLabel: string
  confidenceTone: XRayTone
  hasDataGaps: boolean
  stale: boolean
}

export type PresentedActionLink =
  | { type: "link"; label: string; href: string; external: boolean }
  | { type: "instruction"; label: string; text: string }

export const DIMENSION_ORDER: XRayDimensionKey[] = [
  "hiringReality",
  "capability",
  "evidence",
  "eligibility",
  "positioning",
]

export const XRAY_STATIC_PRESENTATION_STRINGS = [
  "Application X-Ray",
  "Hiring Reality",
  "Capability",
  "Evidence Strength",
  "Posting & Authorization",
  "Positioning",
  "Does the posting look active enough to spend time on?",
  "Does your background line up with the role baseline?",
  "Does the resume show support for the important claims?",
  "Does this posting conflict with what you told us?",
  "Is the resume framed for this job and ATS context?",
  "Apply now",
  "Strengthen first",
  "Reach out first",
  "Skip this one",
  "Complete your X-Ray",
  "The available signals do not show a reason to wait.",
  "A fixable issue should be handled before this application.",
  "A reachable contact route may improve positioning before applying.",
  "A blocking issue is strong enough to focus elsewhere.",
  "X-Ray needs more input before it can call this role.",
  "You may be authorized to work now, but this posting does not clarify whether the employer supports future immigration action. Confirm the policy before relying on this opportunity long term.",
  "Stored E-Verify data did not find this employer; that is not a confirmed refusal.",
  "E-Verify participation is not known from stored data.",
  "This is an observational job-search signal, not legal advice.",
  "Sign in to view Application X-Ray.",
  "X-Ray is not available for this job or resume.",
  "X-Ray could not load right now.",
  "Try again",
  "Refresh analysis",
  "Evidence and gaps",
  "Recommended actions",
  "Rejection risks",
]

const FINAL_ACTIONS: Record<XRayFinalAction, PresentedFinalAction> = {
  APPLY_NOW: {
    label: "Apply now",
    headline: "The strongest signals support applying.",
    description: "The available signals do not show a reason to wait.",
    tone: "positive",
  },
  STRENGTHEN_FIRST: {
    label: "Strengthen first",
    headline: "Fix the application before submitting.",
    description: "A fixable issue should be handled before this application.",
    tone: "attention",
  },
  FIND_ACCESS: {
    label: "Reach out first",
    headline: "Use a reachable route before applying.",
    description: "A reachable contact route may improve positioning before applying.",
    tone: "info",
  },
  SKIP: {
    label: "Skip this one",
    headline: "Focus on a cleaner target.",
    description: "A blocking issue is strong enough to focus elsewhere.",
    tone: "critical",
  },
  INSUFFICIENT_DATA: {
    label: "Complete your X-Ray",
    headline: "More input is needed.",
    description: "X-Ray needs more input before it can call this role.",
    tone: "neutral",
  },
}

const CONFIDENCE_LABELS: Record<XRayConfidence, { label: string; tone: XRayTone }> = {
  high: { label: "High confidence", tone: "positive" },
  medium: { label: "Medium confidence", tone: "info" },
  low: { label: "Low confidence", tone: "attention" },
  unknown: { label: "Confidence unavailable", tone: "neutral" },
}

const DIMENSIONS: Record<XRayDimensionKey, { title: string; question: string }> = {
  hiringReality: {
    title: "Hiring Reality",
    question: "Does the posting look active enough to spend time on?",
  },
  capability: {
    title: "Capability",
    question: "Does your background line up with the role baseline?",
  },
  evidence: {
    title: "Evidence Strength",
    question: "Does the resume show support for the important claims?",
  },
  eligibility: {
    title: "Posting & Authorization",
    question: "Does this posting conflict with what you told us?",
  },
  positioning: {
    title: "Positioning",
    question: "Is the resume framed for this job and ATS context?",
  },
}

const BAND_PRESENTATION: Record<XRayDimensionKey, Record<string, { label: string; explanation: string; tone: XRayTone }>> = {
  hiringReality: {
    LIVE: {
      label: "Recently observed",
      explanation: "The posting has current activity signals in the corpus.",
      tone: "positive",
    },
    LIKELY_LIVE: {
      label: "Likely open",
      explanation: "Available signals lean open, but a direct employer check is still useful.",
      tone: "positive",
    },
    UNCERTAIN: {
      label: "Needs a direct check",
      explanation: "The activity signals are mixed or incomplete.",
      tone: "attention",
    },
    LIKELY_CLOSED: {
      label: "May be stale",
      explanation: "Posting activity signals suggest this role should be verified first.",
      tone: "attention",
    },
    CLOSED: {
      label: "Closed signal",
      explanation: "Stored posting signals indicate this listing should not be treated as open.",
      tone: "critical",
    },
    UNKNOWN: {
      label: "No reliable activity signal",
      explanation: "X-Ray does not have enough posting activity data.",
      tone: "neutral",
    },
  },
  capability: {
    EXCEEDS: {
      label: "Above baseline",
      explanation: "The candidate signals are stronger than the role baseline.",
      tone: "positive",
    },
    MEETS: {
      label: "Meets baseline",
      explanation: "The candidate signals line up with the role baseline.",
      tone: "positive",
    },
    NEAR_MISS: {
      label: "Near fit",
      explanation: "The role is close, with at least one important gap to address.",
      tone: "info",
    },
    STRETCH: {
      label: "Stretch",
      explanation: "The role may require meaningful bridging before applying.",
      tone: "attention",
    },
    MISMATCH: {
      label: "Different target",
      explanation: "The available career signals point away from this role as a strong target.",
      tone: "critical",
    },
    UNKNOWN: {
      label: "Not enough career data",
      explanation: "X-Ray needs more candidate or role data before judging capability fit.",
      tone: "neutral",
    },
  },
  evidence: {
    STRONG: {
      label: "Strong support",
      explanation: "The resume visibly supports the important role signals.",
      tone: "positive",
    },
    ADEQUATE: {
      label: "Usable support",
      explanation: "The resume shows enough support for a reasonable screen.",
      tone: "positive",
    },
    BURIED: {
      label: "Needs surfacing",
      explanation: "Relevant support appears present but not prominent.",
      tone: "attention",
    },
    THIN: {
      label: "Thin visible support",
      explanation: "Important role signals are not clearly supported in readable resume data.",
      tone: "attention",
    },
    UNREADABLE: {
      label: "Resume unreadable",
      explanation: "The resume data cannot be read well enough for this dimension.",
      tone: "neutral",
    },
  },
  eligibility: {
    NO_EXPLICIT_CONFLICT_FOUND: {
      label: "No conflict surfaced",
      explanation: "X-Ray did not find posting language that conflicts with supplied authorization facts.",
      tone: "positive",
    },
    EMPLOYER_ACTION_MAY_BE_NEEDED: {
      label: "Future action may be needed",
      explanation: "Current work authorization and future employer actions are being treated separately.",
      tone: "attention",
    },
    NEEDS_CLARIFICATION: {
      label: "Needs employer clarification",
      explanation: "The posting language is not specific enough to treat as a hard conflict.",
      tone: "attention",
    },
    EXPLICIT_REQUIREMENT_CONFLICT: {
      label: "Posting conflict surfaced",
      explanation: "Explicit posting or employer statements conflict with supplied candidate facts.",
      tone: "critical",
    },
    UNKNOWN: {
      label: "Authorization data missing",
      explanation: "X-Ray needs candidate or posting authorization data before this can be judged.",
      tone: "neutral",
    },
  },
  positioning: {
    ALIGNED: {
      label: "Aligned",
      explanation: "The resume framing lines up with this job's screening context.",
      tone: "positive",
    },
    TUNABLE: {
      label: "Quick tune",
      explanation: "Small supported edits may improve the application package.",
      tone: "info",
    },
    MISALIGNED: {
      label: "Reframe first",
      explanation: "The resume framing does not yet match the role emphasis.",
      tone: "attention",
    },
    UNKNOWN: {
      label: "Positioning unknown",
      explanation: "X-Ray needs more resume or job data before judging positioning.",
      tone: "neutral",
    },
  },
}

const SOURCE_LABELS: Partial<Record<XRaySourceFact["kind"], string>> = {
  job_row: "Job record",
  job_description_text: "Posting text",
  job_normalization: "Job parsing",
  ats_metadata: "ATS metadata",
  company_row: "Company record",
  company_health: "Company activity",
  company_layoffs: "Company activity",
  crawl_signal: "Crawl signal",
  ghost_score_cache: "Posting-risk scan",
  url_probe: "Posting URL check",
  match_score_cache: "Resume match cache",
  resume_row: "Resume record",
  resume_parse: "Resume parse",
  resume_raw_text: "Resume excerpt",
  tailor_analysis: "Tailoring analysis",
  positioning_brief: "Positioning brief",
  candidate_profile: "Candidate profile",
  autofill_profile: "Autofill profile",
  candidate_declaration: "Candidate declaration",
  credential_catalog: "Credential catalog",
  networking_contacts: "Networking route",
  everify_source: "E-Verify source",
  lca_history: "Historical filing data",
  h1b_prediction: "Sponsorship signal",
  rejection_reports: "Application reports",
  application_history: "Application tracker",
  timing_signals: "Timing signals",
  llm_extraction: "Parsed extraction",
  system_default: "System default",
}

export const PROHIBITED_XRAY_UI_LANGUAGE = [
  /\byou are eligible\b/i,
  /\byou'?re eligible\b/i,
  /\byou are ineligible\b/i,
  /\byou'?re ineligible\b/i,
  /\bineligible\b/i,
  /\byou are guaranteed\b/i,
  /\byou'?re guaranteed\b/i,
  /\byou will get an interview\b/i,
  /\byour interview probability is\b/i,
  /\binterview probability\b/i,
  /\bthis company will sponsor you\b/i,
  /\bthis company does not sponsor\b/i,
  /\byou lack\b/i,
  /\bverified evidence\b/i,
  /\bfake job\b/i,
  /\bghost job\b/i,
  /\blegal eligibility\b/i,
  /\blegally eligible\b/i,
  /\blegally ineligible\b/i,
]

export function presentFinalAction(action: XRayFinalAction, headline?: string): PresentedFinalAction {
  const base = FINAL_ACTIONS[action]
  return {
    ...base,
    headline: sanitizePresentationText(headline && headline.trim() ? headline : base.headline),
  }
}

export function presentConfidence(confidence: XRayConfidence): { label: string; tone: XRayTone } {
  return CONFIDENCE_LABELS[confidence] ?? CONFIDENCE_LABELS.unknown
}

export function presentBasis(basis: XRayBasis): string {
  if (basis === "fact") return "Observed signal"
  if (basis === "inference") return "Inferred from available signals"
  return "Estimated from available signals"
}

export function presentDimension(
  key: XRayDimensionKey,
  assessment: ApplicationXRay[XRayDimensionKey],
): PresentedDimension {
  const meta = DIMENSIONS[key]
  const band = BAND_PRESENTATION[key][assessment.band] ?? {
    label: "Unknown",
    explanation: "X-Ray does not have enough data for this dimension.",
    tone: "neutral" as XRayTone,
  }
  const confidence = presentConfidence(assessment.confidence)
  return {
    key,
    title: meta.title,
    question: meta.question,
    bandLabel: band.label,
    explanation: band.explanation,
    tone: band.tone,
    confidenceLabel: confidence.label,
    confidenceTone: confidence.tone,
    hasDataGaps: assessment.dataGaps.length > 0,
    stale: assessment.staleInputsDowngraded,
  }
}

export function getDimensionAssessment(xray: ApplicationXRay, key: XRayDimensionKey): ApplicationXRay[XRayDimensionKey] {
  return xray[key]
}

export function getDecisionReasons(xray: ApplicationXRay, max = 2): string[] {
  const reasons: string[] = []
  const topRisk = xray.rejectionRisks[0]
  if (topRisk) reasons.push(topRisk.statement)

  for (const key of DIMENSION_ORDER) {
    const dimension = xray[key]
    const selected = dimension.findings.find((finding) => finding.impact === "limiting") ??
      dimension.findings.find((finding) => finding.impact === "supporting") ??
      dimension.findings[0]
    if (selected) reasons.push(selected.statement)
    if (reasons.length >= max) break
  }

  if (reasons.length === 0 && xray.dataGaps[0]) reasons.push(xray.dataGaps[0].label)
  return uniqueStrings(reasons.map(sanitizePresentationText)).slice(0, max)
}

export function getPrimaryAction(xray: ApplicationXRay): RecommendedAction | null {
  return xray.actions.find((action) => action.doableNow) ?? xray.actions[0] ?? null
}

export function presentAction(action: RecommendedAction): RecommendedAction {
  return {
    ...action,
    label: sanitizePresentationText(action.label),
    rationale: sanitizePresentationText(action.rationale),
  }
}

export function presentRisk(risk: RejectionRisk): RejectionRisk & { basisLabel: string } {
  return {
    ...risk,
    statement: sanitizePresentationText(risk.statement),
    basisLabel: presentBasis(risk.likelihoodBasis),
  }
}

export function presentAuthorizationNote(xray: ApplicationXRay): string | null {
  const eligibility = xray.eligibility
  const hasAmbiguousScope = eligibility.postingRequirements.some(
    (requirement) => requirement.category === "SPONSORSHIP_SCOPE_AMBIGUOUS",
  )
  const hasFutureAction = eligibility.candidate.futureEmployerActions.length > 0
  if (
    eligibility.candidate.canWorkForTargetEmployerWithoutNewImmigrationAction === "YES" &&
    hasAmbiguousScope &&
    hasFutureAction
  ) {
    return "You may be authorized to work now, but this posting does not clarify whether the employer supports future immigration action. Confirm the policy before relying on this opportunity long term."
  }

  const eVerify = eligibility.sponsorshipHistory?.eVerify
  if (eVerify?.participation === "NOT_FOUND_IN_SOURCE") {
    return "Stored E-Verify data did not find this employer; that is not a confirmed refusal."
  }
  if (eVerify?.participation === "UNKNOWN") {
    return "E-Verify participation is not known from stored data."
  }
  if (eligibility.disclaimerRequired) {
    return "This is an observational job-search signal, not legal advice."
  }
  return null
}

export function presentSourceFact(fact: XRaySourceFact): {
  sourceLabel: string
  basisLabel: string
  confidenceLabel: string
  dateLabel: string
  sampleLabel: string | null
  explanation: string
  excerpt: string | null
} {
  return {
    sourceLabel: SOURCE_LABELS[fact.kind] ?? "Source signal",
    basisLabel: presentBasis(fact.basis),
    confidenceLabel: presentConfidence(fact.confidence).label,
    dateLabel: formatXRayDate(fact.observedAt ?? fact.computedAt),
    sampleLabel: typeof fact.sampleSize === "number" && Number.isFinite(fact.sampleSize)
      ? `${fact.sampleSize.toLocaleString("en-US")} records${fact.sampleWindow ? ` in ${sanitizePresentationText(fact.sampleWindow)}` : ""}`
      : null,
    explanation: sanitizePresentationText(fact.explanation),
    excerpt: fact.excerpt ? sanitizePresentationText(truncateText(fact.excerpt, 220)) : null,
  }
}

export function presentDataGapLabel(value: string): string {
  return sanitizePresentationText(value)
}

export function resolveActionLink(
  action: RecommendedAction,
  routes: ActionableAccessRoute[],
  options: { applyUrl: string | null; jobId: string },
): PresentedActionLink {
  switch (action.kind) {
    case "apply_to_canonical_posting":
    case "verify_posting":
      if (options.applyUrl) return { type: "link", label: "Open posting", href: options.applyUrl, external: true }
      return {
        type: "instruction",
        label: "Open posting",
        text: "Use the Apply button above to check the employer posting directly.",
      }
    case "upload_or_reparse_resume":
      return { type: "link", label: "Open resume", href: "/dashboard/resume", external: false }
    case "surface_buried_evidence":
    case "rewrite_title_or_summary":
    case "add_supported_keywords":
    case "reframe_transferable_experience":
      return {
        type: "link",
        label: "Open tailor view",
        href: `/dashboard/resume/studio?mode=tailor&jobId=${encodeURIComponent(options.jobId)}`,
        external: false,
      }
    case "complete_profile":
    case "confirm_authorization_timeline":
    case "confirm_requirement_status":
    case "confirm_stem_opt_requirement":
      return { type: "link", label: "Open profile", href: "/dashboard/profile", external: false }
    case "contact_named_route":
      return routeLink(action, routes)
    case "choose_different_target":
      return { type: "link", label: "Find roles", href: "/dashboard", external: false }
    case "consider_referral_generally":
      return {
        type: "instruction",
        label: "Use referral flow",
        text: "Use the referral button above if you have a trusted contact.",
      }
    case "confirm_future_sponsorship_policy":
      return {
        type: "instruction",
        label: "Ask employer",
        text: "Ask whether future employer actions are supported for this role.",
      }
    case "confirm_everify_participation":
      return {
        type: "instruction",
        label: "Ask employer",
        text: "Ask the employer to confirm E-Verify participation for this role.",
      }
    case "acquire_missing_requirement":
      return {
        type: "instruction",
        label: "Use your plan",
        text: "Use your declared credential timeline before applying.",
      }
  }
}

export function formatXRayDate(value: string | null): string {
  if (!value) return "Date not available"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Date not available"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export function sanitizePresentationText(value: string): string {
  return value
    .replace(/\bghost[-\s]?job\b/gi, "soft posting signal")
    .replace(/\bghost[-\s]?risk\b/gi, "posting-risk")
    .replace(/\bfake job\b/gi, "unreliable posting")
    .replace(/\bverified evidence\b/gi, "supporting evidence")
    .replace(/\byou lack\b/gi, "the resume did not show")
    .replace(/\bthis company does not sponsor\b/gi, "this posting needs employer-policy confirmation")
    .replace(/\bthis company will sponsor you\b/gi, "historical employer sponsorship signals exist")
    .replace(/\binterview probability\b/gi, "interview signal")
    .trim()
}

export function collectXRayPresentationStrings(xray?: ApplicationXRay | null): string[] {
  const strings = [...XRAY_STATIC_PRESENTATION_STRINGS]
  for (const value of Object.values(FINAL_ACTIONS)) strings.push(value.label, value.headline, value.description)
  for (const dimension of Object.values(DIMENSIONS)) strings.push(dimension.title, dimension.question)
  for (const bands of Object.values(BAND_PRESENTATION)) {
    for (const band of Object.values(bands)) strings.push(band.label, band.explanation)
  }
  for (const confidence of Object.values(CONFIDENCE_LABELS)) strings.push(confidence.label)
  if (!xray) return strings

  strings.push(xray.headline)
  for (const key of DIMENSION_ORDER) {
    const dimension = xray[key]
    strings.push(dimension.headline)
    for (const finding of dimension.findings) strings.push(finding.statement, finding.explanation)
    for (const gap of dimension.dataGaps) strings.push(gap.label, gap.whyNotDefaulted, gap.resolution?.step ?? "")
  }
  for (const risk of xray.rejectionRisks) strings.push(risk.statement)
  for (const action of xray.actions) strings.push(action.label, action.rationale)
  for (const fact of xray.sourceFacts) strings.push(fact.explanation, fact.excerpt ?? "")
  return strings.map(sanitizePresentationText).filter(Boolean)
}

export function findProhibitedXRayUiLanguage(strings: string[]): Array<{ pattern: string; text: string }> {
  const matches: Array<{ pattern: string; text: string }> = []
  for (const text of strings) {
    for (const pattern of PROHIBITED_XRAY_UI_LANGUAGE) {
      if (pattern.test(text)) matches.push({ pattern: pattern.source, text })
    }
  }
  return matches
}

function routeLink(action: RecommendedAction, routes: ActionableAccessRoute[]): PresentedActionLink {
  const route = routes.find((item) => item.id === action.routeId) ?? routes[0]
  if (!route) {
    return {
      type: "instruction",
      label: "Find route",
      text: "Use a known contact or the referral flow before applying.",
    }
  }
  return channelToLink(route.channel)
}

function channelToLink(channel: AccessRouteChannel): PresentedActionLink {
  switch (channel.kind) {
    case "linkedin_profile":
      return { type: "link", label: "Open profile", href: channel.url, external: true }
    case "email":
      return { type: "link", label: "Email contact", href: `mailto:${channel.address}`, external: true }
    case "internal_referral_form":
      return { type: "link", label: "Open referral form", href: channel.url, external: true }
    case "cohort_thread":
      return {
        type: "instruction",
        label: "Use cohort thread",
        text: "Use your existing cohort thread to ask for context.",
      }
  }
}

function truncateText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 3)).trim()}...`
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

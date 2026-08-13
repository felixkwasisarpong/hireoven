import { getResumeVersion } from "@/lib/matching/fast-scorer"
import {
  declaredAcquisitionDays,
  normalizeCredentialKey,
  resolveRequirementPresence,
} from "@/lib/candidates/credential-declarations"
import { buildLocalTailorAnalysis } from "@/lib/resume/tailor-analysis"
import { categorizePostingAuthorizationLanguage } from "../authorization-language"
import type {
  ActionableAccessRoute,
  AtsType,
  EvaluatedRequirement,
  RequirementKind,
  RequirementStrength,
  ReferralAdvantageAdvisory,
  XRayDataGap,
  XRaySourceFact,
} from "../types"
import type {
  CapabilitySignalInput,
  EvidenceSignalInput,
  HiringRealitySignalInput,
  PositioningSignalInput,
} from "../inputs"
import type {
  JsonRecord,
  XRayApplicationRow,
  XRayCredentialDeclarationRow,
  XRayGhostScoreRow,
  XRayHealthScoreRow,
  XRayJobRow,
  XRayRejectionPatternRow,
  XRayResumeRow,
  XRayScoreRow,
} from "./records"
import { companyName } from "./map-job"

export function mapCapability(input: {
  resume: XRayResumeRow | null
  job: XRayJobRow | null
  score: XRayScoreRow | null
  computedBreakdown: XRayScoreRow["score_breakdown"] | null
  scoreFresh: boolean | "missing" | "stale" | "unavailable"
  credentialDeclarations: XRayCredentialDeclarationRow[]
  sourceFacts: XRaySourceFact[]
  now: string
  dataGaps: XRayDataGap[]
}): CapabilitySignalInput {
  const breakdown =
    input.computedBreakdown ??
    (input.scoreFresh === true ? input.score?.score_breakdown ?? null : null)
  const careerFit = breakdown?.careerFit ?? null
  if (!input.resume || !careerFit) {
    input.dataGaps.push({
      id: input.resume ? "career-fit-score-missing" : "resume-missing-for-capability",
      dimension: "capability",
      severity: "dimension_blocking",
      label: input.resume ? "Career-fit score is unavailable" : "No resume selected",
      missingField: input.resume ? "job_match_scores.score_breakdown.careerFit" : "resumes.id",
      whyNotDefaulted: input.resume
        ? "Missing or stale match data is not a capability score."
        : "No resume means no candidate capability evidence can be inspected.",
      resolution: input.resume
        ? { actor: "hireoven", step: "Recompute deterministic match scoring for this resume and job." }
        : { actor: "candidate", step: "Upload or select a resume." },
    })
  }
  if (input.scoreFresh === "stale") {
    input.dataGaps.push({
      id: "career-fit-score-stale",
      dimension: "capability",
      severity: "decision_relevant",
      label: "Cached career-fit score was stale",
      missingField: "fresh job_match_scores row",
      whyNotDefaulted: "A stale score can reflect an older resume or scoring epoch.",
      resolution: { actor: "hireoven", step: "Refresh deterministic match scoring." },
    })
  }

  const requiredYearsStated = typeof careerFit?.requiredYears === "number"
  const mismatchCorroborations: CapabilitySignalInput["mismatchCorroborations"] = []
  if (typeof careerFit?.careerFitScore === "number" && careerFit.careerFitScore < 40) {
    mismatchCorroborations.push("career_fit_below_floor")
  }
  if (
    requiredYearsStated &&
    typeof careerFit?.relevantYearsRatio === "number" &&
    careerFit.relevantYearsRatio < 0.5
  ) {
    mismatchCorroborations.push("severe_years_shortfall")
  }
  if (breakdown?.roleFamily && Array.isArray(breakdown.candidateRoleFamilies) && breakdown.candidateRoleFamilies.length > 0) {
    const compatible = breakdown.candidateRoleFamilies.includes(breakdown.roleFamily)
    if (!compatible) mismatchCorroborations.push("role_family_incompatible")
  }

  const requirements = mapDeterministicRequirements({
    job: input.job,
    resume: input.resume,
    credentialDeclarations: input.credentialDeclarations,
    sourceFacts: input.sourceFacts,
    now: input.now,
  })

  return {
    careerFitScore: careerFit?.careerFitScore ?? null,
    careerFitLabel: careerFit?.label ?? null,
    relevantYears: careerFit?.relevantYears ?? null,
    totalYears: careerFit?.totalYears ?? input.resume?.years_of_experience ?? null,
    requiredYears: requiredYearsStated ? careerFit?.requiredYears ?? null : null,
    requiredYearsStated,
    relevantYearsRatio: requiredYearsStated ? careerFit?.relevantYearsRatio ?? null : null,
    roleFamily: breakdown?.roleFamily ?? null,
    candidateRoleFamilies: Array.isArray(breakdown?.candidateRoleFamilies) ? breakdown.candidateRoleFamilies : [],
    roleFamilyCompatible: breakdown?.roleFamily && Array.isArray(breakdown.candidateRoleFamilies)
      ? breakdown.candidateRoleFamilies.includes(breakdown.roleFamily)
      : "unknown",
    requirements,
    mismatchCorroborations,
    confidence: careerFit ? "medium" : "unknown",
  }
}

export function mapEvidenceAndPositioning(input: {
  resume: XRayResumeRow | null
  job: XRayJobRow | null
  score: XRayScoreRow | null
  computedBreakdown: XRayScoreRow["score_breakdown"] | null
}): { evidence: EvidenceSignalInput; positioning: PositioningSignalInput } {
  const breakdown = input.computedBreakdown ?? input.score?.score_breakdown ?? null
  const description = input.job?.description ?? ""
  const resume = input.resume
  const local = resume && description
    ? buildLocalTailorAnalysis({
      resume,
      jobDescription: description,
      skillsText: skillsText(resume),
      profileSummary: resume.summary ?? "",
      experienceDraft: (resume.work_experience ?? []).map((item) => ({
        company: item.company ?? "",
        role: item.title ?? "",
        description: [item.description, ...(item.achievements ?? [])].filter(Boolean).join("\n"),
      })),
    })
    : null

  const requirementSupport: EvidenceSignalInput["requirementSupport"] = (local?.skillSuggestions ?? []).map((item) => ({
    requirement: item.skill,
    status: item.status,
    absenceKind: item.status === "missing_needs_confirmation" || item.status === "not_recommended"
      ? "NOT_FOUND_IN_READABLE_DATA"
      : null,
    supportingContext: typeof item.evidence === "string" ? item.evidence.slice(0, 240) : null,
    locatedIn: item.status === "present"
      ? "structured_fields"
      : item.status === "missing_supported"
        ? "raw_text_only"
        : "not_found",
    sourceFactIds: [],
  }))

  const supportedMissing = (local?.skillSuggestions ?? [])
    .filter((item) => item.status === "missing_supported")
    .map((item) => item.skill)
  const unsupportedMissing = (local?.skillSuggestions ?? [])
    .filter((item) => item.status === "missing_needs_confirmation" || item.status === "not_recommended")
    .map((item) => item.skill)
  const presentKeywords = local?.presentKeywords ?? []
  const fixes = local?.fixes ?? []

  return {
    evidence: {
      requirementSupport,
      buriedEvidence: supportedMissing,
      confidence: local ? "medium" : "unknown",
    },
    positioning: {
      atsScreenScore: breakdown?.careerFit?.atsScreenScore ?? null,
      atsReadabilityScore: resume?.ats_score ?? null,
      targetAts: mapAts(input.job),
      atsProfileApplied: input.job?.source_ats ?? input.job?.company?.ats_type ?? null,
      resumeTitle: resume?.primary_role ?? null,
      supportedMissing,
      unsupportedMissing,
      presentKeywords,
      leadWith: presentKeywords.slice(0, 5),
      surfaceFromRawText: supportedMissing.slice(0, 5),
      closeGaps: unsupportedMissing.slice(0, 5),
      fieldContext: resume?.target_field
        ? { targetFieldKey: resume.target_field, fieldFitScore: null, corpusAvailable: false }
        : null,
      repairEstimate: {
        supportedEditCount: fixes.filter((fix) => fix.requiresConfirmation === false).length,
        estimatedMinutes: fixes.length ? Math.min(120, Math.max(10, fixes.length * 5)) : 0,
        requiresNewEvidence: unsupportedMissing.length > supportedMissing.length && unsupportedMissing.length > 0,
      },
      confidence: local || breakdown?.careerFit ? "medium" : "unknown",
    },
  }
}

export function mapHiringReality(input: {
  ghost: XRayGhostScoreRow | null
  health: XRayHealthScoreRow | null
  job: XRayJobRow | null
  now: string
}): HiringRealitySignalInput {
  const ghostAge = hoursSince(input.ghost?.last_scanned_at ?? null, input.now)
  const healthAge = hoursSince(input.health?.last_computed_at ?? null, input.now)
  return {
    ghostRisk: {
      band: mapGhostRiskLevel(input.ghost?.risk_level),
      contributingSignals: [],
      concurrentSimilarOpenings: input.ghost?.repost_count ?? null,
      repostHistoryUnavailable: true,
      computedAt: input.ghost?.last_scanned_at ?? null,
      cacheAgeHours: ghostAge,
    },
    employerCapacity: {
      healthVerdict: mapHealthVerdict(input.health?.verdict),
      observedSubScoreCount: input.health ? 1 : 0,
      healthUsable: Boolean(input.health && (healthAge === null || healthAge <= 720)),
      healthComputedAt: input.health?.last_computed_at ?? null,
      hiringFreeze: {
        detected: input.ghost?.has_hiring_freeze ?? null,
        confidence: input.ghost?.has_hiring_freeze ? "possible" : null,
        alreadyCountedInGhostRisk: Boolean(input.ghost),
      },
      medianDaysOpen: numberOrNull(input.job?.company?.median_days_open),
      timeToFillSample: numberOrNull(input.job?.company?.time_to_fill_sample),
    },
    confidence: input.ghost || input.health ? "medium" : "unknown",
  }
}

export function mapPostingAuthorizationRequirements(input: {
  job: XRayJobRow | null
  sourceFacts: XRaySourceFact[]
}): ReturnType<typeof categorizePostingAuthorizationLanguage> {
  const description = input.job?.description ?? ""
  const factsBefore = input.sourceFacts.length
  const factId = "job-authorization-language"
  const requirements = categorizePostingAuthorizationLanguage({
    text: description,
    sourceFactId: factId,
    confidence: description ? "high" : "unknown",
  })
  if (requirements.length > 0 && input.sourceFacts.length === factsBefore) {
    input.sourceFacts.push({
      id: factId,
      kind: "job_description_text",
      basis: "fact",
      confidence: "high",
      key: "jobs.description.authorization_language",
      value: true,
      excerpt: requirements[0]?.excerpt.slice(0, 240) ?? null,
      observedAt: null,
      computedAt: null,
      explanation: "Stored job description contains work-authorization language.",
      usableBy: ["eligibility"],
    })
  }
  return requirements
}

export function mapAccessRoutes(routes: ActionableAccessRoute[]): ActionableAccessRoute[] {
  return routes.filter((route) => Boolean(route.channel && route.sourceFactIds.length > 0))
}

export function mapReferralAdvisory(input: {
  pattern: XRayRejectionPatternRow | null
  job: XRayJobRow | null
}): ReferralAdvantageAdvisory | null {
  const totalSubmissions = Number(input.pattern?.total_submissions ?? 0)
  if (!input.pattern || !input.job?.company_id || totalSubmissions < 10) return null
  const referral = ratio(input.pattern.referral_screen_rate)
  const cold = ratio(input.pattern.cold_apply_screen_rate)
  return {
    companyId: input.job.company_id,
    normalizedTitle: input.job.normalized_title ?? input.job.title,
    totalSubmissions,
    referralScreenRate: referral,
    coldApplyScreenRate: cold,
    deltaPercentagePoints: referral !== null && cold !== null ? Math.round((referral - cold) * 100) : null,
    lastComputedAt: input.pattern.last_computed_at,
    displayable: true,
    gatesFinalAction: false,
  }
}

export function mapResumeInput(resume: XRayResumeRow | null) {
  if (!resume) return null
  return {
    id: resume.id,
    version: getResumeVersion(resume),
    parseStatus: resume.parse_status === "pending" || resume.parse_status === "processing" || resume.parse_status === "complete" || resume.parse_status === "failed"
      ? resume.parse_status
      : "failed",
    parseError: resume.parse_error ?? null,
    hasRawText: Boolean(resume.raw_text && resume.raw_text.trim().length > 0),
    datedRoleCount: (resume.work_experience ?? []).filter((item) => item.start_date || item.end_date).length,
  } as const
}

export function baseSourceFacts(input: {
  job: XRayJobRow | null
  resume: XRayResumeRow | null
  score: XRayScoreRow | null
  ghost: XRayGhostScoreRow | null
  health: XRayHealthScoreRow | null
  applications: XRayApplicationRow[]
}): XRaySourceFact[] {
  const facts: XRaySourceFact[] = []
  if (input.job) {
    facts.push({
      id: "job-row",
      kind: "job_row",
      basis: "fact",
      confidence: "high",
      key: "jobs.id",
      value: input.job.id,
      observedAt: input.job.last_seen_at,
      computedAt: null,
      explanation: `Stored job row${companyName(input.job.company) ? ` for ${companyName(input.job.company)}` : ""}.`,
      usableBy: ["hiringReality", "eligibility", "positioning"],
    })
  }
  if (input.resume) {
    facts.push({
      id: "resume-row",
      kind: "resume_row",
      basis: "fact",
      confidence: "high",
      key: "resumes.id",
      value: input.resume.id,
      observedAt: input.resume.updated_at,
      computedAt: null,
      explanation: "Authenticated user's selected resume row.",
      usableBy: ["capability", "evidence", "positioning"],
    })
  }
  if (input.score) {
    facts.push({
      id: "match-score-career-fit",
      kind: "match_score_cache",
      basis: "inference",
      confidence: "medium",
      key: "job_match_scores.score_breakdown.careerFit",
      value: input.score.score_breakdown?.careerFit?.careerFitScore ?? null,
      observedAt: null,
      computedAt: input.score.computed_at,
      explanation: "Cached deterministic career-fit breakdown; blended overall score is not used by X-Ray.",
      usableBy: ["capability", "positioning"],
    })
  }
  if (input.ghost) {
    facts.push({
      id: "ghost-score-cache",
      kind: "ghost_score_cache",
      basis: "inference",
      confidence: "medium",
      key: "ghost_job_scores.risk_level",
      value: input.ghost.risk_level,
      observedAt: null,
      computedAt: input.ghost.last_scanned_at,
      sampleSize: input.ghost.repost_count,
      explanation: "Stored ghost-risk cache; no live URL probe was run for this X-Ray request.",
      usableBy: ["hiringReality"],
    })
  }
  if (input.health) {
    facts.push({
      id: "company-health-cache",
      kind: "company_health",
      basis: "inference",
      confidence: "medium",
      key: "company_health_scores.verdict",
      value: input.health.verdict,
      observedAt: null,
      computedAt: input.health.last_computed_at,
      explanation: "Stored company-health cache; no refresh was run for this X-Ray request.",
      usableBy: ["hiringReality"],
    })
  }
  if (input.applications.length > 0) {
    facts.push({
      id: "application-history",
      kind: "application_history",
      basis: "fact",
      confidence: "medium",
      key: "job_applications.count",
      value: input.applications.length,
      observedAt: input.applications[0]?.updated_at ?? null,
      computedAt: null,
      explanation: "Authenticated user's application history for this job.",
      usableBy: ["hiringReality"],
    })
  }
  return facts
}

type RequirementCandidate = {
  label: string
  kind: RequirementKind
  strength: RequirementStrength
  excerpt: string
}

const REQUIREMENT_PATTERNS: ReadonlyArray<{
  label: string
  kind: RequirementKind
  pattern: RegExp
}> = [
  { label: "CPA", kind: "certification", pattern: /\b(?:active\s+)?(?:cpa|certified public accountant)(?:\s+(?:license|certification))?\s+(?:is\s+)?(?:required|mandatory)\b/i },
  { label: "PMP", kind: "certification", pattern: /\b(?:pmp|project management professional)(?:\s+(?:certification))?\s+(?:is\s+)?(?:required|mandatory)\b/i },
  { label: "CISSP", kind: "certification", pattern: /\b(?:cissp|certified information systems security professional)(?:\s+(?:certification))?\s+(?:is\s+)?(?:required|mandatory)\b/i },
  { label: "Top Secret clearance", kind: "clearance", pattern: /\b(?:active\s+)?top[\s-]?secret(?:\/sci| sci)?\s+clearance\s+(?:is\s+)?(?:required|mandatory)\b/i },
  { label: "Secret clearance", kind: "clearance", pattern: /\b(?:active\s+)?secret\s+clearance\s+(?:is\s+)?(?:required|mandatory)\b/i },
  { label: "Public Trust clearance", kind: "clearance", pattern: /\bpublic[\s-]?trust\s+(?:clearance\s+)?(?:is\s+)?(?:required|mandatory)\b/i },
]

function mapDeterministicRequirements(input: {
  job: XRayJobRow | null
  resume: XRayResumeRow | null
  credentialDeclarations: XRayCredentialDeclarationRow[]
  sourceFacts: XRaySourceFact[]
  now: string
}): EvaluatedRequirement[] {
  const description = input.job?.description ?? ""
  if (!description.trim()) return []

  const declarations = new Map(input.credentialDeclarations.map((row) => [row.credential_key, row]))
  const candidates: RequirementCandidate[] = []
  for (const spec of REQUIREMENT_PATTERNS) {
    const match = spec.pattern.exec(description)
    if (!match) continue
    candidates.push({
      label: spec.label,
      kind: spec.kind,
      strength: "MANDATORY_EXPLICIT",
      excerpt: excerptAround(description, match.index, match[0].length),
    })
  }

  return candidates.map((candidate, index) => {
    const key = normalizeCredentialKey(candidate.label)
    const declaration = declarations.get(key) ?? null
    const resumeReadable = Boolean(input.resume?.raw_text || input.resume?.certifications || input.resume?.education)
    const structuredFieldMatch = credentialInStructuredResume(input.resume, candidate.label)
    const freeTextMatch = credentialInText(input.resume?.raw_text ?? "", candidate.label)
    const presence = resolveRequirementPresence({
      declaration,
      structuredFieldMatch,
      freeTextMatch,
      candidateDataReadable: resumeReadable,
    })
    const sourceFactId = `job-requirement-${key || index}`
    if (!input.sourceFacts.some((fact) => fact.id === sourceFactId)) {
      input.sourceFacts.push({
        id: sourceFactId,
        kind: "job_description_text",
        basis: "fact",
        confidence: "high",
        key: `jobs.description.requirement.${key || index}`,
        value: candidate.label,
        excerpt: candidate.excerpt,
        observedAt: null,
        computedAt: null,
        explanation: "Stored job description explicitly states a candidate requirement.",
        usableBy: ["capability", "evidence"],
      })
    }
    const declarationFactId = declaration ? `candidate-credential-${key}` : null
    if (declaration && !input.sourceFacts.some((fact) => fact.id === declarationFactId)) {
      input.sourceFacts.push({
        id: declarationFactId!,
        kind: "candidate_declaration",
        basis: "fact",
        confidence: "high",
        key: `candidate_credential_declarations.${key}`,
        value: declaration.held,
        observedAt: declaration.declared_at,
        computedAt: null,
        explanation: "Candidate-supplied credential declaration.",
        usableBy: ["capability", "evidence"],
      })
    }
    const acquisitionDays = declaration
      ? declaredAcquisitionDays(declaration.expected_at, new Date(input.now))
      : null
    const sourceFactIds = declarationFactId ? [sourceFactId, declarationFactId] : [sourceFactId]

    return {
      id: `req-${key || index}`,
      kind: candidate.kind,
      label: candidate.label,
      strength: candidate.strength,
      strengthProvenance: "deterministic_pattern",
      strengthExcerpt: candidate.excerpt,
      presence: presence.presence,
      contradictionReliability: presence.contradictionReliability,
      searchedIn: presence.searchedIn,
      acquirability: {
        source: acquisitionDays !== null ? "candidate_declared" : "unknown",
        estimatedDays: acquisitionDays,
        candidateNote: declaration?.note ?? null,
        sourceFactIds: declarationFactId ? [declarationFactId] : [],
      },
      sourceFactIds,
      confidence: "high",
      supportsHardSkip: false,
    }
  })
}

function credentialInStructuredResume(resume: XRayResumeRow | null, label: string): boolean {
  if (!resume) return false
  const haystack = [
    ...(resume.certifications ?? []).map((item) => JSON.stringify(item)),
    ...(resume.education ?? []).map((item) => JSON.stringify(item)),
    skillsText(resume),
  ].join("\n")
  return credentialInText(haystack, label)
}

function credentialInText(text: string, label: string): boolean {
  if (!text.trim()) return false
  const key = normalizeCredentialKey(label)
  return key
    .split("-")
    .filter(Boolean)
    .every((part) => new RegExp(`\\b${escapeRegex(part)}\\b`, "i").test(text))
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 90)
  const end = Math.min(text.length, index + length + 90)
  return text.slice(start, end).replace(/\s+/g, " ").trim()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function mapAts(job: XRayJobRow | null): AtsType | null {
  const value = (job?.source_ats ?? job?.company?.ats_type ?? "").toLowerCase()
  const known = new Set<AtsType>([
    "greenhouse", "lever", "ashby", "workday", "icims", "smartrecruiters", "bamboohr",
    "jobvite", "taleo", "successfactors", "recruitee", "teamtailor", "workable",
    "rippling", "custom", "unknown",
  ])
  return known.has(value as AtsType) ? value as AtsType : null
}

function skillsText(resume: XRayResumeRow): string {
  const skills = resume.skills
  if (!skills) return (resume.top_skills ?? []).join(", ")
  if (Array.isArray(skills)) return skills.join(", ")
  if (typeof skills === "object") {
    return Object.values(skills as JsonRecord).flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean).join(", ")
  }
  return String(skills)
}

function mapGhostRiskLevel(value: string | null | undefined): "low" | "medium" | "high" | "unknown" {
  if (value === "low" || value === "medium" || value === "high") return value
  return "unknown"
}

function mapHealthVerdict(value: string | null | undefined): "strong" | "healthy" | "caution" | "critical" | "unknown" {
  if (value === "strong" || value === "healthy" || value === "caution" || value === "critical") return value
  return "unknown"
}

function hoursSince(value: string | null, now: string): number | null {
  if (!value) return null
  const start = Date.parse(value)
  const end = Date.parse(now)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, Math.floor((end - start) / 3_600_000))
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function ratio(value: string | number | null | undefined): number | null {
  const parsed = numberOrNull(value)
  if (parsed === null) return null
  return parsed > 1 ? parsed / 100 : parsed
}

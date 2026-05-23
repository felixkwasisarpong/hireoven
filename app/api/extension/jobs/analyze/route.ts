/**
 * POST /api/extension/jobs/analyze
 *
 * Scout analyze endpoint. Deterministic only — no AI calls.
 *
 * Returns:
 *   - existsInHireoven (lookup-only, never writes)
 *   - autofillSupported (mapping by ATS source)
 *   - sponsorship (regex on description text)
 *   - signals (cheap deterministic facts: salary, location, work_mode, requirement)
 *   - matchScore (shared fast scorer used by the main app)
 *   - actions (UI gates)
 */

import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { buildFastScoreResumeContext, computeFastScore } from "@/lib/matching/fast-scorer"
import { getScoringContextForUser } from "@/lib/matching/batch-scorer"
import {
  extensionCorsHeaders,
  extensionError,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import { buildExtensionJobFingerprint, normalizeExtensionJobUrl } from "@/lib/extension/job-fingerprint"
import { extractSkillsFromText, skillMatches } from "@/lib/skills/taxonomy"
import type { EmploymentType, Job, Resume, SeniorityLevel } from "@/types"

export const runtime = "nodejs"

// ── Types (mirror chrome-extension/src/api-types.ts) ──────────────────────────

type SupportedSite =
  | "linkedin"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "indeed"
  | "glassdoor"
  | "unknown"

interface AnalyzeJobBody {
  source: SupportedSite
  url: string
  canonicalUrl?: string
  applyUrl?: string
  title?: string
  company?: string
  location?: string
  descriptionText?: string
  salaryText?: string
  employmentType?: string
  detectedAts?: SupportedSite
  activelyHiring?: boolean
}

type SignalType =
  | "matched_skill"
  | "missing_skill"
  | "salary"
  | "work_mode"
  | "location"
  | "sponsorship"
  | "ghost_risk"
  | "requirement"

interface AnalysisSignal {
  label: string
  type: SignalType
  evidence?: string
  confidence: "high" | "medium" | "low"
}

interface AnalysisResponse {
  jobId?: string
  existsInHireoven: boolean
  matchScore?: number
  autofillSupported: boolean
  detectedAts?: string
  ghostRisk?: { level: "low" | "medium" | "high" | "unknown"; reasons: string[] }
  sponsorship?: { status: "likely" | "no_sponsorship" | "unclear" | "unknown"; evidence: string[] }
  signals: AnalysisSignal[]
  actions: {
    canSave: boolean
    canAnalyze: boolean
    canTailorResume: boolean
    canAutofill: boolean
  }
}

// ── Deterministic rules ───────────────────────────────────────────────────────

/**
 * Autofill capability by source. The Scout Bar uses this to gate the autofill
 * action. true = full support planned, false = job board (apply happens elsewhere).
 * Workday/LinkedIn are "partial" — we still set true, with a partial signal.
 */
const AUTOFILL_BY_SOURCE: Record<SupportedSite, { supported: boolean; partial: boolean }> = {
  greenhouse: { supported: true,  partial: false },
  lever:      { supported: true,  partial: false },
  ashby:      { supported: true,  partial: false },
  workday:    { supported: true,  partial: true  },
  linkedin:   { supported: true,  partial: true  },
  indeed:     { supported: false, partial: false },
  glassdoor:  { supported: false, partial: false },
  unknown:    { supported: false, partial: false },
}

const NO_SPONSOR_RE = new RegExp(
  [
    // Explicit "we won't sponsor" phrases
    /\b(?:will\s+not\s+sponsor|no\s+(?:visa\s+)?sponsorship|cannot\s+sponsor|unable\s+to\s+sponsor|do(?:es)?\s+not\s+sponsor|no\s+work\s+(?:visa|authorization))\b/i.source,
    // U.S. Citizenship requirements (federal contractors, defense, etc. — non-US can't be sponsored for these roles)
    /\bU\.?\s?S\.?\s+Citizen(?:ship)?\b/i.source,
    /\bUnited\s+States\s+Citizen(?:ship)?\b/i.source,
    /\b(?:U\.?\s?S\.?|United\s+States)\s+Citizen(?:ship)?\s+(?:is\s+)?required\b/i.source,
    /\brequires?\s+(?:U\.?\s?S\.?|United\s+States)\s+Citizen(?:ship)?\b/i.source,
    /\bcitizen(?:ship)?\s+(?:is\s+)?required\b/i.source,
    /\bU\.?\s?S\.?\s+persons?\s+only\b/i.source,
    // Top-Secret-level clearance — only US citizens can hold these, so sponsorship is impossible
    /\bTS\s*\/\s*SCI\b/i.source,
    /\b(?:Top\s+)?Secret\s+(?:security\s+)?clearance\b/i.source,
    /\bFull\s+Scope\s+Polygraph\b/i.source,
  ].join("|"),
  "i",
)

const POSITIVE_SPONSOR_RE =
  /\b(?:H[\s-]?1[\s-]?B|visa\s+sponsorship|sponsor(?:ship)?\s+(?:available|provided|offered)|will\s+sponsor|sponsor\s+(?:eligible\s+)?candidate)\b/i

const SALARY_RE =
  /\$\s*\d{1,3}(?:[,]\d{3})*(?:\s*[-–]\s*\$?\s*\d{1,3}(?:[,]\d{3})*)?(?:\s*(?:k|K|\/yr|\/year|annually|per\s+year))?/

const YEARS_EXPERIENCE_RE = /\b(\d{1,2})\+?\s*years?\s+(?:of\s+)?experience\b/i

const REMOTE_RE = /\b(?:remote|work\s+from\s+anywhere|fully\s+remote)\b/i
const HYBRID_RE = /\bhybrid\b/i
const ONSITE_RE = /\b(?:on[-\s]?site|in[-\s]?office)\b/i
const ZERO_UUID = "00000000-0000-0000-0000-000000000000"

// Mirrors chrome-extension/src/extractors/scout-extractor.ts and JobCardV2.
const ACTIVELY_HIRING_RE =
  /\b(?:actively\s+(?:recruiting|hiring|seeking|reviewing\s+(?:applicants?|applications?|candidates?))|urgently?\s+hiring|hiring\s+now|now\s+hiring|immediate(?:ly)?\s+(?:hire|hiring|need|opening)|urgent(?:ly)?\s+(?:hiring|need)|high(?:ly)?\s+priority\s+role)\b/i

function matchSnippet(text: string, regex: RegExp, padding = 60): string | undefined {
  const m = regex.exec(text)
  if (!m) return undefined
  const start = Math.max(0, (m.index ?? 0) - padding)
  const end = Math.min(text.length, (m.index ?? 0) + m[0].length + padding)
  return text.slice(start, end).replace(/\s+/g, " ").trim()
}

function detectSponsorship(description: string | undefined): {
  status: "likely" | "no_sponsorship" | "unclear" | "unknown"
  evidence: string[]
} {
  if (!description) return { status: "unknown", evidence: [] }
  const evidence: string[] = []
  const negSnippet = matchSnippet(description, NO_SPONSOR_RE)
  const posSnippet = matchSnippet(description, POSITIVE_SPONSOR_RE)
  if (negSnippet && posSnippet) {
    evidence.push(negSnippet, posSnippet)
    return { status: "unclear", evidence }
  }
  if (negSnippet) {
    evidence.push(negSnippet)
    return { status: "no_sponsorship", evidence }
  }
  if (posSnippet) {
    evidence.push(posSnippet)
    return { status: "likely", evidence }
  }
  return { status: "unknown", evidence: [] }
}

function buildSignals(body: AnalyzeJobBody): AnalysisSignal[] {
  const signals: AnalysisSignal[] = []
  const desc = body.descriptionText ?? ""

  // Salary — prefer salaryText, fall back to regex on description
  const salaryFromField = body.salaryText?.trim()
  const salaryFromDesc = matchSnippet(desc, SALARY_RE, 0)
  if (salaryFromField || salaryFromDesc) {
    signals.push({
      label: salaryFromField ?? salaryFromDesc!,
      type: "salary",
      evidence: salaryFromField ? "from page" : salaryFromDesc,
      confidence: salaryFromField ? "high" : "medium",
    })
  }

  // Work mode
  const employmentType = body.employmentType?.toLowerCase() ?? ""
  const inferRemote = REMOTE_RE.test(desc) || REMOTE_RE.test(employmentType) || REMOTE_RE.test(body.location ?? "")
  const inferHybrid = HYBRID_RE.test(desc) || HYBRID_RE.test(employmentType) || HYBRID_RE.test(body.location ?? "")
  const inferOnsite = ONSITE_RE.test(desc) || ONSITE_RE.test(employmentType)
  if (inferRemote) {
    signals.push({ label: "Remote", type: "work_mode", confidence: "medium" })
  } else if (inferHybrid) {
    signals.push({ label: "Hybrid", type: "work_mode", confidence: "medium" })
  } else if (inferOnsite) {
    signals.push({ label: "On-site", type: "work_mode", confidence: "medium" })
  }

  // Location
  if (body.location) {
    signals.push({
      label: body.location,
      type: "location",
      confidence: "high",
    })
  }

  // Sponsorship — surfaced both as top-level and as a signal
  const sponsorship = detectSponsorship(desc)
  if (sponsorship.status === "no_sponsorship") {
    signals.push({
      label: "No visa sponsorship",
      type: "sponsorship",
      evidence: sponsorship.evidence[0],
      confidence: "high",
    })
  } else if (sponsorship.status === "likely") {
    signals.push({
      label: "Sponsorship available",
      type: "sponsorship",
      evidence: sponsorship.evidence[0],
      confidence: "medium",
    })
  }

  // Years-of-experience requirement
  const yoe = YEARS_EXPERIENCE_RE.exec(desc)
  if (yoe && yoe[1]) {
    signals.push({
      label: `${yoe[1]}+ years of experience`,
      type: "requirement",
      evidence: matchSnippet(desc, YEARS_EXPERIENCE_RE),
      confidence: "high",
    })
  }

  // Actively recruiting / hiring urgency. Trust the client flag first; fall
  // back to text detection so older extensions that didn't set the flag still
  // surface this signal in the analysis panel.
  const haystack = `${body.title ?? ""} ${desc}`
  const activelyHiring = body.activelyHiring === true || ACTIVELY_HIRING_RE.test(haystack)
  if (activelyHiring) {
    signals.push({
      label: "Actively recruiting",
      type: "requirement", // closest existing type — no "urgency" type in the spec
      evidence: matchSnippet(haystack, ACTIVELY_HIRING_RE) ?? "from page",
      confidence: body.activelyHiring === true ? "high" : "medium",
    })
  }

  return signals
}

function inferEmploymentType(raw: string | undefined): EmploymentType | null {
  const value = raw?.toLowerCase() ?? ""
  if (/\bintern(ship)?\b/.test(value)) return "internship"
  if (/\bpart[-\s]?time\b/.test(value)) return "parttime"
  if (/\bcontract\b|\btemporary\b|\btemp\b|\bfreelance\b/.test(value)) return "contract"
  if (/\bfull[-\s]?time\b/.test(value)) return "fulltime"
  return null
}

function inferSeniorityLevel(title: string, description: string | null): SeniorityLevel | null {
  const text = `${title} ${description ?? ""}`.toLowerCase()
  if (/\bintern(ship)?\b|\bco[-\s]?op\b|\bapprentice\b/.test(text)) return "intern"
  if (/\bvice president\b|\bvp\b/.test(text)) return "vp"
  if (/\bchief\b|\bcto\b|\bceo\b|\bcio\b|\bcso\b|\bcoo\b|\bcfo\b|\bexecutive\b/.test(text)) return "exec"
  if (/\bdirector\b/.test(text)) return "director"
  if (/\bprincipal\b/.test(text)) return "principal"
  if (/\bstaff\b/.test(text)) return "staff"
  if (/\bsenior\b|\bsr\.?\b|\blead\b/.test(text)) return "senior"
  if (/\bjunior\b|\bjr\.?\b|\bentry[-\s]?level\b|\bassociate\b/.test(text)) return "junior"
  if (/\bmid[-\s]?level\b|\bintermediate\b/.test(text)) return "mid"
  return null
}

function inferWorkModeFlags(body: AnalyzeJobBody, description: string): {
  isRemote: boolean
  isHybrid: boolean
} {
  const employmentType = body.employmentType?.toLowerCase() ?? ""
  const location = body.location ?? ""
  const isRemote =
    REMOTE_RE.test(description) || REMOTE_RE.test(employmentType) || REMOTE_RE.test(location)
  const isHybrid =
    !isRemote &&
    (HYBRID_RE.test(description) || HYBRID_RE.test(employmentType) || HYBRID_RE.test(location))
  return { isRemote, isHybrid }
}

function scoreFromSponsorshipStatus(status: "likely" | "no_sponsorship" | "unclear" | "unknown"): number {
  if (status === "likely") return 85
  if (status === "no_sponsorship") return 0
  if (status === "unclear") return 60
  return 65
}

function buildSyntheticJobForScoring(body: AnalyzeJobBody): Job {
  const now = new Date().toISOString()
  const title = body.title?.trim() || "Unknown Role"
  const description = body.descriptionText?.trim() || null
  const textForSkills = `${title} ${description ?? ""}`.trim()
  const extractedSkills =
    textForSkills.length >= 40 ? extractSkillsFromText(textForSkills).slice(0, 40) : []
  const sponsorship = detectSponsorship(description ?? undefined)
  const { isRemote, isHybrid } = inferWorkModeFlags(body, description ?? "")

  const applyUrl =
    normalizeExtensionJobUrl(body.applyUrl) ??
    normalizeExtensionJobUrl(body.canonicalUrl) ??
    normalizeExtensionJobUrl(body.url) ??
    body.url

  return {
    id: ZERO_UUID,
    company_id: ZERO_UUID,
    title,
    department: null,
    location: body.location?.trim() || null,
    is_remote: isRemote,
    is_hybrid: isHybrid,
    employment_type: inferEmploymentType(body.employmentType),
    seniority_level: inferSeniorityLevel(title, description),
    salary_min: null,
    salary_max: null,
    salary_currency: "USD",
    description,
    apply_url: applyUrl,
    external_id: null,
    first_detected_at: now,
    last_seen_at: now,
    is_active: true,
    sponsors_h1b: sponsorship.status === "likely" ? true : sponsorship.status === "no_sponsorship" ? false : null,
    sponsorship_score: scoreFromSponsorshipStatus(sponsorship.status),
    visa_language_detected: sponsorship.evidence[0] ?? null,
    requires_authorization: sponsorship.status === "no_sponsorship",
    skills: extractedSkills.length > 0 ? extractedSkills : null,
    normalized_title: null,
    raw_data: {
      source: body.source,
      detectedAts: body.detectedAts ?? null,
      extensionSyntheticJob: true,
      url: body.url,
      canonicalUrl: body.canonicalUrl ?? null,
      applyUrl: body.applyUrl ?? null,
    },
    h1b_prediction: null,
    h1b_prediction_at: null,
    created_at: now,
    updated_at: now,
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function POST(request: Request) {
  const corsHeaders = extensionCorsHeaders(request.headers.get("origin"))

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const [body, bodyError] = await readExtensionJsonBody<AnalyzeJobBody>(request)
  if (bodyError) return bodyError

  if (!body.url?.trim()) {
    return extensionError(request, 400, "url is required", { headers: corsHeaders })
  }

  // existsInHireoven: best-effort lookup, never write.
  // Use the same multi-candidate normalized lookup as /check so we don't
  // disagree with the bar's existence check (HTTP vs HTTPS canonical, gh_src
  // tracking params, etc. would cause false negatives otherwise).
  const pool = getPostgresPool()
  let jobId: string | undefined
  let existingJob: Job | undefined
  const fingerprint = buildExtensionJobFingerprint({
    urls: [body.applyUrl, body.url, body.canonicalUrl],
    externalJobId: null,
  })
  const candidates = fingerprint.candidateUrls
  const externalIds = fingerprint.externalJobIds
  if (candidates.length > 0 || externalIds.length > 0) {
    try {
      const existing = await pool.query<Job>(
        `SELECT *
         FROM jobs
         WHERE (
           (array_length($1::text[], 1) IS NOT NULL AND apply_url = ANY($1::text[]))
           OR (array_length($2::text[], 1) IS NOT NULL AND external_id = ANY($2::text[]))
         )
         LIMIT 1`,
        [candidates, externalIds],
      )
      if (existing.rows[0]) {
        existingJob = existing.rows[0]
        jobId = existingJob.id
      }
    } catch {
      // DB lookup is non-blocking — analyze still works without it.
    }
  }

  // Whether the user has a saved application for this job
  let userHasSaved = false
  if (jobId) {
    try {
      const saved = await pool.query<{ id: string }>(
        `SELECT id FROM job_applications
         WHERE user_id = $1::uuid AND job_id = $2::uuid AND is_archived = false
         LIMIT 1`,
        [user.sub, jobId],
      )
      userHasSaved = saved.rows.length > 0
    } catch {
      // ignore
    }
  }

  const source: SupportedSite = body.detectedAts ?? body.source
  const autofill = AUTOFILL_BY_SOURCE[source] ?? AUTOFILL_BY_SOURCE.unknown
  const sponsorship = detectSponsorship(body.descriptionText)
  const signals = buildSignals(body)

  // ── Match scoring against the user's primary resume ──────────────────────
  // Uses the same fast scorer as the main app so extension + dashboard stay
  // aligned. Signals are derived from the same score breakdown.
  let matchScore: number | undefined
  try {
    const skillSignals = await computeSkillMatch({
      userId: user.sub,
      body,
      existingJob,
    })
    signals.push(...skillSignals.signals)
    matchScore = skillSignals.matchScore
  } catch (err) {
    console.warn("[extension/jobs/analyze] match scoring failed:", err)
    // Leave matchScore undefined — caller renders nothing.
  }

  const response: AnalysisResponse = {
    jobId,
    existsInHireoven: Boolean(jobId),
    matchScore,
    autofillSupported: autofill.supported,
    detectedAts: source !== "unknown" ? source : undefined,
    // Ghost risk stays unknown until a real ghost-detection service exists
    // (posting age / repost detection / dead apply URL probes). Per spec:
    // omit rather than invent.
    ghostRisk: { level: "unknown", reasons: [] },
    sponsorship,
    signals,
    actions: {
      canSave: !userHasSaved,
      canAnalyze: true,
      // Tailor is a handoff to the web app's existing flow — always available
      // when the extension can extract a job. Web app gates resume mutations
      // (user must approve changes there).
      canTailorResume: true,
      canAutofill: autofill.supported,
    },
  }

  return NextResponse.json(response, { headers: corsHeaders })
}

// ── Skill matching ──────────────────────────────────────────────────────────

/**
 * Compute match score + matched/missing skill signals using the shared fast
 * scorer from the main app. Falls back to a lightweight skill overlap signal
 * only when the scorer has no surfaced skill breakdown.
 */
async function computeSkillMatch(args: {
  userId: string
  body: AnalyzeJobBody
  existingJob?: Job
}): Promise<{
  signals: AnalysisSignal[]
  matchScore?: number
}> {
  const context = await getScoringContextForUser(args.userId)
  if (!context) return { signals: [] }

  const scoreJob = args.existingJob ?? buildSyntheticJobForScoring(args.body)
  const resumeContext = buildFastScoreResumeContext(context.resume)
  const fastScore = computeFastScore({
    resume: context.resume,
    job: scoreJob,
    profile: context.profile,
    resumeContext,
  })

  const breakdown = fastScore.score_breakdown
  const signalText = `${scoreJob.title} ${scoreJob.description ?? ""}`.trim()
  const matchedFromScorer = Array.from(
    new Set(
      (breakdown?.matchedSkills ?? [])
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  )
  const missingFromScorer = Array.from(
    new Set(
      (breakdown?.missingSkills ?? [])
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  )

  const out: AnalysisSignal[] = []
  matchedFromScorer.sort((a, b) => b.length - a.length).slice(0, 6).forEach((s) => {
    out.push({ label: s, type: "matched_skill", evidence: snippetAroundSkill(signalText, s), confidence: "high" })
  })
  missingFromScorer.sort((a, b) => b.length - a.length).slice(0, 6).forEach((s) => {
    out.push({ label: s, type: "missing_skill", evidence: snippetAroundSkill(signalText, s), confidence: "high" })
  })

  // Fallback signal path for sparse jobs where the scorer had no skill list.
  if (out.length === 0) {
    out.push(...computeFallbackSkillSignals(signalText, context.resume))
  }

  return { signals: out, matchScore: fastScore.overall_score }
}

function computeFallbackSkillSignals(text: string, resume: Resume): AnalysisSignal[] {
  if (text.length < 80) return []
  const jdSkills = extractSkillsFromText(text)
  if (jdSkills.length === 0) return []

  const resumeSkills = (resume.top_skills ?? []).filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  )
  if (resumeSkills.length === 0) return []

  const matched: string[] = []
  const missing: string[] = []
  for (const required of jdSkills) {
    const hit = resumeSkills.find((cand) => skillMatches(required, cand))
    if (hit) matched.push(required)
    else missing.push(required)
  }

  const out: AnalysisSignal[] = []
  matched.sort((a, b) => b.length - a.length).slice(0, 6).forEach((s) => {
    out.push({ label: s, type: "matched_skill", evidence: snippetAroundSkill(text, s), confidence: "high" })
  })
  missing.sort((a, b) => b.length - a.length).slice(0, 6).forEach((s) => {
    out.push({ label: s, type: "missing_skill", evidence: snippetAroundSkill(text, s), confidence: "high" })
  })
  return out
}

function snippetAroundSkill(text: string, skill: string, padding = 60): string | undefined {
  const idx = text.toLowerCase().indexOf(skill.toLowerCase())
  if (idx < 0) return undefined
  const start = Math.max(0, idx - padding)
  const end = Math.min(text.length, idx + skill.length + padding)
  return text.slice(start, end).replace(/\s+/g, " ").trim()
}

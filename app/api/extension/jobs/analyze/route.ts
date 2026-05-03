/**
 * POST /api/extension/jobs/analyze
 *
 * Scout MVP analyze endpoint. Deterministic only — no AI calls, no scoring.
 *
 * Returns:
 *   - existsInHireoven (lookup-only, never writes)
 *   - autofillSupported (mapping by ATS source)
 *   - sponsorship (regex on description text)
 *   - signals (cheap deterministic facts: salary, location, work_mode, requirement)
 *   - actions (UI gates)
 *
 * matchScore is intentionally omitted — there is no extension-side match
 * scorer wired yet. ghostRisk is "unknown" until ghost detection lands.
 */

import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extensionCorsHeaders,
  extensionError,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"
import { extractSkillsFromText, skillMatches } from "@/lib/skills/taxonomy"

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

// Mirrors normalizeUrl in /save and /check — strips tracking params
// (utm_*, gclid, fbclid, gh_src, etc.), drops hash, trims trailing slashes,
// and collapses LinkedIn URLs to canonical /jobs/view/[id]/.
//
// Without this, an analyze request from a page like
//   https://job-boards.greenhouse.io/kepora/jobs/4233066009?gh_src=...
// does an exact-match SELECT against the stored URL and misses, leaving
// existsInHireoven=false and actions.canSave=true even when the user
// already has the job saved (which /check correctly reports as saved).
function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  try {
    const parsed = new URL(raw.trim())
    parsed.hash = ""
    if (
      (parsed.hostname === "www.linkedin.com" || parsed.hostname === "linkedin.com") &&
      /^\/jobs\//.test(parsed.pathname)
    ) {
      const fromPath = parsed.pathname.match(/^\/jobs\/view\/(\d+)/)?.[1]
      const fromQuery = parsed.searchParams.get("currentJobId")
      const jobId = fromPath ?? fromQuery
      if (jobId && /^\d+$/.test(jobId)) {
        return `https://www.linkedin.com/jobs/view/${jobId}/`
      }
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|source|share|ref|trk|gh_src)/i.test(key)) {
        parsed.searchParams.delete(key)
      }
    }
    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "")
    }
    return parsed.toString()
  } catch {
    return raw.trim()
  }
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
  const candidates = [body.applyUrl, body.url, body.canonicalUrl]
    .map((u) => normalizeUrl(u))
    .filter((u): u is string => Boolean(u))
  if (candidates.length > 0) {
    try {
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM jobs WHERE apply_url = ANY($1::text[]) LIMIT 1`,
        [candidates],
      )
      if (existing.rows[0]) jobId = existing.rows[0].id
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

  // ── Skill matching against the user's primary resume ─────────────────────
  // Only fires when (a) the JD has enough text to extract skills from, AND
  // (b) the user actually has a resume on file with top_skills populated.
  // Otherwise no skill signals or matchScore are emitted (per spec: omit
  // rather than invent).
  let matchScore: number | undefined
  try {
    const skillSignals = await computeSkillMatch({
      userId: user.sub,
      descriptionText: body.descriptionText ?? "",
      title: body.title ?? "",
    })
    signals.push(...skillSignals.signals)
    matchScore = skillSignals.matchScore
  } catch (err) {
    console.warn("[extension/jobs/analyze] skill match failed:", err)
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
 * Compute matched / missing skill signals + a coarse skill-driven match score
 * by comparing skills extracted from the JD against the user's primary
 * resume's `top_skills`.
 *
 * Hard rules:
 *   - No resume → no signals, no score (we don't invent).
 *   - JD too thin to extract any skills → no missing-skill signals (we don't
 *     manufacture "missing X" when we can't see X being required), and no
 *     score.
 *   - Score is the percentage of detected JD skills that are also on the
 *     resume, capped at 95 so a perfect overlap on a thin JD doesn't read
 *     as a 100% match.
 */
async function computeSkillMatch(args: {
  userId: string
  descriptionText: string
  title: string
}): Promise<{
  signals: AnalysisSignal[]
  matchScore?: number
}> {
  const text = `${args.title} ${args.descriptionText}`.trim()
  if (text.length < 80) return { signals: [] }

  const jdSkills = extractSkillsFromText(text)
  if (jdSkills.length === 0) return { signals: [] }

  const pool = getPostgresPool()
  const r = await pool.query<{ top_skills: string[] | null }>(
    `SELECT top_skills FROM resumes
       WHERE user_id = $1 AND parse_status = 'complete'
       ORDER BY is_primary DESC NULLS LAST, updated_at DESC
       LIMIT 1`,
    [args.userId],
  )
  const resumeSkills = (r.rows[0]?.top_skills ?? []).filter((s): s is string => typeof s === "string" && s.length > 0)
  if (resumeSkills.length === 0) {
    // No resume on file (or empty top_skills) → can't make a real comparison.
    return { signals: [] }
  }

  const matched: string[] = []
  const missing: string[] = []
  for (const required of jdSkills) {
    const hit = resumeSkills.find((cand) => skillMatches(required, cand))
    if (hit) matched.push(required)
    else     missing.push(required)
  }

  const out: AnalysisSignal[] = []
  // Top 6 of each, longest first — feels more meaningful than "Git, Excel, …"
  matched.sort((a, b) => b.length - a.length).slice(0, 6).forEach((s) => {
    out.push({ label: s, type: "matched_skill", evidence: snippetAroundSkill(text, s), confidence: "high" })
  })
  missing.sort((a, b) => b.length - a.length).slice(0, 6).forEach((s) => {
    out.push({ label: s, type: "missing_skill", evidence: snippetAroundSkill(text, s), confidence: "high" })
  })

  const total = matched.length + missing.length
  const matchScore = total > 0
    ? Math.min(95, Math.round((matched.length / total) * 100))
    : undefined

  return { signals: out, matchScore }
}

function snippetAroundSkill(text: string, skill: string, padding = 60): string | undefined {
  const idx = text.toLowerCase().indexOf(skill.toLowerCase())
  if (idx < 0) return undefined
  const start = Math.max(0, idx - padding)
  const end = Math.min(text.length, idx + skill.length + padding)
  return text.slice(start, end).replace(/\s+/g, " ").trim()
}

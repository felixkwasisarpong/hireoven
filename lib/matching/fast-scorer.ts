/**
 * Fast resume↔job scorer — pure TypeScript, runs in-process with no external calls.
 *
 * Seven weighted dimensions (weights sum to 1.0):
 *   skills 0.35 · experience 0.20 · title 0.10 · education 0.10
 *   domain 0.10 · certs 0.05 · semantic 0.10
 *
 * Hard gates applied after aggregation:
 *   missing-required-cert          → cap at 60
 *   >50 % required skills missing  → cap at 50
 *   relevant-years < 50 % required → cap at 55
 *   hard disqualifier              → cap at 25
 */

import type {
  Job,
  JobMatchScoreInsert,
  Profile,
  Resume,
  WorkExperience,
  SeniorityLevel,
} from "@/types"
import {
  canonicalizeSkill,
  getAllResumeSkillLabels,
  normalizeSkillKey,
} from "@/lib/skills/taxonomy"

export interface FastScoreInput {
  resume: Resume
  job: Job
  profile: Profile
  resumeContext?: FastScoreResumeContext
}

type ResumeExperienceSnapshot = {
  title: string
  titleTokens: Set<string>
  seniorityTier: number
  descriptionLower: string
  is_current: boolean
  endYear: number | null
}

export interface FastScoreResumeContext {
  candidateSkillKeys: string[]
  candidateSkillKeySet: Set<string>
  experienceByRecency: ResumeExperienceSnapshot[]
  experienceForTitles: ResumeExperienceSnapshot[]
  hasProgressiveSeniority: boolean
  topSeniorityTier: number
  years: number
  resumeIndustries: string[]
  resumeIndustrySet: Set<string>
  resumeCertificationsLower: string[]
  semanticTokens: Set<string>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear()

const W = {
  skills:     0.35,
  experience: 0.20,
  title:      0.10,
  education:  0.10,
  domain:     0.10,
  certs:      0.05,
  semantic:   0.10,
} as const

// ─── Primitive helpers ────────────────────────────────────────────────────────

function extractYear(s: string | null | undefined): number | null {
  const m = /\b(20\d{2}|19\d{2})\b/.exec(s ?? "")
  return m ? parseInt(m[1], 10) : null
}

function tokenize(text: string | null | undefined): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let n = 0
  for (const t of a) if (b.has(t)) n++
  return n / (a.size + b.size - n)
}

function clamp(v: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v))
}

function rankExperienceByRecency(a: ResumeExperienceSnapshot, b: ResumeExperienceSnapshot) {
  if (a.is_current !== b.is_current) return a.is_current ? -1 : 1
  return (b.endYear ?? 0) - (a.endYear ?? 0)
}

function hasNormalizedSkillOverlap(requiredKey: string, candidateKey: string) {
  if (!requiredKey || !candidateKey) return false
  return (
    requiredKey === candidateKey ||
    (requiredKey.length >= 3 && candidateKey.includes(requiredKey)) ||
    (candidateKey.length >= 3 && requiredKey.includes(candidateKey))
  )
}

// ─── 1. Skills (weight 0.35) ──────────────────────────────────────────────────

function inferLastUsedYear(
  skillName: string,
  experienceByRecency: ResumeExperienceSnapshot[]
): number | null {
  const lower = skillName.toLowerCase()
  for (const exp of experienceByRecency) {
    if (exp.descriptionLower.includes(lower)) {
      return exp.is_current ? CURRENT_YEAR : exp.endYear
    }
  }
  return null
}

function recency(skillName: string, resumeContext: FastScoreResumeContext): number {
  const y = inferLastUsedYear(skillName, resumeContext.experienceByRecency)
  return y !== null && CURRENT_YEAR - y > 5 ? 0.5 : 1.0
}

function scoreSkills(resumeContext: FastScoreResumeContext, job: Job) {
  const jobSkills = job.skills ?? []
  if (jobSkills.length === 0) {
    return { score: 1.0, matched: [] as string[], missing: [] as string[], evidence: "No skills listed for this role.", certGate: false }
  }

  const missing: string[] = []
  const missingSet = new Set<string>()
  let sum = 0

  for (const req of jobSkills) {
    const reqKey = normalizeSkillKey(canonicalizeSkill(req))
    // Fast-path: exact key match (Set lookup O(1))
    // Slow-path: normalized overlap check (only when key misses)
    let found = resumeContext.candidateSkillKeySet.has(reqKey)
    if (!found) {
      for (const candidateKey of resumeContext.candidateSkillKeys) {
        if (hasNormalizedSkillOverlap(reqKey, candidateKey)) {
          found = true
          break
        }
      }
    }
    if (found) {
      sum += recency(req, resumeContext)
      continue
    }
    missing.push(req)
    missingSet.add(req)
  }

  const matched = jobSkills.filter((skill) => !missingSet.has(skill))
  let score = sum / jobSkills.length
  if (missing.length > 0) score = Math.min(score, 0.7)

  const label = missing.length > 3
    ? `${missing.slice(0, 3).join(", ")} +${missing.length - 3} more`
    : missing.join(", ")
  const evidence = missing.length === 0
    ? `Matched all ${jobSkills.length} required skills.`
    : `Matched ${matched.length}/${jobSkills.length}; missing: ${label}.`

  return { score, matched, missing, evidence, certGate: false }
}

// ─── 2. Experience (weight 0.20) ──────────────────────────────────────────────

const MIN_YEARS_PATTERNS = [
  // Range "X-Y years" or "X to Y years" — always take the lower bound
  /(\d+)\s*[-–to]\s*\d+\s*years?\s+of\s+(?:professional\s+|relevant\s+|work\s+)?(?:software\s+)?experience/i,
  /(\d+)\+?\s*years?\s+of\s+(?:professional\s+|relevant\s+|work\s+)?(?:software\s+)?experience/i,
  /(?:minimum|at least|minimum of)\s*(\d+)\s*\+?\s*years?\s+(?:of\s+)?(?:professional\s+|relevant\s+)?experience/i,
  /(\d+)\+?\s*years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|hands[- ]on\s+)?experience\b/i,
  /experience\s*[:\-]?\s*(\d+)\+?\s*years?/i,
]

function extractMinYears(desc: string | null | undefined): number {
  if (!desc) return 0
  // Most specific patterns first; last resort excluded to avoid matching
  // company history ("15+ years in business") or unrelated numbers.
  for (const re of MIN_YEARS_PATTERNS) {
    const m = re.exec(desc)
    if (m) {
      const n = parseInt(m[1], 10)
      // Sanity bounds: 1–20 years. Catches "100+ years in business" etc.
      if (n >= 1 && n <= 20) return n
    }
  }
  return 0
}

function roleYears(exp: { start_date: string; end_date: string | null; is_current: boolean }): number {
  const start = extractYear(exp.start_date)
  if (!start) return 0
  if (exp.is_current) return CURRENT_YEAR - start
  const end = extractYear(exp.end_date)
  // Unknown end date on a past role: assume ~1 year rather than inflating to present
  if (!end) return 1
  return Math.max(0, end - start)
}

function candidateYears(resume: Resume): number {
  // years_of_experience is LLM-parsed and far more reliable than date arithmetic.
  if (resume.years_of_experience != null && resume.years_of_experience > 0) {
    return resume.years_of_experience
  }
  // Fallback: sum role durations (capped at 40 to guard bad dates)
  const summed = (resume.work_experience ?? []).reduce((s, exp) => s + roleYears(exp), 0)
  return Math.min(summed, 40)
}

// Minimum years implied by seniority level — used as a floor when the JD
// states an unusually low number (e.g. "2+ years" for a Senior role).
const SENIORITY_YEAR_FLOOR: Partial<Record<SeniorityLevel, number>> = {
  junior: 1, mid: 3, senior: 5, staff: 7, principal: 8, director: 10, vp: 12, exec: 15,
}

function scoreExperience(resumeContext: FastScoreResumeContext, job: Job) {
  const extracted = extractMinYears(job.description)
  const seniorityFloor = (job.seniority_level ? SENIORITY_YEAR_FLOOR[job.seniority_level] : 0) ?? 0
  // Use the higher of: what the JD explicitly says vs what the seniority implies
  const required = Math.max(extracted, seniorityFloor)
  const years = resumeContext.years

  if (required <= 0) {
    return {
      score: 1.0,
      evidence: `No minimum experience required; candidate has ${years.toFixed(1)} years.`,
      flags: [] as string[],
      relevantYears: years,
      required: 0,
    }
  }

  const score = clamp(years / required)
  const flags: string[] = years > 2.5 * required ? ["overqualified"] : []
  const evidence = years >= required
    ? `${years.toFixed(1)} years meets the ${required}-year requirement${flags.includes("overqualified") ? " (possibly overqualified)" : ""}.`
    : `${years.toFixed(1)} of ${required} required years.`

  return { score, evidence, flags, relevantYears: years, required }
}

// ─── 3. Title (weight 0.10) ───────────────────────────────────────────────────

const SENIORITY_TIERS = [
  ["intern", "trainee", "graduate", "entry"],
  ["junior", "jr", "associate"],
  ["mid", "intermediate", "engineer", "developer", "analyst", "specialist"],
  ["senior", "sr", "lead", "principal", "staff"],
  ["director", "vp", "head", "chief"],
]

// Only strip seniority qualifiers — keep role-type words (engineer, scientist, manager)
// so "Software Engineer" and "Data Scientist" don't collapse to the same token set.
const TITLE_STOP = new Set([
  "and", "or", "the", "a", "an", "of", "in", "for", "to", "with", "at",
  "senior", "sr", "junior", "jr", "lead", "principal", "staff", "associate",
  "i", "ii", "iii", "iv",
])

function seniorityTier(title: string): number {
  const l = title.toLowerCase()
  for (let i = 0; i < SENIORITY_TIERS.length; i++) {
    if (SENIORITY_TIERS[i].some(kw => l.includes(kw))) return i
  }
  return 2
}

function titleTokens(t: string): Set<string> {
  return new Set(
    t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter(w => w.length > 1 && !TITLE_STOP.has(w))
  )
}

function scoreTitle(resumeContext: FastScoreResumeContext, job: Job) {
  if (resumeContext.experienceForTitles.length === 0) {
    return { score: 0.35, evidence: "No past titles on resume." }
  }

  const jdTok = titleTokens(job.title)
  let maxSim = 0
  let bestTitle = ""
  for (const exp of resumeContext.experienceForTitles) {
    const sim = jaccard(jdTok, exp.titleTokens)
    if (sim > maxSim) { maxSim = sim; bestTitle = exp.title }
  }

  // Seniority progression bonus: ascending levels ending near target
  const targetTier = seniorityTier(job.title)
  const bonus = resumeContext.hasProgressiveSeniority &&
    resumeContext.experienceForTitles.length > 1 &&
    resumeContext.topSeniorityTier >= targetTier - 1
    ? 0.1
    : 0

  // Jaccard on title tokens is low (0.05–0.4); scale into useful range
  const score = clamp(maxSim * 1.8 + 0.25 + bonus)
  const evidence = `Best title match "${bestTitle}" vs "${job.title}" (sim ${maxSim.toFixed(2)})${bonus > 0 ? "; seniority progression bonus" : ""}.`

  return { score, evidence }
}

// ─── 4. Education (weight 0.10) ───────────────────────────────────────────────

// Fields that are relevant for tech/engineering roles
const TECH_FIELDS = new Set([
  "computer science", "computer engineering", "software engineering",
  "electrical engineering", "information technology", "information systems",
  "data science", "mathematics", "statistics", "physics", "engineering",
  "computational science", "applied mathematics", "systems engineering",
  "mathematics and computer science", "math", "cs", "cse", "it",
])

// Fields relevant for business/PM/ops roles
const BUSINESS_FIELDS = new Set([
  "business administration", "business", "management", "finance",
  "economics", "marketing", "accounting", "mba", "operations management",
])

const TECH_JOB_RE = /\b(engineer|developer|programmer|architect|devops|sre|scientist|data|ml|ai|software|backend|frontend|fullstack|full.?stack|cloud|platform|infrastructure|security|analytics)\b/i

const BUSINESS_JOB_RE = /\b(product manager|project manager|operations|marketing|sales|finance|accounting|strategy|business analyst)\b/i

function fieldRelevance(field: string, job: Job): number {
  // Combine job title + description for context; both inform what field is relevant
  const jobText = `${job.title} ${job.description ?? ""}`.toLowerCase()
  const f = (field ?? "").toLowerCase().trim()

  if (!f) return 0.75  // no field listed — neutral, don't penalise

  // Exact / substring match against the job text (e.g. field "Data Science" in a data science JD)
  if (f.length > 3 && jobText.includes(f)) return 1.0

  const isTechJob = TECH_JOB_RE.test(job.title)
  const isBusinessJob = BUSINESS_JOB_RE.test(job.title)

  if (isTechJob) {
    if (TECH_FIELDS.has(f)) return 1.0
    // Partial: any engineering/science/computing word in the field name
    if (/\b(engineer|science|computing|technology|technical|math|physics|stat|data|information|system)\b/.test(f)) return 0.9
    if (BUSINESS_FIELDS.has(f)) return 0.55
    return 0.45
  }

  if (isBusinessJob) {
    if (BUSINESS_FIELDS.has(f)) return 1.0
    if (TECH_FIELDS.has(f)) return 0.65
    return 0.5
  }

  // Unclassified job type — be generous; field mismatch is rarely catastrophic
  return 0.75
}

function degreeRank(d: string | null | undefined): number {
  const t = (d ?? "").toLowerCase()
  if (/(ph\.?d|doctor(ate|al)?|d\.phil|sc\.d|d\.eng)/.test(t)) return 5
  if (/(master|m\.?s\.?\b|m\.?eng\b|m\.?b\.?a\b|m\.?a\.?\b|mfa|mph|msc\b|mba\b)/.test(t)) return 4
  if (/(bachelor|b\.?s\.?\b|b\.?a\.?\b|b\.?eng\b|b\.?sc\b|b\.?e\.?\b|undergrad)/.test(t)) return 3
  if (/(associate|a\.?s\.?\b|a\.?a\.?\b|a\.?a\.?s\b|diploma)/.test(t)) return 2
  if (/(high school|ged|secondary)/.test(t)) return 1
  return 0
}

function detectRequiredDegree(job: Job): { rank: number; isHard: boolean } {
  const text = `${job.description ?? ""} ${job.title}`.toLowerCase()
  let rank = 0
  if (/(ph\.?d|doctor(ate|al))/.test(text)) rank = 5
  else if (/(master(?:'?s)?|m\.?s\.?\b|graduate degree)/.test(text)) rank = 4
  else if (/(bachelor(?:'?s)?|b\.?s\.?\b|undergraduate|four.year degree)/.test(text)) rank = 3
  else if (/(associate(?:'?s)?)/.test(text)) rank = 2

  const hasRequiredSignal = /(required|must have|minimum|mandatory)\b/.test(text)
  const hasExemption = /\b(or equivalent|or related|or relevant experience|or commensurate)\b/.test(text)
  const isPreferred = /\b(preferred|a plus|nice to have|desired)\b/.test(text) && !hasRequiredSignal
  const isHard = rank > 0 && hasRequiredSignal && !hasExemption && !isPreferred

  return { rank, isHard }
}

function scoreEducation(resume: Resume, job: Job) {
  const { rank: required, isHard } = detectRequiredDegree(job)
  if (required === 0) return { score: 0.85, evidence: "No degree requirement specified." }

  const edus = resume.education ?? []
  if (edus.length === 0) {
    // No education data at all — soft penalty; many roles accept equivalent experience
    return { score: isHard ? 0.35 : 0.55, evidence: `No education listed; ${required >= 4 ? "master's" : "bachelor's"} expected.` }
  }

  let best = 0
  let evidence = ""
  for (const edu of edus) {
    const cr = degreeRank(edu.degree)
    const diff = required - cr
    // Hierarchical score: over-qualified → 1.0, one level below → softer penalty
    const hier = diff <= 0 ? 1.0 : diff === 1 ? (isHard ? 0.5 : 0.7) : (isHard ? 0.25 : 0.45)
    const fr = fieldRelevance(edu.field, job)
    const combined = clamp(hier * fr)
    if (combined > best) {
      best = combined
      evidence = `${edu.degree}${edu.field ? ` in ${edu.field}` : ""} from ${edu.institution} (level ${hier.toFixed(2)}, field relevance ${fr.toFixed(2)}).`
    }
  }

  return { score: best, evidence }
}

// ─── 5. Domain (weight 0.10) ──────────────────────────────────────────────────

const ADJACENT_PAIRS: Array<[string, string]> = [
  ["fintech", "finance"], ["fintech", "banking"], ["fintech", "technology"],
  ["finance", "banking"], ["finance", "technology"], ["finance", "saas"],
  ["healthtech", "healthcare"],
  ["edtech", "education"],
  ["e-commerce", "retail"],
  ["saas", "technology"], ["saas", "fintech"],
  ["technology", "cybersecurity"], ["technology", "data analytics"],
  ["media", "entertainment"], ["gaming", "entertainment"],
]

// Pre-build bidirectional adjacency Map for O(1) lookups at scoring time.
const ADJACENT_MAP = new Map<string, Set<string>>()
for (const [a, b] of ADJACENT_PAIRS) {
  if (!ADJACENT_MAP.has(a)) ADJACENT_MAP.set(a, new Set())
  if (!ADJACENT_MAP.has(b)) ADJACENT_MAP.set(b, new Set())
  ADJACENT_MAP.get(a)!.add(b)
  ADJACENT_MAP.get(b)!.add(a)
}

const JOB_INDUSTRY_KEYWORDS: Record<string, string[]> = {
  // More specific industries first — "software" is in almost every tech JD so
  // checking "technology" early would swallow finance, healthcare, etc.
  fintech:          ["fintech", "payments platform", "payment processing", "neobank"],
  healthcare:       ["healthcare", "health system", "medical", "clinical", "biotech", "pharma"],
  "data analytics": ["data analytics", "data science platform", "business intelligence"],
  "e-commerce":     ["e-commerce", "ecommerce", "online marketplace", "direct-to-consumer"],
  cybersecurity:    ["cybersecurity", "infosec", "information security", "zero trust"],
  finance:          ["asset management", "investment management", "investment bank", "hedge fund",
                     "wealth management", "financial services", "brokerage", "insurance carrier",
                     "capital markets", "private equity", "venture capital", "trading firm",
                     "finance", "investment"],
  education:        ["edtech", "education technology", "e-learning", "higher education", "university"],
  media:            ["media company", "streaming", "content platform", "publishing"],
  gaming:           ["gaming", "game studio", "esports"],
  // "technology" and "saas" last — they use generic words like "software", "tech", "platform"
  // that appear in virtually every job description.
  saas:             ["saas", "software-as-a-service", "cloud platform", "developer tools"],
  technology:       ["tech company", "technology company", "software company", "startup"],
}

function inferJobIndustry(job: Job): string | null {
  const text = `${job.title} ${job.description ?? ""}`.toLowerCase()
  for (const [industry, keywords] of Object.entries(JOB_INDUSTRY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return industry
  }
  return null
}

function scoreDomain(resumeContext: FastScoreResumeContext, job: Job) {
  if (resumeContext.resumeIndustries.length === 0) return { score: 0.5, evidence: "No industry history on resume." }

  const jobIndustry = inferJobIndustry(job)
  if (!jobIndustry) return { score: 0.65, evidence: "Job industry not determinable from description." }

  if (resumeContext.resumeIndustrySet.has(jobIndustry)) {
    return { score: 1.0, evidence: `Direct ${jobIndustry} industry experience.` }
  }

  // O(1) adjacency lookup via pre-built Map
  const adjacent = ADJACENT_MAP.get(jobIndustry)
  if (adjacent) {
    for (const ind of resumeContext.resumeIndustries) {
      if (adjacent.has(ind)) {
        return { score: 0.7, evidence: `Adjacent industry experience (${ind} → ${jobIndustry}).` }
      }
    }
  }

  return { score: 0.35, evidence: `No industry overlap (resume: ${resumeContext.resumeIndustries.slice(0, 2).join(", ")}; job: ${jobIndustry}).` }
}

// ─── 6. Certs (weight 0.05) ───────────────────────────────────────────────────

const CERT_REQUIRED_RE =
  /(?:required|must have|minimum)\s*[^.]*?(aws[\w\s-]*(?:certified|certification)[\w\s-]*|cka|ckad|cks|pmp|cissp|ceh|ccna|ccnp|azure[\w\s-]*certified[\w\s-]*|google[\w\s-]*certified[\w\s-]*)/gi

function extractRequiredCerts(desc: string | null | undefined): string[] {
  const found = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(CERT_REQUIRED_RE.source, "gi")
  while ((m = re.exec(desc ?? "")) !== null) found.add(m[1].toLowerCase().trim())
  return [...found]
}

function scoreCerts(resumeContext: FastScoreResumeContext, job: Job) {
  const required = extractRequiredCerts(job.description)
  if (required.length === 0) return { score: 1.0, evidence: "No certification requirements detected.", certGate: false }

  const missing = required.filter(
    (req) => !resumeContext.resumeCertificationsLower.some((hc) => hc.includes(req) || req.includes(hc))
  )

  if (missing.length > 0) {
    return { score: 0.0, evidence: `Missing required cert(s): ${missing.join(", ")}.`, certGate: true }
  }
  return { score: 1.0, evidence: `Has all required certifications: ${required.join(", ")}.`, certGate: false }
}

// ─── 7. Semantic overlap (weight 0.10) ────────────────────────────────────────

// Section headers that contain actual requirements — we want these.
const REQ_HEADERS = new Set([
  "qualifications", "requirements", "required", "preferred",
  "preferred qualifications", "nice to have", "what you need",
  "minimum qualifications", "basic qualifications", "what we're looking for",
  "responsibilities", "what you'll do", "role summary", "the role",
  "key responsibilities", "what you will do",
])
// Pre-built arrays for startsWith checks — avoids spread in the per-line hot loop
const REQ_HEADERS_ARR = [...REQ_HEADERS]

const BOILERPLATE_HEADERS = new Set([
  "benefits", "compensation", "base salary", "salary range", "placement",
  "work flexibility", "commitment to diversity", "equal opportunity",
  "finra requirements", "finra", "learn more", "featured employee benefits",
  "about us", "about the company", "about t. rowe price", "about",
])
const BOILERPLATE_HEADERS_ARR = [...BOILERPLATE_HEADERS]

function extractRequirementsText(description: string | null | undefined): string {
  if (!description) return ""

  const lines = description.split(/\r?\n/)
  const kept: string[] = []
  // Start false — skip company-intro paragraphs that precede the first real section.
  let capturing = false

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    // Normalise for header matching: strip trailing punctuation/whitespace
    const norm = trimmed.toLowerCase().replace(/[:\-–*•#\s]+$/, "").trim()

    // Check boilerplate first (higher priority)
    if (BOILERPLATE_HEADERS.has(norm) || BOILERPLATE_HEADERS_ARR.some(h => norm.startsWith(h))) {
      capturing = false
      continue
    }

    if (REQ_HEADERS.has(norm) || REQ_HEADERS_ARR.some(h => norm.startsWith(h))) {
      capturing = true
      continue
    }

    if (capturing) kept.push(trimmed)
  }

  // Fallback: if no headers were found (flat JD), use the full description
  const result = kept.join(" ")
  return result.length > 80 ? result : description
}

function scoreSemanticOverlap(resumeContext: FastScoreResumeContext, job: Job) {
  // Only score against the requirements / responsibilities text, not boilerplate.
  const jdRequirements = extractRequirementsText(job.description)
  const jobTok = new Set(tokenize(`${job.title} ${jdRequirements}`))

  // Jaccard on requirements text is still low (0.05–0.35); ×2 maps a solid
  // match (jaccard≈0.30) to ~0.60 rather than instantly hitting 1.0.
  const score = clamp(jaccard(resumeContext.semanticTokens, jobTok) * 2)
  return { score, evidence: `Requirements text overlap: ${(score * 100).toFixed(0)}%.` }
}

// ─── Location + sponsorship (hard-gate contributors, not primary weights) ──────

const SENIORITY_MAP: Record<SeniorityLevel, number> = {
  intern: 1, junior: 2, mid: 3, senior: 4, staff: 5,
  principal: 6, director: 7, vp: 8, exec: 9,
}

export function getSeniorityGap(c: SeniorityLevel | null | undefined, j: SeniorityLevel | null | undefined) {
  return c && j ? SENIORITY_MAP[c] - SENIORITY_MAP[j] : null
}

function getSponsorshipScore(profile: Profile, job: Job) {
  if (!profile.needs_sponsorship) return { score: 100, compatible: true }
  if (job.sponsors_h1b) return { score: 100, compatible: true }
  const s = job.sponsorship_score ?? 0
  if (s >= 80) return { score: 85, compatible: true }
  if (s >= 60) return { score: 65, compatible: true }
  if (job.requires_authorization) return { score: 0, compatible: false }
  return { score: s < 30 ? 20 : 50, compatible: false }
}

export function getResumeVersion(resume: Resume): number {
  const t = new Date(resume.updated_at).getTime()
  return Number.isFinite(t) && t > 0 ? Math.floor(t / 1000) : 1
}

function toResumeExperienceSnapshot(exp: WorkExperience): ResumeExperienceSnapshot {
  return {
    title: exp.title,
    titleTokens: titleTokens(exp.title),
    seniorityTier: seniorityTier(exp.title),
    descriptionLower: exp.description.toLowerCase(),
    is_current: exp.is_current,
    endYear: extractYear(exp.end_date),
  }
}

export function buildFastScoreResumeContext(resume: Resume): FastScoreResumeContext {
  const candidateSkillKeys = getAllResumeSkillLabels(resume).map((candidateSkill) =>
    normalizeSkillKey(canonicalizeSkill(candidateSkill))
  )

  const experienceForTitles = (resume.work_experience ?? []).map(toResumeExperienceSnapshot)
  const experienceByRecency = [...experienceForTitles].sort(rankExperienceByRecency)
  const tiers = experienceForTitles.map((exp) => exp.seniorityTier)
  const hasProgressiveSeniority = tiers.every((tier, index) => index === 0 || tiers[index - 1] <= tier)
  const topSeniorityTier = tiers.length > 0 ? Math.max(...tiers) : 2

  const resumeIndustries = (resume.industries ?? [])
    .map((industry) => industry.toLowerCase().trim())
    .filter(Boolean)

  const semanticText = [
    ...(resume.skills?.technical ?? []),
    ...(resume.skills?.soft ?? []),
    ...(resume.top_skills ?? []),
    ...(resume.work_experience ?? []).map((exp) => `${exp.title} ${exp.description}`),
  ].join(" ")

  return {
    candidateSkillKeys,
    candidateSkillKeySet: new Set(candidateSkillKeys),
    experienceByRecency,
    experienceForTitles,
    hasProgressiveSeniority,
    topSeniorityTier,
    years: candidateYears(resume),
    resumeIndustries,
    resumeIndustrySet: new Set(resumeIndustries),
    resumeCertificationsLower: (resume.skills?.certifications ?? []).map((cert) => cert.toLowerCase()),
    semanticTokens: new Set(tokenize(semanticText)),
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function computeFastScore({
  resume,
  job,
  profile,
  resumeContext,
}: FastScoreInput): JobMatchScoreInsert {
  const context = resumeContext ?? buildFastScoreResumeContext(resume)
  const skills     = scoreSkills(context, job)
  const experience = scoreExperience(context, job)
  const title      = scoreTitle(context, job)
  const education  = scoreEducation(resume, job)
  const domain     = scoreDomain(context, job)
  const certs      = scoreCerts(context, job)
  const semantic   = scoreSemanticOverlap(context, job)
  const sponsorship = getSponsorshipScore(profile, job)
  const seniorityGap = getSeniorityGap(resume.seniority_level, job.seniority_level)

  // Weighted sum → 0–100
  let overall = Math.round(
    skills.score     * W.skills     * 100 +
    experience.score * W.experience * 100 +
    title.score      * W.title      * 100 +
    education.score  * W.education  * 100 +
    domain.score     * W.domain     * 100 +
    certs.score      * W.certs      * 100 +
    semantic.score   * W.semantic   * 100
  )

  // Hard gates (applied after weighted sum, in order of severity)
  const gatesTriggered: string[] = []
  const totalRequired = job.skills?.length ?? 0

  if (certs.certGate) {
    overall = Math.min(overall, 60)
    gatesTriggered.push("missing_required_cert")
  }

  if (totalRequired > 0 && skills.missing.length / totalRequired > 0.5) {
    overall = Math.min(overall, 50)
    gatesTriggered.push("missing_required_skills_gt50pct")
  }

  const minYears = extractMinYears(job.description)
  if (minYears > 0 && experience.score < 0.5) {
    overall = Math.min(overall, 55)
    gatesTriggered.push("insufficient_experience")
  }

  // Sponsorship: use the sponsorship scorer's own compatible determination.
  // Do NOT check requires_authorization directly — it conflicts with the scorer
  // which already factors in sponsorship_score (72% signal → compatible:true even
  // if requires_authorization is set as boilerplate).
  if (profile.needs_sponsorship && !sponsorship.compatible) {
    overall = Math.min(overall, 45)
    gatesTriggered.push("sponsorship_incompatible")
  }

  // Hybrid is partial remote — only gate fully on-site jobs for remote-only candidates
  if (!job.is_remote && !job.is_hybrid && profile.remote_only) {
    overall = Math.min(overall, 40)
    gatesTriggered.push("remote_only_mismatch")
  }

  // Seniority gap > 3 levels is a true extreme mismatch (e.g. exec applying for intern)
  if (seniorityGap !== null && Math.abs(seniorityGap) > 3) {
    overall = Math.min(overall, 35)
    gatesTriggered.push("extreme_seniority_mismatch")
  }

  overall = clamp(overall, 0, 100)

  const now = new Date().toISOString()
  const confidence = skills.missing.length === 0 && experience.score >= 0.8
    ? "high" as const
    : skills.missing.length / Math.max(1, totalRequired) > 0.5
      ? "low" as const
      : "medium" as const

  return {
    user_id: resume.user_id,
    resume_id: resume.id,
    job_id: job.id,
    overall_score: overall,
    skills_score:          Math.round(skills.score * 100),
    seniority_score:       Math.round(experience.score * 100),  // experience → seniority slot
    education_score:       Math.round(education.score * 100),
    role_fit_score:        Math.round(title.score * 100),        // title → role_fit slot
    location_score:        null,
    employment_type_score: null,
    sponsorship_score:     sponsorship.score,
    is_seniority_match:    experience.score >= 0.5,
    is_education_match:    education.score >= 0.6,
    is_role_fit_match:     title.score >= 0.5,
    is_location_match:     null,
    is_employment_type_match: null,
    is_sponsorship_compatible: sponsorship.compatible,
    matching_skills_count: skills.matched.length,
    total_required_skills: totalRequired,
    skills_match_rate:     totalRequired > 0
      ? Number((skills.matched.length / totalRequired).toFixed(3))
      : null,
    score_method:  "fast",
    computed_at:   now,
    resume_version: getResumeVersion(resume),
    // score_breakdown is not persisted to DB (no column) but the single-job route
    // attaches it to the response so the detail panel can render skill pills.
    score_breakdown: {
      overallScore:        overall,
      skillsScore:         Math.round(skills.score * 100),
      experienceScore:     Math.round(experience.score * 100),
      seniorityScore:      null,
      locationScore:       null,
      employmentTypeScore: null,
      sponsorshipScore:    sponsorship.score,
      visaFitScore:        null,
      freshnessScore:      null,
      matchedSkills:       skills.matched,
      missingSkills:       skills.missing,
      totalRequiredSkills: totalRequired,
      scoreMethod:         "fast",
      confidence,
      concerns: [
        ...(skills.missing.length > 0
          ? [`Missing ${skills.missing.length} required skill${skills.missing.length !== 1 ? "s" : ""}`]
          : []),
        ...gatesTriggered.map(g => `Gate: ${g}`),
      ],
      computedAt: now,
    },
  }
}

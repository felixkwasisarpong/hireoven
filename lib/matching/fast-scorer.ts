/**
 * Fast resume↔job scorer — pure TypeScript, runs in-process with no external calls.
 *
 * Eight weighted dimensions (weights sum to 1.0):
 *   skills 0.40 · experience 0.22 · title 0.10 · education 0.10
 *   location 0.05 · domain 0.03 · certs 0.02 · semantic 0.08
 *
 * Hard gates applied after aggregation:
 *   missing-required-cert (≥5 required)  → –15 pts, floor 45
 *   >60 % required skills missing (≥5)   → cap at 55
 *   relevant-years < 40 % required       → cap at 55
 *   hard disqualifier                    → cap at 25
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
  extractSkillsFromText,
  filterSkillsByTextEvidence,
  getAllResumeSkillLabels,
  normalizeSkillKey,
  normalizeSkillList,
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
  skills:     0.40,
  experience: 0.22,
  title:      0.10,
  education:  0.10,
  location:   0.05,
  domain:     0.03,
  certs:      0.02,
  semantic:   0.08,
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

// Exact key match only — the taxonomy alias system handles synonyms.
// Substring matching caused false positives (e.g. "rust" inside "trust",
// "java" inside "javascript"). Rely on normalizeSkillKey + canonicalizeSkill
// to collapse variations before comparison.
function hasNormalizedSkillOverlap(requiredKey: string, candidateKey: string) {
  return requiredKey.length > 0 && candidateKey.length > 0 && requiredKey === candidateKey
}

// ─── 1. Skills (weight 0.40) ──────────────────────────────────────────────────

type SkillsScoreResult = {
  score: number
  matched: string[]
  missing: string[]
  evidence: string
  certGate: boolean
  requiredCount: number
}

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

// Gradual recency decay — skills used recently score full credit; older skills
// decay smoothly rather than a hard cliff at 5 years.
function recency(skillName: string, resumeContext: FastScoreResumeContext): number {
  const y = inferLastUsedYear(skillName, resumeContext.experienceByRecency)
  if (y === null) return 1.0   // no evidence of last use → assume current
  const age = CURRENT_YEAR - y
  if (age <= 2) return 1.0
  if (age <= 4) return 0.90
  if (age <= 6) return 0.75
  return 0.55
}

function deriveSkillsFromJobText(job: Job): string[] {
  const description = job.description ?? ""
  const requirementsText = extractRequirementsText(description)
  const derivedFromRequirements = filterSkillsByTextEvidence(
    normalizeSkillList(
      extractSkillsFromText(job.title, requirementsText),
      24
    ),
    job.title,
    requirementsText
  )

  if (derivedFromRequirements.length > 0) return derivedFromRequirements

  return filterSkillsByTextEvidence(
    normalizeSkillList(extractSkillsFromText(job.title, description), 24),
    job.title,
    description
  )
}

function scoreSkills(resumeContext: FastScoreResumeContext, job: Job): SkillsScoreResult {
  const storedJobSkills = filterSkillsByTextEvidence(
    normalizeSkillList(job.skills ?? [], 24),
    job.title,
    job.description ?? ""
  )
  const usedDerivedSkills = storedJobSkills.length === 0
  const jobSkills = usedDerivedSkills ? deriveSkillsFromJobText(job) : storedJobSkills

  if (jobSkills.length === 0) {
    return {
      score: 0.55,
      matched: [],
      missing: [],
      evidence:
        "No reliable skills detected in this posting; applied a neutral skills score.",
      certGate: false,
      requiredCount: 0,
    }
  }

  const missing: string[] = []
  const missingSet = new Set<string>()
  let sum = 0

  for (const req of jobSkills) {
    const reqKey = normalizeSkillKey(canonicalizeSkill(req))
    const found = resumeContext.candidateSkillKeySet.has(reqKey) ||
      resumeContext.candidateSkillKeys.some(ck => hasNormalizedSkillOverlap(reqKey, ck))

    if (found) {
      sum += recency(req, resumeContext)
      continue
    }
    missing.push(req)
    missingSet.add(req)
  }

  const matched = jobSkills.filter((skill) => !missingSet.has(skill))
  const score = sum / jobSkills.length

  const sourcePrefix = usedDerivedSkills
    ? `Structured skills were missing; derived ${jobSkills.length} skill${jobSkills.length === 1 ? "" : "s"} from posting text. `
    : ""
  const label = missing.length > 3
    ? `${missing.slice(0, 3).join(", ")} +${missing.length - 3} more`
    : missing.join(", ")
  const evidence = missing.length === 0
    ? `${sourcePrefix}Matched all ${jobSkills.length} required skills.`
    : `${sourcePrefix}Matched ${matched.length}/${jobSkills.length}; missing: ${label}.`

  return {
    score,
    matched,
    missing,
    evidence,
    certGate: false,
    requiredCount: jobSkills.length,
  }
}

// ─── 2. Experience (weight 0.22) ──────────────────────────────────────────────

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
  for (const re of MIN_YEARS_PATTERNS) {
    const m = re.exec(desc)
    if (m) {
      const n = parseInt(m[1], 10)
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
  if (!end) return 1
  return Math.max(0, end - start)
}

function candidateYears(resume: Resume): number {
  if (resume.years_of_experience != null && resume.years_of_experience > 0) {
    return resume.years_of_experience
  }
  const summed = (resume.work_experience ?? []).reduce((s, exp) => s + roleYears(exp), 0)
  return Math.min(summed, 40)
}

const SENIORITY_YEAR_FLOOR: Partial<Record<SeniorityLevel, number>> = {
  junior: 1, mid: 3, senior: 5, staff: 7, principal: 8, director: 10, vp: 12, exec: 15,
}

function scoreExperience(resumeContext: FastScoreResumeContext, job: Job) {
  const extracted = extractMinYears(job.description)
  const seniorityFloor = (job.seniority_level ? SENIORITY_YEAR_FLOOR[job.seniority_level] : 0) ?? 0
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

  const targetTier = seniorityTier(job.title)
  const bonus = resumeContext.hasProgressiveSeniority &&
    resumeContext.experienceForTitles.length > 1 &&
    resumeContext.topSeniorityTier >= targetTier - 1
    ? 0.1
    : 0

  const score = clamp(maxSim * 1.8 + 0.25 + bonus)
  const evidence = `Best title match "${bestTitle}" vs "${job.title}" (sim ${maxSim.toFixed(2)})${bonus > 0 ? "; seniority progression bonus" : ""}.`

  return { score, evidence }
}

// ─── 4. Education (weight 0.10) ───────────────────────────────────────────────

const TECH_FIELDS = new Set([
  "computer science", "computer engineering", "software engineering",
  "electrical engineering", "information technology", "information systems",
  "data science", "mathematics", "statistics", "physics", "engineering",
  "computational science", "applied mathematics", "systems engineering",
  "mathematics and computer science", "math", "cs", "cse", "it",
])

const BUSINESS_FIELDS = new Set([
  "business administration", "business", "management", "finance",
  "economics", "marketing", "accounting", "mba", "operations management",
  "communications", "public relations", "journalism", "advertising",
  "psychology", "sociology", "liberal arts", "english", "political science",
  "international relations", "human resources", "organizational behavior",
])

const HEALTHCARE_FIELDS = new Set([
  "nursing", "medicine", "pharmacy", "pharmacology", "public health",
  "biology", "biochemistry", "chemistry", "microbiology", "health sciences",
  "health administration", "clinical psychology", "physical therapy",
  "occupational therapy", "nutrition", "kinesiology", "pre-med",
  "medical laboratory science", "radiologic technology",
])

const DESIGN_FIELDS = new Set([
  "graphic design", "visual design", "industrial design", "product design",
  "communication design", "interaction design", "human-computer interaction",
  "hci", "fine arts", "art", "animation", "illustration", "photography",
  "film", "media arts", "interior design", "architecture",
])

const LEGAL_FIELDS = new Set([
  "law", "juris doctor", "jd", "legal studies", "pre-law",
  "political science", "criminal justice", "paralegal studies",
])

const EDUCATION_FIELDS = new Set([
  "education", "teaching", "curriculum design", "instructional design",
  "educational psychology", "early childhood education", "special education",
])

// Job type detectors — checked against job title only for speed
const TECH_JOB_RE       = /\b(engineer|developer|programmer|architect|devops|sre|scientist|data|ml|ai|software|backend|frontend|fullstack|full.?stack|cloud|platform|infrastructure|security|analytics)\b/i
const HEALTHCARE_JOB_RE = /\b(nurse|nursing|physician|doctor|clinical|medical|healthcare|pharmacist|therapist|patient care|hospital|dental|radiology|surgeon|clinician|caregiver)\b/i
const DESIGN_JOB_RE     = /\b(designer|design lead|ux|ui|creative director|art director|brand designer|visual designer|motion designer|illustrator|animator)\b/i
const MARKETING_JOB_RE  = /\b(marketing|growth|demand generation|brand manager|content strategist|seo specialist|sem|social media|communications?|public relations|pr manager|copywriter)\b/i
const SALES_JOB_RE      = /\b(sales|account executive|account manager|business development|bdr|sdr|revenue|customer success|solutions engineer)\b/i
const HR_JOB_RE         = /\b(human resources|recruiter|recruiting|talent acquisition|hrbp|people ops|people operations|compensation|workforce)\b/i
const LEGAL_JOB_RE      = /\b(lawyer|attorney|legal counsel|paralegal|compliance officer|general counsel)\b/i
const FINANCE_JOB_RE    = /\b(financial analyst|finance manager|controller|cfo|investment|trader|banker|auditor|actuar|fp&a|treasury)\b/i
const OPS_JOB_RE        = /\b(supply chain|logistics|procurement|warehouse|manufacturing|program manager|project manager|operations manager)\b/i
const EDUCATION_JOB_RE  = /\b(teacher|instructor|professor|curriculum|learning|training|coach|educator|academic)\b/i

function fieldRelevance(field: string, job: Job): number {
  const jobText = `${job.title} ${job.description ?? ""}`.toLowerCase()
  const f = (field ?? "").toLowerCase().trim()

  if (!f) return 0.75
  // Exact substring match against job description is the strongest signal
  if (f.length > 3 && jobText.includes(f)) return 1.0

  const title = job.title

  if (TECH_JOB_RE.test(title)) {
    if (TECH_FIELDS.has(f)) return 1.0
    if (/\b(engineer|science|computing|technology|technical|math|physics|stat|data|information|system)\b/.test(f)) return 0.9
    if (BUSINESS_FIELDS.has(f)) return 0.6
    return 0.55
  }

  if (HEALTHCARE_JOB_RE.test(title)) {
    if (HEALTHCARE_FIELDS.has(f)) return 1.0
    if (TECH_FIELDS.has(f)) return 0.75   // bioinformatics, CS relevant in health tech
    if (BUSINESS_FIELDS.has(f)) return 0.6
    return 0.6
  }

  if (DESIGN_JOB_RE.test(title)) {
    if (DESIGN_FIELDS.has(f)) return 1.0
    if (TECH_FIELDS.has(f)) return 0.8    // CS grads common in UX/product design
    return 0.6
  }

  if (MARKETING_JOB_RE.test(title)) {
    if (BUSINESS_FIELDS.has(f)) return 1.0
    if (DESIGN_FIELDS.has(f)) return 0.8  // creative/design grads common in marketing
    if (TECH_FIELDS.has(f)) return 0.7
    return 0.6
  }

  if (SALES_JOB_RE.test(title)) {
    if (BUSINESS_FIELDS.has(f)) return 1.0
    if (TECH_FIELDS.has(f)) return 0.75   // technical sales values CS background
    return 0.65
  }

  if (HR_JOB_RE.test(title)) {
    if (BUSINESS_FIELDS.has(f)) return 1.0
    if (f.includes("psychology") || f.includes("sociology") || f.includes("human")) return 0.95
    if (TECH_FIELDS.has(f)) return 0.6
    return 0.65
  }

  if (LEGAL_JOB_RE.test(title)) {
    if (LEGAL_FIELDS.has(f)) return 1.0
    if (BUSINESS_FIELDS.has(f)) return 0.7
    return 0.55
  }

  if (FINANCE_JOB_RE.test(title)) {
    if (BUSINESS_FIELDS.has(f)) return 1.0
    if (TECH_FIELDS.has(f)) return 0.75   // quant finance values CS/math
    return 0.55
  }

  if (OPS_JOB_RE.test(title)) {
    if (BUSINESS_FIELDS.has(f)) return 1.0
    if (TECH_FIELDS.has(f)) return 0.8
    if (f.includes("supply chain") || f.includes("industrial") || f.includes("logistics")) return 1.0
    return 0.65
  }

  if (EDUCATION_JOB_RE.test(title)) {
    if (EDUCATION_FIELDS.has(f)) return 1.0
    if (BUSINESS_FIELDS.has(f)) return 0.65
    return 0.7
  }

  // Unknown job type — be generous; field mismatch is rarely catastrophic
  return 0.8
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
    return { score: isHard ? 0.35 : 0.55, evidence: `No education listed; ${required >= 4 ? "master's" : "bachelor's"} expected.` }
  }

  let best = 0
  let evidence = ""
  for (const edu of edus) {
    const cr = degreeRank(edu.degree)
    const diff = required - cr
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

// ─── 5. Location (weight 0.05) ────────────────────────────────────────────────

function scoreLocation(profile: Profile, job: Job) {
  // Remote-only candidates can't work onsite
  if (profile.remote_only && !job.is_remote && !job.is_hybrid) {
    return { score: 0.3, evidence: "Candidate is remote-only; job is onsite.", locationMatch: false }
  }

  if (job.is_remote) {
    return { score: 1.0, evidence: "Remote role — location compatible.", locationMatch: true }
  }

  if (job.is_hybrid) {
    return { score: 0.85, evidence: "Hybrid role — partially location flexible.", locationMatch: true }
  }

  // Onsite: check desired_locations against job location
  const desired = (profile.desired_locations ?? []).map(l => l.toLowerCase().trim()).filter(Boolean)
  const jobLoc = (job.location ?? "").toLowerCase()

  if (desired.length === 0 || !jobLoc) {
    return { score: 0.7, evidence: "On-site role; no location preference set.", locationMatch: null }
  }

  const locationMatch = desired.some(loc => {
    const tokens = loc.split(/[,\s]+/).filter(t => t.length > 2)
    return tokens.some(t => jobLoc.includes(t))
  })

  return locationMatch
    ? { score: 1.0, evidence: `On-site location match (${job.location}).`, locationMatch: true }
    : { score: 0.45, evidence: `On-site location mismatch: desired ${profile.desired_locations?.join(", ")}, job ${job.location}.`, locationMatch: false }
}

// ─── 6. Domain (weight 0.03) ──────────────────────────────────────────────────

const ADJACENT_PAIRS: Array<[string, string]> = [
  ["fintech", "finance"], ["fintech", "banking"], ["fintech", "technology"],
  ["finance", "banking"], ["finance", "technology"], ["finance", "saas"],
  ["finance", "insurance"],
  ["healthtech", "healthcare"], ["healthtech", "technology"],
  ["edtech", "education"], ["edtech", "technology"],
  ["e-commerce", "retail"], ["e-commerce", "technology"],
  ["saas", "technology"], ["saas", "fintech"],
  ["technology", "cybersecurity"], ["technology", "data analytics"],
  ["media", "entertainment"], ["gaming", "entertainment"], ["gaming", "technology"],
  ["consulting", "fintech"], ["consulting", "technology"], ["consulting", "finance"],
  ["real estate", "finance"], ["real estate", "technology"],
  ["manufacturing", "logistics"], ["manufacturing", "technology"],
  ["retail", "e-commerce"], ["retail", "technology"],
  ["marketing", "media"], ["marketing", "technology"],
  ["non-profit", "education"], ["non-profit", "healthcare"],
  ["government", "technology"], ["government", "consulting"],
]

const ADJACENT_MAP = new Map<string, Set<string>>()
for (const [a, b] of ADJACENT_PAIRS) {
  if (!ADJACENT_MAP.has(a)) ADJACENT_MAP.set(a, new Set())
  if (!ADJACENT_MAP.has(b)) ADJACENT_MAP.set(b, new Set())
  ADJACENT_MAP.get(a)!.add(b)
  ADJACENT_MAP.get(b)!.add(a)
}

const JOB_INDUSTRY_KEYWORDS: Record<string, string[]> = {
  // Specific industries first — generic terms checked last
  fintech:          ["fintech", "payments platform", "payment processing", "neobank", "digital banking"],
  healthcare:       ["healthcare", "health system", "hospital", "medical center", "clinical", "biotech",
                     "pharmaceutical", "pharma", "health insurance", "medical device"],
  "data analytics": ["data analytics", "data science platform", "business intelligence", "analytics platform"],
  "e-commerce":     ["e-commerce", "ecommerce", "online marketplace", "direct-to-consumer", "dtc"],
  cybersecurity:    ["cybersecurity", "infosec", "information security", "zero trust", "managed security"],
  finance:          ["asset management", "investment management", "investment bank", "hedge fund",
                     "wealth management", "financial services", "brokerage", "insurance carrier",
                     "capital markets", "private equity", "venture capital", "trading firm",
                     "financial institution", "credit union"],
  "real estate":    ["real estate", "property management", "commercial real estate", "realty", "proptech"],
  manufacturing:    ["manufacturing", "factory", "production facility", "industrial", "automotive",
                     "aerospace", "defense contractor", "semiconductor", "electronics manufacturer"],
  retail:           ["retailer", "retail chain", "consumer goods", "cpg", "grocery", "apparel", "fashion brand"],
  logistics:        ["logistics", "supply chain company", "freight", "shipping company", "fulfillment",
                     "last-mile delivery"],
  education:        ["edtech", "education technology", "e-learning", "higher education", "university",
                     "school district", "online learning"],
  media:            ["media company", "streaming", "content platform", "publishing", "news organization",
                     "broadcast", "digital media"],
  gaming:           ["gaming", "game studio", "game developer", "esports", "video game"],
  marketing:        ["marketing agency", "advertising agency", "digital agency", "pr firm", "creative agency"],
  "non-profit":     ["non-profit", "nonprofit", "ngo", "foundation", "501c3", "charity", "social impact"],
  government:       ["government agency", "federal agency", "state agency", "public sector", "department of"],
  consulting:       ["consulting firm", "management consulting", "strategy consulting", "advisory firm"],
  insurance:        ["insurance company", "insurer", "underwriting", "actuarial", "insurtech"],
  saas:             ["saas", "software-as-a-service", "cloud platform", "developer tools", "enterprise software"],
  technology:       ["tech company", "technology company", "software company", "startup", "tech startup"],
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
  if (!jobIndustry) return { score: 0.75, evidence: "Job industry not determinable from description." }

  if (resumeContext.resumeIndustrySet.has(jobIndustry)) {
    return { score: 1.0, evidence: `Direct ${jobIndustry} industry experience.` }
  }

  const adjacent = ADJACENT_MAP.get(jobIndustry)
  if (adjacent) {
    for (const ind of resumeContext.resumeIndustries) {
      if (adjacent.has(ind)) {
        return { score: 0.75, evidence: `Adjacent industry experience (${ind} → ${jobIndustry}).` }
      }
    }
  }

  return { score: 0.45, evidence: `No industry overlap (resume: ${resumeContext.resumeIndustries.slice(0, 2).join(", ")}; job: ${jobIndustry}).` }
}

// ─── 7. Certs (weight 0.02) ───────────────────────────────────────────────────

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
    // Soft gate: missing cert applies a score penalty rather than a hard cap,
    // so a strong overall match isn't completely killed by a single cert gap.
    return { score: 0.1, evidence: `Missing required cert(s): ${missing.join(", ")}.`, certGate: true }
  }
  return { score: 1.0, evidence: `Has all required certifications: ${required.join(", ")}.`, certGate: false }
}

// ─── 8. Semantic overlap (weight 0.08) ────────────────────────────────────────

const REQ_HEADERS = new Set([
  "qualifications", "requirements", "required", "preferred",
  "preferred qualifications", "nice to have", "what you need",
  "minimum qualifications", "basic qualifications", "what we're looking for",
  "responsibilities", "what you'll do", "role summary", "the role",
  "key responsibilities", "what you will do",
])
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
  let capturing = false

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    const norm = trimmed.toLowerCase().replace(/[:\-–*•#\s]+$/, "").trim()

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

  const result = kept.join(" ")
  return result.length > 80 ? result : description
}

function scoreSemanticOverlap(resumeContext: FastScoreResumeContext, job: Job) {
  const jdRequirements = extractRequirementsText(job.description)
  const jobTok = new Set(tokenize(`${job.title} ${jdRequirements}`))
  const score = clamp(jaccard(resumeContext.semanticTokens, jobTok) * 3.5)
  return { score, evidence: `Requirements text overlap: ${(score * 100).toFixed(0)}%.` }
}

// ─── Sponsorship / seniority helpers ─────────────────────────────────────────

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
  const location   = scoreLocation(profile, job)
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
    location.score   * W.location   * 100 +
    domain.score     * W.domain     * 100 +
    certs.score      * W.certs      * 100 +
    semantic.score   * W.semantic   * 100
  )

  // Hard gates (applied after weighted sum, in order of severity)
  const gatesTriggered: string[] = []
  const totalRequired = skills.requiredCount

  // Cert gate — soft penalty (–15 pts) rather than hard cap, preserving strong
  // overall matches. Certs are obtainable; a 95-match candidate shouldn't be
  // capped at 60 for missing a single cert.
  if (certs.certGate) {
    overall = Math.max(45, overall - 15)
    gatesTriggered.push("missing_required_cert")
  }

  // Skills gate — only fires when there are enough skills to make the ratio
  // meaningful (≥5 required). Sparse job listings with 2–3 skills shouldn't
  // trigger an aggressive cap when the candidate is missing just one.
  if (totalRequired >= 5 && skills.missing.length / totalRequired > 0.6) {
    overall = Math.min(overall, 55)
    gatesTriggered.push("missing_required_skills_gt60pct")
  }

  // Experience gate — threshold lowered from 0.4 to 0.35 to avoid
  // over-penalising candidates who are slightly under the stated minimum.
  const minYears = extractMinYears(job.description)
  if (minYears > 0 && experience.score < 0.35) {
    overall = Math.min(overall, 55)
    gatesTriggered.push("insufficient_experience")
  }

  // Extreme seniority mismatch (e.g. exec applying for intern)
  if (seniorityGap !== null && Math.abs(seniorityGap) > 3) {
    overall = Math.min(overall, 35)
    gatesTriggered.push("extreme_seniority_mismatch")
  }

  overall = clamp(overall, 0, 100)

  // Curve: stretch scores above 55 upward so strong matches reach 90–98.
  if (overall > 55) {
    overall = Math.min(99, Math.round(overall + (overall - 55) * 0.25))
  }

  const now = new Date().toISOString()
  const confidence = skills.missing.length === 0 && experience.score >= 0.8
    ? "high" as const
    : totalRequired === 0
      ? "low" as const
    : skills.missing.length / Math.max(1, totalRequired) > 0.5
      ? "low" as const
      : "medium" as const

  return {
    user_id: resume.user_id,
    resume_id: resume.id,
    job_id: job.id,
    overall_score: overall,
    skills_score:          Math.round(skills.score * 100),
    seniority_score:       Math.round(experience.score * 100),
    education_score:       Math.round(education.score * 100),
    role_fit_score:        Math.round(title.score * 100),
    location_score:        Math.round(location.score * 100),
    employment_type_score: null,
    sponsorship_score:     sponsorship.score,
    is_seniority_match:    experience.score >= 0.5,
    is_education_match:    education.score >= 0.6,
    is_role_fit_match:     title.score >= 0.5,
    is_location_match:     location.locationMatch,
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
    score_breakdown: {
      overallScore:        overall,
      skillsScore:         Math.round(skills.score * 100),
      experienceScore:     Math.round(experience.score * 100),
      seniorityScore:      null,
      locationScore:       Math.round(location.score * 100),
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
        ...(totalRequired === 0
          ? ["Job posting skills were not reliably structured; confidence is reduced."]
          : []),
        ...(skills.missing.length > 0
          ? [`Missing ${skills.missing.length} required skill${skills.missing.length !== 1 ? "s" : ""}`]
          : []),
        ...gatesTriggered.map(g => `Gate: ${g}`),
      ],
      computedAt: now,
    },
  }
}

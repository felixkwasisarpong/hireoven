/**
 * Fast resume↔job scorer — pure TypeScript, runs in-process with no external calls.
 *
 * Seven weighted dimensions (weights sum to 1.0):
 *   skills 0.45 · experience 0.22 · title 0.10 · education 0.10
 *   domain 0.03 · certs 0.02 · semantic 0.08
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
  /**
   * Role families inferred from the candidate's three most recent roles.
   * Used by the role-family gate to reject obvious cross-domain matches
   * (e.g. SWE matched to physical-security / inspection / clinical roles).
   */
  recentRoleFamilies: RoleFamily[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear()

const W = {
  skills:     0.45,
  experience: 0.22,
  title:      0.10,
  education:  0.10,
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
  // Always union stored ∪ text-derived. Previously we only fell back to
  // text-derivation when stored was empty — but a job with a single soft skill
  // like {"Problem Solving"} would skip derivation entirely, letting a candidate
  // match 1/1 = 100% while the JD actually demanded HTML, .NET, Docker, etc.
  const derivedSkills = deriveSkillsFromJobText(job)
  const seenKeys = new Set<string>()
  const jobSkills: string[] = []
  for (const skill of [...storedJobSkills, ...derivedSkills]) {
    const key = normalizeSkillKey(canonicalizeSkill(skill))
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    jobSkills.push(skill)
  }
  const usedDerivedSkills = storedJobSkills.length === 0 && derivedSkills.length > 0

  if (jobSkills.length === 0) {
    return {
      // Lowered from 0.55 → 0.40: when we can't extract skills it usually
      // means the JD is non-technical. A neutral-high default lets unrelated
      // roles ride the missing-signal up into the 90s.
      score: 0.40,
      matched: [],
      missing: [],
      evidence:
        "No reliable skills detected in this posting; applied a conservative score.",
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

function scoreExperience(
  resumeContext: FastScoreResumeContext,
  job: Job,
  resumeSeniority?: SeniorityLevel | null
) {
  const extracted = extractMinYears(job.description)
  const seniorityFloor = (job.seniority_level ? SENIORITY_YEAR_FLOOR[job.seniority_level] : 0) ?? 0
  const required = Math.max(extracted, seniorityFloor)
  const years = resumeContext.years

  // Over-qualification penalty: when the candidate is meaningfully above the
  // job's seniority tier, return a partial score instead of the implicit 1.0
  // that years/required would produce. Without this, an 8-year senior would
  // match cashier/intern roles at seniority=100% just because years >> minimum.
  const gap = getSeniorityGap(resumeSeniority, job.seniority_level)
  if (gap !== null && gap >= 2) {
    // gap=2 (senior→junior) = 0.55, gap=3 (senior→intern) = 0.35,
    // gap=4 (staff→intern) = 0.20 (the extreme_seniority gate caps at 35 anyway)
    const overqualPenalty = Math.max(0.20, 0.85 - 0.20 * gap)
    return {
      score: overqualPenalty,
      evidence: `Candidate is ~${gap} tiers above this role; partial fit only.`,
      flags: ["overqualified"] as string[],
      relevantYears: years,
      required,
    }
  }

  if (required <= 0) {
    return {
      // Lowered from 1.0 → 0.70: "no minimum stated" is not the same as
      // "perfect fit". Most legitimate tech roles state a minimum and will
      // still score 1.0 via the years/required path below.
      score: 0.70,
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

  // Lowered baseline 0.25 → 0.10. With the previous baseline, "Security
  // Officer" vs "Software Engineer" (zero token overlap) still scored 0.25
  // — a free 2.5 pts. The role-family gate downstream is the primary
  // defense, but this removes the auto-rebate for unrelated titles.
  const score = clamp(maxSim * 1.8 + 0.10 + bonus)
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

// Job type detectors — used by both fieldRelevance and the role-family gate.
// `security` removed from TECH_JOB_RE: it was incorrectly catching physical
// security roles ("Security Officer", "Security Guard"). Cyber/InfoSec roles
// still match via "engineer"/"analyst" + their description text.
// Ambiguous short words (`data`, `ai`, `ml`) now require context to prevent
// "Data Entry Clerk" / "AI Care Assistant" from misclassifying as tech.
const TECH_JOB_RE       = /\b(?:engineer|developer|programmer|architect|devops|sre|software|backend|frontend|fullstack|full.?stack|infrastructure|platform engineer|cloud engineer|data\s+(?:scientist|engineer|analyst|architect|specialist)|ml\s+(?:engineer|scientist|researcher)|machine\s+learning\s+engineer|ai\s+(?:engineer|scientist|researcher)|analytics\s+engineer|qa\s+engineer|test\s+engineer)\b/i
const HEALTHCARE_JOB_RE = /\b(?:nurse|nursing|physician|doctor|clinical|medical|healthcare|pharmacist|pharmacy|therapist|patient\s+(?:care|journey)|hospital|dental|radiology|radiologic|surgeon|clinician|caregiver|sonograph|phlebotom|cna|rn\b|lpn|emt|paramedic|(?:radiologic|surgical|ultrasound|cardiovascular|nuclear|medical|imaging|laboratory|respiratory|pharmacy)\s+technologist|(?:pharmacy|surgical|lab|medical|dental|veterinary|patient\s+care)\s+(?:technician|tech))\b/i
const DESIGN_JOB_RE     = /\b(?:designer|design lead|ux|ui|creative director|art director|brand designer|visual designer|motion designer|illustrator|animator)\b/i
const MARKETING_JOB_RE  = /\b(?:marketing|growth|demand generation|brand manager|content strategist|seo specialist|sem|social media|public relations|pr manager|copywriter)\b/i
const SALES_JOB_RE      = /\b(?:sales|account executive|account manager|business development|bdr|sdr|customer success|solutions engineer)\b/i
const HR_JOB_RE         = /\b(?:human resources|recruiter|recruiting|talent acquisition|hrbp|people\s+ops(?:erations)?|compensation\s+(?:analyst|specialist)|workforce)\b/i
const LEGAL_JOB_RE      = /\b(?:lawyer|attorney|legal counsel|paralegal|compliance officer|general counsel)\b/i
const FINANCE_JOB_RE    = /\b(?:financial analyst|finance manager|controller|cfo|investment|trader|banker|auditor|actuar|fp&a|treasury|accountant|bookkeeper)\b/i
const OPS_JOB_RE        = /\b(?:supply chain|logistics|procurement|warehouse manager|manufacturing|program manager|project manager|operations manager|data entry)\b/i
const EDUCATION_JOB_RE  = /\b(?:teacher|instructor|professor|curriculum|learning|coach|educator|academic|tutor|principal|dean)\b/i

// Non-tech families used by the role-family gate. These are domains
// fundamentally incompatible with most office/tech backgrounds — when the JD
// looks like one of these and the candidate's recent roles are different,
// the match is almost certainly bad regardless of soft-skill overlap.
const PHYSICAL_SECURITY_JOB_RE = /\b(?:security officer|security guard|security agent|guard|patrol(?:\s+officer)?|loss prevention|protective services|correctional officer|bouncer|bodyguard|crossing guard|surveillance officer)\b/i
// `technician` only counts as a trade when paired with a trade qualifier;
// bare "Technician" stays unclassified rather than misrouting to trades.
const SKILLED_TRADES_JOB_RE    = /\b(?:electrician|plumber|hvac|welder|carpenter|locksmith|machinist|millwright|pipefitter|ironworker|roofer|mason|(?:hvac|automotive|auto|mechanical|electrical|electronics|maintenance|field|service|industrial)\s+(?:technician|tech)|(?:diesel|aircraft)\s+mechanic)\b/i
const INSPECTION_JOB_RE        = /\b(?:ndt|non.?destructive|ultrasonic|utsw|paut|radiographic\s+(?:testing|technician)|inspector|inspect(?:ion)?\s+(?:level|technician)|qa\s+inspect|magnetic\s+particle|penetrant\s+test)\b/i
const FOODSERVICE_JOB_RE       = /\b(?:chef|cook|server|waiter|waitress|barista|bro?ista|bartender|barback|sous chef|line cook|prep cook|host(?:ess)?\s+server|crew member|food (?:runner|prep)|dishwasher|fast food|restaurant (?:associate|team)|cashier|food service|kitchen (?:staff|helper))\b/i
const LABOR_JOB_RE             = /\b(?:forklift|truck driver|cdl|warehouse associate|warehouse worker|picker|packer|janitor|custodian|cleaner|housekeep|landscape|groundskeep|laborer|stocker)\b/i
const VEHICLE_JOB_RE           = /\b(?:veterinarian|veterinary|groomer|delivery driver|courier|uber driver|lyft driver|taxi driver|chauffeur|bus driver)\b/i

export type RoleFamily =
  | "tech" | "design" | "healthcare" | "physical_security" | "trades"
  | "inspection" | "foodservice" | "labor" | "vehicle" | "finance"
  | "marketing" | "sales" | "hr" | "legal" | "ops" | "education" | "unknown"

/**
 * Single-pass classifier. Order matters because regex domains overlap
 * (a Pharmacy Technician contains both a healthcare term and a trade term).
 * We check the most specific families before the broader ones.
 */
function classifyByText(text: string): RoleFamily {
  if (!text || !text.trim()) return "unknown"
  if (PHYSICAL_SECURITY_JOB_RE.test(text)) return "physical_security"
  if (INSPECTION_JOB_RE.test(text))        return "inspection"
  if (FOODSERVICE_JOB_RE.test(text))       return "foodservice"
  if (VEHICLE_JOB_RE.test(text))           return "vehicle"
  if (LABOR_JOB_RE.test(text))             return "labor"
  // Healthcare before trades because "Pharmacy Technician" / "Surgical Tech"
  // are healthcare even though "technician" appears in the trades regex.
  if (HEALTHCARE_JOB_RE.test(text))        return "healthcare"
  if (SKILLED_TRADES_JOB_RE.test(text))    return "trades"
  if (LEGAL_JOB_RE.test(text))             return "legal"
  if (HR_JOB_RE.test(text))                return "hr"
  if (FINANCE_JOB_RE.test(text))           return "finance"
  if (EDUCATION_JOB_RE.test(text))         return "education"
  if (DESIGN_JOB_RE.test(text))            return "design"
  if (SALES_JOB_RE.test(text))             return "sales"
  if (MARKETING_JOB_RE.test(text))         return "marketing"
  if (TECH_JOB_RE.test(text))              return "tech"
  if (OPS_JOB_RE.test(text))               return "ops"
  return "unknown"
}

/**
 * Classifies a JD into a single role family. Tries the **title first** —
 * descriptions often contain incidental references (e.g. a SWE job
 * mentioning "warehouse" in its product description) that would mis-route a
 * title+description scan. Only falls back to the description when the title
 * is too generic to classify (e.g. "Manager", "Coordinator", "Specialist").
 */
export function classifyRoleFamily(title: string, description?: string | null): RoleFamily {
  const titleFamily = classifyByText(title ?? "")
  if (titleFamily !== "unknown") return titleFamily
  if (description) return classifyByText(description)
  return "unknown"
}

/**
 * Adjacency map for the role-family gate. A candidate in family X can
 * reasonably target a job in family Y iff X→Y appears here. Pairs are
 * mirrored — the helper below enforces symmetry at lookup time, so editing
 * one direction is enough.
 *
 * Conservative by design: a few common transitions (tech↔design, sales↔
 * marketing, healthcare↔education, trades↔labor, hr↔ops, finance↔legal) are
 * allowed because they happen routinely in the wild. Anything else gets
 * gated so cross-domain matches can't ride soft-skill overlap into the 90s.
 */
const ROLE_FAMILY_ADJACENT_RAW: Partial<Record<RoleFamily, RoleFamily[]>> = {
  tech:              ["design", "ops", "finance", "marketing", "sales"],
  design:            ["tech", "marketing"],
  marketing:         ["sales", "design", "tech"],
  sales:             ["marketing", "tech", "ops"],
  finance:           ["tech", "ops", "legal", "hr"],
  ops:               ["tech", "finance", "sales", "trades", "labor", "hr"],
  healthcare:        ["education"],
  trades:            ["labor", "ops", "inspection"],
  labor:             ["trades", "ops", "foodservice", "physical_security", "vehicle"],
  inspection:        ["trades", "ops"],
  foodservice:       ["labor", "vehicle"],
  vehicle:           ["labor", "foodservice"],
  physical_security: ["labor"],
  legal:             ["finance", "hr"],
  hr:                ["ops", "finance", "legal"],
  education:         ["healthcare"],
}

/**
 * Symmetric adjacency derived from the raw map. Each entry contains itself
 * (X is always compatible with X) plus every neighbour from both directions,
 * so editing one side of a pair is enough.
 */
const ROLE_FAMILY_ADJACENT: Map<RoleFamily, Set<RoleFamily>> = (() => {
  const map = new Map<RoleFamily, Set<RoleFamily>>()
  const ensure = (key: RoleFamily) => {
    let set = map.get(key)
    if (!set) {
      set = new Set<RoleFamily>([key])
      map.set(key, set)
    }
    return set
  }
  for (const [from, tos] of Object.entries(ROLE_FAMILY_ADJACENT_RAW) as Array<[RoleFamily, RoleFamily[]]>) {
    const fromSet = ensure(from)
    for (const to of tos) {
      fromSet.add(to)
      ensure(to).add(from)
    }
  }
  return map
})()

export function isRoleFamilyCompatible(candidate: RoleFamily, job: RoleFamily): boolean {
  // Unknown on either side → don't penalise. The gate's job is to catch
  // obvious mismatches, not to demote candidates with hard-to-classify
  // resumes or JDs.
  if (candidate === "unknown" || job === "unknown") return true
  if (candidate === job) return true
  return ROLE_FAMILY_ADJACENT.get(candidate)?.has(job) ?? false
}

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

  // Unknown job type — lowered 0.8 → 0.55. The previous value was a free
  // 5.5 pts whenever the title regex didn't recognise the job. Combined
  // with the no-requirement default it was the main source of inflation
  // for cross-domain matches.
  return 0.55
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

const DEGREE_PATTERNS: Array<{ rank: number; re: RegExp }> = [
  { rank: 5, re: /(ph\.?d|doctor(ate|al)|d\.phil)/ },
  { rank: 4, re: /(master(?:'?s)?|m\.?s\.?\b|m\.?eng\b|m\.?b\.?a\b|graduate degree)/ },
  { rank: 3, re: /(bachelor(?:'?s)?|b\.?s\.?\b|b\.?a\.?\b|undergraduate|four.year degree)/ },
  { rank: 2, re: /(associate(?:'?s)?)/ },
]

const PREFERRED_RE = /\b(preferred|a plus|nice to have|desired|bonus|plus|ideal(?:ly)?)\b/
const REQUIRED_HINT_RE = /\b(required|must have|mandatory|need(?:ed)?|minimum (?:of )?(?:education|degree|qualification)|qualifications?:|requirements?:)\b/
// Common exemption phrases. The `(?:a |an )?` group allows "or a related field",
// "or an equivalent...", "or related field" — all of which weaken a hard
// degree requirement to soft.
const EXEMPTION_RE = /\bor\s+(?:a\s+|an\s+)?(equivalent|related|relevant\s+(?:experience|background)|similar|commensurate)\b/

/**
 * Detect the required degree by scanning sentence-level context. A degree
 * mentioned only inside a sentence with "preferred"/"a plus"/etc. doesn't
 * bump the required floor — only degrees outside a preferred-context (or
 * inside an explicit required-context) count toward `rank`.
 */
function detectRequiredDegree(job: Job): { rank: number; isHard: boolean } {
  const text = `${job.description ?? ""} ${job.title}`
  const lower = text.toLowerCase()
  const sentences = lower.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)

  let requiredRank = 0
  let preferredRank = 0

  for (const sentence of sentences) {
    const isPreferredSentence = PREFERRED_RE.test(sentence)
    const isRequiredSentence = REQUIRED_HINT_RE.test(sentence)
    for (const { rank, re } of DEGREE_PATTERNS) {
      if (!re.test(sentence)) continue
      if (isPreferredSentence && !isRequiredSentence) {
        if (rank > preferredRank) preferredRank = rank
      } else {
        if (rank > requiredRank) requiredRank = rank
      }
      break
    }
  }

  // Fall back to "highest preferred" only when no required mention exists at all.
  const rank = requiredRank > 0 ? requiredRank : preferredRank

  const hasRequiredSignal = /\b(required|must have|minimum|mandatory)\b/.test(lower)
  const hasExemption = EXEMPTION_RE.test(lower)
  const isHard = requiredRank > 0 && hasRequiredSignal && !hasExemption

  return { rank, isHard }
}

function scoreEducation(resume: Resume, job: Job) {
  const { rank: required, isHard } = detectRequiredDegree(job)
  // Lowered no-requirement default from 0.85 → 0.65. The previous value
  // handed out 8.5 pts to every job that didn't state a degree, which is
  // most non-corporate listings.
  if (required === 0) return { score: 0.65, evidence: "No degree requirement specified." }

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

// ─── 5. Domain (weight 0.03) ──────────────────────────────────────────────────

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

  // Recent role families: classify the three most recent positions so the
  // gate can compare against the JD's family. Three is a balance — enough
  // to reflect a career pivot, few enough that one ancient unrelated role
  // doesn't keep the candidate eligible for everything.
  const recentRoleFamilies = experienceByRecency
    .slice(0, 3)
    .map((exp) => classifyRoleFamily(exp.title))

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
    recentRoleFamilies,
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
  const experience = scoreExperience(context, job, resume.seniority_level)
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
  const totalRequired = skills.requiredCount

  // Cert gate — soft penalty (–15 pts) rather than hard cap, preserving strong
  // overall matches. Certs are obtainable; a 95-match candidate shouldn't be
  // capped at 60 for missing a single cert.
  if (certs.certGate) {
    overall = Math.max(45, overall - 15)
    gatesTriggered.push("missing_required_cert")
  }

  // Low-signal gate — when the JD only yields 1-2 extracted skills, the
  // ratio (matched/total) becomes meaningless: 1 soft-skill hit like
  // "Communication" or "Leadership" reads as 100% match. Cap any tiny-
  // skill-set listing at the "good match" ceiling so they can't be
  // promoted into the "strong match" band.
  // Observed: Dutch Bros "Broista" job with 1 extracted skill scored 72
  // against a SWE resume — caught here at 65.
  if (totalRequired > 0 && totalRequired < 5) {
    overall = Math.min(overall, 65)
    gatesTriggered.push(`low_signal_skills_lt5:${totalRequired}`)
  }

  // Skills gate — only fires when there are enough skills to make the ratio
  // meaningful (≥5 required) AND the candidate is missing >75% of them.
  // Threshold raised from 60% → 75% so candidates missing half the stack
  // (a common state, especially as our extractor now pulls more skills per
  // JD) aren't capped at 55. Cap relaxed 55 → 65 so a partial-skill match
  // can still reach "good match" territory.
  if (totalRequired >= 5 && skills.missing.length / totalRequired > 0.75) {
    overall = Math.min(overall, 65)
    gatesTriggered.push("missing_required_skills_gt75pct")
  }

  // Experience gate — relaxed 55 → 65. Years-of-experience is a soft signal:
  // a candidate just under the stated minimum but otherwise a strong match
  // shouldn't be capped below the "good match" band.
  const minYears = extractMinYears(job.description)
  if (minYears > 0 && experience.score < 0.35) {
    overall = Math.min(overall, 65)
    gatesTriggered.push("insufficient_experience")
  }

  // Extreme seniority mismatch (e.g. exec applying for intern) — relaxed
  // 35 → 50. The gap still pushes the score below the "great match" band
  // but doesn't crush it to a single-digit territory.
  if (seniorityGap !== null && Math.abs(seniorityGap) > 3) {
    overall = Math.min(overall, 50)
    gatesTriggered.push("extreme_seniority_mismatch")
  }

  // Role-family gate — caps scores when the JD belongs to a fundamentally
  // different career family from the candidate's recent roles. Caused by
  // soft-skill overlap inflating cross-domain matches (e.g. SWE matched to
  // "Security Officer" at 91% because both resumes/JDs mention
  // "Communication"). `unknown` on either side skips the gate.
  // Fallback: when work_experience didn't yield any classifiable families
  // (sparse resumes, non-traditional titles), classify from `primary_role`
  // so the gate still fires for an obvious cross-domain mismatch.
  const jobFamily = classifyRoleFamily(job.title, job.description)
  let candidateFamilies = context.recentRoleFamilies
  if (candidateFamilies.length === 0 && resume.primary_role) {
    const fromPrimaryRole = classifyRoleFamily(resume.primary_role)
    if (fromPrimaryRole !== "unknown") candidateFamilies = [fromPrimaryRole]
  }
  if (jobFamily !== "unknown" && candidateFamilies.length > 0) {
    const compatible = candidateFamilies.some((cf) => isRoleFamilyCompatible(cf, jobFamily))
    if (!compatible) {
      // Relaxed 40 → 55: the role-family classifier mis-fires on
      // multidisciplinary roles (SWE → "Data Scientist", "Security Engineer"
      // → "Software Engineer", etc.). Cap at 55 keeps these out of the
      // "great match" band but doesn't bury legitimate adjacent fits.
      overall = Math.min(overall, 55)
      gatesTriggered.push(`role_family_mismatch:${candidateFamilies[0]}→${jobFamily}`)
    }
  }

  overall = clamp(overall, 0, 100)

  // Previously: a curve at >55 inflated 80→86 and 90→99, which combined
  // with the seniority over-generosity to push unrelated jobs into the
  // "great match" band. Removed — scores now reflect the weighted sum
  // directly, with the gates above as the only post-hoc adjustments.

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
    location_score:        null,
    employment_type_score: null,
    sponsorship_score:     sponsorship.score,
    domain_score:          Math.round(domain.score * 100),
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

/**
 * Fast resume↔job scorer — pure TypeScript, runs in-process with no external calls.
 *
 * Nine weighted dimensions (weights sum to 1.0):
 *   skills 0.36 · experience 0.14 · seniority 0.06 · title 0.10 · education 0.09
 *   role-family 0.14 · semantic 0.06 · domain 0.03 · certs 0.02
 *
 * Experience is relevant-experience aware: total years still matter, but years
 * earned outside the role/domain are discounted so skill-list overlap alone
 * cannot make a career-pivot look like a direct ATS-ready fit.
 *
 * Hard gates applied after aggregation:
 *   missing-required-cert                -> -15 pts, floor 45
 *   >75% required skills missing (>=5)   -> cap at 65
 *   total/relevant years shortfall       -> cap below strong-match band
 *   incompatible role family             -> cap at 55
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
  getSkillFamily,
  isSoftSkill,
  normalizeSkillKey,
  normalizeSkillList,
} from "@/lib/skills/taxonomy"
import { inferSeniorityLevel } from "@/lib/jobs/metadata"
import { fieldAffinity } from "@/lib/resume/signal"

export interface FastScoreInput {
  resume: Resume
  job: Job
  profile: Profile
  resumeContext?: FastScoreResumeContext
  /**
   * Optional career field the user has chosen to be matched as (a FIELDS key
   * from lib/resume/signal). When set, jobs that belong to that field get a
   * small, bounded positioning boost so the user's chosen lane rises up the
   * feed. Omitted/null ⇒ scoring is byte-for-byte unchanged.
   */
  targetField?: string | null
}

type ResumeExperienceSnapshot = {
  title: string
  titleTokens: Set<string>
  seniorityTier: number
  descriptionLower: string
  skillKeys: Set<string>
  roleFamily: RoleFamily
  is_current: boolean
  endYear: number | null
  years: number
}

export interface FastScoreResumeContext {
  candidateSkillKeys: string[]
  candidateSkillKeySet: Set<string>
  /** Set of skill-family ids the candidate covers (e.g. "nosql_db"). Used for
   * partial-credit scoring when JD wants a related-family skill. */
  candidateFamilies: Set<string>
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
  skills:     0.36,
  experience: 0.14,
  seniority:  0.06,
  title:      0.10,
  education:  0.09,
  domain:     0.03,
  certs:      0.02,
  semantic:   0.06,
  roleFamily: 0.14,
} as const

// Max points a chosen target field can add to a NON-blocked match, scaled by the
// job's affinity to that field (0–1). Small on purpose: it re-ranks the user's
// chosen lane within their good matches, it does not resurrect gated ones.
const TARGET_FIELD_BOOST_MAX = 8

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

const PROGRAMMING_LANGUAGE_KEYS = new Set(
  [
    "JavaScript",
    "TypeScript",
    "Python",
    "Java",
    "Go",
    "Rust",
    "C++",
    "C#",
    "Ruby",
    "PHP",
    "Swift",
    "Kotlin",
    "Scala",
    "R",
    "MATLAB",
    "Bash",
    "Dart",
    "Elixir",
    "Haskell",
  ].map((skill) => normalizeSkillKey(canonicalizeSkill(skill)))
)

const FOUNDATIONAL_CS_KEYS = new Set(
  ["Data Structures", "Algorithms", "Object-Oriented Programming"].map((skill) =>
    normalizeSkillKey(canonicalizeSkill(skill))
  )
)

const TEST_AUTOMATION_REQ_KEYS = new Set(
  ["Test Automation"].map((skill) => normalizeSkillKey(canonicalizeSkill(skill)))
)

const TESTING_SIGNAL_KEYS = new Set(
  [
    "Test Automation",
    "pytest",
    "JUnit",
    "Jest",
    "Selenium",
    "Cypress",
    "Playwright",
    "Mocha",
    "TestNG",
    "API Testing",
    "Load Testing",
    "CI/CD",
    "GitHub Actions",
    "Jenkins",
  ].map((skill) => normalizeSkillKey(canonicalizeSkill(skill)))
)

const BACKEND_SIGNAL_KEYS = new Set(
  [
    "Backend Development",
    "Distributed Systems",
    "API Development",
    "Microservices",
    "Spring",
    "FastAPI",
    "Django",
    "Flask",
    "Node.js",
    "Express",
    "Rails",
    "Laravel",
    ".NET",
  ].map((skill) => normalizeSkillKey(canonicalizeSkill(skill)))
)

const GENERIC_SOFTWARE_ROLE_RE =
  /\b(?:software(?:\s+development)?|backend|full.?stack|platform|application)\s+(?:engineer|developer)\b/i
const LANGUAGE_SPECIFIC_ROLE_RE =
  /\b(?:c\+\+|c#|java|python|go|golang|rust|scala|kotlin|ruby|php|swift|typescript|javascript)\b/i

function countKeyHits(keys: Set<string>, candidateKeySet: Set<string>): number {
  let count = 0
  for (const key of keys) if (candidateKeySet.has(key)) count++
  return count
}

function hasAnyKey(keys: Set<string>, candidateKeySet: Set<string>): boolean {
  for (const key of keys) {
    if (candidateKeySet.has(key)) return true
  }
  return false
}

function getGeneralistSubstituteScore(
  requiredKey: string,
  requiredLabel: string,
  job: Job,
  candidateSkillKeySet: Set<string>,
  requiredLanguageCount: number,
  resumeContext: FastScoreResumeContext
): { score: number; relatedTo: string } | null {
  const candidateLanguageCount = countKeyHits(PROGRAMMING_LANGUAGE_KEYS, candidateSkillKeySet)
  const hasBackendSignals = hasAnyKey(BACKEND_SIGNAL_KEYS, candidateSkillKeySet)
  const hasTestingSignals = hasAnyKey(TESTING_SIGNAL_KEYS, candidateSkillKeySet)
  const isGenericSoftwareRole = GENERIC_SOFTWARE_ROLE_RE.test(job.title)
  const isLanguageSpecificRole = LANGUAGE_SPECIFIC_ROLE_RE.test(job.title)

  // For generic SWE postings, language variance is expected. Award modest
  // partial credit when the candidate is clearly polyglot.
  if (
    PROGRAMMING_LANGUAGE_KEYS.has(requiredKey) &&
    !isLanguageSpecificRole &&
    isGenericSoftwareRole &&
    requiredLanguageCount >= 3 &&
    candidateLanguageCount >= 2
  ) {
    return { score: 0.4 * recency(requiredLabel, resumeContext), relatedTo: "polyglot_language_overlap" }
  }

  // CS fundamentals are often implied by sustained backend/software roles
  // even when not explicitly listed in the resume skill section.
  if (
    FOUNDATIONAL_CS_KEYS.has(requiredKey) &&
    candidateLanguageCount >= 2 &&
    (hasBackendSignals || hasTestingSignals)
  ) {
    return { score: 0.75 * recency(requiredLabel, resumeContext), relatedTo: "software_fundamentals" }
  }

  if (
    TEST_AUTOMATION_REQ_KEYS.has(requiredKey) &&
    (hasTestingSignals || (candidateLanguageCount >= 1 && hasBackendSignals))
  ) {
    return { score: 0.7 * recency(requiredLabel, resumeContext), relatedTo: "testing_practice" }
  }

  return null
}

// ─── 1. Skills (weight 0.36) ──────────────────────────────────────────────────

/**
 * Per-skill match score on a 0–1 scale.
 *   - direct hit (alias match in resume) → recency(0.55–1.0)
 *   - related-family hit (e.g. resume has DynamoDB, JD wants MongoDB) → 0.5 × recency
 *   - no match → 0.0
 * Surfaced through score_breakdown.skillScores so the UI can show
 * "Spring Boot 100% · MongoDB 100% · Node.js 0%" instead of bare green/red pills.
 */
type PerSkillScore = {
  skill: string
  score: number
  /** Source resume skill when this was a related-family hit (not a direct match). */
  relatedTo?: string
}

type SkillsScoreResult = {
  score: number
  matched: string[]
  missing: string[]
  hardMissing: string[]
  hardMatchedCount: number
  hardSkills: string[]
  /** Each required skill graded 0–1; consumed by score_breakdown.skillScores. */
  perSkill: PerSkillScore[]
  evidence: string
  certGate: boolean
  requiredCount: number
}

type RelevantExperienceResult = {
  score: number
  ratio: number | null
  relevantYears: number
  totalYears: number
  requiredYears: number
  evidence: string
}

type CareerFitLabel = "ats_ready" | "tailor_resume" | "bridge_first" | "career_pivot"

type CareerFitResult = {
  atsScreenScore: number
  careerFitScore: number
  relevantYears: number
  totalYears: number
  requiredYears: number
  relevantYearsRatio: number | null
  label: CareerFitLabel
  recommendation: string
  evidence: string[]
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
      hardMissing: [],
      hardMatchedCount: 0,
      hardSkills: [],
      perSkill: [],
      evidence:
        "No reliable skills detected in this posting; applied a conservative score.",
      certGate: false,
      requiredCount: 0,
    }
  }

  // Partition into hard vs soft. Soft skills (Leadership, Communication,
  // Mentoring, Adaptability, etc.) are excluded from the skills_score
  // denominator AND the missing-skills gate — every senior engineer can
  // claim them, so a JD listing them as "required" shouldn't pull a
  // strong technical match down to a partial one. Observed: Home Depot
  // "Senior Software Engineer" listed 4 soft skills as required and a
  // backend engineer matching Java + CI/CD was scoring 16% (2/11). With
  // soft skills separated, the hard-skill ratio drives the score.
  const hardSkills: string[] = []
  const softSkills: string[] = []
  for (const skill of jobSkills) {
    if (isSoftSkill(skill)) softSkills.push(skill)
    else hardSkills.push(skill)
  }

  // Partial-credit weight for related-family substitutes (e.g. JD wants
  // MongoDB, resume has DynamoDB — both in nosql_db family → 0.5 × recency).
  const FAMILY_PARTIAL = 0.5

  const requiredLanguageCount = hardSkills.reduce((count, skill) => {
    const key = normalizeSkillKey(canonicalizeSkill(skill))
    return PROGRAMMING_LANGUAGE_KEYS.has(key) ? count + 1 : count
  }, 0)

  const perSkill: PerSkillScore[] = []
  let hardSum = 0

  for (const req of hardSkills) {
    const reqKey = normalizeSkillKey(canonicalizeSkill(req))
    const directHit =
      resumeContext.candidateSkillKeySet.has(reqKey) ||
      resumeContext.candidateSkillKeys.some((ck) => hasNormalizedSkillOverlap(reqKey, ck))

    if (directHit) {
      const score = recency(req, resumeContext)
      perSkill.push({ skill: req, score })
      hardSum += score
      continue
    }

    // No direct match — check for a related-family substitute. We only know
    // the family of the *required* skill; if the candidate covers that family
    // at all (via any skill), they get partial credit.
    const reqFamily = getSkillFamily(req)
    if (reqFamily && resumeContext.candidateFamilies.has(reqFamily)) {
      const score = FAMILY_PARTIAL * recency(req, resumeContext)
      perSkill.push({ skill: req, score, relatedTo: reqFamily })
      hardSum += score
      continue
    }

    const generalistSubstitute = getGeneralistSubstituteScore(
      reqKey,
      req,
      job,
      resumeContext.candidateSkillKeySet,
      requiredLanguageCount,
      resumeContext
    )
    if (generalistSubstitute) {
      perSkill.push({
        skill: req,
        score: generalistSubstitute.score,
        relatedTo: generalistSubstitute.relatedTo,
      })
      hardSum += generalistSubstitute.score
      continue
    }

    perSkill.push({ skill: req, score: 0 })
  }

  // Soft skills are surfaced in perSkill (with their actual match score) for
  // UI completeness, but they don't contribute to hardSum/denominator.
  for (const skill of softSkills) {
    const reqKey = normalizeSkillKey(canonicalizeSkill(skill))
    const directHit =
      resumeContext.candidateSkillKeySet.has(reqKey) ||
      resumeContext.candidateSkillKeys.some((ck) => hasNormalizedSkillOverlap(reqKey, ck))
    perSkill.push({ skill, score: directHit ? recency(skill, resumeContext) : 0 })
  }

  // Matched = ≥0.7 credit, missing = <0.4 (in-between is "partial" via
  // perSkill[].score). Backwards-compatible matched/missing arrays remain.
  const matched = perSkill.filter((p) => p.score >= 0.7).map((p) => p.skill)
  const hardMatched = matched.filter((m) => !isSoftSkill(m))
  const missing = perSkill.filter((p) => p.score < 0.4).map((p) => p.skill)
  const hardMissing = missing.filter((m) => !isSoftSkill(m))
  // Score is computed against the hard-skill set only. If a JD is 100% soft
  // skills, fall back to a neutral 0.55.
  const score = hardSkills.length === 0 ? 0.55 : hardSum / hardSkills.length

  const sourcePrefix = usedDerivedSkills
    ? `Structured skills were missing; derived ${jobSkills.length} skill${jobSkills.length === 1 ? "" : "s"} from posting text. `
    : ""
  const label = hardMissing.length > 3
    ? `${hardMissing.slice(0, 3).join(", ")} +${hardMissing.length - 3} more`
    : hardMissing.join(", ")
  const evidence = hardMissing.length === 0
    ? `${sourcePrefix}Matched all ${hardSkills.length} hard-skill requirements.`
    : `${sourcePrefix}Matched ${hardSkills.length - hardMissing.length}/${hardSkills.length} hard skills; missing: ${label}.`

  return {
    score,
    matched,
    missing,
    hardMissing,
    hardMatchedCount: hardMatched.length,
    hardSkills,
    perSkill,
    evidence,
    certGate: false,
    // Gate uses hard-skill count so a 4-soft + 2-hard job doesn't trip
    // the "≥5 required" precondition off soft-skill fluff.
    requiredCount: hardSkills.length,
  }
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
  job: Job
) {
  const extracted = extractMinYears(job.description)
  const seniorityFloor = (job.seniority_level ? SENIORITY_YEAR_FLOOR[job.seniority_level] : 0) ?? 0
  const required = Math.max(extracted, seniorityFloor)
  const years = resumeContext.years

  if (required <= 0) {
    return {
      // Lowered from 1.0 → 0.70: "no minimum stated" is not the same as
      // "perfect fit". Most legitimate tech roles state a minimum and will
      // still score 1.0 via the years/required path below.
      score: 0.70,
      ratio: null as number | null,
      evidence: `No minimum experience required; candidate has ${years.toFixed(1)} years.`,
      flags: [] as string[],
      relevantYears: years,
      required: 0,
    }
  }

  const ratio = years / required
  // Convex shortfall penalty (was a flat linear ratio). Being at 62% of the
  // required years should NOT read as a 62% experience fit. ratio^1.6 keeps
  // small gaps mild (0.9→0.85) but makes real gaps bite (0.62→0.47, 0.5→0.33).
  // Meeting or exceeding the requirement still earns full credit.
  const score = ratio >= 1 ? 1 : clamp(Math.pow(ratio, 1.6))
  const flags: string[] = years > 2.5 * required ? ["overqualified"] : []
  const evidence = years >= required
    ? `${years.toFixed(1)} years meets the ${required}-year requirement${flags.includes("overqualified") ? " (possibly overqualified)" : ""}.`
    : `${years.toFixed(1)} of ${required} required years.`

  return { score, ratio, evidence, flags, relevantYears: years, required }
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

const WEAK_SINGLE_TITLE_TOKENS = new Set([
  "assistant",
  "associate",
  "coordinator",
  "specialist",
  "manager",
  "administrator",
  "admin",
  "analyst",
  "technician",
  "support",
  "consultant",
])

const STRONG_PROFESSION_TITLE_TOKENS = new Set([
  "developer",
  "programmer",
  "pharmacist",
  "nurse",
  "physician",
  "doctor",
  "clinician",
  "therapist",
  "dentist",
  "hygienist",
  "sonographer",
  "phlebotomist",
  "paramedic",
  "attorney",
  "lawyer",
  "paralegal",
  "accountant",
  "auditor",
  "recruiter",
  "teacher",
  "professor",
  "instructor",
  "designer",
  "electrician",
  "plumber",
  "welder",
  "carpenter",
  "mechanic",
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

function titleSimilarity(jobTokens: Set<string>, candidateTokens: Set<string>) {
  const base = jaccard(jobTokens, candidateTokens)
  if (jobTokens.size === 0 || candidateTokens.size === 0) return base

  const shared = [...candidateTokens].filter((token) => jobTokens.has(token))
  if (shared.length === 0) return base

  const containment = shared.length / Math.min(jobTokens.size, candidateTokens.size)
  if (shared.length >= 2 && containment >= 0.75) {
    return Math.max(base, 0.85)
  }

  if (
    shared.length === 1 &&
    containment >= 1 &&
    Math.min(jobTokens.size, candidateTokens.size) === 1 &&
    !WEAK_SINGLE_TITLE_TOKENS.has(shared[0])
  ) {
    return Math.max(base, 0.80)
  }

  if (shared.length === 1 && STRONG_PROFESSION_TITLE_TOKENS.has(shared[0])) {
    return Math.max(base, 0.45)
  }

  return base
}

function scoreTitle(resumeContext: FastScoreResumeContext, job: Job) {
  if (resumeContext.experienceForTitles.length === 0) {
    return { score: 0.35, evidence: "No past titles on resume." }
  }

  const jdTok = titleTokens(job.title)
  let maxSim = 0
  let bestTitle = ""
  for (const exp of resumeContext.experienceForTitles) {
    const sim = titleSimilarity(jdTok, exp.titleTokens)
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
const TECH_JOB_RE       = /\b(?:engineer|developer|programmer|architect|devops|sre|site\s+reliability|software|backend|frontend|fullstack|full.?stack|infrastructure|platform engineer|cloud engineer|data\s+(?:scientist|engineer|analyst|architect|specialist)|ml\s+(?:engineer|scientist|researcher)|machine\s+learning\s+engineer|ai\s+(?:engineer|scientist|researcher)|analytics\s+engineer|qa\s+engineer|test\s+engineer|(?:i\.?t\.?|information technology)\s+(?:specialist|analyst|engineer|administrator|admin|support|technician|manager|consultant)|systems?\s+(?:administrator|admin|engineer|analyst)|sysadmin|network\s+(?:engineer|administrator|admin|analyst|specialist)|help\s*desk|desktop\s+support|technical\s+support\s+engineer)\b/i
const HEALTHCARE_JOB_RE = /\b(?:nurse|nursing|physician|doctor|clinical|medical|healthcare|pharmacist|pharmacy|therapist|patient\s+(?:care|journey)|hospital|dental|radiology|radiologic|surgeon|clinician|caregiver|sonograph|phlebotom|cna|rn\b|lpn|emt|paramedic|(?:radiologic|surgical|ultrasound|cardiovascular|nuclear|medical|imaging|laboratory|respiratory|pharmacy)\s+technologist|(?:pharmacy|surgical|lab|medical|dental|veterinary|patient\s+care)\s+(?:technician|tech))\b/i
const DESIGN_JOB_RE     = /\b(?:designer|design lead|ux|ui|creative director|art director|brand designer|visual designer|motion designer|illustrator|animator)\b/i
const MARKETING_JOB_RE  = /\b(?:marketing|growth|demand generation|brand manager|content strategist|seo specialist|sem|social media|public relations|pr manager|copywriter)\b/i
const SALES_JOB_RE      = /\b(?:sales|account executive|account manager|business development|bdr|sdr|customer success|solutions engineer)\b/i
const HR_JOB_RE         = /\b(?:human resources|recruiter|recruiting|talent acquisition|hrbp|people\s+ops(?:erations)?|compensation\s+(?:analyst|specialist)|workforce)\b/i
const LEGAL_JOB_RE      = /\b(?:lawyer|attorney|legal counsel|paralegal|compliance officer|general counsel)\b/i
const FINANCE_JOB_RE    = /\b(?:financial analyst|finance manager|controller|cfo|investment|trader|banker|auditor|actuar|fp&a|treasury|accountant|bookkeeper)\b/i
const OPS_JOB_RE        = /\b(?:supply chain|logistics|procurement|warehouse manager|manufacturing|program manager|project manager|operations manager|data entry)\b/i
const EDUCATION_JOB_RE  = /\b(?:teacher|instructor|professor|curriculum|learning\s+(?:designer|specialist|consultant|coordinator|manager|coach|instructor)|coach|educator|academic|tutor|(?:school|assistant|vice)\s+principal|principal\s+(?:teacher|educator|curriculum|learning)|dean)\b/i

// Non-tech families used by the role-family gate. These are domains
// fundamentally incompatible with most office/tech backgrounds — when the JD
// looks like one of these and the candidate's recent roles are different,
// the match is almost certainly bad regardless of soft-skill overlap.
const PHYSICAL_SECURITY_JOB_RE = /\b(?:security officer|security guard|security agent|guard|patrol(?:\s+officer)?|loss prevention|protective services|correctional officer|bouncer|bodyguard|crossing guard|surveillance officer)\b/i
// `technician` only counts as a trade when paired with a trade qualifier;
// bare "Technician" stays unclassified rather than misrouting to trades.
const SKILLED_TRADES_JOB_RE    = /\b(?:electrician|plumber|hvac|welder|carpenter|locksmith|machinist|millwright|pipefitter|ironworker|roofer|mason|(?:hvac|automotive|auto|mechanical|electrical|electronics|maintenance|field|service|industrial)\s+(?:technician|tech)|(?:diesel|aircraft)\s+mechanic)\b/i
const INSPECTION_JOB_RE        = /\b(?:ndt|non.?destructive|ultrasonic|utsw|paut|radiographic\s+(?:testing|technician)|inspector|inspect(?:ion)?\s+(?:level|technician)|qa\s+inspect|magnetic\s+particle|penetrant\s+test)\b/i
const FOODSERVICE_JOB_RE       = /\b(?:chef|cook|(?:restaurant|food|banquet|dining)\s+server|waiter|waitress|barista|bro?ista|bartender|barback|sous chef|line cook|prep cook|host(?:ess)?\s+server|crew member|food (?:runner|prep)|dishwasher|fast food|restaurant (?:associate|team)|cashier|food service|kitchen (?:staff|helper))\b/i
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

function uniqueRoleFamilies(families: RoleFamily[]): RoleFamily[] {
  const seen = new Set<RoleFamily>()
  const out: RoleFamily[] = []
  for (const family of families) {
    if (seen.has(family)) continue
    seen.add(family)
    out.push(family)
  }
  return out
}

function knownRoleFamilies(families: RoleFamily[]): RoleFamily[] {
  const known = families.filter((family) => family !== "unknown")
  return known.length > 0 ? uniqueRoleFamilies(known) : uniqueRoleFamilies(families)
}

function getCandidateRoleFamilies(
  resumeContext: FastScoreResumeContext,
  resume: Resume
): RoleFamily[] {
  const families = [...resumeContext.recentRoleFamilies]
  if (resume.primary_role) families.push(classifyRoleFamily(resume.primary_role))
  return knownRoleFamilies(families)
}

function scoreRoleFamilyFit(
  resumeContext: FastScoreResumeContext,
  resume: Resume,
  job: Job
) {
  const jobFamily = classifyRoleFamily(job.title, job.description)
  const candidateFamilies = getCandidateRoleFamilies(resumeContext, resume)

  if (
    jobFamily === "unknown" ||
    candidateFamilies.length === 0 ||
    candidateFamilies.every((family) => family === "unknown")
  ) {
    return {
      score: 0.55,
      jobFamily,
      candidateFamilies,
      compatible: true,
      evidence: "Role family could not be classified confidently.",
    }
  }

  if (candidateFamilies.includes(jobFamily)) {
    return {
      score: 1.0,
      jobFamily,
      candidateFamilies,
      compatible: true,
      evidence: `Candidate has recent ${jobFamily} experience.`,
    }
  }

  const adjacent = candidateFamilies.find((family) => isRoleFamilyCompatible(family, jobFamily))
  if (adjacent) {
    return {
      score: 0.75,
      jobFamily,
      candidateFamilies,
      compatible: true,
      evidence: `Candidate's ${adjacent} background is adjacent to ${jobFamily}.`,
    }
  }

  return {
    score: 0.2,
    jobFamily,
    candidateFamilies,
    compatible: false,
    evidence: `Candidate families (${candidateFamilies.join(", ")}) do not align with ${jobFamily}.`,
  }
}

function roleFamilyBaseline(candidate: RoleFamily, job: RoleFamily): number {
  if (candidate === "unknown" || job === "unknown") return 0.45
  if (candidate === job) return 0.45
  if (isRoleFamilyCompatible(candidate, job)) return 0.3
  return 0.08
}

function experienceRecencyMultiplier(exp: ResumeExperienceSnapshot): number {
  if (exp.is_current) return 1
  if (!exp.endYear) return 0.65
  const age = CURRENT_YEAR - exp.endYear
  if (age <= 2) return 0.9
  if (age <= 5) return 0.75
  if (age <= 8) return 0.55
  return 0.35
}

function hardSkillCoverageForExperience(
  exp: ResumeExperienceSnapshot,
  hardSkills: string[]
): number {
  if (hardSkills.length === 0) return 0

  let hits = 0
  for (const skill of hardSkills) {
    const key = normalizeSkillKey(canonicalizeSkill(skill))
    const literal = skill.toLowerCase()
    if (exp.skillKeys.has(key) || (literal.length > 2 && exp.descriptionLower.includes(literal))) {
      hits++
    }
  }
  return hits / hardSkills.length
}

function relevanceFactorForExperience(
  exp: ResumeExperienceSnapshot,
  job: Job,
  jobFamily: RoleFamily,
  hardSkills: string[]
): number {
  const titleSim = titleSimilarity(titleTokens(job.title), exp.titleTokens)
  const titleFactor =
    titleSim >= 0.8 ? 0.95 :
    titleSim >= 0.45 ? 0.75 :
    titleSim >= 0.25 ? 0.55 :
    0
  const skillCoverage = hardSkillCoverageForExperience(exp, hardSkills)
  const skillFactor =
    skillCoverage >= 0.65 ? 0.95 :
    skillCoverage >= 0.4 ? 0.8 :
    skillCoverage >= 0.2 ? 0.6 :
    skillCoverage > 0 ? 0.4 :
    0
  const familyFactor = roleFamilyBaseline(exp.roleFamily, jobFamily)
  let factor = Math.max(familyFactor, titleFactor, skillFactor)

  // A broad family match alone is not enough. "Pharmacist" and "RN" are both
  // healthcare, but the relevant-years credit should depend on title or skill
  // evidence that proves the same lane, not the family label by itself.
  if (
    exp.roleFamily === jobFamily &&
    jobFamily !== "unknown" &&
    titleFactor === 0 &&
    skillFactor < 0.6
  ) {
    factor = Math.min(factor, 0.35)
  }

  if (!isRoleFamilyCompatible(exp.roleFamily, jobFamily) && skillFactor < 0.8 && titleFactor < 0.8) {
    factor = Math.min(factor, 0.35)
  }

  return factor * experienceRecencyMultiplier(exp)
}

function scoreRelevantExperience(
  resumeContext: FastScoreResumeContext,
  job: Job,
  hardSkills: string[],
  roleFamily: ReturnType<typeof scoreRoleFamilyFit>,
  totalExperience: ReturnType<typeof scoreExperience>
): RelevantExperienceResult {
  const requiredYears = totalExperience.required
  let relevantYears = 0
  let bestFactor = 0

  for (const exp of resumeContext.experienceByRecency) {
    const factor = relevanceFactorForExperience(exp, job, roleFamily.jobFamily, hardSkills)
    bestFactor = Math.max(bestFactor, factor)
    relevantYears += exp.years * factor
  }

  // Some parses provide total years but incomplete role dates. Avoid treating
  // a clear same-lane resume as zero relevant years just because dates failed.
  if (relevantYears === 0 && resumeContext.years > 0 && bestFactor > 0) {
    relevantYears = resumeContext.years * bestFactor
  }

  relevantYears = Math.min(resumeContext.years, relevantYears)
  const ratio = requiredYears > 0 ? relevantYears / requiredYears : null
  const score =
    requiredYears <= 0
      ? clamp(bestFactor > 0 ? bestFactor : 0.55)
      : ratio !== null && ratio >= 1
        ? 1
        : clamp(Math.pow(ratio ?? 0, 1.35))

  const evidence =
    requiredYears > 0
      ? `${relevantYears.toFixed(1)} relevant years toward ${requiredYears} required.`
      : `${relevantYears.toFixed(1)} relevant years detected; no minimum stated.`

  return {
    score,
    ratio,
    relevantYears,
    totalYears: resumeContext.years,
    requiredYears,
    evidence,
  }
}

function buildCareerFit(
  skills: SkillsScoreResult,
  experience: RelevantExperienceResult,
  seniority: ReturnType<typeof scoreSeniorityAlignment>,
  title: ReturnType<typeof scoreTitle>,
  domain: ReturnType<typeof scoreDomain>,
  semantic: ReturnType<typeof scoreSemanticOverlap>,
  certs: ReturnType<typeof scoreCerts>,
  roleFamily: ReturnType<typeof scoreRoleFamilyFit>
): CareerFitResult {
  const atsScreenScore = Math.round(clamp(
    skills.score * 0.55 +
    semantic.score * 0.2 +
    title.score * 0.15 +
    certs.score * 0.1
  ) * 100)

  const careerFitScore = Math.round(clamp(
    experience.score * 0.45 +
    roleFamily.score * 0.25 +
    domain.score * 0.15 +
    seniority.score * 0.1 +
    title.score * 0.05
  ) * 100)

  const label: CareerFitLabel =
    careerFitScore >= 80 && atsScreenScore >= 75
      ? "ats_ready"
      : atsScreenScore >= 70 && careerFitScore >= 60
        ? "tailor_resume"
        : atsScreenScore >= 60
          ? "bridge_first"
          : "career_pivot"

  const recommendation =
    label === "ats_ready"
      ? "Apply with light tailoring; the resume already shows role-specific evidence."
      : label === "tailor_resume"
        ? "Tailor the resume around recent role-specific proof before applying."
        : label === "bridge_first"
          ? "Build or foreground recent role-specific evidence before spending many applications here."
          : "Treat this as a pivot; target adjacent stepping-stone roles or add proof in the missing domain first."

  const requiredLabel =
    experience.requiredYears > 0
      ? ` of ${experience.requiredYears} required`
      : ""

  return {
    atsScreenScore,
    careerFitScore,
    relevantYears: Number(experience.relevantYears.toFixed(1)),
    totalYears: Number(experience.totalYears.toFixed(1)),
    requiredYears: experience.requiredYears,
    relevantYearsRatio:
      experience.ratio == null ? null : Number(experience.ratio.toFixed(3)),
    label,
    recommendation,
    evidence: [
      `${experience.relevantYears.toFixed(1)} relevant${requiredLabel} years; ${experience.totalYears.toFixed(1)} total years.`,
      roleFamily.evidence,
      domain.evidence,
    ],
  }
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

// ─── 8. Semantic overlap (weight 0.06) ────────────────────────────────────────

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

const HIGH_IMPACT_SENIORITY = new Set<SeniorityLevel>(["director", "vp", "exec"])

export function getSeniorityGap(c: SeniorityLevel | null | undefined, j: SeniorityLevel | null | undefined) {
  return c && j ? SENIORITY_MAP[c] - SENIORITY_MAP[j] : null
}

function resolveJobSeniorityForScoring(job: Job): {
  level: SeniorityLevel | null
  ignoredStoredLevel: SeniorityLevel | null
} {
  const inferred = inferSeniorityLevel(job.title, job.description) as SeniorityLevel | null

  if (inferred) {
    return {
      level: inferred,
      ignoredStoredLevel:
        job.seniority_level && job.seniority_level !== inferred ? job.seniority_level : null,
    }
  }

  if (job.seniority_level && HIGH_IMPACT_SENIORITY.has(job.seniority_level)) {
    return {
      level: null,
      ignoredStoredLevel: job.seniority_level,
    }
  }

  return {
    level: job.seniority_level ?? null,
    ignoredStoredLevel: null,
  }
}

function scoreSeniorityAlignment(
  candidateLevel: SeniorityLevel | null | undefined,
  jobLevel: SeniorityLevel | null | undefined
) {
  const gap = getSeniorityGap(candidateLevel, jobLevel)

  if (gap === null) {
    return {
      score: 0.75,
      evidence: "Seniority level unavailable for candidate or role; using neutral fit.",
      gap,
    }
  }

  if (gap === 0) {
    return {
      score: 1,
      evidence: `Candidate seniority (${candidateLevel}) matches role seniority (${jobLevel}).`,
      gap,
    }
  }

  const absGap = Math.abs(gap)
  const score =
    gap > 0
      ? Math.max(0.2, 0.9 - 0.2 * (absGap - 1))
      : Math.max(0.15, 0.82 - 0.24 * (absGap - 1))
  const direction = gap > 0 ? "above" : "below"

  return {
    score,
    evidence: `Candidate seniority (${candidateLevel}) is ~${absGap} tier${absGap === 1 ? "" : "s"} ${direction} role seniority (${jobLevel}).`,
    gap,
  }
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
  const title = exp.title ?? ""
  const description = exp.description ?? ""
  const evidenceText = [
    title,
    description,
    ...(exp.achievements ?? []),
  ].join(" ")
  const skillKeys = new Set(
    normalizeSkillList(extractSkillsFromText(evidenceText), 24).map((skill) =>
      normalizeSkillKey(canonicalizeSkill(skill))
    )
  )

  return {
    title,
    titleTokens: titleTokens(title),
    seniorityTier: seniorityTier(title),
    descriptionLower: description.toLowerCase(),
    skillKeys,
    roleFamily: classifyRoleFamily(title, description),
    is_current: exp.is_current,
    endYear: extractYear(exp.end_date),
    years: roleYears(exp),
  }
}

export function buildFastScoreResumeContext(resume: Resume): FastScoreResumeContext {
  const resumeEvidenceText = [
    resume.summary ?? "",
    resume.primary_role ?? "",
    ...(resume.work_experience ?? []).map((exp) =>
      [
        exp.title,
        exp.description,
        ...(exp.achievements ?? []),
      ].join(" ")
    ),
    ...(resume.projects ?? []).map((project) =>
      [
        project.name,
        project.description,
        ...(project.technologies ?? []),
      ].join(" ")
    ),
    resume.raw_text ?? "",
  ]
  const candidateSkillLabels = normalizeSkillList([
    ...getAllResumeSkillLabels(resume),
    ...extractSkillsFromText(...resumeEvidenceText),
  ])
  const candidateSkillKeys = candidateSkillLabels.map((candidateSkill) =>
    normalizeSkillKey(canonicalizeSkill(candidateSkill))
  )
  const candidateFamilies = new Set<string>()
  for (const label of candidateSkillLabels) {
    const family = getSkillFamily(label)
    if (family) candidateFamilies.add(family)
  }

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
    .map((exp) => exp.roleFamily)

  return {
    candidateSkillKeys,
    candidateSkillKeySet: new Set(candidateSkillKeys),
    candidateFamilies,
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
  targetField,
}: FastScoreInput): JobMatchScoreInsert {
  const context = resumeContext ?? buildFastScoreResumeContext(resume)
  const jobSeniority = resolveJobSeniorityForScoring(job)
  const jobForScoring =
    job.seniority_level === jobSeniority.level ? job : { ...job, seniority_level: jobSeniority.level }
  const skills     = scoreSkills(context, job)
  const candidateSeniority = resume.seniority_level ?? profile.seniority_level
  const experience = scoreExperience(context, jobForScoring)
  const seniority  = scoreSeniorityAlignment(candidateSeniority, jobForScoring.seniority_level)
  const title      = scoreTitle(context, job)
  const education  = scoreEducation(resume, job)
  const domain     = scoreDomain(context, job)
  const certs      = scoreCerts(context, job)
  const semantic   = scoreSemanticOverlap(context, job)
  const roleFamily = scoreRoleFamilyFit(context, resume, job)
  const relevantExperience = scoreRelevantExperience(
    context,
    jobForScoring,
    skills.hardSkills,
    roleFamily,
    experience
  )
  const careerFit = buildCareerFit(
    skills,
    relevantExperience,
    seniority,
    title,
    domain,
    semantic,
    certs,
    roleFamily
  )
  const sponsorship = getSponsorshipScore(profile, job)
  const seniorityGap = seniority.gap

  // Weighted sum → 0–100
  let overall = Math.round(
    skills.score     * W.skills     * 100 +
    relevantExperience.score * W.experience * 100 +
    seniority.score  * W.seniority  * 100 +
    title.score      * W.title      * 100 +
    education.score  * W.education  * 100 +
    domain.score     * W.domain     * 100 +
    certs.score      * W.certs      * 100 +
    semantic.score   * W.semantic   * 100 +
    roleFamily.score * W.roleFamily * 100
  )

  // Hard gates (applied after weighted sum, in order of severity)
  const gatesTriggered: string[] = []
  const totalRequired = skills.requiredCount
  let topBandPromotion: string | null = null

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
    const hasLowSignalSkillSupport =
      skills.score >= 0.4 ||
      skills.hardMatchedCount >= 1
    const strongSameFamilyEvidence =
      hasLowSignalSkillSupport &&
      roleFamily.score >= 1 &&
      relevantExperience.score >= 0.7 &&
      title.score >= 0.65 &&
      education.score >= 0.55
    const cap = strongSameFamilyEvidence ? 78 : 65
    overall = Math.min(overall, cap)
    if (strongSameFamilyEvidence) {
      overall = Math.max(overall, 70)
    }
    gatesTriggered.push(`low_signal_skills_lt5:${totalRequired}`)
  }

  // Skills gate — only fires when there are enough skills to make the ratio
  // meaningful (≥5 required) AND the candidate is missing >75% of them.
  // Threshold raised from 60% → 75% so candidates missing half the stack
  // (a common state, especially as our extractor now pulls more skills per
  // JD) aren't capped at 55. Cap relaxed 55 → 65 so a partial-skill match
  // can still reach "good match" territory.
  if (totalRequired >= 5 && skills.hardMissing.length / totalRequired > 0.75) {
    overall = Math.min(overall, 65)
    gatesTriggered.push("missing_required_skills_gt75pct")
  }

  // Experience gate — tiered by how far under the stated requirement the
  // candidate is, using raw total years first (candidate_years / required_years).
  // A real shortfall must keep a role out of the great-match band: a 5-year
  // candidate on an "8–10 years" role (ratio 0.62) is a "good", not "great",
  // fit no matter how well the other dimensions line up.
  if (experience.required > 0 && experience.ratio != null) {
    if (experience.ratio < 0.5) {
      // Less than half the required years — well short.
      overall = Math.min(overall, 65)
      gatesTriggered.push("insufficient_experience")
    } else if (experience.ratio < 0.75) {
      // Meaningfully under the requirement — cap below the strong-match band.
      overall = Math.min(overall, 80)
      gatesTriggered.push("below_preferred_experience")
    }
  }

  // Relevant-experience gate — catches the higher-value failure mode: the
  // candidate has enough years overall and maybe enough keywords, but those
  // years are not in or near the role's actual lane.
  if (relevantExperience.requiredYears > 0 && relevantExperience.ratio != null) {
    if (relevantExperience.ratio < 0.5) {
      overall = Math.min(overall, 65)
      gatesTriggered.push("insufficient_relevant_experience")
    } else if (relevantExperience.ratio < 0.75) {
      overall = Math.min(overall, 78)
      gatesTriggered.push("limited_relevant_experience")
    }
  }

  // Extreme seniority mismatch (e.g. exec applying for intern) — relaxed
  // 35 → 50. The gap still pushes the score below the "great match" band
  // but doesn't crush it to a single-digit territory.
  if (seniorityGap !== null && Math.abs(seniorityGap) > 3) {
    overall = Math.min(overall, 50)
    gatesTriggered.push("extreme_seniority_mismatch")
  }

  // Moderate level mismatches should not land in the excellent band purely
  // because the candidate has enough raw years or overlapping skills.
  if (seniorityGap !== null && Math.abs(seniorityGap) >= 2) {
    const cap = seniorityGap < 0 ? 72 : 78
    overall = Math.min(overall, cap)
    gatesTriggered.push(`seniority_mismatch:${seniorityGap}`)
  }

  // Same broad family is helpful but not enough by itself. A pharmacist and
  // registered nurse are both healthcare; a backend engineer and help-desk
  // technician are both tech. If the title evidence is very weak, keep the
  // score below the strong-match band unless the rest of the evidence is
  // unusually specific.
  if (roleFamily.score >= 1 && title.score < 0.35 && skills.score < 0.85) {
    overall = Math.min(overall, 68)
    gatesTriggered.push("same_family_low_title_fit")
  }

  // Role-family gate — caps scores when the JD belongs to a fundamentally
  // different career family from the candidate's recent roles. Caused by
  // soft-skill overlap inflating cross-domain matches (e.g. SWE matched to
  // "Security Officer" at 91% because both resumes/JDs mention
  // "Communication"). Unknown candidate families are ignored when any known
  // family exists, so one sparse title cannot disable the cross-domain guard.
  if (
    roleFamily.jobFamily !== "unknown" &&
    roleFamily.candidateFamilies.length > 0 &&
    !roleFamily.compatible
  ) {
    // Relaxed 40 → 55: the role-family classifier mis-fires on
    // multidisciplinary roles (SWE → "Data Scientist", "Security Engineer"
    // → "Software Engineer", etc.). Cap at 55 keeps these out of the
    // "great match" band but doesn't bury legitimate adjacent fits.
    overall = Math.min(overall, 55)
    gatesTriggered.push(`role_family_mismatch:${roleFamily.candidateFamilies[0]}→${roleFamily.jobFamily}`)
  }

  // Spread genuine (ungated) matches across the range so good and mediocre fits
  // separate visibly instead of clumping in the 70s–80s. Expanding around a 70
  // pivot pushes strong matches up and weak ones down (90→94, 80→82, 60→58).
  // Applied ONLY when no gate fired, so the cross-domain / seniority / skills /
  // experience guards above are never re-inflated — that unconditional inflation
  // is exactly what retired the previous global curve. Runs before the
  // top-band promotion so promoted floors (95/98) are never themselves expanded.
  if (gatesTriggered.length === 0) {
    const PIVOT = 70
    const SPREAD = 1.22
    overall = clamp(Math.round(PIVOT + (overall - PIVOT) * SPREAD), 0, 100)
  }

  const hasTopBandBlockingGate = gatesTriggered.some((gate) =>
    gate === "missing_required_cert" ||
    gate === "missing_required_skills_gt75pct" ||
    gate === "insufficient_experience" ||
    gate === "insufficient_relevant_experience" ||
    gate === "limited_relevant_experience" ||
    gate === "extreme_seniority_mismatch" ||
    gate.startsWith("seniority_mismatch:") ||
    gate === "same_family_low_title_fit" ||
    gate.startsWith("role_family_mismatch:")
  )
  const hasUsableSkillEvidence =
    skills.score >= 0.55 ||
    (totalRequired > 0 &&
      totalRequired < 5 &&
      (skills.hardMatchedCount >= 1 || skills.score >= 0.5) &&
      skills.hardMissing.length <= 1)
  const excellentSameProfessionEvidence =
    !hasTopBandBlockingGate &&
    roleFamily.score >= 1 &&
    title.score >= 0.9 &&
    relevantExperience.score >= 0.7 &&
    seniority.score >= 0.7 &&
    education.score >= 0.5 &&
    hasUsableSkillEvidence

  if (excellentSameProfessionEvidence) {
    // Near-perfect evidence reaches into the 96–98 band so a truly exceptional
    // fit is visibly distinct from a merely strong one (which tops out ~92–95).
    const target =
      skills.score >= 0.9 && relevantExperience.score >= 0.95 && title.score >= 0.9 && seniority.score >= 0.85
        ? 98
        : skills.score >= 0.8
          ? 95
          : skills.score >= 0.6
            ? 92
            : 90
    if (overall < target) {
      overall = target
      topBandPromotion = `Excellent same-profession evidence promoted score to ${target}.`
    }
  }

  // Target-field positioning boost (opt-in). When the user has chosen a lane to
  // be matched as, nudge jobs that belong to that field up their feed — scaled by
  // how strongly the job belongs to it. Applied only to non-blocked matches so it
  // re-ranks within good matches rather than reviving a gated (bad) one.
  let targetFieldBoost = 0
  if (targetField && !hasTopBandBlockingGate) {
    const affinity = fieldAffinity(
      targetField,
      `${job.title} ${(job.skills ?? []).join(" ")} ${job.description ?? ""}`.slice(0, 4000),
    )
    targetFieldBoost = Math.round(TARGET_FIELD_BOOST_MAX * affinity)
    if (targetFieldBoost > 0) overall = overall + targetFieldBoost
  }

  // Sponsorship-first ranking (opt-in by profile). A visa-needing user should see
  // employers that will actually sponsor rank above those that won't. Folded into
  // overall_score ONLY when profile.needs_sponsorship — for everyone else
  // getSponsorshipScore returns {100, compatible} so the delta is 0 and scoring
  // is byte-for-byte unchanged. Bounded; the explicit "must already be
  // authorized" dead-end is pushed down hard.
  let sponsorshipRankDelta = 0
  if (profile.needs_sponsorship) {
    if (sponsorship.compatible) {
      sponsorshipRankDelta = sponsorship.score >= 100 ? 8 : sponsorship.score >= 80 ? 5 : sponsorship.score >= 60 ? 2 : 0
    } else {
      // score 0 == requires_authorization (a dead end); >0 == just no sponsorship signal.
      sponsorshipRankDelta = sponsorship.score === 0 ? -18 : -6
    }
    overall = overall + sponsorshipRankDelta
  }

  overall = clamp(overall, 0, 100)

  const now = new Date().toISOString()
  const confidence = skills.hardMissing.length === 0 && relevantExperience.score >= 0.8 && careerFit.careerFitScore >= 75
    ? "high" as const
    : totalRequired === 0
      ? "low" as const
    : careerFit.careerFitScore < 50
      ? "low" as const
    : skills.hardMissing.length / Math.max(1, totalRequired) > 0.5
      ? "low" as const
      : "medium" as const

  return {
    user_id: resume.user_id,
    resume_id: resume.id,
    job_id: job.id,
    overall_score: overall,
    skills_score:          Math.round(skills.score * 100),
    seniority_score:       Math.round(seniority.score * 100),
    education_score:       Math.round(education.score * 100),
    role_fit_score:        Math.round(title.score * 100),
    location_score:        null,
    employment_type_score: null,
    sponsorship_score:     sponsorship.score,
    domain_score:          Math.round(domain.score * 100),
    is_seniority_match:    seniority.score >= 0.65,
    is_education_match:    education.score >= 0.6,
    is_role_fit_match:     title.score >= 0.5,
    is_location_match:     null,
    is_employment_type_match: null,
    is_sponsorship_compatible: sponsorship.compatible,
    matching_skills_count: skills.hardMatchedCount,
    total_required_skills: totalRequired,
    skills_match_rate:     totalRequired > 0
      ? Number((skills.hardMatchedCount / totalRequired).toFixed(3))
      : null,
    score_method:  "fast",
    computed_at:   now,
    resume_version: getResumeVersion(resume),
    score_breakdown: {
      overallScore:        overall,
      skillsScore:         Math.round(skills.score * 100),
      experienceScore:     Math.round(relevantExperience.score * 100),
      seniorityScore:      Math.round(seniority.score * 100),
      roleFamilyScore:     Math.round(roleFamily.score * 100),
      roleFamily:          roleFamily.jobFamily,
      candidateRoleFamilies: roleFamily.candidateFamilies,
      careerFit,
      domainScore:         Math.round(domain.score * 100),
      semanticScore:       Math.round(semantic.score * 100),
      certificationScore:  Math.round(certs.score * 100),
      locationScore:       null,
      employmentTypeScore: null,
      sponsorshipScore:    sponsorship.score,
      visaFitScore:        null,
      freshnessScore:      null,
      matchedSkills:       skills.matched,
      missingSkills:       skills.missing,
      skillScores:         skills.perSkill,
      totalRequiredSkills: totalRequired,
      scoreMethod:         "fast",
      confidence,
      concerns: [
        ...(totalRequired === 0
          ? ["Job posting skills were not reliably structured; confidence is reduced."]
          : []),
        ...(skills.hardMissing.length > 0
          ? [`Missing ${skills.hardMissing.length} required skill${skills.hardMissing.length !== 1 ? "s" : ""}`]
          : []),
        ...(relevantExperience.requiredYears > 0 && relevantExperience.ratio != null && relevantExperience.ratio < 0.75
          ? [careerFit.recommendation]
          : []),
        ...(roleFamily.score >= 1 && totalRequired > 0 && totalRequired < 5
          ? ["Sparse job-skill extraction; role-family evidence carried more weight."]
          : []),
        ...(topBandPromotion ? [topBandPromotion] : []),
        ...(targetFieldBoost > 0 ? [`Positioned toward ${targetField}: +${targetFieldBoost} pts`] : []),
        ...(sponsorshipRankDelta !== 0
          ? [
              `Sponsorship ranking: ${sponsorshipRankDelta > 0 ? "+" : ""}${sponsorshipRankDelta} pts (${
                sponsorship.compatible ? "sponsors" : "no sponsorship"
              })`,
            ]
          : []),
        ...(jobSeniority.ignoredStoredLevel
          ? [`Unsupported stored seniority (${jobSeniority.ignoredStoredLevel}) ignored for scoring.`]
          : []),
        ...gatesTriggered.map(g => `Gate: ${g}`),
      ],
      computedAt: now,
    },
  }
}

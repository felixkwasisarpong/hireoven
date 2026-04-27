import { extractKeywords, normalizeKeyword } from "@/lib/resume/hub"
import { extractSkillsFromText, skillMatches } from "@/lib/skills/taxonomy"
import type { Resume } from "@/types"
import type { ResumeTailoringAnalysis } from "@/types/resume-hub"
import type {
  TailorAnalysisResult,
  TailorBulletSuggestion,
  TailorFix,
  TailorRoleAlignment,
  TailorSkillSuggestion,
  TailorSummarySuggestion,
} from "@/types/tailor-analysis"

/** Canonical technology keywords for local keyword comparison (request spec). */
export const TAILOR_CANON_KEYWORDS: readonly string[] = [
  "Python",
  "Java",
  "TypeScript",
  "React",
  "Next.js",
  "Node.js",
  "FastAPI",
  "Flask",
  "Django",
  "Spring Boot",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Redis",
  "AWS",
  "Azure",
  "GCP",
  "Docker",
  "Kubernetes",
  "Terraform",
  "Kafka",
  "RabbitMQ",
  "CI/CD",
  "GitHub Actions",
  "REST APIs",
  "GraphQL",
  "Microservices",
  "LLM",
  "LangChain",
  "OpenAI",
  "PyTorch",
  "Machine Learning",
  "Data Pipelines",
] as const

/**
 * Don’t nudge “add to skills” for generic soft/hiring phrasing; posting language often matches
 * these even when they are not a concrete stack/tool line for the skills block.
 */
const SOFT_OR_PM_JARGON_EXCLUDE = new Set(
  [
    "leadership",
    "communication",
    "collaboration",
    "teamwork",
    "stakeholder",
    "stakeholders",
    "stakeholder management",
    "cross functional",
    "crossfunctional",
    "excellent written",
    "verbal communication",
    "problem solving",
    "critical thinking",
    "time management",
    "mentoring",
    "mentorship",
    "public speaking",
    "adaptability",
    "organizational skills",
    "excellent",
    "ability",
    "opportunity",
    "self starter",
    "self-starter",
    "detail oriented",
    "fast paced",
    "interpersonal",
    "passionate",
    "rockstar",
    "ninja",
  ].map((s) => normalizeKeyword(s))
)

function isExcludedSoftOrNoiseSkill(term: string): boolean {
  const k = normalizeKeyword(term)
  if (k.length < 2) return true
  if (SOFT_OR_PM_JARGON_EXCLUDE.has(k)) return true
  if (/^(a|an|the|and|or|in|on|at|to|of|for|we|us|is|it|as|be)\b/.test(k)) return true
  return false
}

/**
 * Build posting “skill” list from the canonical tech list + taxonomy (no random JD word extraction).
 * Still allows a **small** set of `extractKeywords` hits that look plausibly technical.
 */
function buildSkillJobTerms(jd: string): string[] {
  const fromCanon = TAILOR_CANON_KEYWORDS.filter((kw) => keywordInText(kw, jd))
  const fromTax = extractSkillsFromText(jd).filter((s) => !isExcludedSoftOrNoiseSkill(s))
  const merged = Array.from(
    new Map(
      [...fromCanon, ...fromTax].map((s) => {
        const display = s.trim()
        return [normalizeKeyword(display), display] as const
      })
    ).values()
  )
  if (merged.length) return merged

  const extra = extractKeywords(jd, 24).filter((raw) => {
    if (isExcludedSoftOrNoiseSkill(raw)) return false
    if (!/^[A-Za-z0-9#][A-Za-z0-9#+./-]{1,32}$/u.test(raw.trim()) && !raw.trim().includes(" ")) {
      return false
    }
    if (raw.includes("/") || raw.includes(".") || /\d/.test(raw) || /[A-Z]{2,5}/.test(raw)) {
      return true
    }
    if (TAILOR_CANON_KEYWORDS.some((c) => skillMatches(c, raw))) {
      return true
    }
    return false
  })
  return uniqueKeywordStrings([...fromCanon, ...extra]).slice(0, 32)
}

function hasImpactSignal(line: string): boolean {
  return /\b\d[\d,]*%|\$\d|%\b|\b\d+\s*(ms|k|m|b|yr|yrs|years?|users?|teams?|people|x)\b|\b(reduce[ds]?|increase[ds]?|improve[ds]?|save[ds]?|grow|grew|cut|drove|dropped|gained|grew|scaled|impact|revenue|latency|throughput|uptime|nps|kpi|q[1-4]|qoq|yoy|mom)\b/i.test(
    line
  )
}

function readStrengthVerb(line: string): boolean {
  const t = line.replace(/^[-•*]\s*/, "").trim()
  const first = t.split(/[\s,;]+/)[0] ?? ""
  return /^(architect|automated|built|closed|conceived|cut|decreased|defined|delivered|deployed|designed|developed|drove|enabled|established|expanded|founded|grew|hired|improved|increased|introduced|launched|led|mentored|migrated|optimized|orchestrated|owned|pioneered|rebuilt|redesigned|refactored|reduced|rolled|scaled|shipped|solved|spearheaded|streamlined|tested|transformed|migrated|implemented|wrote|created|achieved|analyzed|coordinated|executed|established|oversaw|negotiated|partnered|proved|sourced|stewarded)\b/i.test(
    first
  )
}

function isWeakOrThinBullet(
  line: string,
  jobSkillTerms: string[],
  expTextForRole: string
): { weak: boolean; reason: "vague" | "thin" | "no_metric" | "missing_jd_stack" } | null {
  const trimmed = line.replace(/^[-•*]\s*/, "").trim()
  if (trimmed.length < 6) return null

  const vague = /\b(responsible for|worked on|helped|assisted|involved in|various|several|tasks?|duties? included)\b/i.test(
    trimmed
  )
  if (vague) {
    if (readStrengthVerb(trimmed) && hasImpactSignal(trimmed)) return null
    return { weak: true, reason: "vague" }
  }

  const noMetric = !hasImpactSignal(trimmed)
  const tooShort = trimmed.length < 46
  if (tooShort && noMetric && (trimmed.split(/\s+/).length < 9 || /^(also|in addition|additionally|my |i |we )\b/i.test(trimmed))) {
    if (readStrengthVerb(trimmed) && hasImpactSignal(trimmed)) return null
    return { weak: true, reason: "thin" }
  }

  if (noMetric && (trimmed.length < 40 || trimmed.split(/\s+/).length < 8) && /^(supported|participated|contributed|collaborated|coordinated) /i.test(trimmed)) {
    return { weak: true, reason: "no_metric" }
  }

  if (jobSkillTerms.length) {
    const inBullet = (t: string) => keywordInText(t, trimmed)
    const inExp = (t: string) => keywordInText(t, expTextForRole)
    const shouldSurface = jobSkillTerms.some((t) => inExp(t) && !inBullet(t))
    if (shouldSurface && !hasImpactSignal(trimmed) && trimmed.length < 88) {
      return { weak: true, reason: "missing_jd_stack" }
    }
  }
  return null
}

function buildDraftReplaceBullet(
  reason: "vague" | "thin" | "no_metric" | "missing_jd_stack",
  trimmedLine: string,
  exp: ExperienceLite,
  jobSkillTerms: string[]
): { issue: string; suggested: string; confidence: "low" | "medium" } {
  const expText = [exp.description, exp.role, exp.company].filter(Boolean).join(" ")
  const inRoleNotBullet = jobSkillTerms.filter(
    (t) => keywordInText(t, expText) && !keywordInText(t, trimmedLine)
  )
  const inRole = inRoleNotBullet.slice(0, 2)

  if (inRole.length) {
    return {
      issue:
        reason === "missing_jd_stack"
          ? "This bullet doesn’t name tools or outcomes the job asks for, while the same role already shows that stack nearby — pull one into this line with a result you can verify."
          : "This line is easy to miss in a skim; it should name your stack and a measurable result.",
      suggested: `• [Draft—verify] Led <outcome> with ${inRole.join(" and ")} (already in this role—make this bullet the one that proves that stack). Add one metric: time, %, $, or scale.`,
      confidence: "medium",
    }
  }

  if (reason === "vague" || reason === "thin" || reason === "no_metric") {
    return {
      issue: "Generic phrasing: strengthen with a past-tense outcome, scope, and a number if you can support it.",
      suggested:
        "• [Draft—verify] <Strong verb> <scope> that <measurable outcome> (replace bracketed parts with facts from this job).",
      confidence: "low",
    }
  }
  return {
    issue: "Tie this line to a concrete action and tool from the job description you actually used.",
    suggested:
      "• [Draft—verify] <Strong verb> <system/project> to <customer-facing or infra outcome> using <posting tool you truly used> + one metric.",
    confidence: "low",
  }
}

const INDIRECT_HINTS: Record<string, string[]> = {
  kubernetes: ["k8s", "k8", "kube"],
  "ci/cd": ["github actions", "gitlab ci", "jenkins", "circleci", "cicd"],
  aws: ["ec2", "lambda", "s3", "amazon web services"],
  fastapi: ["fast api"],
  postgresql: ["postgres", "psql"],
  typescript: ["ts "],
  javascript: ["js "],
  kafka: ["event stream", "event streaming"],
}

function scoreToRoleAlignment(score: number): TailorRoleAlignment {
  if (score >= 70) return "strong"
  if (score >= 45) return "moderate"
  return "weak"
}

function hasIndirectEvidence(resumeBundle: string, term: string): { ok: boolean; evidence: string } {
  const n = normalizeKeyword(term)
  const lower = resumeBundle.toLowerCase()
  const hints = INDIRECT_HINTS[n] ?? []
  for (const h of hints) {
    if (lower.includes(h)) {
      return { ok: true, evidence: `Resume mentions related term: ${h}` }
    }
  }
  if (n === "kubernetes" && /\bk8s?\b/i.test(resumeBundle)) {
    return { ok: true, evidence: "Resume uses K8s-style shorthand" }
  }
  return { ok: false, evidence: "" }
}

type ExperienceLite = { company: string; role: string; description: string }

export type BuildLocalTailorInput = {
  resume: Resume | null
  jobDescription: string
  skillsText: string
  profileSummary: string
  experienceDraft: ExperienceLite[]
}

function collectResumeBundle(input: BuildLocalTailorInput): string {
  const { resume, skillsText, profileSummary, experienceDraft } = input
  const fromResume = [
    resume?.raw_text,
    resume?.summary,
    JSON.stringify(resume?.work_experience ?? []),
    JSON.stringify(resume?.skills ?? {}),
    (resume?.top_skills ?? []).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
  const fromDrafts = experienceDraft
    .map((e) => [e.company, e.role, e.description].filter(Boolean).join(" "))
    .join(" ")
  return [fromResume, skillsText, profileSummary, fromDrafts].join("\n")
}

function keywordInText(kw: string, text: string): boolean {
  const n = normalizeKeyword(kw)
  return text.toLowerCase().includes(n) || new RegExp(`\\b${escapeRe(kw)}\\b`, "i").test(text)
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildFixId(prefix: string, index: number) {
  return `local-${prefix}-${index}`
}

/** Deduplication key: same skill / same bullet / one summary. */
function fixMergeKey(f: TailorFix): string {
  if (f.type === "add_skill") return `a:${normalizeKeyword(f.skill)}`
  if (f.type === "replace_bullet") {
    return `b:${f.experienceId}:${normalizeKeyword(f.original.slice(0, 240))}`
  }
  return "s:summary"
}

function uniqueKeywordStrings(keywords: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of keywords) {
    const k = normalizeKeyword(w)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(w)
  }
  return out
}

/**
 * Drop hiring-noise and generic soft skills from model output (local path already avoids them).
 */
export function pruneSkillNoiseFromAnalysis(result: TailorAnalysisResult): TailorAnalysisResult {
  const keepSkill = (s: string) => !isExcludedSoftOrNoiseSkill(s)
  const nextSkills = result.skillSuggestions.filter((s) => keepSkill(s.skill))
  const nextPresent = result.presentKeywords.filter(keepSkill)
  const nextMissing = result.missingKeywords.filter(keepSkill)
  const nextFixes = result.fixes.filter((f) => {
    if (f.type !== "add_skill") return true
    return keepSkill(f.skill)
  })
  if (
    nextSkills.length === result.skillSuggestions.length
    && nextPresent.length === result.presentKeywords.length
    && nextMissing.length === result.missingKeywords.length
    && nextFixes.length === result.fixes.length
  ) {
    return result
  }
  return { ...result, skillSuggestions: nextSkills, presentKeywords: nextPresent, missingKeywords: nextMissing, fixes: nextFixes }
}

/**
 * Union two analyses so quick-scan fixes are kept when the model returns a shorter list.
 * Prefer higher match score, union keywords and fixes (deduped by semantic key).
 */
export function mergeTailorResults(
  a: TailorAnalysisResult,
  b: TailorAnalysisResult
): TailorAnalysisResult {
  const fixMap = new Map<string, TailorFix>()
  for (const f of a.fixes) fixMap.set(fixMergeKey(f), f)
  for (const f of b.fixes) {
    const k = fixMergeKey(f)
    if (!fixMap.has(k)) fixMap.set(k, f)
  }
  const fixRank = (t: TailorFix["type"]) => (t === "add_skill" ? 0 : t === "replace_bullet" ? 1 : 2)
  const fixes = Array.from(fixMap.values()).sort(
    (x, y) => fixRank(x.type) - fixRank(y.type) || x.label.localeCompare(y.label, "en")
  )

  const skMap = new Map<string, TailorSkillSuggestion>()
  for (const s of a.skillSuggestions) skMap.set(normalizeKeyword(s.skill), s)
  for (const s of b.skillSuggestions) {
    const k = normalizeKeyword(s.skill)
    if (!skMap.has(k)) skMap.set(k, s)
  }

  const bMap = new Map<string, TailorBulletSuggestion>()
  for (const s of a.bulletSuggestions) bMap.set(s.id, s)
  for (const s of b.bulletSuggestions) {
    if (!bMap.has(s.id)) bMap.set(s.id, s)
  }

  const matchScore = Math.max(a.matchScore, b.matchScore)
  return {
    matchScore: Math.max(0, Math.min(100, matchScore)),
    roleAlignment: scoreToRoleAlignment(matchScore),
    presentKeywords: uniqueKeywordStrings([...a.presentKeywords, ...b.presentKeywords]),
    missingKeywords: uniqueKeywordStrings([...a.missingKeywords, ...b.missingKeywords]),
    skillSuggestions: Array.from(skMap.values()),
    bulletSuggestions: Array.from(bMap.values()),
    summarySuggestion: b.summarySuggestion ?? a.summarySuggestion,
    fixes,
    warnings: Array.from(new Set([...a.warnings, ...b.warnings])),
  }
}

/**
 * Heuristic: append or categorize a skill in the user’s skills block without duplicating.
 */
export function addSkillToSkillsText(skillsText: string, skill: string): string {
  const add = skill.trim()
  if (!add) return skillsText
  const normalizedAdd = normalizeKeyword(add)
  const normalizedParts = skillsText
    .split(/\r?\n|,|;|\||•|·/)
    .map((part) => {
      const rhs = part.includes(":") ? (part.split(":").slice(1).join(":") || part) : part
      return normalizeKeyword(rhs)
    })
    .filter(Boolean)
  if (normalizedParts.some((part) => part === normalizedAdd)) {
    return skillsText
  }

  const hasCategoryLines = /:\s*[^\n]+/m.test(skillsText) && skillsText.split("\n").some((line) => /:\s*/.test(line))

  if (!hasCategoryLines) {
    const base = skillsText.trim()
    return base ? `${base}, ${add}` : add
  }

  const sk = add
  const lower = sk.toLowerCase()
  const pick =
    /aws|azure|gcp|docker|kubernetes|terraform|ci\/cd|github actions/i.test(sk) ? "Cloud & DevOps"
    : /llm|langchain|openai|pytorch|machine learning/i.test(sk) ? "AI & ML Tools"
    : /python|java|typescript|javascript|sql|bash|go(\b|$)/i.test(sk) ? "Languages"
    : /fastapi|flask|django|spring boot|node\.js|react|next\.js/i.test(sk) ? "Frameworks"
    : "Concepts"

  const lines = skillsText.split(/\r?\n/)
  let found = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (new RegExp(`^\\s*${escapeRe(pick)}\\s*:`, "i").test(lines[i]!)) {
      found = i
      break
    }
  }
  if (found >= 0) {
    const line = lines[found]!
    const m = line.match(/^(.*?:\s*)(.*)$/)
    if (m) {
      const rest = m[2] ?? ""
      const nextRest = rest.trim() ? `${rest.trim()}, ${sk}` : sk
      lines[found] = `${m[1] ?? ""}${nextRest}`
      return lines.join("\n")
    }
  }
  return `${skillsText.trim()}\nAdditional: ${sk}`
}

export function buildLocalTailorAnalysis(input: BuildLocalTailorInput): TailorAnalysisResult {
  const jd = input.jobDescription
  const resumeBundle = collectResumeBundle(input)

  const jobTerms = buildSkillJobTerms(jd)

  const presentKeywords: string[] = []
  const missingFromCanon: string[] = []

  for (const kw of jobTerms) {
    if (keywordInText(kw, resumeBundle)) {
      presentKeywords.push(kw)
    } else {
      missingFromCanon.push(kw)
    }
  }

  const presentSet = new Set(presentKeywords.map((k) => normalizeKeyword(k)))
  const missingKeywords = missingFromCanon.filter((k) => !presentSet.has(normalizeKeyword(k)))

  const matchScore = Math.round(
    jobTerms.length > 0 ? (presentKeywords.length / jobTerms.length) * 100 : 45
  )
  const roleAlignment = scoreToRoleAlignment(matchScore)

  const skillSuggestions: TailorSkillSuggestion[] = jobTerms.map((skill) => {
    if (keywordInText(skill, resumeBundle)) {
      return {
        skill,
        status: "present",
        reason: "This term already appears in your resume text.",
        targetSection: "skills",
      }
    }
    const indirect = hasIndirectEvidence(resumeBundle, skill)
    if (indirect.ok) {
      return {
        skill,
        status: "missing_supported",
        evidence: indirect.evidence,
        reason: "Not written exactly as the posting, but your resume has related context—safe to align wording if true.",
        targetSection: "skills",
      }
    }
    return {
      skill,
      status: "missing_needs_confirmation",
      reason: "Mentioned in the job description but not clearly present in the resume. Confirm before adding.",
      targetSection: "skills",
    }
  })

  const skillSuggestionsByKey = new Map(skillSuggestions.map((s) => [normalizeKeyword(s.skill), s]))

  const warnings = [
    "Add only skills and experience that are true. Do not fabricate experience.",
    "Only apply suggestions that accurately reflect your real experience.",
  ]

  const bulletSuggestions: TailorBulletSuggestion[] = []
  const fixes: TailorFix[] = []
  let fixIndex = 0

  const pushAddSkill = (skill: string, status: "missing_supported" | "missing_needs_confirmation", before: string) => {
    const requiresConfirmation = status === "missing_needs_confirmation"
    const after = addSkillToSkillsText(before, skill)
    if (after === before) return
    fixes.push({
      id: buildFixId("skill", fixIndex++),
      type: "add_skill",
      label: `Add skill: ${skill}`,
      skill,
      target: "skills",
      before,
      after,
      reason: skillSuggestionsByKey.get(normalizeKeyword(skill))?.reason ?? "Aligns your skills with the job posting.",
      requiresConfirmation,
    })
  }

  const seenSkillFix = new Set<string>()
  for (const s of skillSuggestions) {
    if (s.status === "missing_supported" || s.status === "missing_needs_confirmation") {
      const k = normalizeKeyword(s.skill)
      if (seenSkillFix.has(k)) continue
      const beforeLen = fixes.length
      pushAddSkill(s.skill, s.status, input.skillsText)
      if (fixes.length > beforeLen) seenSkillFix.add(k)
    }
  }

  const MAX_BULLET_FIXES = 24
  let bulletFixCount = 0
  for (let i = 0; i < input.experienceDraft.length; i += 1) {
    if (bulletFixCount >= MAX_BULLET_FIXES) break
    const exp = input.experienceDraft[i]!
    const experienceId = `exp-${i}`
    const expTextForRole = [exp.description, exp.role, exp.company].filter(Boolean).join("\n")
    const descLines = exp.description.split(/\r?\n/)
    let bulletsThisExp = 0
    let missingJdNudgesThisExp = 0
    for (const line of descLines) {
      if (bulletFixCount >= MAX_BULLET_FIXES) break
      if (bulletsThisExp >= 8) break
      const weak = isWeakOrThinBullet(line, jobTerms, expTextForRole)
      if (!weak?.weak) continue
      if (weak.reason === "missing_jd_stack") {
        if (missingJdNudgesThisExp >= 3) continue
        missingJdNudgesThisExp += 1
      }

      const draft = buildDraftReplaceBullet(weak.reason, line, exp, jobTerms)
      const b: TailorBulletSuggestion = {
        id: buildFixId("bullet", bulletSuggestions.length),
        experienceId,
        company: exp.company,
        role: exp.role,
        original: line.trim(),
        issue: draft.issue,
        suggested: draft.suggested,
        reason:
          "Suggests how to echo tools from this role or the posting without inventing new employers or dates.",
        confidence: draft.confidence,
      }
      bulletSuggestions.push(b)
      fixes.push({
        id: buildFixId("bullet", fixIndex++),
        type: "replace_bullet",
        label: `Strengthen bullet @ ${[exp.role, exp.company].filter(Boolean).join(" — ") || `Role ${i + 1}`}`,
        experienceId,
        original: line.trim(),
        suggested: b.suggested,
        reason: b.reason,
        requiresConfirmation: false,
      })
      bulletsThisExp += 1
      bulletFixCount += 1
    }
  }

  const summaryText = input.profileSummary.trim()
  const summaryLacksJd = summaryText
    ? jobTerms.filter((k) => !summaryText.toLowerCase().includes(normalizeKeyword(k))).length >= 2
    : true
  let summarySuggestion: TailorSummarySuggestion | undefined
  if (!summaryText || summaryLacksJd) {
    const suggested = sanitizeTailorSummaryText(
      summaryText
        ? summaryText
        : "Target-aligned summary: highlight verified tools, scope, and outcomes from your actual experience."
    )

    summarySuggestion = {
      original: summaryText || "(empty)",
      issue: "Summary is empty or does not echo enough of the role’s key themes.",
      suggested: suggested,
      reason: "Uses your existing content only and removes placeholder hint text.",
      confidence: "medium",
    }
    fixes.push({
      id: buildFixId("summary", fixIndex++),
      type: "replace_summary",
      label: "Tighten profile summary for this role",
      original: summaryText,
      suggested: summarySuggestion.suggested,
      reason: summarySuggestion.reason,
      requiresConfirmation: false,
    })
  }

  return {
    matchScore: Math.max(0, Math.min(100, matchScore)),
    roleAlignment,
    presentKeywords,
    missingKeywords,
    skillSuggestions,
    bulletSuggestions,
    summarySuggestion,
    fixes,
    warnings,
  }
}

function asString(x: unknown): string {
  return typeof x === "string" ? x.trim() : ""
}

export function sanitizeTailorSummaryText(text: string): string {
  if (!text.trim()) return ""
  return text
    .replace(/\[Alignment hint[^\]]*\]/gi, "")
    .replace(/\[Draft[^\]]*\]/gi, "")
    .replace(/\s*\(\s*keep only if accurate\s*\)\s*/gi, " ")
    .replace(/\s*Emphasize [^.?!]*only where it is already true in your experience\.\s*/gi, " ")
    .replace(/\s*Terms to reflect if true:[^.?!]*[.?!]\s*/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function asOptString(x: unknown): string | undefined {
  const s = asString(x)
  return s || undefined
}

function asNumber(x: unknown, d: number) {
  return typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : d
}

function isRoleAlignment(x: unknown): x is TailorRoleAlignment {
  return x === "strong" || x === "moderate" || x === "weak"
}

/**
 * Coerce server/LLM JSON and legacy `ResumeTailoringAnalysis` into `TailorAnalysisResult`.
 */
export function normalizeTailorAnalysis(
  input: unknown,
  fallbackJobTitle = "Target role"
): TailorAnalysisResult {
  if (!input || typeof input !== "object") {
    return {
      matchScore: 0,
      roleAlignment: "weak",
      presentKeywords: [],
      missingKeywords: [],
      skillSuggestions: [],
      bulletSuggestions: [],
      fixes: [],
      warnings: ["Invalid analysis payload."],
    }
  }

  const o = input as Record<string, unknown>
  const hasNewShape = typeof o.roleAlignment === "string" || Array.isArray(o.fixes)
  const isLegacy = !hasNewShape && (o as { bulletSuggestions?: { section?: string }[] }).bulletSuggestions?.[0] &&
    "section" in ((o as { bulletSuggestions: { section?: string }[] }).bulletSuggestions[0] as object)
  if (isLegacy) {
    return legacyToTailor(input as ResumeTailoringAnalysis, fallbackJobTitle)
  }

  const skillStatuses = new Set(["present", "missing_supported", "missing_needs_confirmation", "not_recommended"])
  const targetSections = new Set(["skills", "experience", "do_not_add"])

  const rawSkills = Array.isArray(o.skillSuggestions) ? o.skillSuggestions : []
  const skillSuggestions: TailorSkillSuggestion[] = rawSkills
    .map((raw) => {
      if (!raw || typeof raw !== "object") {
        return { skill: "—", status: "missing_needs_confirmation" as const, reason: "—", targetSection: "skills" as const }
      }
      const s = raw as Record<string, unknown>
      const status = s.status
      const st = skillStatuses.has(status as string) ? (status as TailorSkillSuggestion["status"]) : "missing_needs_confirmation"
      const skill = asString(s.skill) || "Skill"
      return {
        skill,
        status: st,
        evidence: asOptString(s.evidence),
        reason: asString(s.reason) || "—",
        targetSection: targetSections.has(s.targetSection as string) ? (s.targetSection as TailorSkillSuggestion["targetSection"]) : "skills",
      }
    })

  const rawBullets = Array.isArray(o.bulletSuggestions) ? o.bulletSuggestions : []
  const bulletSuggestions: TailorBulletSuggestion[] = rawBullets.map((raw, i) => {
    if (!raw || typeof raw !== "object") {
      return {
        id: `b-${i}`,
        experienceId: "exp-0",
        original: "—",
        issue: "—",
        suggested: "—",
        reason: "—",
        confidence: "medium" as const,
      }
    }
    const s = raw as Record<string, unknown>
    const c = s.confidence
    const conf = c === "low" || c === "high" || c === "medium" ? c : "medium"
    return {
      id: asString(s.id) || `b-${i}`,
      experienceId: asString(s.experienceId) || "exp-0",
      original: asString(s.original) || "—",
      issue: asString(s.issue) || "—",
      suggested: asString(s.suggested) || "—",
      reason: asString(s.reason) || "—",
      confidence: conf,
      ...(() => {
        const co = asOptString(s.company)
        const ro = asOptString(s.role)
        return {
          ...(co != null && co !== "" ? { company: co } : {}),
          ...(ro != null && ro !== "" ? { role: ro } : {}),
        }
      })(),
    }
  })

  const rawSum = o.summarySuggestion
  let summarySuggestion: TailorSummarySuggestion | undefined
  if (rawSum && typeof rawSum === "object") {
    const s = rawSum as Record<string, unknown>
    summarySuggestion = {
      original: asString(s.original),
      issue: asString(s.issue) || "—",
      suggested: sanitizeTailorSummaryText(asString(s.suggested) || "—"),
      reason: asString(s.reason) || "—",
      confidence: s.confidence === "low" || s.confidence === "high" || s.confidence === "medium" ? s.confidence : "medium",
    }
  }

  const rawFixes = Array.isArray(o.fixes) ? o.fixes : []
  const fixes: TailorFix[] = rawFixes
    .map((raw, i) => {
      if (!raw || typeof raw !== "object") return null
      const s = raw as Record<string, unknown>
      const id = asString(s.id) || `fix-${i}`
      const type = s.type
      const reason = asString(s.reason) || "—"
      const requires = Boolean(s.requiresConfirmation)

      if (type === "add_skill") {
        const skill = asString(s.skill)
        const before = asString(s.before) ?? ""
        const after = asString(s.after) || before
        return {
          id,
          type: "add_skill" as const,
          label: asString(s.label) || `Add skill: ${skill || "—"}`,
          skill: skill || "Skill",
          target: "skills" as const,
          before,
          after,
          reason,
          requiresConfirmation: requires,
        }
      }
      if (type === "replace_bullet") {
        return {
          id,
          type: "replace_bullet" as const,
          label: asString(s.label) || "Improve bullet",
          experienceId: asString(s.experienceId) || "exp-0",
          original: asString(s.original) || "",
          suggested: asString(s.suggested) || "",
          reason,
          requiresConfirmation: requires,
        }
      }
      if (type === "replace_summary") {
        return {
          id,
          type: "replace_summary" as const,
          label: asString(s.label) || "Replace profile summary",
          original: asString(s.original) || "",
          suggested: sanitizeTailorSummaryText(asString(s.suggested) || ""),
          reason,
          requiresConfirmation: requires,
        }
      }
      return null
    })
    .filter((x): x is TailorFix => Boolean(x))

  const presentKeywords = Array.isArray(o.presentKeywords) ? o.presentKeywords.map((k) => asString(k)).filter(Boolean) : []
  const missingKeywords = Array.isArray(o.missingKeywords) ? o.missingKeywords.map((k) => asString(k)).filter(Boolean) : []
  const ra = o.roleAlignment
  const matchScore = asNumber(o.matchScore, 0)
  return {
    matchScore,
    roleAlignment: isRoleAlignment(ra) ? ra : scoreToRoleAlignment(matchScore),
    presentKeywords,
    missingKeywords,
    skillSuggestions,
    bulletSuggestions,
    summarySuggestion,
    fixes,
    warnings: Array.isArray(o.warnings) ? o.warnings.map((w) => asString(w)).filter(Boolean) : [],
  }
}

function legacyToTailor(legacy: ResumeTailoringAnalysis, _jobTitle: string): TailorAnalysisResult {
  const presentKeywords = legacy.presentKeywords ?? []
  const missingKeywords = legacy.missingKeywords ?? []
  const matchScore = legacy.matchScore ?? 0
  const fixes: TailorFix[] = []
  let i = 0
  for (const s of legacy.suggestedSkillsToAdd ?? []) {
    if (!s?.trim()) continue
    const before = ""
    const after = s
    fixes.push({
      id: `legacy-skill-${i++}`,
      type: "add_skill",
      label: `Add skill: ${s}`,
      skill: s,
      target: "skills",
      before,
      after: after,
      reason: "Suggested from job vs resume comparison — verify before applying.",
      requiresConfirmation: true,
    })
  }
  if (legacy.suggestedSummaryRewrite) {
    fixes.push({
      id: `legacy-sum-${i++}`,
      type: "replace_summary",
      label: "Profile summary (legacy suggestion)",
      original: "",
      suggested: legacy.suggestedSummaryRewrite,
      reason: "From previous analyzer output.",
      requiresConfirmation: false,
    })
  }
  const bulletSuggestions: TailorBulletSuggestion[] = (legacy.bulletSuggestions ?? []).map((b, j) => ({
    id: `leg-b-${j}`,
    experienceId: "exp-0",
    original: b.original,
    issue: b.reason,
    suggested: b.suggested,
    reason: b.reason,
    confidence: "medium",
  }))

  return {
    matchScore,
    roleAlignment: scoreToRoleAlignment(matchScore),
    presentKeywords,
    missingKeywords,
    skillSuggestions: presentKeywords.map((k) => ({
      skill: k,
      status: "present" as const,
      reason: "In resume",
      targetSection: "skills" as const,
    })),
    bulletSuggestions,
    fixes,
    warnings: legacy.warnings?.length
      ? legacy.warnings
      : ["Add only skills and experience that are true. Do not fabricate experience."],
  }
}

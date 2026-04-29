import Anthropic from "@anthropic-ai/sdk"
import {
  cleanJobTitle,
  extractSkillsFromText,
  normalizeJobTitle,
} from "@/lib/jobs/text-normalizer"
import { categorizeSkills, emptyCategorizedSkills, normalizeSkillList } from "@/lib/skills/taxonomy"
import {
  extractSalaryRange,
  inferJobMetadata,
  inferRequiresAuthorization,
} from "@/lib/jobs/metadata"
import { HAIKU_MODEL } from "@/lib/ai/anthropic-models"
import { extractCanonicalSections } from "@/lib/jobs/normalization/sections"
import { validateCanonicalJob } from "@/lib/jobs/normalization/validator"
import { adaptPersistedJob, adaptRawCrawlerJob } from "@/lib/jobs/normalization/source-adapters"
import {
  formatSalaryLabel,
  mapCanonicalToJobCardView,
  mapCanonicalToJobPageView,
} from "@/lib/jobs/normalization/view-model"
import {
  JOB_NORMALIZATION_VERSION,
} from "@/lib/jobs/normalization/types"
import type {
  CanonicalField,
  CanonicalJob,
  FieldProvenance,
  NormalizationResult,
  PersistedJobForNormalization,
  SourceRawJobInput,
} from "@/lib/jobs/normalization/types"
import type { EmploymentType, SeniorityLevel } from "@/types"

let anthropicClient: Anthropic | null = null

type ExistingJobState = {
  description: string | null
  employment_type: EmploymentType | null
  seniority_level: SeniorityLevel | null
  is_remote: boolean | null
  is_hybrid: boolean | null
  requires_authorization: boolean | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  sponsors_h1b: boolean | null
  sponsorship_score: number | null
  visa_language_detected: string | null
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function field<T>(
  value: T | null,
  confidence: number,
  provenance: FieldProvenance | FieldProvenance[]
): CanonicalField<T> {
  return {
    value,
    confidence: clampConfidence(confidence),
    provenance: Array.isArray(provenance) ? provenance : [provenance],
  }
}

function pickConfidence(
  value: unknown,
  preferred: number,
  fallback: number
): number {
  return value == null ? fallback : preferred
}

function normalizePostedAt(raw: string | null | undefined, fallbackIso: string): string {
  if (!raw) return fallbackIso
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) return fallbackIso
  return new Date(parsed).toISOString()
}

function extractVisaLanguage(description: string | null): string | null {
  if (!description) return null

  const contextual = description.match(
    /([^\n.!?]{0,120}\b(?:visa|sponsor|sponsorship|authorized to work|work authorization|h-?1b|opt)\b[^\n.!?]{0,180})/i
  )?.[1]

  if (contextual?.trim()) return contextual.trim().slice(0, 220)

  const fragments = description.split(/[\n.;]+/)
  for (const fragment of fragments) {
    if (
      /\b(visa|sponsor|sponsorship|authorized to work|work authorization|h-?1b|opt)\b/i.test(
        fragment
      )
    ) {
      return fragment.trim().slice(0, 220)
    }
  }

  return null
}

function inferSponsorshipFromText(
  description: string | null
): { sponsors_h1b: boolean | null; sponsorship_score: number } {
  if (!description) {
    return {
      sponsors_h1b: null,
      sponsorship_score: 60,
    }
  }

  if (/\b(we sponsor|visa sponsorship available|h-?1b sponsorship|will sponsor)\b/i.test(description)) {
    return {
      sponsors_h1b: true,
      sponsorship_score: 95,
    }
  }

  if (/\b(no sponsorship|without sponsorship|must be authorized to work|cannot sponsor)\b/i.test(description)) {
    return {
      sponsors_h1b: false,
      sponsorship_score: 10,
    }
  }

  if (/\b(visa|sponsorship|work authorization|h-?1b|opt)\b/i.test(description)) {
    return {
      sponsors_h1b: null,
      sponsorship_score: 55,
    }
  }

  return {
    sponsors_h1b: null,
    sponsorship_score: 60,
  }
}

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey })
  }
  return anthropicClient
}

function extractJsonObjectCandidate(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = (fenced?.[1] ?? trimmed).trim()
  const start = candidate.indexOf("{")
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < candidate.length; i += 1) {
    const char = candidate[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = inString
      continue
    }
    if (char === "\"") {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === "{") depth += 1
    if (char === "}") depth -= 1
    if (depth === 0) return candidate.slice(start, i + 1)
  }

  return null
}

function cleanLine(value: unknown, maxLen = 340): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (!trimmed) return null
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 3)}...` : trimmed
}

function cleanLines(value: unknown, limit: number, maxLen = 340): string[] {
  if (!Array.isArray(value)) return []

  const out: string[] = []
  for (const item of value) {
    const line = cleanLine(item, maxLen)
    if (!line) continue
    if (out.some((existing) => existing.toLowerCase() === line.toLowerCase())) continue
    out.push(line)
    if (out.length >= limit) break
  }

  return out
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeEmploymentType(value: unknown): EmploymentType | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === "fulltime" || normalized === "full-time" || normalized === "full time") return "fulltime"
  if (normalized === "parttime" || normalized === "part-time" || normalized === "part time") return "parttime"
  if (normalized === "contract" || normalized === "contractor" || normalized === "temporary") return "contract"
  if (normalized === "internship" || normalized === "intern") return "internship"
  return null
}

function normalizeSeniority(value: unknown): SeniorityLevel | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  if (
    normalized === "intern" ||
    normalized === "junior" ||
    normalized === "mid" ||
    normalized === "senior" ||
    normalized === "staff" ||
    normalized === "principal" ||
    normalized === "director" ||
    normalized === "vp" ||
    normalized === "exec"
  ) {
    return normalized
  }
  return null
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toUpperCase()
  if (!normalized) return null
  return normalized.length <= 8 ? normalized : normalized.slice(0, 8)
}

type HaikuNormalizationPayload = {
  cleanDescription?: unknown
  shortSummary?: unknown
  sections?: unknown
  extractedSkills?: unknown
  salary?: unknown
  workMode?: unknown
  employmentType?: unknown
  seniorityLevel?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toStructuredJobData(input: {
  canonical: CanonicalJob
  salaryCurrency: string
  payText: string | null
  shortSummary?: string | null
}): Record<string, unknown> {
  const job = input.canonical
  const sections = job.sections
  const remoteSignal =
    job.header.is_remote.value === true
      ? "remote"
      : job.header.is_hybrid.value === true
        ? "hybrid"
        : job.header.location.value
          ? "onsite_or_unspecified"
          : null

  return {
    title: job.header.title.value,
    company: job.company.name,
    companyDomain: job.company.domain,
    location: job.header.location.value,
    workMode:
      job.header.is_remote.value === true
        ? "remote"
        : job.header.is_hybrid.value === true
          ? "hybrid"
          : job.header.location.value
            ? "onsite"
            : null,
    employmentType: job.header.employment_type.value,
    salaryMin: job.compensation.salary_min.value,
    salaryMax: job.compensation.salary_max.value,
    salaryCurrency: input.salaryCurrency,
    postedAt: job.header.posted_at.value,
    applyUrl: job.header.apply_url.value,
    sourceUrl: job.source.crawl_url,
    atsProvider: job.source.adapter === "unknown" ? null : job.source.adapter,
    descriptionRaw: job.descriptions.raw,
    descriptionClean: job.descriptions.clean,
    sections: {
      aboutRole: sections.about_role.items,
      responsibilities: sections.responsibilities.items,
      requirements: sections.requirements.items,
      qualifications: sections.qualifications.items,
      preferredQualifications: sections.preferred_qualifications.items,
      skills: sections.skills.items,
      benefits: sections.benefits.items,
      compensation: sections.compensation.items.length > 0
        ? sections.compensation.items
        : input.payText
          ? [input.payText]
          : [],
      companyInfo: sections.company_info.items,
      equalOpportunity: sections.equal_opportunity.items,
      other: sections.other.items,
    },
    extractedSkills: job.skills.value ?? [],
    skillGroups: job.skill_groups,
    seniority: job.header.seniority_level.value,
    visaSponsorshipSignal: job.visa.visa_language.value,
    remoteSignal,
    jobCardSummary: input.shortSummary ?? null,
  }
}

type HaikuEnrichmentInput = {
  title: string
  location: string | null
  description: string | null
  existingDescription: string | null
  deterministic: NormalizationResult
}

async function requestHaikuEnrichment(input: HaikuEnrichmentInput): Promise<HaikuNormalizationPayload | null> {
  const client = getAnthropicClient()
  if (!client) return null

  const description = (input.description ?? input.existingDescription ?? "").trim()
  if (!description) return null

  const deterministicSections = {
    aboutRole: input.deterministic.canonical.sections.about_role.items,
    responsibilities: input.deterministic.canonical.sections.responsibilities.items,
    requirements: input.deterministic.canonical.sections.requirements.items,
    qualifications: input.deterministic.canonical.sections.qualifications.items,
    preferredQualifications: input.deterministic.canonical.sections.preferred_qualifications.items,
    skills: input.deterministic.canonical.sections.skills.items,
    benefits: input.deterministic.canonical.sections.benefits.items,
    compensation: input.deterministic.canonical.sections.compensation.items,
    companyInfo: input.deterministic.canonical.sections.company_info.items,
    equalOpportunity: input.deterministic.canonical.sections.equal_opportunity.items,
    other: input.deterministic.canonical.sections.other.items,
  }

  const message = await client.messages.create({
    // Job cleanup, sectioning, and metadata parsing are extraction/classification tasks.
    model: HAIKU_MODEL,
    max_tokens: 1800,
    temperature: 0,
    system:
      "You normalize noisy job descriptions into strict JSON for a downstream deterministic pipeline. " +
      "Do not browse, fetch URLs, or infer crawl targets. Do not fabricate content.",
    messages: [
      {
        role: "user",
        content: `Return ONLY valid JSON with this exact shape:
{
  "cleanDescription": string | null,
  "shortSummary": string | null,
  "sections": {
    "aboutRole": string[],
    "responsibilities": string[],
    "requirements": string[],
    "qualifications": string[],
    "preferredQualifications": string[],
    "skills": string[],
    "benefits": string[],
    "compensation": string[],
    "companyInfo": string[],
    "equalOpportunity": string[],
    "other": string[]
  },
  "extractedSkills": string[],
  "salary": {
    "min": number | null,
    "max": number | null,
    "currency": string | null,
    "payText": string | null
  },
  "workMode": "remote" | "hybrid" | "onsite" | "unknown" | null,
  "employmentType": "fulltime" | "parttime" | "contract" | "internship" | null,
  "seniorityLevel": "intern" | "junior" | "mid" | "senior" | "staff" | "principal" | "director" | "vp" | "exec" | null
}

Rules:
- Keep only role-relevant content; remove navigation, boilerplate, legal fluff, and tracking text.
- Keep shortSummary <= 180 chars.
- Use only evidence from the provided text; do not invent skills, salary, employment type, or seniority.
- Skill extraction must focus on role requirements/responsibilities/skills sections only.
- If uncertain, return null for that field.

Context:
Title: ${input.title}
Location: ${input.location ?? "Unknown"}

Deterministic baseline sections (for alignment only):
${JSON.stringify(deterministicSections).slice(0, 7000)}

Raw description to normalize:
${description.slice(0, 16000)}`,
      },
    ],
  })

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim()
  const json = extractJsonObjectCandidate(text)
  if (!json) return null

  try {
    const parsed = JSON.parse(json) as unknown
    if (!isObject(parsed)) return null
    return parsed as HaikuNormalizationPayload
  } catch {
    return null
  }
}

function applyHaikuEnrichment(
  deterministic: NormalizationResult,
  payload: HaikuNormalizationPayload
): NormalizationResult {
  const canonical = structuredClone(deterministic.canonical)
  const nextColumns = {
    ...deterministic.nextColumns,
    skills: [...deterministic.nextColumns.skills],
  }
  const aiProvenance: FieldProvenance = {
    adapter: canonical.source.adapter,
    method: "heuristic",
    source_path: "anthropic.haiku",
  }

  const cleanDescription = cleanLine(payload.cleanDescription, 16_000)
  if (cleanDescription) {
    nextColumns.description = cleanDescription
    canonical.descriptions.clean = cleanDescription
  }

  const sectionMap = isObject(payload.sections) ? payload.sections : {}
  const mappedSections = [
    { inKey: "aboutRole", outKey: "about_role" },
    { inKey: "responsibilities", outKey: "responsibilities" },
    { inKey: "requirements", outKey: "requirements" },
    { inKey: "qualifications", outKey: "qualifications" },
    { inKey: "preferredQualifications", outKey: "preferred_qualifications" },
    { inKey: "skills", outKey: "skills" },
    { inKey: "benefits", outKey: "benefits" },
    { inKey: "compensation", outKey: "compensation" },
    { inKey: "companyInfo", outKey: "company_info" },
    { inKey: "equalOpportunity", outKey: "equal_opportunity" },
    { inKey: "other", outKey: "other" },
  ] as const

  for (const entry of mappedSections) {
    const items = cleanLines(sectionMap[entry.inKey], 16)
    if (items.length === 0) continue
    canonical.sections[entry.outKey].items = items
    canonical.sections[entry.outKey].provenance = [aiProvenance]
    canonical.sections[entry.outKey].confidence = 0.8
    canonical.sections[entry.outKey].is_fallback = false
  }

  const shortSummary = cleanLine(payload.shortSummary, 180)
  if (shortSummary) {
    const aboutItems = canonical.sections.about_role.items
    if (!aboutItems.some((item) => item.toLowerCase() === shortSummary.toLowerCase())) {
      canonical.sections.about_role.items = [shortSummary, ...aboutItems].slice(0, 8)
    }
  }

  const skillsFromModel = normalizeSkillList(cleanLines(payload.extractedSkills, 28, 80), 24)
  const sectionSkillSource = [
    ...canonical.sections.skills.items,
    ...canonical.sections.requirements.items,
    ...canonical.sections.qualifications.items,
    ...canonical.sections.preferred_qualifications.items,
    ...canonical.sections.responsibilities.items,
  ].join("\n")
  const skillsFromSections = normalizeSkillList(extractSkillsFromText(sectionSkillSource), 24)
  const mergedSkills = normalizeSkillList(
    [...skillsFromModel, ...skillsFromSections, ...nextColumns.skills],
    24
  )
  if (mergedSkills.length > 0) {
    nextColumns.skills = mergedSkills
    canonical.skills.value = mergedSkills
    canonical.skills.confidence = 0.82
    canonical.skills.provenance = [aiProvenance]
    canonical.skill_groups = categorizeSkills(mergedSkills)
  } else {
    canonical.skill_groups = emptyCategorizedSkills()
  }

  const salary = isObject(payload.salary) ? payload.salary : null
  const salaryMinRaw = toNumber(salary?.min)
  const salaryMaxRaw = toNumber(salary?.max)
  const salaryMin =
    salaryMinRaw != null && salaryMinRaw > 0 ? Math.round(salaryMinRaw) : null
  const salaryMax =
    salaryMaxRaw != null && salaryMaxRaw > 0 ? Math.round(salaryMaxRaw) : null

  if (salaryMin != null || salaryMax != null) {
    const fixedMin =
      salaryMin != null && salaryMax != null ? Math.min(salaryMin, salaryMax) : salaryMin
    const fixedMax =
      salaryMin != null && salaryMax != null ? Math.max(salaryMin, salaryMax) : salaryMax

    nextColumns.salary_min = fixedMin
    nextColumns.salary_max = fixedMax
    canonical.compensation.salary_min.value = fixedMin
    canonical.compensation.salary_max.value = fixedMax
    canonical.compensation.salary_min.confidence = 0.78
    canonical.compensation.salary_max.confidence = 0.78
    canonical.compensation.salary_min.provenance = [aiProvenance]
    canonical.compensation.salary_max.provenance = [aiProvenance]
  }

  const salaryCurrency = normalizeCurrency(salary?.currency)
  if (salaryCurrency) {
    nextColumns.salary_currency = salaryCurrency
    canonical.compensation.salary_currency.value = salaryCurrency
    canonical.compensation.salary_currency.confidence = 0.8
    canonical.compensation.salary_currency.provenance = [aiProvenance]
  }

  const payText = cleanLine(salary?.payText, 220) ??
    formatSalaryLabel(nextColumns.salary_min, nextColumns.salary_max, nextColumns.salary_currency)
  if (payText) {
    canonical.compensation.pay_text.value = payText
    canonical.compensation.pay_text.confidence = 0.8
    canonical.compensation.pay_text.provenance = [aiProvenance]
  }

  const workMode = typeof payload.workMode === "string" ? payload.workMode.trim().toLowerCase() : null
  if (workMode === "remote") {
    nextColumns.is_remote = true
    nextColumns.is_hybrid = false
  } else if (workMode === "hybrid") {
    nextColumns.is_remote = false
    nextColumns.is_hybrid = true
  } else if (workMode === "onsite" || workMode === "on-site") {
    nextColumns.is_remote = false
    nextColumns.is_hybrid = false
  }

  canonical.header.is_remote.value = nextColumns.is_remote
  canonical.header.is_hybrid.value = nextColumns.is_hybrid
  canonical.header.is_remote.confidence = 0.76
  canonical.header.is_hybrid.confidence = 0.76
  canonical.header.is_remote.provenance = [aiProvenance]
  canonical.header.is_hybrid.provenance = [aiProvenance]

  const employmentType = normalizeEmploymentType(payload.employmentType)
  if (employmentType) {
    nextColumns.employment_type = employmentType
    canonical.header.employment_type.value = employmentType
    canonical.header.employment_type.confidence = 0.78
    canonical.header.employment_type.provenance = [aiProvenance]
  }

  const seniorityLevel = normalizeSeniority(payload.seniorityLevel)
  if (seniorityLevel) {
    nextColumns.seniority_level = seniorityLevel
    canonical.header.seniority_level.value = seniorityLevel
    canonical.header.seniority_level.confidence = 0.76
    canonical.header.seniority_level.provenance = [aiProvenance]
  }

  canonical.validation = validateCanonicalJob(canonical)
  const pageView = mapCanonicalToJobPageView(canonical)
  const cardView = mapCanonicalToJobCardView(canonical)
  const structuredData = toStructuredJobData({
    canonical,
    salaryCurrency: nextColumns.salary_currency,
    payText,
    shortSummary,
  })

  return {
    canonical,
    pageView,
    cardView,
    nextColumns,
    rawSnapshot: deterministic.rawSnapshot,
    structuredData,
  }
}

async function maybeApplyHaikuEnrichment(input: HaikuEnrichmentInput): Promise<NormalizationResult> {
  const payload = await requestHaikuEnrichment(input).catch(() => null)
  if (!payload) return input.deterministic

  const enriched = applyHaikuEnrichment(input.deterministic, payload)
  // Deterministic result is always the fallback if enrichment produces an invalid shape.
  if (!enriched.canonical.header.title.value || !enriched.canonical.header.apply_url.value) {
    return input.deterministic
  }
  return enriched
}

function normalizeFromCoreInput(input: {
  title: string
  applyUrl: string
  location: string | null
  postedAt: string | null
  description: string | null
  company: string | null
  companyDomain: string | null
  externalId: string | null
  adapter: ReturnType<typeof adaptRawCrawlerJob>["adapter"]
  structuredSections?: ReturnType<typeof adaptRawCrawlerJob>["structuredSections"]
  structuredCompensationText?: string | null
  structuredVisaText?: string | null
  existing: ExistingJobState
  nowIso: string
}): NormalizationResult {
  const cleanedTitle = cleanJobTitle(input.title)
  const normalizedTitle = normalizeJobTitle(cleanedTitle)
  const metadata = inferJobMetadata({
    title: cleanedTitle,
    description: input.description,
    location: input.location,
  })

  const extractedSalary = extractSalaryRange(input.description)
  const salaryMin =
    extractedSalary?.min ??
    metadata.salaryMin ??
    input.existing.salary_min ??
    null
  const salaryMax =
    extractedSalary?.max ??
    metadata.salaryMax ??
    input.existing.salary_max ??
    null
  const salaryCurrency =
    extractedSalary?.currency ??
    metadata.salaryCurrency ??
    input.existing.salary_currency ??
    "USD"

  const requiresAuthorization =
    metadata.requiresAuthorization ??
    inferRequiresAuthorization(input.description) ??
    input.existing.requires_authorization ??
    false

  const visaSignals = inferSponsorshipFromText(input.description)
  const sponsorsH1b =
    visaSignals.sponsors_h1b ??
    input.existing.sponsors_h1b ??
    null

  const sponsorshipScore =
    sponsorsH1b === true
      ? 100
      : sponsorsH1b === false
        ? 10
        : input.existing.sponsorship_score ?? visaSignals.sponsorship_score

  const visaLanguage =
    input.structuredVisaText ??
    extractVisaLanguage(input.description) ??
    input.existing.visa_language_detected ??
    null

  const nextColumns = {
    normalized_title: normalizedTitle,
    description: input.description ?? input.existing.description,
    location: input.location,
    employment_type:
      metadata.employmentType ?? input.existing.employment_type ?? null,
    seniority_level:
      metadata.seniorityLevel ?? input.existing.seniority_level ?? null,
    is_remote: metadata.isRemote ?? input.existing.is_remote ?? false,
    is_hybrid: metadata.isHybrid ?? input.existing.is_hybrid ?? false,
    salary_min: salaryMin,
    salary_max: salaryMax,
    salary_currency: salaryCurrency,
    sponsors_h1b: sponsorsH1b,
    sponsorship_score: sponsorshipScore,
    requires_authorization: requiresAuthorization,
    visa_language_detected: visaLanguage,
    skills: [] as string[],
  }

  const sections = extractCanonicalSections({
    adapter: input.adapter,
    description: nextColumns.description,
    structuredSections: input.structuredSections,
  })

  // Do NOT include the full raw description here. Skills already flow through
  // the canonical section buckets above; including the raw description blob
  // adds nav/footer/sidebar noise that contaminates skill matching.
  const skillSource = [
    cleanedTitle,
    ...sections.skills.items,
    ...sections.requirements.items,
    ...sections.qualifications.items,
    ...sections.preferred_qualifications.items,
    ...sections.responsibilities.items,
  ].filter(Boolean).join("\n")
  const extractedSkills = extractSkillsFromText(skillSource).slice(0, 24)
  const skillGroups =
    extractedSkills.length > 0 ? categorizeSkills(extractedSkills) : emptyCategorizedSkills()
  nextColumns.skills = extractedSkills

  const headerProvenance: FieldProvenance = {
    adapter: input.adapter,
    method: "structured",
    source_path: "crawler",
  }

  const inferredProvenance: FieldProvenance = {
    adapter: input.adapter,
    method: "heuristic",
    source_path: "description",
  }

  sections.header.items = [
    cleanedTitle,
    input.location ?? "Location not specified",
  ]
  sections.header.provenance.push(headerProvenance)
  sections.header.confidence = 0.94

  const payText =
    input.structuredCompensationText ??
    formatSalaryLabel(salaryMin, salaryMax, salaryCurrency)

  if (payText && sections.compensation.items.length === 0) {
    sections.compensation.items = [payText]
    sections.compensation.provenance.push({
      adapter: input.adapter,
      method: "fallback",
      source_path: "derived.salary",
    })
    sections.compensation.confidence = 0.56
    sections.compensation.is_fallback = true
  }

  if (visaLanguage && sections.visa.items.length === 0) {
    sections.visa.items = [visaLanguage]
    sections.visa.provenance.push({
      adapter: input.adapter,
      method: "fallback",
      source_path: "derived.visa_language",
    })
    sections.visa.confidence = 0.58
    sections.visa.is_fallback = true
  }

  const canonical: CanonicalJob = {
    schema_version: JOB_NORMALIZATION_VERSION,
    normalized_at: input.nowIso,
    source: {
      adapter: input.adapter,
      external_id: input.externalId,
      crawl_url: input.applyUrl,
    },
    company: {
      name: input.company,
      domain: input.companyDomain,
    },
    descriptions: {
      raw: input.description,
      clean: nextColumns.description,
    },
    header: {
      title: field(cleanedTitle, 0.98, headerProvenance),
      normalized_title: field(normalizedTitle, 0.95, headerProvenance),
      location: field(input.location, pickConfidence(input.location, 0.9, 0.3), headerProvenance),
      apply_url: field(input.applyUrl, 0.99, headerProvenance),
      employment_type: field(
        nextColumns.employment_type,
        pickConfidence(metadata.employmentType, 0.72, 0.5),
        metadata.employmentType ? inferredProvenance : headerProvenance
      ),
      seniority_level: field(
        nextColumns.seniority_level,
        pickConfidence(metadata.seniorityLevel, 0.72, 0.5),
        metadata.seniorityLevel ? inferredProvenance : headerProvenance
      ),
      is_remote: field(
        nextColumns.is_remote,
        pickConfidence(metadata.isRemote, 0.72, 0.45),
        metadata.isRemote != null ? inferredProvenance : headerProvenance
      ),
      is_hybrid: field(
        nextColumns.is_hybrid,
        pickConfidence(metadata.isHybrid, 0.72, 0.45),
        metadata.isHybrid != null ? inferredProvenance : headerProvenance
      ),
      posted_at: field(
        normalizePostedAt(input.postedAt, input.nowIso),
        pickConfidence(input.postedAt, 0.85, 0.5),
        headerProvenance
      ),
    },
    compensation: {
      salary_min: field(
        salaryMin,
        pickConfidence(extractedSalary?.min ?? metadata.salaryMin, 0.7, 0.5),
        extractedSalary ? inferredProvenance : headerProvenance
      ),
      salary_max: field(
        salaryMax,
        pickConfidence(extractedSalary?.max ?? metadata.salaryMax, 0.7, 0.5),
        extractedSalary ? inferredProvenance : headerProvenance
      ),
      salary_currency: field(salaryCurrency, 0.8, headerProvenance),
      pay_text: field(
        payText,
        pickConfidence(payText, input.structuredCompensationText ? 0.92 : 0.54, 0.25),
        input.structuredCompensationText
          ? {
              adapter: input.adapter,
              method: "structured",
              source_path: "structured.compensation",
            }
          : {
              adapter: input.adapter,
              method: "fallback",
              source_path: "derived.salary",
            }
      ),
    },
    visa: {
      sponsors_h1b: field(
        sponsorsH1b,
        pickConfidence(visaSignals.sponsors_h1b, 0.7, 0.5),
        visaSignals.sponsors_h1b != null ? inferredProvenance : headerProvenance
      ),
      requires_authorization: field(
        requiresAuthorization,
        pickConfidence(metadata.requiresAuthorization, 0.76, 0.52),
        metadata.requiresAuthorization != null ? inferredProvenance : headerProvenance
      ),
      sponsorship_score: field(
        sponsorshipScore,
        pickConfidence(visaSignals.sponsors_h1b, 0.68, 0.52),
        inferredProvenance
      ),
      visa_language: field(
        visaLanguage,
        pickConfidence(visaLanguage, 0.65, 0.2),
        visaLanguage
          ? {
              adapter: input.adapter,
              method: input.structuredVisaText ? "structured" : "heuristic",
              source_path: input.structuredVisaText ? "structured.visa" : "description",
              source_excerpt: visaLanguage,
            }
          : inferredProvenance
      ),
    },
    skills: field(nextColumns.skills, nextColumns.skills.length > 0 ? 0.74 : 0.4, inferredProvenance),
    skill_groups: skillGroups,
    sections,
    validation: {
      completeness_score: 0,
      confidence_score: 0,
      requires_review: false,
      issues: [],
    },
  }

  const validation = validateCanonicalJob(canonical)
  canonical.validation = validation

  const pageView = mapCanonicalToJobPageView(canonical)
  const cardView = mapCanonicalToJobCardView(canonical)

  return {
    canonical,
    pageView,
    cardView,
    nextColumns,
    rawSnapshot: {
      source_adapter: input.adapter,
      source_external_id: input.externalId,
      crawled_url: input.applyUrl,
      normalized_at: input.nowIso,
    },
    structuredData: toStructuredJobData({
      canonical,
      salaryCurrency,
      payText,
    }),
  }
}

export function normalizeCrawlerJobForPersistence(input: {
  rawJob: SourceRawJobInput
  crawledAtIso: string
  existing?: ExistingJobState
}): NormalizationResult {
  const adapted = adaptRawCrawlerJob(input.rawJob)

  return normalizeFromCoreInput({
    title: adapted.title,
    applyUrl: adapted.applyUrl,
    location: adapted.location,
    postedAt: adapted.postedAt,
    description: adapted.description,
    company: adapted.company,
    companyDomain: adapted.companyDomain,
    externalId: adapted.externalId,
    adapter: adapted.adapter,
    structuredSections: adapted.structuredSections,
    structuredCompensationText: adapted.structuredCompensationText,
    structuredVisaText: adapted.structuredVisaText,
    existing: input.existing ?? {
      description: null,
      employment_type: null,
      seniority_level: null,
      is_remote: null,
      is_hybrid: null,
      requires_authorization: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      sponsors_h1b: null,
      sponsorship_score: null,
      visa_language_detected: null,
    },
    nowIso: input.crawledAtIso,
  })
}

export async function normalizeCrawlerJobForPersistenceWithAI(input: {
  rawJob: SourceRawJobInput
  crawledAtIso: string
  existing?: ExistingJobState
}): Promise<NormalizationResult> {
  const deterministic = normalizeCrawlerJobForPersistence(input)
  return maybeApplyHaikuEnrichment({
    title: input.rawJob.title,
    location: input.rawJob.location ?? null,
    description: input.rawJob.description ?? null,
    existingDescription: input.existing?.description ?? null,
    deterministic,
  })
}

export function normalizePersistedJobRecord(
  job: PersistedJobForNormalization
): NormalizationResult {
  const adapted = adaptPersistedJob(job)

  return normalizeFromCoreInput({
    title: adapted.title,
    applyUrl: adapted.applyUrl,
    location: adapted.location,
    postedAt: adapted.postedAt,
    description: adapted.description,
    company: adapted.company,
    companyDomain: adapted.companyDomain,
    externalId: adapted.externalId,
    adapter: adapted.adapter,
    structuredSections: adapted.structuredSections,
    structuredCompensationText: adapted.structuredCompensationText,
    structuredVisaText: adapted.structuredVisaText,
    existing: {
      description: job.description,
      employment_type: job.employment_type,
      seniority_level: job.seniority_level,
      is_remote: job.is_remote,
      is_hybrid: job.is_hybrid,
      requires_authorization: job.requires_authorization,
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      salary_currency: job.salary_currency,
      sponsors_h1b: job.sponsors_h1b,
      sponsorship_score: job.sponsorship_score,
      visa_language_detected: job.visa_language_detected,
    },
    nowIso: new Date().toISOString(),
  })
}

export async function normalizePersistedJobRecordWithAI(
  job: PersistedJobForNormalization
): Promise<NormalizationResult> {
  const deterministic = normalizePersistedJobRecord(job)
  return maybeApplyHaikuEnrichment({
    title: job.title,
    location: job.location,
    description: job.description,
    existingDescription: job.description,
    deterministic,
  })
}

export function readCanonicalFromRawData(
  rawData: Record<string, unknown> | null | undefined
): CanonicalJob | null {
  if (!rawData || typeof rawData !== "object") return null

  const normalized = (rawData as Record<string, unknown>).normalized
  if (!normalized || typeof normalized !== "object") return null

  const schemaVersion = (normalized as Record<string, unknown>).schema_version
  if (schemaVersion !== JOB_NORMALIZATION_VERSION) return null

  return normalized as CanonicalJob
}

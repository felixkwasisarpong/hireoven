import crypto from "crypto"
import type { RawJob } from "@/lib/crawler"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  cleanJobTitle,
} from "@/lib/jobs/text-normalizer"
import { detectAts } from "@/lib/companies/detect-ats"
import {
  cleanJobDescription,
  fetchJobDescription,
  normalizeJobApplyUrl,
} from "@/lib/jobs/description"
import {
  normalizeCrawlerJobForPersistence,
  normalizeCrawlerJobForPersistenceWithAI,
} from "@/lib/jobs/normalization"
import {
  getCrawlerAiEnrichmentMode,
  shouldAttemptAiEnrichment,
} from "@/lib/crawler/enrichment-mode"
import { normalizeGreenhouseBoardUrl } from "@/lib/companies/greenhouse-url"
import type { EmploymentType, SeniorityLevel } from "@/types"

const DESCRIPTION_FETCH_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_DESCRIPTION_FETCH_CONCURRENCY ?? "4", 10)
)
const MAX_DESCRIPTION_FETCHES_PER_COMPANY = Math.max(
  0,
  Number.parseInt(process.env.CRAWLER_MAX_DESCRIPTION_FETCHES_PER_COMPANY ?? "500", 10)
)
const DEACTIVATION_GRACE_HOURS = Math.max(
  0,
  Number.parseInt(process.env.CRAWLER_DEACTIVATION_GRACE_HOURS ?? "72", 10)
)
const ALLOW_DEACTIVATE_ON_EMPTY_RESULTS =
  process.env.CRAWLER_ALLOW_DEACTIVATE_ON_EMPTY_RESULTS === "true"
const EXISTING_ROW_LOOKUP_BATCH_SIZE = Math.max(
  25,
  Number.parseInt(process.env.CRAWLER_EXISTING_ROW_LOOKUP_BATCH_SIZE ?? "100", 10)
)
const JOB_WRITE_BATCH_SIZE = Math.max(
  10,
  Number.parseInt(process.env.CRAWLER_JOB_WRITE_BATCH_SIZE ?? "25", 10)
)
const JOB_DEACTIVATE_BATCH_SIZE = Math.max(
  25,
  Number.parseInt(process.env.CRAWLER_JOB_DEACTIVATE_BATCH_SIZE ?? "250", 10)
)

function shouldMarkGreenhouseManualReview(args: {
  atsType: string | null
  careersUrl: string | null
  crawledJobCount: number
}) {
  const atsType = args.atsType?.toLowerCase() ?? ""
  const careersUrl = args.careersUrl ?? ""
  if (atsType !== "greenhouse" && !careersUrl.toLowerCase().includes("greenhouse.io")) {
    return false
  }
  const normalized = normalizeGreenhouseBoardUrl(careersUrl)
  return args.crawledJobCount === 0 && Boolean(normalized.boardToken)
}

const JOB_INSERT_COLUMNS = [
  "company_id",
  "title",
  "normalized_title",
  "apply_url",
  "location",
  "employment_type",
  "seniority_level",
  "is_remote",
  "is_hybrid",
  "requires_authorization",
  "salary_min",
  "salary_max",
  "salary_currency",
  "description",
  "external_id",
  "sponsors_h1b",
  "sponsorship_score",
  "visa_language_detected",
  "skills",
  "is_active",
  "last_seen_at",
  "raw_data",
  "updated_at",
  "first_detected_at",
  "created_at",
] as const

const JOB_UPDATE_WHITELIST = new Set<string>(
  JOB_INSERT_COLUMNS.filter((c) => c !== "first_detected_at" && c !== "created_at")
)

async function insertJobsChunk(pool: ReturnType<typeof getPostgresPool>, chunk: Record<string, unknown>[]) {
  if (chunk.length === 0) return
  const values: unknown[] = []
  const tuples = chunk.map((row) => {
    const placeholders = JOB_INSERT_COLUMNS.map((col) => {
      values.push(row[col] ?? null)
      return `$${values.length}`
    })
    return `(${placeholders.join(",")})`
  })
  await pool.query(
    `INSERT INTO jobs (${JOB_INSERT_COLUMNS.join(",")}) VALUES ${tuples.join(",")}`,
    values
  )
}

async function updateJobRow(
  pool: ReturnType<typeof getPostgresPool>,
  id: string,
  payload: Record<string, unknown>
) {
  const entries = Object.entries(payload).filter(([k]) => JOB_UPDATE_WHITELIST.has(k))
  if (entries.length === 0) return
  const values = entries.map(([, v]) => v)
  const setClause = entries.map(([k], i) => `${k} = $${i + 1}`).join(", ")
  await pool.query(`UPDATE jobs SET ${setClause} WHERE id = $${values.length + 1}`, [...values, id])
}

const BLOCKED_TITLE_PATTERNS = [
  /^(login|log(?:\s+)?in|log back in!?)$/i,
  /^go back to our career portal$/i,
  /^by category$/i,
  /^by job title$/i,
  /^search jobs?$/i,
  /^work in [\w\s,().-]+$/i,
  /^explore (?:jobs|careers|roles)/i,
  /^contractor roles?$/i,
  /^remote opportunities?$/i,
  /^hybrid opportunities?$/i,
  /^\s*\.css-/i,                        // styled-components CSS class strings
  /\{-webkit-|-webkit-text-decoration/, // CSS property bleed
]

const BLOCKED_PATH_PATTERNS = [
  /\/jobs\/login$/i,
  /\/jobs\/intro$/i,
  /\/intro$/i,
]

function isBlockedCrawlTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim()
  if (!normalized || normalized.length < 3) return true
  return BLOCKED_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isBlockedApplyUrl(url: string) {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, "")
    if (BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(path))) return true
    if (parsed.searchParams.has("loginOnly") && parsed.searchParams.get("loginOnly") === "1")
      return true
    return false
  } catch {
    return false
  }
}

function externalIdForJob(job: RawJob) {
  if (job.externalId?.trim()) return job.externalId.trim()
  return `url:${crypto
    .createHash("sha1")
    .update(normalizeJobApplyUrl(job.url))
    .digest("hex")}`
}

function normalizePostedAtToIso(
  postedAt: string | undefined,
  crawledAt: Date
): string | null {
  const raw = postedAt?.trim()
  if (!raw) return null

  const direct = Date.parse(raw)
  if (!Number.isNaN(direct)) {
    return new Date(direct).toISOString()
  }

  const normalized = raw.toLowerCase().replace(/^posted\s+/, "").trim()
  if (!normalized) return null

  if (normalized === "today" || normalized === "just posted" || normalized === "new") {
    return crawledAt.toISOString()
  }
  if (normalized === "yesterday") {
    return new Date(crawledAt.getTime() - 24 * 60 * 60 * 1000).toISOString()
  }

  const relativeMatch = normalized.match(
    /^(\d+)\+?\s*(minute|hour|day|week|month|year)s?\s+ago$/
  )
  if (!relativeMatch) return null

  const amount = Number.parseInt(relativeMatch[1], 10)
  const unit = relativeMatch[2]
  if (!Number.isFinite(amount) || amount < 0) return null

  const unitMs: Record<string, number> = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  }

  const step = unitMs[unit]
  if (!step) return null

  return new Date(crawledAt.getTime() - amount * step).toISOString()
}

function toOptionalString(value: unknown, maxLength = 600): string | null {
  if (typeof value !== "string") return null
  const cleaned = value.trim()
  if (!cleaned) return null
  return cleaned.slice(0, maxLength)
}

function toOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  return null
}

function toOptionalRoundedNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return null
}

function toOptionalStringArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const text = toOptionalString(item, 80)
    if (!text) continue
    if (!out.includes(text)) out.push(text)
    if (out.length >= limit) break
  }
  return out
}

function compactRecord<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out as T
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number
): Promise<T[]> {
  const results: T[] = []
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      const current = idx
      idx += 1
      results.push(await tasks[current]())
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, tasks.length) }).map(() => worker())
  )
  return results
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  if (values.length === 0) return []
  const size = Math.max(1, chunkSize)
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

export async function persistCrawlJobs({
  companyId,
  crawledAt,
  jobs,
  sourceUrl,
  normalizedUrl,
  diagnostics,
}: {
  companyId: string
  crawledAt: Date
  jobs: RawJob[]
  sourceUrl?: string
  normalizedUrl?: string
  diagnostics?: Array<{
    provider?: string | null
    originalUrl: string
    normalizedUrl: string | null
    statusCode: number | null
    reason: string
    crawlResult?: string
    errorReason?: string | null
    retryCount?: number
    fallbackUsed?: string | null
  }>
}) {
  const pool = getPostgresPool()
  const crawledAtIso = crawledAt.toISOString()
  const companyResult = await pool.query<{
    name: string | null
    domain: string | null
    careers_url: string | null
    ats_type: string | null
    raw_ats_config: Record<string, unknown> | null
  }>(
    `SELECT name, domain, careers_url, ats_type, raw_ats_config FROM companies WHERE id = $1`,
    [companyId]
  )
  const company = companyResult.rows[0] ?? null
  const normalized = jobs
    .map((job) => ({
      ...job,
      title: cleanJobTitle(job.title),
      url: normalizeJobApplyUrl(job.url),
      externalId: externalIdForJob(job),
      description: cleanJobDescription(job.description ?? null) ?? undefined,
    }))
    .filter((job) => !isBlockedCrawlTitle(job.title))
    .filter((job) => !isBlockedApplyUrl(job.url))

  const missingDescriptionCandidates = normalized
    .map((job, index) => ({ index, hasDescription: Boolean(job.description), url: job.url }))
    .filter((entry) => !entry.hasDescription && /^https?:\/\//i.test(entry.url))

  const missingDescriptionIndexes =
    MAX_DESCRIPTION_FETCHES_PER_COMPANY > 0
      ? missingDescriptionCandidates.slice(0, MAX_DESCRIPTION_FETCHES_PER_COMPANY)
      : missingDescriptionCandidates

  if (missingDescriptionIndexes.length > 0) {
    // Pass the company's ATS type as a provider hint so that description
    // fetching can use provider-specific content selectors.
    const providerHint = company?.ats_type?.toLowerCase() ?? undefined
    await runWithConcurrency(
      missingDescriptionIndexes.map((entry) => async () => {
        const description = await fetchJobDescription(entry.url, undefined, providerHint)
        if (!description) return
        normalized[entry.index] = {
          ...normalized[entry.index],
          description,
        }
      }),
      DESCRIPTION_FETCH_CONCURRENCY
    )
  }

  // Some sources repeat identical external IDs. Keep the latest payload once to avoid
  // duplicate writes and oversized PostgREST payloads.
  const dedupedByExternalId = new Map<string, (typeof normalized)[number]>()
  for (const job of normalized) {
    dedupedByExternalId.set(job.externalId, job)
  }
  const dedupedJobs = [...dedupedByExternalId.values()]

  const externalIds = dedupedJobs.map((job) => job.externalId)
  const existingRows: Array<{
    id: string
    external_id: string
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
  }> = []

  for (const externalIdChunk of chunkValues(externalIds, EXISTING_ROW_LOOKUP_BATCH_SIZE)) {
    const { rows } = await pool.query<
      (typeof existingRows)[number]
    >(
      `SELECT id, external_id, description, employment_type, seniority_level, is_remote, is_hybrid,
              requires_authorization, salary_min, salary_max, salary_currency, sponsors_h1b,
              sponsorship_score, visa_language_detected
       FROM jobs
       WHERE company_id = $1 AND external_id = ANY($2::text[])`,
      [companyId, externalIdChunk]
    )
    existingRows.push(...rows)
  }

  const existingByExternalId = new Map<
    string,
    {
      id: string
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
  >()
  for (const row of existingRows) {
    existingByExternalId.set(row.external_id, {
      id: row.id,
      description: row.description ?? null,
      employment_type: row.employment_type ?? null,
      seniority_level: row.seniority_level ?? null,
      is_remote: row.is_remote ?? null,
      is_hybrid: row.is_hybrid ?? null,
      requires_authorization: row.requires_authorization ?? null,
      salary_min: row.salary_min ?? null,
      salary_max: row.salary_max ?? null,
      salary_currency: row.salary_currency ?? null,
      sponsors_h1b: row.sponsors_h1b ?? null,
      sponsorship_score: row.sponsorship_score ?? null,
      visa_language_detected: row.visa_language_detected ?? null,
    })
  }

  const toInsert: Array<Record<string, unknown>> = []
  const toUpdate: Array<{ id: string; payload: Record<string, unknown> }> = []
  const aiEnrichmentMode = getCrawlerAiEnrichmentMode()
  const aiAvailable = aiEnrichmentMode !== "off" && Boolean(process.env.ANTHROPIC_API_KEY)
  let aiQueued = 0

  for (const job of dedupedJobs) {
    const normalizedPostedAt = normalizePostedAtToIso(job.postedAt, crawledAt)
    const existing = existingByExternalId.get(job.externalId)
    const normalizationInput = {
      rawJob: {
        externalId: job.externalId,
        title: job.title,
        url: job.url,
        description: job.description,
        location: job.location,
        postedAt: job.postedAt,
        company: company?.name ?? null,
        companyDomain: company?.domain ?? null,
        companyLogo: job.companyLogo ?? null,
        workMode: job.workMode ?? null,
        employmentType: job.employmentType ?? null,
        salaryRange: job.salaryRange ?? null,
        matchScore: job.matchScore ?? null,
        matchLabel: job.matchLabel ?? null,
        matchedSkills: job.matchedSkills ?? null,
        missingSkills: job.missingSkills ?? null,
        sponsorshipSignal: job.sponsorshipSignal ?? null,
        companySummary: job.companySummary ?? null,
        companyFoundedYear: job.companyFoundedYear ?? null,
        companyEmployeeCount: job.companyEmployeeCount ?? null,
        companyIndustry: job.companyIndustry ?? null,
        easyApply: job.easyApply ?? null,
        activelyHiring: job.activelyHiring ?? null,
        topApplicantSignal: job.topApplicantSignal ?? null,
        companyVerified: job.companyVerified ?? null,
      },
      crawledAtIso,
      existing: {
        description: existing?.description ?? null,
        employment_type: existing?.employment_type ?? null,
        seniority_level: existing?.seniority_level ?? null,
        is_remote: existing?.is_remote ?? null,
        is_hybrid: existing?.is_hybrid ?? null,
        requires_authorization: existing?.requires_authorization ?? null,
        salary_min: existing?.salary_min ?? null,
        salary_max: existing?.salary_max ?? null,
        salary_currency: existing?.salary_currency ?? null,
        sponsors_h1b: existing?.sponsors_h1b ?? null,
        sponsorship_score: existing?.sponsorship_score ?? null,
        visa_language_detected: existing?.visa_language_detected ?? null,
      },
    }

    // Deterministic crawl/extraction remains primary. AI enrichment is optional:
    // sync mode applies it inline, async mode marks jobs for background processing.
    const deterministicNormalization = normalizeCrawlerJobForPersistence(normalizationInput)
    const shouldEnrich = aiAvailable && shouldAttemptAiEnrichment(deterministicNormalization)
    let normalization = deterministicNormalization
    let aiStatus: "done" | "pending" | "skipped" | "disabled" = aiAvailable
      ? "skipped"
      : "disabled"
    let aiAttempts = 0
    let aiLastError: string | null = null
    const nowIso = new Date().toISOString()

    if (shouldEnrich && aiEnrichmentMode === "sync") {
      try {
        normalization = await normalizeCrawlerJobForPersistenceWithAI(normalizationInput)
        aiStatus = "done"
        aiAttempts = 1
      } catch (error) {
        aiStatus = "pending"
        aiAttempts = 1
        aiLastError = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
        aiQueued += 1
      }
    } else if (shouldEnrich && aiEnrichmentMode === "async") {
      aiStatus = "pending"
      aiQueued += 1
    }

    const cleanedTitle = cleanJobTitle(job.title)
    const companyEmployeeCount =
      toOptionalString(job.companyEmployeeCount, 120) ??
      (toOptionalRoundedNumber(job.companyEmployeeCount)?.toLocaleString() ?? null)
    const companyFoundedYearRaw = toOptionalRoundedNumber(job.companyFoundedYear)
    const companyFoundedYear =
      companyFoundedYearRaw && companyFoundedYearRaw >= 1800 && companyFoundedYearRaw <= new Date().getUTCFullYear() + 1
        ? companyFoundedYearRaw
        : null
    // Promote company_info from the normalizer when the crawler didn't provide a summary.
    // This ensures raw_data.companySummary is populated for standard ATS jobs where the
    // JD contains an "About us / Who we are" section even if the crawler signal is absent.
    const companySummaryFromNormalization =
      normalization.canonical.sections.company_info.items.find(
        (item) => typeof item === "string" && item.trim().length >= 20
      ) ?? null

    const cardSignals = compactRecord({
      companyLogo: toOptionalString(job.companyLogo, 1200),
      companyVerified: toOptionalBoolean(job.companyVerified),
      workMode: toOptionalString(job.workMode, 80),
      employmentType: toOptionalString(job.employmentType, 80),
      salaryRange: toOptionalString(job.salaryRange, 180),
      postedAt: toOptionalString(job.postedAt, 120),
      matchScore: toOptionalRoundedNumber(job.matchScore),
      matchLabel: toOptionalString(job.matchLabel, 80),
      matchedSkills: toOptionalStringArray(job.matchedSkills, 10),
      missingSkills: toOptionalStringArray(job.missingSkills, 10),
      sponsorshipSignal: toOptionalString(job.sponsorshipSignal, 180),
      companySummary:
        toOptionalString(job.companySummary, 2000) ??
        toOptionalString(companySummaryFromNormalization, 2000),
      companyFoundedYear,
      companyEmployeeCount,
      companyIndustry: toOptionalString(job.companyIndustry, 180),
      easyApply: toOptionalBoolean(job.easyApply),
      activelyHiring: toOptionalBoolean(job.activelyHiring),
      topApplicantSignal: toOptionalBoolean(job.topApplicantSignal),
    })
    const payload: Record<string, unknown> = {
      company_id: companyId,
      title: cleanedTitle,
      normalized_title: normalization.nextColumns.normalized_title,
      apply_url: job.url,
      location: normalization.nextColumns.location,
      employment_type: normalization.nextColumns.employment_type,
      seniority_level: normalization.nextColumns.seniority_level,
      is_remote: normalization.nextColumns.is_remote,
      is_hybrid: normalization.nextColumns.is_hybrid,
      requires_authorization: normalization.nextColumns.requires_authorization,
      salary_min: normalization.nextColumns.salary_min,
      salary_max: normalization.nextColumns.salary_max,
      salary_currency: normalization.nextColumns.salary_currency,
      description: normalization.nextColumns.description,
      external_id: job.externalId,
      sponsors_h1b: normalization.nextColumns.sponsors_h1b,
      sponsorship_score: normalization.nextColumns.sponsorship_score,
      visa_language_detected: normalization.nextColumns.visa_language_detected,
      skills: normalization.nextColumns.skills,
      is_active: true,
      last_seen_at: crawledAtIso,
      raw_data: {
        source: "crawler",
        source_adapter: normalization.canonical.source.adapter,
        source_title: job.title,
        posted_at: job.postedAt ?? null,
        posted_at_normalized: normalizedPostedAt,
        description_captured: Boolean(normalization.nextColumns.description),
        ...cardSignals,
        raw: {
          title: job.title,
          url: job.url,
          description: job.description ?? null,
          location: job.location ?? null,
          posted_at: job.postedAt ?? null,
          external_id: job.externalId,
        },
        normalization: {
          version: normalization.canonical.schema_version,
          normalized_at: normalization.canonical.normalized_at,
          confidence_score: normalization.canonical.validation.confidence_score,
          completeness_score: normalization.canonical.validation.completeness_score,
          requires_review: normalization.canonical.validation.requires_review,
          issues: normalization.canonical.validation.issues,
          ai_enrichment: {
            mode: aiEnrichmentMode,
            status: aiStatus,
            attempts: aiAttempts,
            queued_at: aiStatus === "pending" ? nowIso : null,
            enriched_at: aiStatus === "done" ? nowIso : null,
            last_error: aiLastError,
          },
        },
        normalized: normalization.canonical,
        structured_job: normalization.structuredData,
        view: {
          page: normalization.pageView,
          card: normalization.cardView,
        },
      },
      updated_at: crawledAtIso,
    }

    if (existing) {
      toUpdate.push({ id: existing.id, payload })
    } else {
      toInsert.push({
        ...payload,
        first_detected_at: normalizedPostedAt ?? crawledAtIso,
        created_at: crawledAtIso,
      })
    }
  }

  if (toInsert.length > 0) {
    for (const insertChunk of chunkValues(toInsert, JOB_WRITE_BATCH_SIZE)) {
      await insertJobsChunk(pool, insertChunk)
    }
  }

  for (const row of toUpdate) {
    await updateJobRow(pool, row.id, row.payload)
  }

  const activeResult = await pool.query<{
    id: string
    external_id: string | null
    last_seen_at: string | null
  }>(
    `SELECT id, external_id, last_seen_at FROM jobs WHERE company_id = $1 AND is_active = true`,
    [companyId]
  )

  const currentExternalIdSet = new Set(externalIds)
  const staleRows = (activeResult.rows as Array<{
    id: string
    external_id: string | null
    last_seen_at: string | null
  }>).filter((row) => row.external_id && !currentExternalIdSet.has(row.external_id))
  const cutoffTs = crawledAt.getTime() - DEACTIVATION_GRACE_HOURS * 60 * 60 * 1000
  const canDeactivateOnThisRun =
    currentExternalIdSet.size > 0 || ALLOW_DEACTIVATE_ON_EMPTY_RESULTS
  const staleIds = canDeactivateOnThisRun
    ? staleRows
        .filter((row) => {
          if (DEACTIVATION_GRACE_HOURS === 0) return true
          const seenTs = row.last_seen_at ? Date.parse(row.last_seen_at) : NaN
          if (!Number.isFinite(seenTs)) return true
          return seenTs <= cutoffTs
        })
        .map((row) => row.id)
    : []

  if (staleIds.length > 0) {
    for (const staleChunk of chunkValues(staleIds, JOB_DEACTIVATE_BATCH_SIZE)) {
      await pool.query(
        `UPDATE jobs SET is_active = false, updated_at = $1 WHERE id = ANY($2::uuid[])`,
        [crawledAtIso, staleChunk]
      )
    }
  }

  // Background: lift jobs.sponsorship_score to GREATEST(job_score, company_confidence).
  // Fire-and-forget — never blocks or delays the crawl.
  pool.query(
    `UPDATE jobs j
     SET sponsorship_score = GREATEST(COALESCE(j.sponsorship_score, 0), COALESCE(c.sponsorship_confidence, 0)),
         updated_at         = $2
     FROM companies c
     WHERE j.company_id  = c.id
       AND j.company_id  = $1
       AND j.is_active   = true
       AND COALESCE(c.sponsorship_confidence, 0) > COALESCE(j.sponsorship_score, 0)`,
    [companyId, crawledAtIso]
  ).catch(() => { /* intentional: non-critical background step */ })

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM jobs WHERE company_id = $1 AND is_active = true`,
    [companyId]
  )
  const activeCount = Number(countResult.rows[0]?.count ?? 0)
  const greenhouseManualReview = shouldMarkGreenhouseManualReview({
    atsType: company?.ats_type ?? null,
    careersUrl: sourceUrl ?? company?.careers_url ?? null,
    crawledJobCount: dedupedJobs.length,
  })
  const currentRawAtsConfig = company?.raw_ats_config ?? {}
  const diagnosticsForStorage = diagnostics && diagnostics.length > 0
    ? {
        provider: diagnostics.find((entry) => entry.provider)?.provider ?? null,
        original_url: sourceUrl ?? company?.careers_url ?? null,
        normalized_url: normalizedUrl ?? null,
        attempts: diagnostics,
        checked_at: crawledAtIso,
        result: dedupedJobs.length > 0 ? "success" : "empty",
        jobs_found: dedupedJobs.length,
      }
    : null
  const greenhouseDiagnostics = diagnostics?.filter((entry) => {
    const provider = entry.provider?.toLowerCase()
    return (
      provider === "greenhouse" ||
      entry.originalUrl.toLowerCase().includes("greenhouse.io") ||
      (entry.normalizedUrl ?? "").toLowerCase().includes("greenhouse.io")
    )
  })
  const nextRawAtsConfig = {
    ...currentRawAtsConfig,
    crawl_diagnostics: diagnosticsForStorage
      ? diagnosticsForStorage
      : (currentRawAtsConfig as Record<string, unknown>).crawl_diagnostics,
    greenhouse_crawl: greenhouseDiagnostics && greenhouseDiagnostics.length > 0
      ? {
          original_url: sourceUrl ?? company?.careers_url ?? null,
          normalized_url: normalizedUrl ?? null,
          attempts: greenhouseDiagnostics,
          checked_at: crawledAtIso,
        }
      : (currentRawAtsConfig as Record<string, unknown>).greenhouse_crawl,
    needs_manual_review: greenhouseManualReview
      ? true
      : (currentRawAtsConfig as Record<string, unknown>).needs_manual_review ?? false,
    manual_review_reason: greenhouseManualReview
      ? "greenhouse_stable_board_resolution_failed"
      : (currentRawAtsConfig as Record<string, unknown>).manual_review_reason ?? null,
  }

  await pool.query(
    `UPDATE companies
     SET last_crawled_at = $1, job_count = $2, updated_at = $3, raw_ats_config = $5::jsonb
     WHERE id = $4`,
    [crawledAtIso, activeCount, crawledAtIso, companyId, JSON.stringify(nextRawAtsConfig)]
  )

  // Auto-detect and backfill ATS type from the apply URLs we just crawled.
  // Only updates when the company is still marked null or 'custom' — never
  // overwrites a previously confirmed ATS type.
  if (dedupedJobs.length > 0) {
    const applyUrls = dedupedJobs.map((j) => j.url)
    const detected = detectAts({ careersUrl: null, applyUrls })
    if (detected && detected.confidence === "high") {
      await pool.query(
        `UPDATE companies
         SET ats_type = $1,
             ats_identifier = COALESCE(ats_identifier, $2),
             updated_at = $3
         WHERE id = $4
           AND (ats_type IS NULL OR ats_type = 'custom')`,
        [detected.atsType, detected.atsIdentifier, crawledAtIso, companyId]
      )
    }
  }

  return {
    inserted: toInsert.length,
    updated: toUpdate.length,
    deactivated: staleIds.length,
    activeCount,
    aiQueued,
  }
}

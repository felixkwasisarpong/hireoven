/**
 * POST /api/extension/jobs/import
 *
 * Imports a job scraped by the Chrome extension.
 *
 * Pipeline:
 *   1. Upsert company by name → company_id
 *   2. Upsert job by apply_url → job_id in `jobs` table
 *   3. Idempotency check — skip if already saved
 *   4. Create `job_applications` record linked to the job
 *
 * Auth: Bearer <ho_session JWT>. No auto-apply. No form submission.
 */

import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { domainFromApplyUrl } from "@/lib/applications/company-domain"
import { enrichJobWithNormalization } from "@/lib/jobs/enrich-job-with-normalization"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extensionError,
  extensionCorsHeaders,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"

export const runtime = "nodejs"

interface ImportJobBody {
  title?: string | null
  company?: string | null
  companyLogo?: string | null
  companyVerified?: boolean | string | null
  location?: string | null
  workMode?: string | null
  employmentType?: string | null
  description?: string | null
  salary?: string | null
  salaryRange?: string | null
  postedAt?: string | null
  matchScore?: number | string | null
  matchLabel?: string | null
  matchedSkills?: string[] | null
  missingSkills?: string[] | null
  sponsorshipSignal?: string | null
  companySummary?: string | null
  companyFoundedYear?: number | string | null
  companyEmployeeCount?: number | string | null
  companyIndustry?: string | null
  easyApply?: boolean | string | null
  activelyHiring?: boolean | string | null
  topApplicantSignal?: boolean | string | null
  sourceUrl?: string | null
  applyUrl?: string | null
  externalJobId?: string | null
  url?: string | null
  ats?: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Parse a human-readable salary string into numeric min/max (annual USD).
 * Handles: "$120k", "$120,000", "$120k - $160k", "$120,000 – $160,000 /yr"
 */
function parseSalary(raw: string | null | undefined): { min: number | null; max: number | null } {
  if (!raw) return { min: null, max: null }
  // Strip currency symbols and commas, then find all numbers
  const clean = raw.replace(/[$,]/g, "")
  const nums = [...clean.matchAll(/(\d+(?:\.\d+)?)\s*k?\b/gi)].map((m) => {
    const n = parseFloat(m[1])
    // If the raw match has a "k" suffix or the number is < 1000, it's in thousands
    return m[0].toLowerCase().includes("k") || n < 1000 ? n * 1000 : n
  })
  if (nums.length === 0) return { min: null, max: null }
  if (nums.length === 1) return { min: nums[0], max: null }
  return { min: Math.min(...nums), max: Math.max(...nums) }
}

function toOptionalString(value: unknown, maxLength = 400): string | null {
  if (typeof value !== "string") return null
  const cleaned = value.trim()
  if (!cleaned) return null
  return cleaned.slice(0, maxLength)
}

function toOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
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

function toOptionalStringArray(value: unknown, limit = 8): string[] {
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

function normalizeCaptureUrl(raw: string | null): string | null {
  if (!raw?.trim()) return null
  try {
    const parsed = new URL(raw.trim())
    parsed.hash = ""
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|source|share|ref|trk)/i.test(key)) {
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

const US_STATE_RE = new RegExp(
  ",\\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\\s*$",
  "i"
)

/**
 * Decide is_remote and normalise location so the job passes
 * the sqlJobLocatedInUsa() filter used on the detail page.
 */
function resolveLocation(
  raw: string | null | undefined,
  title: string | null | undefined,
  description: string | null | undefined,
  workMode: string | null | undefined
): { location: string | null; isRemote: boolean; isHybrid: boolean } {
  const loc = raw?.trim() ?? null
  const normalizedMode = workMode?.trim().toLowerCase() ?? ""

  if (normalizedMode.includes("remote")) {
    return { location: loc ?? "Remote", isRemote: true, isHybrid: false }
  }
  if (normalizedMode.includes("hybrid")) {
    return { location: loc ?? "Hybrid, United States", isRemote: false, isHybrid: true }
  }
  if (normalizedMode.includes("on-site") || normalizedMode.includes("onsite")) {
    return { location: loc, isRemote: false, isHybrid: false }
  }

  // Explicit remote signals in location string
  if (loc && /\bremote\b/i.test(loc)) {
    return { location: loc, isRemote: true, isHybrid: false }
  }

  if (loc && /\bhybrid\b/i.test(loc)) {
    return { location: loc, isRemote: false, isHybrid: true }
  }

  // Remote signals in title
  if (/\bremote\b/i.test(title ?? "")) {
    return { location: loc ?? "Remote", isRemote: true, isHybrid: false }
  }

  if (/\bhybrid\b/i.test(title ?? "")) {
    return { location: loc ?? "Hybrid, United States", isRemote: false, isHybrid: true }
  }

  // Already US-formatted location
  if (loc && (US_STATE_RE.test(loc) || /united states/i.test(loc))) {
    return { location: loc, isRemote: false, isHybrid: false }
  }

  // Mention of remote in description
  if (/\bfully remote\b|\bwork from anywhere\b|\bremote-first\b/i.test(description ?? "")) {
    return { location: loc ?? "Remote", isRemote: true, isHybrid: false }
  }

  if (/\bhybrid\b/i.test(description ?? "")) {
    return { location: loc ?? "Hybrid, United States", isRemote: false, isHybrid: true }
  }

  // No location clue → default to remote so the job is always visible
  return { location: loc ?? "Remote, United States", isRemote: true, isHybrid: false }
}

// ── Route handlers ─────────────────────────────────────────────────────────────

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  const headers = extensionCorsHeaders(origin)

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const [body, bodyError] = await readExtensionJsonBody<ImportJobBody>(request)
  if (bodyError) return bodyError
  const sourceUrl = toOptionalString(body.sourceUrl ?? body.url, 1400)
  const applyUrl = toOptionalString(body.applyUrl ?? body.url, 1400)
  const jobUrl = applyUrl

  if (!jobUrl) {
    return extensionError(request, 400, "url is required", { headers })
  }

  const pool = getPostgresPool()
  const companyName = body.company?.trim() || null
  const jobTitle = body.title?.trim() || "Unknown Role"
  const salaryInput = body.salaryRange?.trim() || body.salary?.trim() || null
  const { location, isRemote, isHybrid } = resolveLocation(
    body.location,
    body.title,
    body.description,
    body.workMode
  )
  const { min: salaryMin, max: salaryMax } = parseSalary(salaryInput)
  const companyLogo = toOptionalString(body.companyLogo, 1200)
  const companySummary = toOptionalString(body.companySummary, 2000)
  const companyIndustry = toOptionalString(body.companyIndustry, 180)
  const companyEmployeeCount =
    toOptionalString(body.companyEmployeeCount, 120) ??
    (toOptionalRoundedNumber(body.companyEmployeeCount)?.toLocaleString() ?? null)
  const companyFoundedYearRaw = toOptionalRoundedNumber(body.companyFoundedYear)
  const companyFoundedYear =
    companyFoundedYearRaw && companyFoundedYearRaw >= 1800 && companyFoundedYearRaw <= new Date().getUTCFullYear() + 1
      ? companyFoundedYearRaw
      : null
  const easyApply = toOptionalBoolean(body.easyApply)
  const activelyHiring = toOptionalBoolean(body.activelyHiring)
  const topApplicantSignal = toOptionalBoolean(body.topApplicantSignal)
  const companyVerified = toOptionalBoolean(body.companyVerified)
  const matchScoreRaw = toOptionalRoundedNumber(body.matchScore)
  const matchScore =
    matchScoreRaw === null ? null : Math.max(0, Math.min(100, matchScoreRaw))
  const matchLabel = toOptionalString(body.matchLabel, 80)
  const sponsorshipSignal = toOptionalString(body.sponsorshipSignal, 180)
  const matchedSkills = toOptionalStringArray(body.matchedSkills, 10)
  const missingSkills = toOptionalStringArray(body.missingSkills, 10)
  const externalJobId = toOptionalString(body.externalJobId, 220)
  const canonicalSourceUrl = normalizeCaptureUrl(sourceUrl)
  const canonicalApplyUrl = normalizeCaptureUrl(applyUrl)
  const extensionRawData = compactRecord({
    captureSource: "extension",
    captureAdapter: body.ats ?? "unknown",
    sourceUrl,
    applyUrl,
    canonicalSourceUrl,
    canonicalApplyUrl,
    externalJobId,
    title: jobTitle,
    company: companyName,
    companyLogo,
    companyVerified,
    location,
    workMode: toOptionalString(body.workMode, 80),
    employmentType: toOptionalString(body.employmentType, 80),
    salaryRange: salaryInput,
    postedAt: toOptionalString(body.postedAt, 120),
    matchScore,
    matchLabel,
    matchedSkills,
    missingSkills,
    sponsorshipSignal,
    companySummary,
    companyFoundedYear,
    companyEmployeeCount,
    companyIndustry,
    easyApply,
    activelyHiring,
    topApplicantSignal,
  })

  const inferredDomain = domainFromApplyUrl(jobUrl)

  // ── 1. Resolve company ─────────────────────────────────────────────────────

  let companyId: string | null = null

  if (companyName) {
    const existing = await pool
      .query<{ id: string }>(
        `SELECT id FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [companyName]
      )
      .catch(() => null)

    if (existing?.rows[0]) {
      companyId = existing.rows[0].id
      if (companyId && (inferredDomain || companyLogo)) {
        await pool
          .query(
            `UPDATE companies
             SET domain = COALESCE(NULLIF(trim(domain), ''), $2),
                 logo_url = COALESCE(NULLIF(trim(logo_url), ''), $3),
                 updated_at = NOW()
             WHERE id = $1
               AND (
                 domain IS NULL OR trim(domain) = ''
                 OR ($3 IS NOT NULL AND (logo_url IS NULL OR trim(logo_url) = ''))
               )`,
            [companyId, inferredDomain, companyLogo]
          )
          .catch(() => null)
      }
    } else {
      const created = await pool
        .query<{ id: string }>(
          `INSERT INTO companies (name, is_active, ats_type)
           VALUES ($1, true, $2)
           RETURNING id`,
          [companyName, body.ats ?? "unknown"]
        )
        .catch(() => null)

      companyId = created?.rows[0]?.id ?? null

      if (companyId && (inferredDomain || companyLogo)) {
        await pool
          .query(
            `UPDATE companies
             SET domain = COALESCE(NULLIF(trim(domain), ''), $2),
                 logo_url = COALESCE(NULLIF(trim(logo_url), ''), $3),
                 updated_at = NOW()
             WHERE id = $1
               AND (
                 domain IS NULL OR trim(domain) = ''
                 OR ($3 IS NOT NULL AND (logo_url IS NULL OR trim(logo_url) = ''))
               )`,
            [companyId, inferredDomain, companyLogo]
          )
          .catch(() => null)
      }
    }
  }

  // ── 2. Upsert job ──────────────────────────────────────────────────────────

  const existingJob = await pool
    .query<{ id: string }>(
      `SELECT id
       FROM jobs
       WHERE apply_url = $1
          OR ($2::text IS NOT NULL AND external_id = $2::text)
       LIMIT 1`,
      [jobUrl, externalJobId]
    )
    .catch(() => null)

  let jobId: string | null = existingJob?.rows[0]?.id ?? null

  if (!jobId) {
    // Insert a new job record with only real schema columns
    const inserted = await pool
      .query<{ id: string }>(
        `INSERT INTO jobs (
          company_id, title, location, description,
          apply_url, is_remote, is_hybrid, is_active,
          external_id,
          salary_min, salary_max,
          raw_data,
          first_detected_at, last_seen_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, true,
          $8,
          $9, $10,
          $11::jsonb,
          NOW(), NOW()
        )
        RETURNING id`,
        [
          companyId,
          jobTitle,
          location,
          body.description?.trim().slice(0, 10000) ?? null,
          jobUrl,
          isRemote,
          isHybrid,
          externalJobId,
          salaryMin,
          salaryMax,
          JSON.stringify(extensionRawData),
        ]
      )
      .catch(() => null)

    jobId = inserted?.rows[0]?.id ?? null

    // If insert failed (e.g. unique violation on apply_url), try a fresh lookup
    if (!jobId) {
      const retry = await pool
        .query<{ id: string }>(`SELECT id FROM jobs WHERE apply_url = $1 LIMIT 1`, [jobUrl])
        .catch(() => null)
      jobId = retry?.rows[0]?.id ?? null
    }
  }

  if (jobId) {
    await pool
      .query(
        `UPDATE jobs
         SET raw_data = COALESCE(raw_data, '{}'::jsonb) || $2::jsonb,
             location = COALESCE(NULLIF(trim(location), ''), $3),
             description = COALESCE(NULLIF(trim(description), ''), $4),
             salary_min = COALESCE(salary_min, $5),
             salary_max = COALESCE(salary_max, $6),
             is_remote = CASE WHEN is_remote THEN true ELSE $7 END,
             is_hybrid = CASE WHEN is_hybrid THEN true ELSE $8 END,
             external_id = COALESCE(NULLIF(trim(external_id), ''), $9),
             last_seen_at = NOW(),
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          jobId,
          JSON.stringify(extensionRawData),
          location,
          body.description?.trim().slice(0, 10000) ?? null,
          salaryMin,
          salaryMax,
          isRemote,
          isHybrid,
          externalJobId,
        ]
      )
      .catch(() => null)
  }

  // ── 3. Idempotency check ───────────────────────────────────────────────────

  if (jobId) {
    const alreadySaved = await pool
      .query<{ id: string }>(
        `SELECT id FROM job_applications
         WHERE user_id = $1::uuid AND job_id = $2::uuid AND is_archived = false
         LIMIT 1`,
        [user.sub, jobId]
      )
      .catch(() => null)

    if (alreadySaved?.rows[0]) {
      return NextResponse.json(
        { saved: true, alreadySaved: true, jobId, applicationId: alreadySaved.rows[0].id },
        { headers }
      )
    }
  } else {
    const alreadyManual = await pool
      .query<{ id: string }>(
        `SELECT id FROM job_applications
         WHERE user_id = $1::uuid AND apply_url = $2 AND is_archived = false
         LIMIT 1`,
        [user.sub, jobUrl]
      )
      .catch(() => null)

    if (alreadyManual?.rows[0]) {
      return NextResponse.json(
        { saved: true, alreadySaved: true, applicationId: alreadyManual.rows[0].id },
        { headers }
      )
    }
  }

  // ── 4. Create application record ───────────────────────────────────────────

  const applicationId = randomUUID()
  const initialTimeline = JSON.stringify([
    {
      id: randomUUID(),
      type: "status_change",
      status: "saved",
      date: new Date().toISOString(),
      auto: true,
      note: "Saved via Hireoven Scout Bridge",
    },
  ])

  try {
    await pool.query(
      `INSERT INTO job_applications (
        id, user_id, job_id, status,
        company_name, job_title, apply_url,
        timeline, interviews, is_archived, source,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, 'saved',
        $4, $5, $6,
        $7::jsonb, '[]'::jsonb, false, 'extension',
        NOW(), NOW()
      )`,
      [
        applicationId,
        user.sub,
        jobId,
        companyName ?? "Unknown Company",
        jobTitle,
        jobUrl,
        initialTimeline,
      ]
    )
  } catch (err) {
    console.error("[extension/jobs/import] application insert failed:", err)
    return extensionError(request, 500, "Failed to save job. Please try again.", { headers })
  }

  if (jobId) {
    try {
      await enrichJobWithNormalization(pool, jobId)
    } catch (e) {
      console.error("[extension/jobs/import] normalization enrichment:", e)
    }
  }

  return NextResponse.json(
    { saved: true, jobId, applicationId },
    { status: 201, headers }
  )
}

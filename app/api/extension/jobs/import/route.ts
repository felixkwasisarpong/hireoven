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
  location?: string | null
  description?: string | null
  salary?: string | null
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
  description: string | null | undefined
): { location: string | null; isRemote: boolean } {
  const loc = raw?.trim() ?? null

  // Explicit remote signals in location string
  if (loc && /\bremote\b/i.test(loc)) {
    return { location: loc, isRemote: true }
  }

  // Remote signals in title
  if (/\bremote\b/i.test(title ?? "")) {
    return { location: loc ?? "Remote", isRemote: true }
  }

  // Already US-formatted location
  if (loc && (US_STATE_RE.test(loc) || /united states/i.test(loc))) {
    return { location: loc, isRemote: false }
  }

  // Mention of remote in description
  if (/\bfully remote\b|\bwork from anywhere\b|\bremote-first\b/i.test(description ?? "")) {
    return { location: loc ?? "Remote", isRemote: true }
  }

  // No location clue → default to remote so the job is always visible
  return { location: loc ?? "Remote, United States", isRemote: true }
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
  const jobUrl = body.url?.trim()

  if (!jobUrl) {
    return extensionError(request, 400, "url is required", { headers })
  }

  const pool = getPostgresPool()
  const companyName = body.company?.trim() || null
  const jobTitle = body.title?.trim() || "Unknown Role"
  const { location, isRemote } = resolveLocation(body.location, body.title, body.description)
  const { min: salaryMin, max: salaryMax } = parseSalary(body.salary)

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
    }
  }

  // ── 2. Upsert job ──────────────────────────────────────────────────────────

  const existingJob = await pool
    .query<{ id: string }>(
      `SELECT id FROM jobs WHERE apply_url = $1 LIMIT 1`,
      [jobUrl]
    )
    .catch(() => null)

  let jobId: string | null = existingJob?.rows[0]?.id ?? null

  if (!jobId) {
    // Insert a new job record with only real schema columns
    const inserted = await pool
      .query<{ id: string }>(
        `INSERT INTO jobs (
          company_id, title, location, description,
          apply_url, is_remote, is_active,
          salary_min, salary_max,
          first_detected_at, last_seen_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, true,
          $7, $8,
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
          salaryMin,
          salaryMax,
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

  return NextResponse.json(
    { saved: true, jobId, applicationId },
    { status: 201, headers }
  )
}

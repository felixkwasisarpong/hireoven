/**
 * POST /api/extension/jobs/resolve
 *
 * Resolve a page fingerprint to an existing Hireoven job/application context.
 *
 * Returns:
 * - found: job already exists for the user
 * - created: job exists globally; user application link was created
 * - needs_import: no reliable match found
 */

import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extensionCorsHeaders,
  extensionError,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"

export const runtime = "nodejs"

type ResolveBody = {
  sourceUrl?: string | null
  applyUrl?: string | null
  atsProvider?: string | null
  externalJobId?: string | null
  title?: string | null
  company?: string | null
}

function cleanText(value: unknown, max = 280): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

const TRANSIENT_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
  "source",
  "share",
  "ref",
  "referral",
  "trk",
])

function normalizeUrl(input: string | null | undefined): string | null {
  if (!input?.trim()) return null
  try {
    const parsed = new URL(input.trim())
    parsed.hash = ""
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRANSIENT_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key)
      }
    }
    parsed.hostname = parsed.hostname.toLowerCase()
    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "")
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function unique(values: Array<string | null | undefined>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!value) continue
    const key = value.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  const headers = extensionCorsHeaders(origin)

  const [user, authError] = await requireExtensionAuth(request)
  if (authError) return authError

  const [body, bodyError] = await readExtensionJsonBody<ResolveBody>(request)
  if (bodyError) return bodyError

  const sourceUrl = normalizeUrl(cleanText(body.sourceUrl, 1400))
  const applyUrl = normalizeUrl(cleanText(body.applyUrl, 1400))
  const title = cleanText(body.title, 220)
  const company = cleanText(body.company, 220)
  const externalJobId = cleanText(body.externalJobId, 220)

  const candidateUrls = unique([
    sourceUrl,
    applyUrl,
    cleanText(body.sourceUrl, 1400),
    cleanText(body.applyUrl, 1400),
  ])

  if (candidateUrls.length === 0 && !externalJobId && !(title && company)) {
    return extensionError(request, 400, "Missing fingerprint fields", { headers })
  }

  const pool = getPostgresPool()

  // 1) Check if this user already has the job in applications.
  const ownedHit = await pool
    .query<{ job_id: string | null }>(
      `SELECT j.id AS job_id
       FROM job_applications ja
       LEFT JOIN jobs j ON j.id = ja.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE ja.user_id = $1::uuid
         AND ja.is_archived = false
         AND (
           j.apply_url = ANY($2::text[])
           OR (j.raw_data->>'sourceUrl') = ANY($2::text[])
           OR (j.raw_data->>'canonicalSourceUrl') = ANY($2::text[])
           OR (j.raw_data->>'applyUrl') = ANY($2::text[])
           OR (j.raw_data->>'canonicalApplyUrl') = ANY($2::text[])
           OR ($3::text IS NOT NULL AND j.external_id = $3::text)
           OR (
             $4::text IS NOT NULL
             AND $5::text IS NOT NULL
             AND LOWER(COALESCE(j.title, '')) = LOWER($4::text)
             AND LOWER(COALESCE(c.name, '')) = LOWER($5::text)
           )
         )
       ORDER BY ja.updated_at DESC NULLS LAST, ja.created_at DESC
       LIMIT 1`,
      [user.sub, candidateUrls, externalJobId, title, company],
    )
    .catch(() => null)

  const ownedJobId = ownedHit?.rows[0]?.job_id ?? null
  if (ownedJobId) {
    return NextResponse.json(
      { exists: true, jobId: ownedJobId, status: "found" },
      { headers },
    )
  }

  // 2) Match a global jobs row.
  const globalHit = await pool
    .query<{ job_id: string; job_title: string | null; apply_url: string | null; company_name: string | null }>(
      `SELECT j.id AS job_id, j.title AS job_title, j.apply_url, c.name AS company_name
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE (
         j.apply_url = ANY($1::text[])
         OR (j.raw_data->>'sourceUrl') = ANY($1::text[])
         OR (j.raw_data->>'canonicalSourceUrl') = ANY($1::text[])
         OR (j.raw_data->>'applyUrl') = ANY($1::text[])
         OR (j.raw_data->>'canonicalApplyUrl') = ANY($1::text[])
         OR ($2::text IS NOT NULL AND j.external_id = $2::text)
         OR (
           $3::text IS NOT NULL
           AND $4::text IS NOT NULL
           AND LOWER(COALESCE(j.title, '')) = LOWER($3::text)
           AND LOWER(COALESCE(c.name, '')) = LOWER($4::text)
         )
       )
       ORDER BY j.updated_at DESC NULLS LAST, j.created_at DESC
       LIMIT 1`,
      [candidateUrls, externalJobId, title, company],
    )
    .catch(() => null)

  const globalRow = globalHit?.rows[0] ?? null
  if (!globalRow?.job_id) {
    return NextResponse.json(
      { exists: false, status: "needs_import" },
      { headers },
    )
  }

  // 3) Link global job to this user if not already linked.
  const alreadyLinked = await pool
    .query<{ id: string }>(
      `SELECT id
       FROM job_applications
       WHERE user_id = $1::uuid
         AND job_id = $2::uuid
         AND is_archived = false
       LIMIT 1`,
      [user.sub, globalRow.job_id],
    )
    .catch(() => null)

  if (alreadyLinked?.rows[0]?.id) {
    return NextResponse.json(
      { exists: true, jobId: globalRow.job_id, status: "found" },
      { headers },
    )
  }

  const applicationId = randomUUID()
  const nowIso = new Date().toISOString()
  const timeline = JSON.stringify([
    {
      id: randomUUID(),
      type: "status_change",
      status: "saved",
      date: nowIso,
      auto: true,
      note: "Linked via extension job resolve",
    },
  ])

  const linked = await pool
    .query(
      `INSERT INTO job_applications (
        id,
        user_id,
        job_id,
        status,
        company_name,
        job_title,
        apply_url,
        timeline,
        interviews,
        is_archived,
        source,
        created_at,
        updated_at
      ) VALUES (
        $1,
        $2,
        $3,
        'saved',
        $4,
        $5,
        $6,
        $7::jsonb,
        '[]'::jsonb,
        false,
        'extension',
        NOW(),
        NOW()
      )`,
      [
        applicationId,
        user.sub,
        globalRow.job_id,
        globalRow.company_name ?? company ?? "Unknown Company",
        globalRow.job_title ?? title ?? "Unknown Role",
        globalRow.apply_url ?? applyUrl ?? sourceUrl,
        timeline,
      ],
    )
    .then(() => true)
    .catch(() => false)

  if (!linked) {
    return NextResponse.json(
      { exists: true, jobId: globalRow.job_id, status: "found" },
      { headers },
    )
  }

  return NextResponse.json(
    { exists: true, jobId: globalRow.job_id, status: "created" },
    { headers },
  )
}

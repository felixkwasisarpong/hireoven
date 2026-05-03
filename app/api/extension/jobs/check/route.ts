/**
 * GET /api/extension/jobs/check?url=...&applyUrl=...
 *
 * Lightweight presence check used by the Scout Bar to decide whether to show
 * the Save button. Just looks up whether the current user already has an
 * active (non-archived) job_applications row pointing at the same job.
 *
 * Two URL hints can be supplied — the bar passes both the page URL and the
 * extracted external apply URL when available. The route normalizes both and
 * checks against jobs.apply_url for either match. Returns within ~10ms — the
 * bar can call this on every URL change without overhead.
 *
 * Response:
 *   { saved: false }
 *   { saved: true, jobId, applicationId, dashboardUrl }
 */

import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extensionCorsHeaders,
  extensionError,
  handleExtensionPreflight,
  requireExtensionAuth,
} from "@/lib/extension/auth"

export const runtime = "nodejs"

// Mirrors the normalizeUrl in /save — strip tracking params so the lookup
// matches what /save persisted.
function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  try {
    const parsed = new URL(raw.trim())
    parsed.hash = ""
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|source|share|ref|trk|gh_src)/i.test(key)) {
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

function originFromRequest(request: Request): string {
  const origin = request.headers.get("origin")
  if (origin && /^https?:\/\//.test(origin)) return origin
  try { return new URL(request.url).origin } catch { return "" }
}

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function GET(request: Request) {
  const corsHeaders = extensionCorsHeaders(request.headers.get("origin"))

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const params = new URL(request.url).searchParams
  const candidates = [params.get("applyUrl"), params.get("url"), params.get("canonicalUrl")]
    .map((u) => normalizeUrl(u))
    .filter((u): u is string => Boolean(u))

  if (candidates.length === 0) {
    return extensionError(request, 400, "url is required", { headers: corsHeaders })
  }

  const pool = getPostgresPool()

  // Find job by apply_url match (any of the candidate URLs).
  const jobRow = await pool
    .query<{ id: string }>(
      `SELECT id FROM jobs WHERE apply_url = ANY($1::text[]) LIMIT 1`,
      [candidates],
    )
    .catch((err: unknown) => {
      console.error("[extension/jobs/check] jobs lookup failed:", err)
      return null
    })

  const jobId = jobRow?.rows[0]?.id
  if (!jobId) {
    return NextResponse.json({ saved: false }, { headers: corsHeaders })
  }

  // Has the current user saved this job (and not archived it)?
  const appRow = await pool
    .query<{ id: string }>(
      `SELECT id FROM job_applications
       WHERE user_id = $1::uuid AND job_id = $2::uuid AND is_archived = false
       LIMIT 1`,
      [user.sub, jobId],
    )
    .catch(() => null)

  if (!appRow?.rows[0]) {
    return NextResponse.json({ saved: false, jobId }, { headers: corsHeaders })
  }

  return NextResponse.json(
    {
      saved: true,
      jobId,
      applicationId: appRow.rows[0].id,
      dashboardUrl: `${originFromRequest(request)}/dashboard/jobs/${jobId}`,
    },
    { headers: corsHeaders },
  )
}

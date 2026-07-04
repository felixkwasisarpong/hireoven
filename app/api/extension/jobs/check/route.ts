/**
 * GET /api/extension/jobs/check?url=...&applyUrl=...
 *
 * Lightweight presence check used by the Apex Bar to decide whether to show
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
import { extensionDashboardUrl } from "@/lib/extension/dashboard-url"
import { buildExtensionJobFingerprint } from "@/lib/extension/job-fingerprint"

export const runtime = "nodejs"

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function GET(request: Request) {
  const corsHeaders = extensionCorsHeaders(request.headers.get("origin"))

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const params = new URL(request.url).searchParams
  const fingerprint = buildExtensionJobFingerprint({
    urls: [params.get("applyUrl"), params.get("url"), params.get("canonicalUrl")],
    externalJobId: params.get("externalJobId"),
  })
  const candidates = fingerprint.candidateUrls
  const externalIds = fingerprint.externalJobIds

  if (candidates.length === 0 && externalIds.length === 0) {
    return extensionError(request, 400, "url is required", { headers: corsHeaders })
  }

  const pool = getPostgresPool()

  // Find job by apply_url OR external_id match.
  const jobRow = await pool
    .query<{ id: string }>(
      `SELECT id
       FROM jobs
       WHERE (
         (array_length($1::text[], 1) IS NOT NULL AND apply_url = ANY($1::text[]))
         OR (array_length($2::text[], 1) IS NOT NULL AND external_id = ANY($2::text[]))
       )
       LIMIT 1`,
      [candidates, externalIds],
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
      dashboardUrl: extensionDashboardUrl(request, jobId),
    },
    { headers: corsHeaders },
  )
}

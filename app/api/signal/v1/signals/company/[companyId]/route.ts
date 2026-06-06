import { NextResponse } from "next/server"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { getPostgresPool } from "@/lib/postgres/server"
import { deriveCompanyIntel, buildCompanyIntelSummary } from "@/lib/apex/company-intel/aggregator"
import { requireSignalApiAuth } from "@/lib/signal-api/auth"
import { signalApiError, signalApiJson } from "@/lib/signal-api/http"
import { logAndReturnSignalApiResponse } from "@/lib/signal-api/request-log"
import type { Company, Job } from "@/types"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const startedAtMs = Date.now()
  const auth = await requireSignalApiAuth(request, {
    requiredScopes: ["signals.read"],
  })
  if (auth instanceof NextResponse) return auth

  const finish = (response: Response) =>
    logAndReturnSignalApiResponse(request, auth, startedAtMs, response)

  const { companyId } = await params
  if (!companyId) {
    return finish(signalApiError(400, "companyId is required", "BAD_REQUEST", auth.requestId, auth.rateLimit, undefined, auth.quota))
  }

  try {
    const pool = getPostgresPool()

    const [companyRes, jobsRes] = await Promise.all([
      pool.query<Company>(
        `SELECT *
         FROM companies c
         WHERE c.id = $1
           AND EXISTS (
             SELECT 1
             FROM jobs j
             WHERE j.company_id = c.id
               AND j.is_active = true
               AND ${sqlPublishedJob("j")}
               AND COALESCE(j.raw_data->>'signalTenantId', '') = $2
           )
         LIMIT 1`,
        [companyId, auth.tenantId]
      ),
      pool.query<Job>(
        `SELECT id, title, first_detected_at, last_seen_at, is_active, is_remote,
                sponsors_h1b, sponsorship_score, skills, normalized_title
         FROM jobs
         WHERE company_id = $1
           AND is_active = true
           AND ${sqlPublishedJob("jobs")}
           AND COALESCE(raw_data->>'signalTenantId', '') = $2
         ORDER BY first_detected_at DESC
         LIMIT 100`,
        [companyId, auth.tenantId]
      ),
    ])

    const company = companyRes.rows[0]
    if (!company) {
      return finish(signalApiError(404, "Company not found", "NOT_FOUND", auth.requestId, auth.rateLimit, undefined, auth.quota))
    }

    const jobs = jobsRes.rows
    const intel = deriveCompanyIntel(company, jobs)
    const summary = buildCompanyIntelSummary(company, intel, jobs.length)

    return finish(signalApiJson(auth, {
      intel,
      summary,
      companyName: company.name,
    }))
  } catch (error) {
    console.error("[signal/v1/signals/company] error", error)
    return finish(signalApiError(500, "Unable to load company signals", "INTERNAL_ERROR", auth.requestId, auth.rateLimit, undefined, auth.quota))
  }
}

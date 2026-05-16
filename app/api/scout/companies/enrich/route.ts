/**
 * POST /api/scout/companies/enrich
 *
 * Glassdoor handler streams company-level signals (rating, review count,
 * pros/cons phrases, role-specific salary range, etc.) here. We attach the
 * payload to companies.raw_data under the key matching the source; later
 * enrichers (e.g. Linkedin Insights) can write under their own keys without
 * stepping on each other.
 *
 * Auth: Bearer JWT.
 */

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

interface EnrichBody {
  source: "glassdoor" | string
  companyName: string
  /** True if the user explicitly clicked "Save company to Scout"; false for auto-enrich. */
  explicit?: boolean
  signals: Record<string, unknown>
}

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function POST(request: Request) {
  const corsHeaders = extensionCorsHeaders(request.headers.get("origin"))

  const [user, authError] = await requireExtensionAuth(request)
  if (authError) return authError
  void user

  const [body, bodyError] = await readExtensionJsonBody<EnrichBody>(request)
  if (bodyError) return bodyError

  const companyName = body.companyName?.trim()
  if (!companyName || !body.source) {
    return extensionError(request, 400, "companyName and source are required", { headers: corsHeaders })
  }

  const pool = getPostgresPool()

  // Find or create the company shell.
  const existing = await pool
    .query<{ id: string }>(
      `SELECT id FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [companyName],
    )
    .catch(() => null)

  let companyId = existing?.rows[0]?.id ?? null
  if (!companyId) {
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    const placeholderDomain = `${slug || "unknown"}.scout-enrichment-placeholder`
    const created = await pool
      .query<{ id: string }>(
        `INSERT INTO companies (name, is_active, ats_type, domain)
         VALUES ($1, true, 'generic', $2)
         RETURNING id`,
        [companyName, placeholderDomain],
      )
      .catch(() => null)
    companyId = created?.rows[0]?.id ?? null
  }

  if (!companyId) {
    return extensionError(request, 500, "company resolution failed", { headers: corsHeaders })
  }

  const enrichmentPayload = {
    [body.source]: {
      ...body.signals,
      lastEnrichedAt: new Date().toISOString(),
      explicit: !!body.explicit,
    },
  }

  try {
    const updateResult = await pool.query(
      `UPDATE companies
       SET scout_enrichment = COALESCE(scout_enrichment, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1::uuid`,
      [companyId, JSON.stringify(enrichmentPayload)],
    )
    if ((updateResult.rowCount ?? 0) < 1) {
      return extensionError(request, 500, "company enrichment update failed", { headers: corsHeaders })
    }
  } catch (error) {
    console.error("[scout/companies/enrich] update failed", {
      companyId,
      source: body.source,
      error: error instanceof Error ? error.message : String(error),
    })
    return extensionError(request, 500, "company enrichment update failed", { headers: corsHeaders })
  }

  // When a Glassdoor rating arrives, update company_health_scores in-place
  // so the health badge reflects fresh data without waiting for a full recompute.
  if (body.source === "glassdoor") {
    const rating = body.signals?.rating
    if (typeof rating === "number" && rating >= 1 && rating <= 5) {
      void pool.query(
        `WITH gs AS (
           SELECT
             CASE
               WHEN $2::numeric >= 4.5 THEN 25
               WHEN $2::numeric >= 4.0 THEN 20
               WHEN $2::numeric >= 3.5 THEN 14
               WHEN $2::numeric >= 3.0 THEN 8
               ELSE 2
             END AS score
         ),
         upd AS (
           UPDATE company_health_scores chs
           SET
             glassdoor_rating = $2::numeric,
             glassdoor_score  = gs.score,
             updated_at       = NOW()
           FROM gs
           WHERE chs.company_id = $1
           RETURNING chs.company_id, chs.funding_score, chs.layoff_score,
                     chs.headcount_score, gs.score AS glassdoor_score
         )
         UPDATE company_health_scores chs
         SET
           total_score = LEAST(100, GREATEST(0,
             u.funding_score + u.layoff_score + u.headcount_score + u.glassdoor_score)),
           verdict = CASE
             WHEN LEAST(100, GREATEST(0,
               u.funding_score + u.layoff_score + u.headcount_score + u.glassdoor_score)) >= 75
               THEN 'strong'
             WHEN LEAST(100, GREATEST(0,
               u.funding_score + u.layoff_score + u.headcount_score + u.glassdoor_score)) >= 55
               THEN 'healthy'
             WHEN LEAST(100, GREATEST(0,
               u.funding_score + u.layoff_score + u.headcount_score + u.glassdoor_score)) >= 35
               THEN 'caution'
             ELSE 'critical'
           END
         FROM upd u
         WHERE chs.company_id = u.company_id`,
        [companyId, rating],
      ).catch((error) => {
        console.error("[scout/companies/enrich] health score update failed", {
          companyId,
          rating,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }

  return NextResponse.json(
    { companyId, source: body.source, explicit: !!body.explicit },
    { headers: corsHeaders },
  )
}

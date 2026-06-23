/**
 * GET /api/cron/company-logos
 *
 * Precision logo backfill: for every active company that already has a usable
 * web domain (real `companies.domain` or a `raw_ats_config.guessed_domain`
 * resolved by discovery) but no `logo_url`, derive + validate the logo.dev mark
 * and store it. Never guesses a domain from the name — that stays with
 * `discover-from-domains` (which also sets logos when it resolves). This pass
 * just converts already-known domains into logos, covering the gap discovery
 * skips (companies that already hold a real domain never get a logo otherwise).
 *
 * Env:
 *   CRON_SECRET                      required auth header
 *   COMPANY_LOGOS_BATCH              companies per run (default 300)
 *   COMPANY_LOGOS_CONCURRENCY        parallel logo.dev probes (default 6)
 * Query:
 *   ?dry=1                           probe but never write (measure hit-rate)
 *   ?batch=300&concurrency=6         override batch/concurrency
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { backfillCompanyLogos } from "@/lib/companies/logo-backfill"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const dry = url.searchParams.get("dry") === "1"
  const batch = Number.parseInt(
    url.searchParams.get("batch") ?? process.env.COMPANY_LOGOS_BATCH ?? "300",
    10
  )
  const concurrency = Number.parseInt(
    url.searchParams.get("concurrency") ?? process.env.COMPANY_LOGOS_CONCURRENCY ?? "6",
    10
  )

  const startedAt = Date.now()
  try {
    const result = await backfillCompanyLogos(getPostgresPool(), {
      limit: Number.isFinite(batch) ? batch : 300,
      concurrency: Number.isFinite(concurrency) ? concurrency : 6,
      execute: !dry,
    })
    return NextResponse.json({
      ok: true,
      dry,
      durationMs: Date.now() - startedAt,
      ...result,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

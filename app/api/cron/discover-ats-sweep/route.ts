/**
 * GET /api/cron/discover-ats-sweep
 *
 * Company-first ATS discovery: the automated version of the manual Eightfold
 * sweep. Claims the least-recently-swept weak/unmatched active companies (the
 * ~39k custom/jsonld/no-ats backlog), probes each name across the ATS platforms
 * (eightfold, greenhouse, lever, ashby, smartrecruiters), and when a live board
 * with MORE jobs than the company's current capture is found, points the company
 * at it so the harvester crawls it. Rotates through the backlog via ats_sweep_at.
 *
 * Read-only probes + tiny enrollment writes — disk-safe. Enrollment never
 * downgrades a company that's already better-captured elsewhere.
 *
 * Env / query:
 *   batch       — companies to sweep per run (default 40)
 *   concurrency — parallel companies probed (default 5)
 */

import { NextRequest, NextResponse } from "next/server"
import pLimit from "p-limit"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { probeCompanyForAts } from "@/lib/discovery/ats-probers"
import { counter } from "@/lib/observability/metrics"

export const runtime = "nodejs"
export const maxDuration = 300

const CLAIM_SQL = `
UPDATE companies SET ats_sweep_at = now()
WHERE id IN (
  SELECT id FROM companies
  WHERE is_active = true
    AND (ats_type IS NULL OR ats_type IN ('custom', 'jsonld', ''))
    AND name IS NOT NULL AND length(trim(name)) >= 3
    AND name !~ '^[0-9]'
    AND domain !~* 'placeholder|discovered|^adzuna-|^dice-|^builtin-|^workable-'
  ORDER BY ats_sweep_at ASC NULLS FIRST
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, name;
`

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const url = new URL(request.url)
  const batch = Math.max(1, Number(url.searchParams.get("batch") ?? "40"))
  const concurrency = Math.max(1, Number(url.searchParams.get("concurrency") ?? "5"))

  const pool = getPostgresPool()
  const { rows: candidates } = await pool.query<{ id: string; name: string }>(CLAIM_SQL, [batch])

  const stats = { swept: candidates.length, enrolled: 0, byAts: {} as Record<string, number> }
  const limit = pLimit(concurrency)

  await Promise.all(
    candidates.map((c) =>
      limit(async () => {
        let hit
        try {
          hit = await probeCompanyForAts(c.name)
        } catch {
          return
        }
        if (!hit) return

        // Only convert if the found board beats what we already capture — never
        // downgrade a company whose current (weak) crawl already has more jobs.
        const { rows } = await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM jobs WHERE company_id = $1 AND is_active = true",
          [c.id],
        )
        const current = rows[0]?.n ?? 0
        if (hit.jobCount <= current) return

        try {
          await pool.query(
            `UPDATE companies
                SET ats_type = $2, ats_identifier = $3,
                    direct_ats_url = $4,
                    careers_url = COALESCE(NULLIF(careers_url, ''), $5),
                    is_active = true, status = 'active',
                    consecutive_empty_crawls = 0, next_harvest_at = NULL,
                    discovered_via = 'cron:discover-ats-sweep',
                    updated_at = now()
              WHERE id = $1`,
            [c.id, hit.atsType, hit.identifier, hit.directAtsUrl, hit.careersUrl],
          )
          stats.enrolled++
          stats.byAts[hit.atsType] = (stats.byAts[hit.atsType] ?? 0) + 1
          counter("discover.ats_sweep.enrolled", { ats: hit.atsType })
        } catch {
          // domain/unique edge cases — skip this company
        }
      }),
    ),
  )

  counter("discover.ats_sweep.swept", undefined, stats.swept)
  return NextResponse.json({ ok: true, ...stats })
}

import type { Pool } from "pg"

/**
 * Freshness feedback loop.
 *
 * Job-board ingest crons (dice-ingest, waas-ingest, …) see "company X is
 * hiring right now" before the harvester's tier cadence would re-poll that
 * company's real ATS board — a tier_3 board is only crawled every 6h, so a job
 * posted minutes ago can sit unseen for hours, then get promoted the next
 * nightly maintenance pass. That lag is the gap between us and "within minutes
 * of posting".
 *
 * When an ingest run touches a company we already hold as a harvestable ATS
 * source, this pulls its `next_harvest_at` forward to now() so the worker
 * claims it on the next tick (~30s), and floors slow tiers at tier_2 so its
 * ongoing cadence keeps up. We deliberately do NOT force tier_1 — the nightly
 * maintenance tiering promotes to tier_1 only if the board actually yields
 * recent jobs, which avoids inflating the 3-min hot tier with board copies.
 *
 * Only ats_type-bearing, active, non-duplicate companies are touched —
 * placeholder rows (crawl_allowed=false, no ats_type) aren't harvestable, so
 * bumping them would be wasted writes. Returns the number of companies pulled
 * forward.
 */
export async function bumpHarvestForActiveCompanies(
  pool: Pool,
  companyIds: string[]
): Promise<number> {
  if (companyIds.length === 0) return 0
  const res = await pool.query(
    `UPDATE companies
        SET next_harvest_at = now(),
            freshness_tier = CASE
              WHEN freshness_tier IN ('tier_3', 'tier_dead') THEN 'tier_2'
              ELSE freshness_tier
            END,
            updated_at = now()
      WHERE id = ANY($1::uuid[])
        AND ats_type IS NOT NULL
        AND status = 'active'
        AND is_active = true
        AND duplicate_of_company_id IS NULL
        -- Only pull forward boards that aren't already due, so a backlog of
        -- overdue companies keeps its existing (earlier) ordering.
        AND (next_harvest_at IS NULL OR next_harvest_at > now())`,
    [companyIds]
  )
  return res.rowCount ?? 0
}

/**
 * Split U.S. Bank and Elavon back into two standalone companies.
 *
 * Background
 * ----------
 * Elavon is U.S. Bank's payments subsidiary, and elavon.com/careers funnels
 * into U.S. Bank's Workday tenant. ATS resolution therefore stamped the Elavon
 * company row with U.S. Bank's board:
 *
 *   Elavon Inc. (elavon.com)  ats_identifier = usbank:wd1:US_Bank_Careers
 *
 * A later dedupe pass saw two companies claiming the same tenant, merged them,
 * and picked the WRONG survivor: Elavon Inc. became canonical and the real
 * U.S. Bank (usbank.com) row was marked status='dead'. From then on the whole
 * U.S. Bank board was ingested under the Elavon name and elavon.com logo — of
 * the 876 jobs attributed to Elavon, 839 mention "U.S. Bank" and only 8
 * mention Elavon.
 *
 * What this does
 * --------------
 *  1. Consolidates every job crawled from the U.S. Bank Workday tenant onto the
 *     real U.S. Bank row. Where the same external_id exists on both sides, the
 *     row with the later last_seen_at wins (it reflects the more recent crawl)
 *     but inherits the earlier first_detected_at of the pair, so we don't lose
 *     the true discovery date or make old postings look freshly listed.
 *  2. Restores U.S. Bank as an active, standalone canonical company owning the
 *     Workday board, using the crawl config that is currently working on the
 *     Elavon row. etag is cleared so the next harvest is a full crawl, not a 304.
 *  3. Leaves Elavon Inc. standalone with its own identity but NO board, since it
 *     has no separate ATS of its own. Its careers_url is cleared (that URL is
 *     what resolved into U.S. Bank's tenant) and the discovery-attempt stamps
 *     are set so it does not immediately re-resolve to the same tenant.
 *  4. Repoints the ats_tenants registry rows for both usbank tenant spellings at
 *     U.S. Bank. This is the root cause — without it, enrolment would re-attach
 *     the board to Elavon.
 *  5. Folds the synthetic "usbank:wd1:us_bank_careers.workday-tenant" placeholder
 *     row into U.S. Bank. It is a tenant-derived stub, not a real company.
 *
 * Deliberately NOT touched: the h1b/lca/perm/pwd records under Elavon. Those were
 * matched by employer name and genuinely read "Elavon, Inc." — they are Elavon's
 * own filings and must stay with Elavon's standalone sponsorship profile.
 *
 * Stale rows are left to the normal lifecycle: deactivateMissingJobs() in
 * lib/harvester/persist-bulk.ts closes out by absence per company, so once
 * U.S. Bank is the single crawl target the next crawl expires whatever the board
 * no longer lists.
 *
 * Usage:
 *   npx tsx scripts/split-usbank-elavon.ts             # dry run
 *   npx tsx scripts/split-usbank-elavon.ts --execute
 */

import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"

const execute = process.argv.includes("--execute")

/** Elavon Inc. (elavon.com) — wrongly made canonical for U.S. Bank's board. */
const ELAVON = "9ffcfbbe-039a-4ea8-835b-d7c2cc3892dc"
/** U.S. Bank (usbank.com) — the real company, wrongly marked dead. */
const USBANK = "2505c476-46ee-4566-a948-98f3523bc375"
/** Synthetic "usbank:wd1:us_bank_careers.workday-tenant" stub row. */
const TENANT_STUB = "8a13f46b-43fd-4ae1-ac47-813885547fca"

/** The tenant spelling the working crawl config uses. */
const ATS_IDENTIFIER = "usbank:wd1:US_Bank_Careers"
const BOARD_URL = "https://usbank.wd1.myworkdayjobs.com/US_Bank_Careers"

/** Both ats_tenants spellings that must point at U.S. Bank, not Elavon. */
const TENANT_IDENTIFIERS = ["usbank:wd1:US_Bank_Careers", "usbank:wd1:us_bank_careers"]

type Snapshot = {
  id: string
  name: string
  domain: string | null
  status: string | null
  is_active: boolean
  duplicate_of_company_id: string | null
  ats_identifier: string | null
  job_count: number | null
  active_jobs: string
  total_jobs: string
}

async function snapshot(pool: ReturnType<typeof getPostgresPool>): Promise<Snapshot[]> {
  const { rows } = await pool.query<Snapshot>(
    `SELECT c.id, c.name, c.domain, c.status, c.is_active, c.duplicate_of_company_id,
            c.ats_identifier, c.job_count,
            (SELECT count(*) FROM jobs WHERE company_id = c.id AND is_active) AS active_jobs,
            (SELECT count(*) FROM jobs WHERE company_id = c.id) AS total_jobs
       FROM companies c
      WHERE c.id = ANY($1::uuid[])
      ORDER BY c.name`,
    [[ELAVON, USBANK, TENANT_STUB]]
  )
  return rows
}

/**
 * Move every job from `srcId` onto `dstId`, resolving (company_id, external_id)
 * collisions in favour of the more recently seen row while preserving the
 * earliest first_detected_at across the pair.
 */
async function absorbJobs(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: unknown[] }> },
  srcId: string,
  dstId: string
) {
  await client.query(
    `CREATE TEMP TABLE pairs ON COMMIT DROP AS
       SELECT s.id AS src_id,
              d.id AS dst_id,
              LEAST(s.first_detected_at, d.first_detected_at) AS earliest,
              (s.last_seen_at > d.last_seen_at)               AS src_wins
         FROM jobs s
         JOIN jobs d
           ON d.external_id = s.external_id
          AND d.company_id = $2::uuid
        WHERE s.company_id = $1::uuid
          AND s.external_id IS NOT NULL`,
    [srcId, dstId]
  )

  // Keeper inherits the earlier discovery date of the pair.
  await client.query(
    `UPDATE jobs j
        SET first_detected_at = p.earliest,
            updated_at = NOW()
       FROM pairs p
      WHERE j.id = CASE WHEN p.src_wins THEN p.src_id ELSE p.dst_id END
        AND j.first_detected_at > p.earliest`
  )

  const dropped = await client.query(
    `DELETE FROM jobs
      WHERE id IN (SELECT CASE WHEN src_wins THEN dst_id ELSE src_id END FROM pairs)`
  )

  const moved = await client.query(
    `UPDATE jobs SET company_id = $2::uuid, updated_at = NOW() WHERE company_id = $1::uuid`,
    [srcId, dstId]
  )

  await client.query(`DROP TABLE pairs`)

  return { moved: moved.rowCount ?? 0, dropped: dropped.rowCount ?? 0 }
}

async function main() {
  const pool = getPostgresPool()

  console.log(`[split-usbank-elavon] mode=${execute ? "EXECUTE" : "dry-run"}`)
  console.log("\nBefore:")
  console.table(await snapshot(pool))

  if (!execute) {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*) FROM jobs e
            JOIN jobs u ON u.external_id = e.external_id AND u.company_id = $2::uuid
           WHERE e.company_id = $1::uuid)                                          AS colliding,
         (SELECT count(*) FROM jobs WHERE company_id = $1::uuid)                    AS elavon_jobs,
         (SELECT count(*) FROM jobs WHERE company_id = $3::uuid)                    AS stub_jobs`,
      [ELAVON, USBANK, TENANT_STUB]
    )
    console.log("\nPlanned job moves:", rows[0])
    console.log("\n(Pass --execute to apply.)")
    await pool.end()
    return
  }

  // Capture the working crawl config off the Elavon row before we clear it —
  // Elavon must release the tenant first, because uq_companies_ats_pair_active
  // makes (ats_type, ats_identifier) unique across all non-duplicate companies.
  const { rows: elavonRows } = await pool.query<{
    raw_ats_config: unknown
    freshness_tier: string | null
  }>(`SELECT raw_ats_config, freshness_tier FROM companies WHERE id = $1`, [ELAVON])
  const workingConfig = elavonRows[0]

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const fromElavon = await absorbJobs(client, ELAVON, USBANK)
    console.log(`  jobs Elavon -> U.S. Bank: moved=${fromElavon.moved} dropped_as_dupes=${fromElavon.dropped}`)

    const fromStub = await absorbJobs(client, TENANT_STUB, USBANK)
    console.log(`  jobs tenant-stub -> U.S. Bank: moved=${fromStub.moved} dropped_as_dupes=${fromStub.dropped}`)

    // 1. Elavon: standalone, keeps its own identity + sponsorship profile, no board.
    //    Must run BEFORE U.S. Bank claims the tenant (unique index above).
    await client.query(
      `UPDATE companies SET
          status                        = 'active',
          is_active                     = true,
          duplicate_of_company_id       = NULL,
          ats_type                      = NULL,
          ats_identifier                = NULL,
          -- careers_url is NOT NULL, and every elavon.com careers path 302s to
          -- careers.usbank.com (verified), so we park it on the corporate
          -- homepage rather than hand resolution a URL that walks back into
          -- U.S. Bank's tenant. uq_companies_ats_pair_active is the real
          -- backstop: while U.S. Bank holds the tenant with a NULL
          -- duplicate_of_company_id, nothing else can claim it.
          careers_url                   = 'https://www.elavon.com',
          direct_ats_url                = NULL,
          direct_ats_provider           = NULL,
          direct_ats_identifier         = NULL,
          direct_ats_url_resolved_at    = NULL,
          raw_ats_config                = NULL,
          etag                          = NULL,
          last_modified                 = NULL,
          next_harvest_at               = NULL,
          job_count                     = 0,
          ats_probe_attempted_at        = NOW(),
          careers_discovery_attempted_at = NOW(),
          notes                         = 'U.S. Bank subsidiary. elavon.com/careers redirects into U.S. Bank''s Workday tenant (usbank:wd1:US_Bank_Careers), so ATS resolution must NOT attach that board here — it is U.S. Bank''s. Left boardless deliberately; see scripts/split-usbank-elavon.ts.',
          updated_at                    = NOW()
        WHERE id = $1`,
      [ELAVON]
    )

    // 2. U.S. Bank: standalone, active, owns the Workday board.
    await client.query(
      `UPDATE companies SET
          status                      = 'active',
          is_active                   = true,
          duplicate_of_company_id     = NULL,
          ats_type                    = 'workday',
          ats_identifier              = $2,
          careers_url                 = $3,
          direct_ats_url              = $3,
          direct_ats_provider         = 'workday',
          direct_ats_identifier       = 'usbank/US_Bank_Careers',
          direct_ats_url_resolved_at  = NOW(),
          raw_ats_config              = $4::jsonb,
          freshness_tier              = COALESCE($5, freshness_tier),
          etag                        = NULL,
          last_modified               = NULL,
          consecutive_empty_crawls    = 0,
          next_harvest_at             = NOW(),
          notes                       = 'Owns the usbank:wd1:US_Bank_Careers Workday board. Elavon Inc. is a subsidiary whose careers URL funnels into this same tenant — do not merge the two; see scripts/split-usbank-elavon.ts.',
          updated_at                  = NOW()
        WHERE id = $1`,
      [
        USBANK,
        ATS_IDENTIFIER,
        BOARD_URL,
        workingConfig?.raw_ats_config ? JSON.stringify(workingConfig.raw_ats_config) : null,
        workingConfig?.freshness_tier ?? null,
      ]
    )

    // 3. Tenant stub folds into U.S. Bank.
    await client.query(
      `UPDATE companies SET
          status                  = 'dead',
          is_active               = false,
          duplicate_of_company_id = $2,
          ats_type                = NULL,
          ats_identifier          = NULL,
          next_harvest_at         = NULL,
          job_count               = 0,
          updated_at              = NOW()
        WHERE id = $1`,
      [TENANT_STUB, USBANK]
    )

    // 4. Root cause: the tenant registry must point at U.S. Bank.
    const tenants = await client.query(
      `UPDATE ats_tenants SET company_id = $1, updated_at = NOW()
        WHERE ats_identifier = ANY($2::text[])`,
      [USBANK, TENANT_IDENTIFIERS]
    )
    console.log(`  ats_tenants repointed at U.S. Bank: ${tenants.rowCount}`)

    // 5. Recompute denormalised job_count for the survivor.
    await client.query(
      `UPDATE companies c
          SET job_count = (SELECT count(*) FROM jobs WHERE company_id = c.id AND is_active),
              updated_at = NOW()
        WHERE c.id = $1`,
      [USBANK]
    )

    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }

  console.log("\nAfter:")
  console.table(await snapshot(pool))
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

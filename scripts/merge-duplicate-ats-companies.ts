/**
 * Merge company records that describe the same employer.
 *
 * One employer accumulates a row per discovery subsystem that found it, because
 * every subsystem invents its own synthetic domain and every upsert conflicts on
 * `domain`. The rows all carry the same `ats_type`/`ats_identifier`, which is the
 * employer's real identity, so that pair defines a group here.
 *
 * What this does NOT do is delete the losing rows. Twenty-six tables reference
 * companies.id and several cascade, so deleting a merged-away record would take
 * watchlist entries and crawl history with it. Losers are re-pointed, flagged and
 * deactivated instead.
 *
 * Moved to the survivor: jobs, watchlist, and the immigration record tables that
 * drive sponsorship UI. Left in place: crawl_logs (1.3M rows of per-row operational
 * history, meaningless to merge) and analytic tables whose company_id is nullable.
 *
 * Usage:
 *   tsx scripts/merge-duplicate-ats-companies.ts                  # dry run, 25 groups
 *   tsx scripts/merge-duplicate-ats-companies.ts --limit=200      # dry run, more
 *   tsx scripts/merge-duplicate-ats-companies.ts --execute        # commit
 *   tsx scripts/merge-duplicate-ats-companies.ts --ats-identifier=metropolis --execute
 */
import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"
import { resolveDuplicates, type DuplicateCandidate } from "@/lib/companies/duplicate-resolution"

loadEnvConfig(process.cwd())

function flag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find((v) => v.startsWith(prefix))
  return arg ? arg.slice(prefix.length).trim() : null
}

const execute = process.argv.includes("--execute")
const limit = Number(flag("limit") ?? "25")
const onlyIdentifier = flag("ats-identifier")
const promoteDomains = process.argv.includes("--promote-domains")

if (!Number.isFinite(limit) || limit <= 0) throw new Error("--limit must be a positive number")

/** Tables whose company_id should follow the employer to the survivor. */
const REPOINT_TABLES = [
  "lca_records",
  "h1b_records",
  "perm_records",
  "pwd_records",
  "employer_lca_stats",
]

type GroupRow = {
  ats_type: string
  ats_identifier: string
  id: string
  domain: string | null
  is_active: boolean
  job_count: number
  created_at: string
}

type Totals = {
  groups: number
  losers: number
  jobsMoved: number
  jobsCollapsed: number
  watchlistMoved: number
  recordsRepointed: number
  domainsPromoted: number
  cyclesBroken: number
  ambiguous: number
}

async function loadGroups(): Promise<Map<string, GroupRow[]>> {
  const pool = getPostgresPool()
  const params: unknown[] = [limit]
  const identifierClause = onlyIdentifier ? "AND g.ats_identifier = $2" : ""
  if (onlyIdentifier) params.push(onlyIdentifier)

  // Job counts come from jobs itself; companies.job_count is a cached column and
  // is exactly the kind of thing that drifts on records nobody crawls any more.
  const { rows } = await pool.query<GroupRow>(
    `WITH g AS (
       SELECT ats_type, ats_identifier
         FROM companies
        WHERE ats_type IS NOT NULL AND ats_identifier IS NOT NULL
        GROUP BY 1, 2
       HAVING count(*) > 1
     ),
     picked AS (
       SELECT * FROM g WHERE true ${identifierClause} ORDER BY ats_type, ats_identifier LIMIT $1
     )
     SELECT c.ats_type, c.ats_identifier, c.id, c.domain, c.is_active,
            c.created_at::text AS created_at,
            (SELECT count(*)::int FROM jobs j WHERE j.company_id = c.id AND j.is_active) AS job_count
       FROM companies c
       JOIN picked p ON p.ats_type = c.ats_type AND p.ats_identifier = c.ats_identifier`,
    params,
  )

  const groups = new Map<string, GroupRow[]>()
  for (const row of rows) {
    const key = `${row.ats_type}:${row.ats_identifier}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  return groups
}

async function mergeGroup(key: string, rows: GroupRow[], totals: Totals): Promise<void> {
  const candidates: DuplicateCandidate[] = rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    isActive: r.is_active,
    jobCount: r.job_count,
    createdAt: r.created_at,
  }))

  const plan = resolveDuplicates(candidates)
  if (!plan) return

  if (plan.status === "ambiguous") {
    totals.ambiguous += 1
    console.log(`\n${key}  (${rows.length} records)  HELD — ${plan.reason}`)
    console.log(`  ${plan.realDomains.join("  vs  ")}`)
    return
  }

  const { survivor, losers, reason } = plan
  // Promotion is opt-in. The one real domain in a group is not always the right
  // one — `ashby/anima` carries `secure.axyz-design.com`, which is simply wrong —
  // and a wrong-but-real domain drives wrong logos and enrichment, where a
  // synthetic one merely drives none.
  const promoteDomain = promoteDomains ? plan.promoteDomain : null
  const loserIds = losers.map((l) => l.id)

  console.log(`\n${key}  (${rows.length} records)`)
  console.log(`  survivor ${survivor.id.slice(0, 8)}  ${survivor.domain ?? "-"}  [${reason}]`)
  for (const l of losers) {
    console.log(`  merge    ${l.id.slice(0, 8)}  ${l.domain ?? "-"}  ${l.jobCount} jobs`)
  }
  if (promoteDomain) console.log(`  promote domain -> ${promoteDomain}`)
  else if (plan.promoteDomain) console.log(`  real domain available (--promote-domains to apply): ${plan.promoteDomain}`)
  const anyActive = rows.some((r) => r.is_active)
  if (anyActive && !survivor.isActive) console.log(`  reactivate survivor (a merged record was live)`)
  if (!anyActive) console.log(`  group is entirely dormant — survivor stays inactive`)

  totals.groups += 1
  totals.losers += losers.length
  if (promoteDomain) totals.domainsPromoted += 1

  if (!execute) return

  const pool = getPostgresPool()
  const client = await pool.connect()
  try {
    await client.query("SET statement_timeout = '120s'")
    await client.query("BEGIN")

    // Move one row per external_id that the survivor does not already have.
    //
    // DISTINCT ON matters: several losers routinely hold the same posting, so a
    // plain UPDATE would move two rows with equal external_id onto the survivor
    // and trip the (company_id, external_id) unique index, failing the group.
    // Prefer the live, most recently seen copy.
    const moved = await client.query(
      `WITH pick AS (
         SELECT DISTINCT ON (j.external_id) j.id
           FROM jobs j
          WHERE j.company_id = ANY($1::uuid[])
            AND j.external_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM jobs s
               WHERE s.company_id = $2 AND s.external_id = j.external_id)
          ORDER BY j.external_id, j.is_active DESC, j.last_seen_at DESC NULLS LAST
       )
       UPDATE jobs SET company_id = $2, updated_at = now()
        WHERE id IN (SELECT id FROM pick)`,
      [loserIds, survivor.id],
    )

    // Rows with no external_id are outside the unique index and can all move.
    const movedNull = await client.query(
      `UPDATE jobs SET company_id = $2, updated_at = now()
        WHERE company_id = ANY($1::uuid[]) AND external_id IS NULL`,
      [loserIds, survivor.id],
    )
    totals.jobsMoved += (moved.rowCount ?? 0) + (movedNull.rowCount ?? 0)

    // Whatever is left on a loser now duplicates a posting the survivor holds —
    // either it always did, or the step above just moved its twin. Retire it so
    // the feed stops showing one role several times.
    const collapsed = await client.query(
      `UPDATE jobs j
          SET is_active = false,
              duplicate_of_id = s.id,
              updated_at = now()
         FROM jobs s
        WHERE j.company_id = ANY($1::uuid[])
          AND s.company_id = $2
          AND s.external_id = j.external_id
          AND j.external_id IS NOT NULL
          AND j.is_active`,
      [loserIds, survivor.id],
    )
    totals.jobsCollapsed += collapsed.rowCount ?? 0

    // A user watching two rows of one employer must not end up with a duplicate
    // key; keep their existing entry and drop the redundant one.
    const watch = await client.query(
      `UPDATE watchlist w SET company_id = $2
        WHERE w.company_id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM watchlist e WHERE e.user_id = w.user_id AND e.company_id = $2)`,
      [loserIds, survivor.id],
    )
    totals.watchlistMoved += watch.rowCount ?? 0
    await client.query(`DELETE FROM watchlist WHERE company_id = ANY($1::uuid[])`, [loserIds])

    for (const table of REPOINT_TABLES) {
      const res = await client.query(
        `UPDATE ${table} SET company_id = $2 WHERE company_id = ANY($1::uuid[])`,
        [loserIds, survivor.id],
      )
      totals.recordsRepointed += res.rowCount ?? 0
    }

    // Free the real domain before the survivor can take it — `domain` is unique.
    if (promoteDomain) {
      await client.query(
        `UPDATE companies SET domain = id::text || '.merged', updated_at = now()
          WHERE id = ANY($1::uuid[]) AND domain = $2`,
        [loserIds, promoteDomain],
      )
      await client.query(
        `UPDATE companies SET domain = $2, updated_at = now() WHERE id = $1`,
        [survivor.id, promoteDomain],
      )
    }

    // Carry over facts the survivor lacks rather than losing them with the row.
    //
    // Crawl state matters as much as the data here. The fullest record is often an
    // older one that was retired as `dead` while a newer duplicate did the actual
    // harvesting — Metropolis is exactly that shape. Merging into it without
    // carrying activity across would retire every live row in the group and stop
    // the employer being crawled at all.
    await client.query(
      `UPDATE companies s SET
          careers_url = COALESCE(NULLIF(s.careers_url, ''), b.careers_url),
          logo_url    = COALESCE(NULLIF(s.logo_url, ''), b.logo_url),
          industry    = COALESCE(NULLIF(s.industry, ''), b.industry),
          h1b_sponsor_count_1yr = GREATEST(COALESCE(s.h1b_sponsor_count_1yr,0), COALESCE(b.c1,0)),
          h1b_sponsor_count_3yr = GREATEST(COALESCE(s.h1b_sponsor_count_3yr,0), COALESCE(b.c3,0)),
          sponsors_h1b = s.sponsors_h1b OR COALESCE(b.sponsors, false),
          is_cap_exempt = s.is_cap_exempt OR COALESCE(b.cap_exempt, false),
          is_active = s.is_active OR COALESCE(b.any_active, false),
          status = CASE
            WHEN COALESCE(b.any_active, false) AND s.status IN ('dead', 'unknown') THEN 'active'
            ELSE s.status
          END,
          next_harvest_at = CASE
            WHEN s.is_active OR COALESCE(b.any_active, false)
              THEN LEAST(COALESCE(s.next_harvest_at, now()), COALESCE(b.next_harvest, now()))
            ELSE s.next_harvest_at
          END,
          updated_at = now()
        FROM (
          SELECT max(careers_url) careers_url, max(logo_url) logo_url, max(industry) industry,
                 max(h1b_sponsor_count_1yr) c1, max(h1b_sponsor_count_3yr) c3,
                 bool_or(sponsors_h1b) sponsors, bool_or(is_cap_exempt) cap_exempt,
                 bool_or(is_active) any_active, min(next_harvest_at) next_harvest
            FROM companies WHERE id = ANY($1::uuid[])
        ) b
       WHERE s.id = $2`,
      [loserIds, survivor.id],
    )

    // Retire the losers. Not deleted: cascading FKs would take watchlist rows and
    // crawl history with them.
    //
    // The ATS pair is surrendered, not just flagged. Holding it is what let this
    // grow: flagging a row as a duplicate exempted it from the uniqueness guard
    // while it kept occupying the key, so the next subsystem was free to insert
    // yet another copy. Releasing the pair also makes this script drain in
    // batches — a merged group stops matching "more than one row per pair" — and
    // is what allows the guard to become a plain unique index. The original pair
    // is kept in raw_ats_config for provenance.
    await client.query(
      `UPDATE companies
          SET duplicate_of_company_id = $2,
              is_active = false,
              next_harvest_at = NULL,
              job_count = 0,
              raw_ats_config = COALESCE(raw_ats_config, '{}'::jsonb) || jsonb_build_object(
                'merged_from_ats', jsonb_build_object(
                  'ats_type', ats_type, 'ats_identifier', ats_identifier,
                  'merged_into', $3::text, 'merged_at', now()::text)),
              ats_type = NULL,
              ats_identifier = NULL,
              updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [loserIds, survivor.id, survivor.id],
    )

    // The survivor must be canonical. Groups exist today where every row points at
    // another as its duplicate — including mutual a->b->a pairs — so the chain
    // terminates nowhere and the uniqueness guard skips all of them.
    const uncycled = await client.query(
      `UPDATE companies SET duplicate_of_company_id = NULL, updated_at = now()
        WHERE id = $1 AND duplicate_of_company_id IS NOT NULL`,
      [survivor.id],
    )
    totals.cyclesBroken += uncycled.rowCount ?? 0

    await client.query(
      `UPDATE companies c SET job_count =
         (SELECT count(*)::int FROM jobs j WHERE j.company_id = c.id AND j.is_active)
        WHERE c.id = $1`,
      [survivor.id],
    )

    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

async function main(): Promise<void> {
  const groups = await loadGroups()
  console.log(`${execute ? "EXECUTING" : "DRY RUN"} — ${groups.size} duplicate group(s)`)

  const totals: Totals = {
    groups: 0, losers: 0, jobsMoved: 0, jobsCollapsed: 0,
    watchlistMoved: 0, recordsRepointed: 0, domainsPromoted: 0, cyclesBroken: 0, ambiguous: 0,
  }

  for (const [key, rows] of groups) {
    try {
      await mergeGroup(key, rows, totals)
    } catch (err) {
      console.error(`FAILED ${key}: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
      return
    }
  }

  console.log(`\n--- ${execute ? "merged" : "would merge"} ---`)
  console.log(`  groups:            ${totals.groups}`)
  console.log(`  records retired:   ${totals.losers}`)
  console.log(`  groups held (ambiguous identity): ${totals.ambiguous}`)
  console.log(`  domains promoted:  ${totals.domainsPromoted}`)
  if (execute) {
    console.log(`  jobs moved:        ${totals.jobsMoved}`)
    console.log(`  jobs collapsed:    ${totals.jobsCollapsed}`)
    console.log(`  watchlist moved:   ${totals.watchlistMoved}`)
    console.log(`  records repointed: ${totals.recordsRepointed}`)
    console.log(`  cycles broken:     ${totals.cyclesBroken}`)
  } else {
    console.log(`\nRe-run with --execute to apply.`)
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPostgresPool().end()
  })

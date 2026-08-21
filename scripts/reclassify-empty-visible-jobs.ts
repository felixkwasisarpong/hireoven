/**
 * Demote jobs marked `visible_enriched` that have no role content.
 *
 * The publication gate let skills stand in for a description: a job needed a
 * 120-character description OR two skills. Skills are extracted from the title,
 * so "Senior Software Engineer (Java/Python)" yielded ["Python", "Java"] and the
 * job was classified as fully enriched with an empty body. Those rows are
 * notification-eligible and SEO-visible, so a push notification could open a job
 * page with nothing on it — which is how this was reported.
 *
 * The gate is fixed in lib/jobs/publication.ts; this repairs the rows it already
 * mislabelled by moving them to `visible_basic`, where enrichment will pick them
 * up and promote them back once they have a body (SQL_UPGRADE_TO_VISIBLE_ENRICHED).
 *
 * Batched and bounded: `ix_jobs_pub_status_active` covers the predicate, but jobs
 * is the table that OOM-restarts prod Postgres when scanned carelessly.
 *
 * Usage:
 *   tsx scripts/reclassify-empty-visible-jobs.ts             # dry run
 *   tsx scripts/reclassify-empty-visible-jobs.ts --execute
 */
import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const BATCH = 500

/**
 * Repair window. `visible_enriched` holds hundreds of thousands of rows, and a
 * predicate over all of them times out — jobs is the table that OOM-restarts prod
 * Postgres. `first_detected_at` is indexed, so working recent slices keeps every
 * statement small, and recent jobs are the ones notifications can still reach.
 */
const days = Number((process.argv.find((v) => v.startsWith("--days=")) ?? "--days=30").slice(7))
if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be a positive number")

/** Mirrors MIN_DESCRIPTION_CHARS in lib/jobs/publication.ts. */
const MIN_DESCRIPTION_CHARS = 120

/**
 * A row is empty when it has neither a usable description nor parsed role
 * sections. Sections live in job_intelligence; treat their presence as content so
 * this never demotes a job whose body is structured rather than prose.
 */
/** Slice width. Each statement covers a few indexed days, which keeps it small. */
const SLICE_DAYS = 3

const EMPTY_PREDICATE = `
  first_detected_at >= now() - make_interval(days => $1)
  AND first_detected_at <  now() - make_interval(days => $2)
  AND is_active
  AND publication_status = 'visible_enriched'
  AND COALESCE(length(btrim(description)), 0) < ${MIN_DESCRIPTION_CHARS}
  AND COALESCE(jsonb_array_length(
        COALESCE(job_intelligence -> 'sections' -> 'responsibilities' -> 'items', '[]'::jsonb)
      ), 0) = 0
  AND COALESCE(jsonb_array_length(
        COALESCE(job_intelligence -> 'sections' -> 'requirements' -> 'items', '[]'::jsonb)
      ), 0) = 0
`

async function main(): Promise<void> {
  const pool = getPostgresPool()
  const client = await pool.connect()
  try {
    await client.query("SET statement_timeout = '60s'")

    let scanned = 0
    let moved = 0
    let shown = 0

    // Walk backwards a slice at a time. Scanning the whole window in one
    // statement times out: visible_enriched is hundreds of thousands of rows and
    // the predicate has to read each description out of TOAST.
    for (let older = SLICE_DAYS; older <= days; older += SLICE_DAYS) {
      const newer = older - SLICE_DAYS
      const params = [older, newer]

      const { rows: matches } = await client.query<{ id: string; title: string; skills: string[] | null }>(
        `SELECT id, title, skills FROM jobs WHERE ${EMPTY_PREDICATE} LIMIT 5000`,
        params,
      )
      scanned += matches.length
      if (matches.length === 0) continue

      for (const row of matches.slice(0, Math.max(0, 5 - shown))) {
        console.log(`  ${row.title.slice(0, 50).padEnd(52)} skills=${JSON.stringify(row.skills ?? [])}`)
        shown += 1
      }

      if (!execute) continue

      for (let i = 0; i < matches.length; i += BATCH) {
        const ids = matches.slice(i, i + BATCH).map((r) => r.id)
        const res = await client.query(
          `UPDATE jobs SET publication_status = 'visible_basic', updated_at = now()
            WHERE id = ANY($1::uuid[]) AND publication_status = 'visible_enriched'`,
          [ids],
        )
        moved += res.rowCount ?? 0
      }
      console.log(`  days ${newer}-${older}: ${matches.length} found, ${moved} demoted so far`)
    }

    console.log(
      execute
        ? `\ndemoted ${moved} of ${scanned} job(s) to visible_basic`
        : `\n${scanned} visible_enriched job(s) with no role content in the last ${days} days` +
          `\nRe-run with --execute to demote them to visible_basic.`,
    )
  } finally {
    client.release()
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

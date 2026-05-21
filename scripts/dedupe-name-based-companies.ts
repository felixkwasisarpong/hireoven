/**
 * Merge active companies that share the same normalized name but live under
 * different domains — only when one of the domains is clearly low-quality
 * (mangled synthetic, scout placeholder, USCIS-employer, ATS tenant) and the
 * other is a real-looking domain.
 *
 * Ambiguous clusters (two real-looking domains, e.g. snyk.com vs snyk.io) are
 * NOT merged automatically — they're printed for manual review.
 *
 * Same merge mechanics as scripts/dedupe-ats-domain-companies.ts:
 *   1. Drop dup-side jobs whose external_id already exists for the canonical.
 *   2. Repoint jobs + watchlist + other FK tables.
 *   3. Mark dup row is_active=false, duplicate_of_company_id=canonical.id.
 *
 * Usage:
 *   npx tsx scripts/dedupe-name-based-companies.ts
 *   npx tsx scripts/dedupe-name-based-companies.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const execute = args.includes("--execute")

function nameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|corp|corporation|company|co|llc|group|ltd|the|llp|plc|gmbh)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "")
}

type Row = {
  id: string
  name: string
  domain: string
  job_count: number
  slug: string
}

function hostOf(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/\.(com|org|net|io|co|ai|edu|gov)$/, "")
}

function isLowQuality(row: Row): boolean {
  const d = row.domain.toLowerCase()
  if (d.endsWith(".scout-placeholder")) return true
  if (d.endsWith(".uscis-employer") || d.endsWith(".lca-employer")) return true
  if (/\.wd\d+\.myworkdayjobs\.com$/.test(d)) return true
  if (d.endsWith(".applytojob.com")) return true
  if (d.endsWith(".greenhouse.io")) return true
  if (d.endsWith(".smartrecruiters.com")) return true
  return false
}

/**
 * Domain quality score. Higher wins as canonical.
 * Real short brand domains win over long synthetic ones.
 */
function domainScore(row: Row): number {
  const d = row.domain.toLowerCase()
  let score = 0

  // Hard negatives — these are never canonical.
  if (d.endsWith(".scout-placeholder")) score -= 100
  if (d.endsWith(".uscis-employer") || d.endsWith(".lca-employer")) score -= 80
  if (/\.wd\d+\.myworkdayjobs\.com$/.test(d)) score -= 60
  if (d.endsWith(".applytojob.com")) score -= 60
  if (d.endsWith(".greenhouse.io")) score -= 60
  if (d.endsWith(".smartrecruiters.com")) score -= 60

  // Real institutional TLDs.
  if (d.endsWith(".edu")) score += 30
  if (d.endsWith(".gov")) score += 30

  // Prefer shorter hosts — real brand domains are short ("anduril"), synthetic
  // name-as-domain ones are long ("andurilindustries").
  score += Math.max(0, 30 - hostOf(d).length)

  return score
}

type Cluster = {
  slug: string
  rows: Row[]
  canonical: Row
  dups: Row[]
  ambiguous: boolean
}

async function findClusters(pool: ReturnType<typeof getPostgresPool>): Promise<Cluster[]> {
  const { rows: raw } = await pool.query<{
    id: string
    name: string
    domain: string
    job_count: string | null
  }>(
    `SELECT id, name, domain, COALESCE(job_count, 0)::text AS job_count
       FROM companies
      WHERE is_active = true
        AND duplicate_of_company_id IS NULL
        AND domain IS NOT NULL
        AND length(name) > 1`
  )

  const byName = new Map<string, Row[]>()
  for (const r of raw) {
    const slug = nameSlug(r.name)
    if (!slug) continue
    const row: Row = {
      id: r.id,
      name: r.name,
      domain: r.domain,
      job_count: Number(r.job_count ?? "0"),
      slug,
    }
    const arr = byName.get(slug) ?? []
    arr.push(row)
    byName.set(slug, arr)
  }

  const clusters: Cluster[] = []
  for (const [slug, rows] of byName.entries()) {
    if (rows.length < 2) continue

    const scored = rows
      .map((r) => ({ row: r, score: domainScore(r) }))
      .sort((a, b) => b.score - a.score)

    const canonical = scored[0].row
    const dups = scored.slice(1).map((s) => s.row)

    // Refuse to auto-merge if the canonical itself looks low-quality (placeholder,
    // USCIS-employer, ATS subdomain). Nothing good comes from picking a junk row
    // as the survivor — flag the cluster for manual review instead.
    const canonicalIsBad = isLowQuality(canonical)

    // Each dup must be clearly worse than the canonical to auto-merge:
    //   - it's a placeholder/USCIS/ATS row, OR
    //   - its host is ≥6 chars longer than canonical's host AND it contains
    //     the canonical host as a substring (i.e. it's a "fullname-baked-in"
    //     mangled variant like andurilindustries.com vs anduril.com).
    const canonHost = hostOf(canonical.domain)
    const canonIsEduOrGov =
      canonical.domain.toLowerCase().endsWith(".edu") ||
      canonical.domain.toLowerCase().endsWith(".gov")

    const allWorse = dups.every((d) => {
      if (isLowQuality(d)) return true
      const dHost = hostOf(d.domain)
      // Mangled-as-substring: andurilindustries.com vs anduril.com.
      if (dHost.length - canonHost.length >= 6 && dHost.includes(canonHost)) return true
      // Edu/gov canonical + long synthetic .com dup (acronym .edu won't share
      // a substring with the spelled-out .com name).
      if (
        canonIsEduOrGov &&
        d.domain.toLowerCase().endsWith(".com") &&
        dHost.length >= 15
      ) {
        return true
      }
      return false
    })

    clusters.push({
      slug,
      rows,
      canonical,
      dups,
      ambiguous: canonicalIsBad || !allWorse,
    })
  }

  return clusters.sort((a, b) => a.slug.localeCompare(b.slug))
}

async function mergeOne(
  pool: ReturnType<typeof getPostgresPool>,
  canonicalId: string,
  dupId: string
): Promise<{ moved: number; deleted: number }> {
  const client = await pool.connect()
  let moved = 0
  let deleted = 0
  try {
    await client.query("BEGIN")

    const drop = await client.query(
      `DELETE FROM jobs
        WHERE company_id = $1
          AND external_id IS NOT NULL
          AND external_id IN (
            SELECT external_id FROM jobs
             WHERE company_id = $2 AND external_id IS NOT NULL
          )`,
      [dupId, canonicalId]
    )
    deleted = drop.rowCount ?? 0

    const move = await client.query(
      `UPDATE jobs SET company_id = $1, updated_at = NOW() WHERE company_id = $2`,
      [canonicalId, dupId]
    )
    moved = move.rowCount ?? 0

    await client.query(
      `DELETE FROM watchlist
        WHERE company_id = $1
          AND user_id IN (SELECT user_id FROM watchlist WHERE company_id = $2)`,
      [dupId, canonicalId]
    )
    await client.query(`UPDATE watchlist SET company_id = $1 WHERE company_id = $2`, [
      canonicalId,
      dupId,
    ])

    await client.query(
      `DELETE FROM application_timing_signals
        WHERE company_id = $1
          AND (day_of_week, hour_of_day) IN (
            SELECT day_of_week, hour_of_day
              FROM application_timing_signals
             WHERE company_id = $2
          )`,
      [dupId, canonicalId]
    )
    await client.query(
      `UPDATE application_timing_signals SET company_id = $1 WHERE company_id = $2`,
      [canonicalId, dupId]
    )

    const repointTables = [
      "h1b_records",
      "lca_records",
      "hired_outcomes",
      "post_hire_checkins",
      "rejection_submissions",
      "fair_chance_employers",
      "layoff_events",
      "employer_lca_stats",
      "employer_cohort_requests",
    ]
    for (const t of repointTables) {
      await client.query(`UPDATE ${t} SET company_id = $1 WHERE company_id = $2`, [
        canonicalId,
        dupId,
      ])
    }

    await client.query(
      `UPDATE companies
          SET is_active = false,
              duplicate_of_company_id = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [canonicalId, dupId]
    )

    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }

  return { moved, deleted }
}

async function refreshJobCounts(
  pool: ReturnType<typeof getPostgresPool>,
  ids: string[]
): Promise<void> {
  if (!ids.length) return
  await pool.query(
    `WITH counts AS (
       SELECT c.id, COUNT(j.*) FILTER (WHERE j.is_active = true) AS cnt
         FROM companies c
         LEFT JOIN jobs j ON j.company_id = c.id
        WHERE c.id = ANY($1::uuid[])
        GROUP BY c.id
     )
     UPDATE companies c SET job_count = counts.cnt, updated_at = NOW()
       FROM counts WHERE c.id = counts.id`,
    [ids]
  )
}

async function main() {
  const pool = getPostgresPool()
  const clusters = await findClusters(pool)
  const auto = clusters.filter((c) => !c.ambiguous)
  const review = clusters.filter((c) => c.ambiguous)

  console.log(
    `[dedupe-name] mode=${execute ? "execute" : "dry-run"} clusters_total=${clusters.length} auto_mergeable=${auto.length} need_review=${review.length}`
  )

  console.log("\n── Auto-mergeable (low-quality dup → real canonical) ────────")
  for (const c of auto.slice(0, 40)) {
    const dupDesc = c.dups.map((d) => `${d.name} [${d.domain}, ${d.job_count}j]`).join(" + ")
    console.log(`  ${c.canonical.name} [${c.canonical.domain}, ${c.canonical.job_count}j]  ←  ${dupDesc}`)
  }
  if (auto.length > 40) console.log(`  …and ${auto.length - 40} more`)

  if (review.length > 0) {
    console.log("\n── Needs manual review (multiple real-looking domains) ─────")
    for (const c of review.slice(0, 25)) {
      const rowDesc = c.rows
        .map((r) => `${r.domain} (${r.job_count}j, score ${domainScore(r)})`)
        .join("  vs  ")
      console.log(`  ${c.canonical.name}:  ${rowDesc}`)
    }
    if (review.length > 25) console.log(`  …and ${review.length - 25} more`)
  }

  if (!execute) {
    console.log("\n(Pass --execute to merge the auto cluster.)")
    await pool.end()
    return
  }

  let merged = 0
  let totalMoved = 0
  let totalDeleted = 0
  const canonicalIds = new Set<string>()
  for (const c of auto) {
    for (const dup of c.dups) {
      try {
        const r = await mergeOne(pool, c.canonical.id, dup.id)
        merged += 1
        totalMoved += r.moved
        totalDeleted += r.deleted
        canonicalIds.add(c.canonical.id)
      } catch (err) {
        console.warn(
          `  merge failed for ${dup.id} → ${c.canonical.id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  console.log(
    `\n[dedupe-name] merging done merged=${merged} jobs_moved=${totalMoved} jobs_deleted_as_dupes=${totalDeleted}`
  )

  await refreshJobCounts(pool, [...canonicalIds])
  console.log(`[dedupe-name] refreshed job_count on ${canonicalIds.size} canonicals`)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

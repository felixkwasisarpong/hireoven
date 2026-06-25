/**
 * Merge active companies that refer to the same employer but live under
 * different domains — only when one domain is clearly low-quality (apex/`.placeholder`,
 * `*-discovered` stub, USCIS-employer, or hosted-ATS tenant host) and the other
 * is a real-looking domain.
 *
 * Rows are clustered by union-find over two keys, so a pair links even when the
 * NAMES differ:
 *   • normalized name slug ("Acme Inc" ~ "Acme"), and
 *   • a domain-derived brand token — the ATS tenant / discovered slug
 *     ("wgu" from wgu.wd5.myworkdayjobs.com or zigabyte.bamboohr-discovered)
 *     matched against the real brand domain's host ("wgu" from wgu.edu).
 * This catches abbreviation↔fullname dups ("Wgu" ↔ "Western Governors University")
 * that pure name-slug clustering missed.
 *
 * Ambiguous clusters (two real-looking domains, e.g. snyk.com vs snyk.io) are
 * NOT merged automatically — they're printed for manual review.
 *
 * Merge mechanics:
 *   1. Migrate harvest config onto the canonical when it lacks one and the dup
 *      has it (so deactivating the dup doesn't stop the only real crawl).
 *   2. Drop dup-side jobs whose external_id already exists for the canonical.
 *   3. Repoint jobs + watchlist + other FK tables.
 *   4. Mark dup row is_active=false, duplicate_of_company_id=canonical.id.
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
// Restrict execution to the highest-confidence PATH-1 ATS/placeholder
// consolidations (exact brand-token match, single real domain).
const atsOnly = args.includes("--ats-only")
// Only merge clusters whose dup side actually carries jobs (a meaningful
// consolidation) — skips empty-stub dups for a first conservative batch.
const minDupJobsArg = args.find((a) => a.startsWith("--min-dup-jobs="))
const minDupJobs = minDupJobsArg ? Number(minDupJobsArg.split("=")[1]) || 0 : 0

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
  ats_identifier: string | null
  job_count: number
  slug: string
  brand: string | null
}

function hostOf(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/\.(com|org|net|io|co|ai|edu|gov)$/, "")
}

// Synthetic "*.<provider>-discovered" / "*.placeholder" suffixes minted by the
// discovery pipeline when a company is found via an ATS tenant or aggregator
// before its real domain is resolved. Mirrors CompanyLogo's PLACEHOLDER_DOMAIN_RE.
// Matches every synthetic-suffix shape the discovery pipeline mints:
//   *.placeholder / *.apex-placeholder / *.<provider>.ats-placeholder
//   *.<provider>-discovered / *.<provider>.discovered
//   *.uscis-employer / *.lca-employer
const PLACEHOLDER_SUFFIX_RE = /[.-]placeholder$|[.-]discovered$|\.(uscis|lca)-employer$/i

// Hosted-ATS domains where the leading label is the tenant (brand) slug.
// Each entry's capture group 1 is the tenant token (e.g. wgu.wd5.myworkdayjobs.com → "wgu").
const ATS_HOST_RES: RegExp[] = [
  /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i,
  /^([a-z0-9-]+)\.greenhouse\.io$/i,
  /^([a-z0-9-]+)\.smartrecruiters\.com$/i,
  /^([a-z0-9-]+)\.applytojob\.com$/i,
  /^([a-z0-9-]+)\.bamboohr\.com$/i,
  /^([a-z0-9-]+)\.recruitee\.com$/i,
  /^([a-z0-9-]+)\.teamtailor\.com$/i,
  /^([a-z0-9-]+)\.icims\.com$/i,
]

function isAtsHostDomain(domain: string): boolean {
  return ATS_HOST_RES.some((re) => re.test(domain))
}

function isLowQuality(row: Row): boolean {
  const d = row.domain.toLowerCase()
  if (PLACEHOLDER_SUFFIX_RE.test(d)) return true
  if (isAtsHostDomain(d)) return true
  return false
}

// Brand token used to cluster rows whose *names* differ but clearly refer to
// the same employer — the ATS tenant / discovered slug ("wgu" from
// wgu.wd5.myworkdayjobs.com or zigabyte from zigabyte.bamboohr-discovered)
// matches the host of the real brand domain ("wgu" from wgu.edu). Returns null
// when no specific token can be derived. Generic tokens are too collision-prone
// to cluster on, so they're rejected.
const BRAND_TOKEN_STOPLIST = new Set([
  "careers", "jobs", "apply", "www", "talent", "work", "team", "info", "the",
  "group", "global", "inc", "corp", "hr", "people", "hiring", "join", "recruiting",
  // Generic ATS/job-board subdomains that are NOT a tenant slug — e.g.
  // boards.greenhouse.io / job-boards.greenhouse.io are greenhouse's shared host.
  "boards", "jobboards", "secure", "app", "portal", "search", "my",
])

function brandToken(domain: string, atsIdentifier: string | null): string | null {
  const d = domain.toLowerCase()

  // Prefer the ATS identifier's leading segment ("wgu:wd5:External" → "wgu").
  const idHead = (atsIdentifier ?? "").toLowerCase().split(/[:/_-]/)[0]?.trim()

  let token: string | null = null
  for (const re of ATS_HOST_RES) {
    const m = d.match(re)
    if (m?.[1]) { token = m[1]; break }
  }
  if (!token && PLACEHOLDER_SUFFIX_RE.test(d)) {
    // Tenant is the leading label: "zigabyte.bamboohr-discovered" → "zigabyte",
    // "360learning.lever-discovered" → "360learning". Skip mangled aggregator
    // stubs ("adzuna-zigabyte-corporation.placeholder") whose first label has a
    // dash — too noisy to trust.
    const first = d.split(".")[0] ?? ""
    if (first && !first.includes("-")) token = first
  }
  if (!token) token = idHead || hostOf(d)

  token = (token ?? "").replace(/[^a-z0-9]/g, "")
  // ≥3 chars keeps real short acronym brands (wgu, sap, ibm) while dropping
  // ultra-generic 1–2 char tokens; collisions between two real domains still
  // land in the ambiguous/needs-review bucket rather than auto-merging.
  if (token.length < 3 || BRAND_TOKEN_STOPLIST.has(token)) return null
  return token
}

/**
 * Domain quality score. Higher wins as canonical.
 * Real short brand domains win over long synthetic ones.
 */
function domainScore(row: Row): number {
  const d = row.domain.toLowerCase()
  let score = 0

  // Hard negatives — these are never canonical.
  if (PLACEHOLDER_SUFFIX_RE.test(d)) score -= 90
  if (isAtsHostDomain(d)) score -= 60

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
  pathway: "ats" | "mangle" | null
}

async function findClusters(pool: ReturnType<typeof getPostgresPool>): Promise<Cluster[]> {
  const { rows: raw } = await pool.query<{
    id: string
    name: string
    domain: string
    ats_identifier: string | null
    job_count: string | null
  }>(
    `SELECT id, name, domain, ats_identifier, COALESCE(job_count, 0)::text AS job_count
       FROM companies
      WHERE is_active = true
        AND duplicate_of_company_id IS NULL
        AND domain IS NOT NULL
        AND length(name) > 1`
  )

  // Build rows + group them by every key they expose: the normalized name slug
  // AND a domain-derived brand token. Rows sharing ANY key are unioned into one
  // cluster, so "Wgu" (wgu.wd5.myworkdayjobs.com) links to "Western Governors
  // University" (wgu.edu) on the shared brand token even though their names differ.
  const allRows: Row[] = []
  const keyToIdx = new Map<string, number[]>()
  const addKey = (key: string | null, idx: number) => {
    if (!key) return
    const arr = keyToIdx.get(key) ?? []
    arr.push(idx)
    keyToIdx.set(key, arr)
  }

  for (const r of raw) {
    const slug = nameSlug(r.name)
    const brand = brandToken(r.domain, r.ats_identifier)
    if (!slug && !brand) continue
    const idx = allRows.length
    allRows.push({
      id: r.id,
      name: r.name,
      domain: r.domain,
      ats_identifier: r.ats_identifier,
      job_count: Number(r.job_count ?? "0"),
      slug,
      brand,
    })
    addKey(slug ? `n:${slug}` : null, idx)
    addKey(brand ? `b:${brand}` : null, idx)
  }

  // Union-find over row indices.
  const parent = allRows.map((_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  const union = (a: number, b: number) => { parent[find(a)] = find(b) }
  for (const idxs of keyToIdx.values()) {
    for (let i = 1; i < idxs.length; i++) union(idxs[0], idxs[i])
  }

  const components = new Map<number, Row[]>()
  for (let i = 0; i < allRows.length; i++) {
    const root = find(i)
    const arr = components.get(root) ?? []
    arr.push(allRows[i])
    components.set(root, arr)
  }

  const clusters: Cluster[] = []
  for (const compRows of components.values()) {
    if (compRows.length < 2) continue
    // Need at least two distinct domains to be a real duplicate (not the same
    // row keyed twice).
    const distinctDomains = new Set(compRows.map((r) => r.domain.toLowerCase()))
    if (distinctDomains.size < 2) continue
    const rows = compRows
    const slug = rows.map((r) => r.slug || r.brand).find(Boolean) ?? "(brand)"

    const scored = rows
      .map((r) => ({ row: r, score: domainScore(r) }))
      .sort((a, b) => b.score - a.score)

    const canonical = scored[0].row
    const dups = scored.slice(1).map((s) => s.row)

    // Refuse to auto-merge if the canonical itself looks low-quality (placeholder,
    // discovered stub, ATS subdomain). Nothing good comes from picking a junk row
    // as the survivor — flag the cluster for manual review instead.
    const canonicalIsBad = isLowQuality(canonical)

    const canonHost = hostOf(canonical.domain)
    const canonIsEduOrGov =
      canonical.domain.toLowerCase().endsWith(".edu") ||
      canonical.domain.toLowerCase().endsWith(".gov")
    const canonBrand = brandToken(canonical.domain, canonical.ats_identifier)
    const realRows = rows.filter((r) => !isLowQuality(r))

    // The survivor's host must anchor to its own brand token — guards against a
    // mis-attached generic domain (e.g. "1021 Creative" whose ats_identifier is
    // "1021creative" but whose domain is the unrelated creative.com). When the
    // brand token comes from the host itself this is trivially true; it only
    // trips when an ATS identifier says one brand and the domain says another.
    const canonHostAnchored =
      canonBrand !== null &&
      (canonBrand.startsWith(canonHost) || canonHost.startsWith(canonBrand))

    // PATH 1 — ATS/placeholder consolidation: the cluster has exactly ONE
    // real-looking domain (the canonical) and every dup is a low-quality row
    // whose brand token EXACTLY matches the canonical's. The exact-token gate is
    // what keeps brand-token clustering from bridging different companies that
    // merely share a short prefix (abacus.co ✗ abacus.bamboohr.com-of-Abacus-Wealth):
    // such clusters carry a second real domain → realRows.length > 1 → not path1.
    //
    // A shared ATS tenant token alone is NOT proof of same employer — distinct
    // companies collide on it ("Bluestone Lane" ✗ "blueStone Solutions Group",
    // both tenant "bluestone"). So auto-merge additionally requires every dup to
    // share the canonical's exact normalized NAME. Abbreviation↔fullname pairs
    // (Wgu ↔ Western Governors University) and cross-company collisions then fall
    // to the review bucket — surfaced by brand-token clustering, but not merged.
    const path1 =
      realRows.length === 1 &&
      canonBrand !== null &&
      canonHostAnchored &&
      dups.every((d) => isLowQuality(d)) &&
      dups.every((d) => brandToken(d.domain, d.ats_identifier) === canonBrand) &&
      dups.every((d) => !!d.slug && d.slug === canonical.slug)

    // PATH 2 — same-company mangled domain: the dup shares the canonical's exact
    // normalized NAME and is a longer host that bakes the brand in
    // (andurilindustries.com vs anduril.com) or a long spelled-out .com against an
    // edu/gov canonical. Requiring an exact name-slug match stops brand-token
    // links to differently-named companies from auto-merging.
    //
    // Guard against a mis-attached canonical domain (e.g. "1021 Creative" sitting
    // on creative.com): the survivor's host must anchor to the company name —
    // one of {host, name-slug} is a prefix of the other. Without this, the
    // low-quality-dup fallback below would merge real jobs onto a wrong domain.
    const canonNameAnchored =
      !!canonical.slug &&
      (canonical.slug.startsWith(canonHost) || canonHost.startsWith(canonical.slug))
    const path2 =
      canonNameAnchored &&
      dups.every((d) => {
        if (!d.slug || d.slug !== canonical.slug) return false
        const dHost = hostOf(d.domain)
        if (dHost.length - canonHost.length >= 6 && dHost.includes(canonHost)) return true
        if (canonIsEduOrGov && d.domain.toLowerCase().endsWith(".com") && dHost.length >= 15) return true
        return isLowQuality(d)
      })

    clusters.push({
      slug,
      rows,
      canonical,
      dups,
      ambiguous: canonicalIsBad || !(path1 || path2),
      pathway: canonicalIsBad ? null : path1 ? "ats" : path2 ? "mangle" : null,
    })
  }

  return clusters.sort((a, b) => a.slug.localeCompare(b.slug))
}

async function mergeOne(
  pool: ReturnType<typeof getPostgresPool>,
  canonicalId: string,
  dupId: string
): Promise<{ moved: number; deleted: number; migratedConfig: boolean }> {
  const client = await pool.connect()
  let moved = 0
  let deleted = 0
  let migratedConfig = false
  try {
    await client.query("BEGIN")

    // Harvest-config migration: the real-brand-domain canonical often has
    // ats_type set but NO ats_identifier/direct_ats_url (it falls back to a weak
    // custom crawl), while the low-quality dup carries the working ATS tenant.
    // Copy that config onto the canonical so deactivating the dup doesn't stop
    // the only real crawl. Only fires when the canonical has no usable config
    // and the dup does. careers_url stays the canonical's brand page when set
    // (the claim query also matches on direct_ats_url).
    const cfg = await client.query(
      `UPDATE companies can SET
          careers_url         = COALESCE(NULLIF(can.careers_url, ''), dup.careers_url),
          direct_ats_url      = dup.direct_ats_url,
          direct_ats_provider = dup.direct_ats_provider,
          ats_type            = COALESCE(NULLIF(can.ats_type, ''), dup.ats_type),
          ats_identifier      = dup.ats_identifier,
          raw_ats_config      = dup.raw_ats_config,
          next_harvest_at     = NOW(),
          updated_at          = NOW()
         FROM companies dup
        WHERE can.id = $1 AND dup.id = $2
          AND COALESCE(NULLIF(can.ats_identifier, ''), '') = ''
          AND COALESCE(NULLIF(can.direct_ats_url, ''), '') = ''
          AND COALESCE(NULLIF(dup.ats_identifier, ''), NULLIF(dup.direct_ats_url, ''), '') <> ''`,
      [canonicalId, dupId]
    )
    migratedConfig = (cfg.rowCount ?? 0) > 0

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
              next_harvest_at = NULL,
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

  return { moved, deleted, migratedConfig }
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
  const review = clusters.filter((c) => c.ambiguous)
  const autoAll = clusters.filter((c) => !c.ambiguous)
  // Apply execution filters (used both for reporting and the actual merge set).
  const auto = autoAll.filter((c) => {
    if (atsOnly && c.pathway !== "ats") return false
    if (minDupJobs > 0 && c.dups.reduce((s, d) => s + d.job_count, 0) < minDupJobs) return false
    return true
  })

  const filterDesc = `${atsOnly ? " ats-only" : ""}${minDupJobs > 0 ? ` min-dup-jobs=${minDupJobs}` : ""}`
  console.log(
    `[dedupe-name] mode=${execute ? "execute" : "dry-run"}${filterDesc} clusters_total=${clusters.length} auto_total=${autoAll.length} auto_selected=${auto.length} need_review=${review.length}`
  )

  const printLimit = args.includes("--print-all") ? auto.length : 40
  console.log("\n── Auto-mergeable (low-quality dup → real canonical) ────────")
  for (const c of auto.slice(0, printLimit)) {
    const dupDesc = c.dups.map((d) => `${d.name} [${d.domain}, ${d.job_count}j]`).join(" + ")
    console.log(`  ${c.canonical.name} [${c.canonical.domain}, ${c.canonical.job_count}j]  ←  ${dupDesc}`)
  }
  if (auto.length > printLimit) console.log(`  …and ${auto.length - printLimit} more`)

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
  let totalConfigMigrated = 0
  const canonicalIds = new Set<string>()
  for (const c of auto) {
    for (const dup of c.dups) {
      try {
        const r = await mergeOne(pool, c.canonical.id, dup.id)
        merged += 1
        totalMoved += r.moved
        totalDeleted += r.deleted
        if (r.migratedConfig) totalConfigMigrated += 1
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
    `\n[dedupe-name] merging done merged=${merged} jobs_moved=${totalMoved} jobs_deleted_as_dupes=${totalDeleted} harvest_config_migrated=${totalConfigMigrated}`
  )

  await refreshJobCounts(pool, [...canonicalIds])
  console.log(`[dedupe-name] refreshed job_count on ${canonicalIds.size} canonicals`)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

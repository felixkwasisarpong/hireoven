/**
 * Discover Greenhouse tenants by probing the Greenhouse Job Board API.
 *
 * Greenhouse customers expose their job board at
 *   https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
 * with `slug` = the customer's tenant identifier. crt.sh can't see these
 * because Greenhouse serves them all from boards-api.greenhouse.io rather
 * than per-tenant subdomains.
 *
 * Strategy: build a wordlist from existing seed files + active company names
 * in the DB, generate 1-3 slug variants per candidate, probe each. A 200
 * response is a real tenant; 404 isn't. Inserted rows get ats_type='greenhouse',
 * ats_identifier=slug, freshness_tier='tier_2' (warm up before jumping to
 * tier_1 — maintenance.ts will promote real performers on its next pass).
 *
 *   npx tsx scripts/discover-greenhouse-tenants.ts            # dry-run
 *   npx tsx scripts/discover-greenhouse-tenants.ts --execute
 *   npx tsx scripts/discover-greenhouse-tenants.ts --execute --concurrency=20
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { appendFileSync, writeFileSync, existsSync, readFileSync } from "node:fs"

loadEnvConfig(process.cwd())

import { Pool } from "pg"

const args = process.argv.slice(2)
const execute = args.includes("--execute")
const concurrency = Math.max(
  1,
  Number.parseInt(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? "4", 10)
)
const limit = Number.parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "", 10)
const CAP = Number.isFinite(limit) && limit > 0 ? limit : Infinity
// Per-request stagger so we don't trip Greenhouse's CloudFront WAF.
// Empirically: 22k probes at concurrency=16 with 0 stagger gets us 403'd
// after ~20 minutes. Default to 100ms stagger + concurrency 4 = ~25 req/sec
// which AWS WAF tends to tolerate.
const stagger = Number.parseInt(args.find((a) => a.startsWith("--stagger-ms="))?.split("=")[1] ?? "100", 10)
const CHECKPOINT = args.find((a) => a.startsWith("--checkpoint="))?.split("=")[1]
  ?? `/tmp/greenhouse-hits-${Date.now()}.csv`

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set in env — aborting")
  process.exit(1)
}

const PROBE_TIMEOUT_MS = 6_000

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
}

function slugifyHyphen(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function generateCandidates(name: string): string[] {
  const variants = new Set<string>()
  const cleaned = name
    .replace(/\b(incorporated|inc|l\.?l\.?c\.?|llp|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|solutions|services|systems|us|usa|america|americas)\b/gi, " ")
    .replace(/[,()&]/g, " ")
    .trim()

  variants.add(slugify(cleaned))
  variants.add(slugifyHyphen(cleaned))
  // First word only (e.g., "Acme Corp" → "acme")
  const firstWord = cleaned.split(/\s+/)[0]
  if (firstWord) {
    variants.add(slugify(firstWord))
  }
  // Full original
  variants.add(slugify(name))

  // Slug minimum length 2, max length 60 — Greenhouse uses fairly normal slugs.
  return Array.from(variants).filter((s) => s.length >= 2 && s.length <= 60)
}

async function probeGreenhouse(slug: string): Promise<{ ok: boolean; status: number } > {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=false`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: {
        "user-agent": "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)",
        accept: "application/json",
      },
    })
    try { await res.arrayBuffer() } catch { /* drain */ }
    clearTimeout(t)
    return { ok: res.status === 200, status: res.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadCandidateNames(pool: Pool): Promise<string[]> {
  const seeds = new Set<string>()

  // From the in-repo seed files. Each row is a [name, ...] tuple.
  const seedModules = [
    "./data/company-seeds-expansion",
    "./data/company-seeds-f2000-us",
    "./data/company-seeds",
    "./data/enterprise-ats-seeds",
    "./data/tech-brand-seeds",
    "./data/workday-tenant-seeds",
  ]
  for (const mod of seedModules) {
    try {
      const m: Record<string, unknown> = await import(mod)
      for (const value of Object.values(m)) {
        if (!Array.isArray(value)) continue
        for (const row of value as unknown[]) {
          if (Array.isArray(row) && typeof row[0] === "string") {
            seeds.add(row[0])
          }
        }
      }
    } catch (err) {
      console.warn(`[discover-greenhouse] couldn't load ${mod}: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Add active company NAMES from the DB (so we can find existing companies
  // that have a Greenhouse board we don't know about yet).
  const dbRows = await pool.query<{ name: string }>(
    `SELECT name FROM companies
      WHERE is_active = true
        AND duplicate_of_company_id IS NULL
        AND (ats_type IS NULL OR ats_type != 'greenhouse')`
  )
  for (const r of dbRows.rows) seeds.add(r.name)

  return Array.from(seeds)
}

async function loadKnownGreenhouseSlugs(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_identifier: string | null }>(
    `SELECT ats_identifier FROM companies
      WHERE ats_type = 'greenhouse'
        AND ats_identifier IS NOT NULL`
  )
  return new Set(rows.map((r) => (r.ats_identifier ?? "").toLowerCase()).filter(Boolean))
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  console.log("[discover-greenhouse] loading candidate names …")
  const names = await loadCandidateNames(pool)
  const knownSlugs = await loadKnownGreenhouseSlugs(pool)

  // Build a unique candidate slug list, attaching the source name for the
  // insert step (we keep the first name that produced each slug).
  const slugToName = new Map<string, string>()
  for (const name of names) {
    for (const slug of generateCandidates(name)) {
      if (knownSlugs.has(slug)) continue
      if (!slugToName.has(slug)) slugToName.set(slug, name)
    }
  }
  const candidates = Array.from(slugToName.keys()).slice(0, CAP === Infinity ? undefined : CAP)

  // Resume: read previously-found hits from the checkpoint file (if any).
  const previouslyFound = new Set<string>()
  if (existsSync(CHECKPOINT)) {
    const csv = readFileSync(CHECKPOINT, "utf8").split("\n").slice(1)
    for (const line of csv) {
      const slug = line.split(",")[0]?.trim()
      if (slug) previouslyFound.add(slug)
    }
    console.log(`[discover-greenhouse] resuming from ${CHECKPOINT} (${previouslyFound.size} known hits)`)
  } else {
    writeFileSync(CHECKPOINT, "slug,name\n")
  }

  console.log(
    `[discover-greenhouse] names=${names.length} known=${knownSlugs.size} unique candidates=${candidates.length} mode=${execute ? "execute" : "dry-run"} concurrency=${concurrency} stagger=${stagger}ms`
  )
  console.log(`[discover-greenhouse] checkpoint csv: ${CHECKPOINT}`)

  const limiter = pLimit(concurrency)
  let processed = 0
  let hits = previouslyFound.size
  let inserted = 0
  let blocked403 = 0
  const newSlugs: Array<{ slug: string; name: string }> = []

  // Pre-load already-discovered hits from checkpoint so we can insert them
  // even if the network later blocks us mid-run.
  for (const slug of previouslyFound) {
    newSlugs.push({ slug, name: slugToName.get(slug) ?? slug })
  }

  await Promise.all(
    candidates.map((slug) =>
      limiter(async () => {
        if (previouslyFound.has(slug)) return
        if (stagger > 0) await sleep(stagger)

        processed += 1
        const { ok, status } = await probeGreenhouse(slug)
        if (!ok) {
          if (status === 403 || status === 406 || status === 429) blocked403 += 1
          if (processed % 250 === 0) {
            console.log(
              `  progress: ${processed}/${candidates.length} hits=${hits} blocked=${blocked403}`
            )
          }
          return
        }
        hits += 1
        const name = slugToName.get(slug) ?? slug
        newSlugs.push({ slug, name })
        appendFileSync(
          CHECKPOINT,
          `${slug},${name.replace(/"/g, "'").replace(/,/g, ";")}\n`
        )

        if (processed % 50 === 0) {
          console.log(
            `  progress: ${processed}/${candidates.length} hits=${hits} blocked=${blocked403}`
          )
        }
      })
    )
  )

  console.log(
    `\n[discover-greenhouse] probed=${processed} hits=${hits} blocked=${blocked403}`
  )
  if (blocked403 > processed * 0.5 && blocked403 > 50) {
    console.warn(
      `[discover-greenhouse] ⚠ ${blocked403} of ${processed} probes returned 403/406/429 — your IP is being WAF-throttled. Run from a different egress (Coolify prod) or wait a few hours.`
    )
  }

  if (!execute) {
    console.log("\nDry-run only. Use --execute to insert. Sample hits:")
    for (const h of newSlugs.slice(0, 20)) console.log(`  ${h.slug}  (${h.name})`)
    await pool.end()
    return
  }

  // Bulk insert. Skip rows whose careers_url would collide with an existing
  // company (rare since we already filtered known greenhouse slugs).
  for (const { slug, name } of newSlugs) {
    const careersUrl = `https://boards.greenhouse.io/${slug}`
    const domain = `${slug}.greenhouse-discovered`  // placeholder; harvester will refine later via job posting metadata
    try {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO companies
           (name, domain, careers_url, ats_type, ats_identifier,
            is_active, status, freshness_tier, discovered_via, next_harvest_at)
         VALUES ($1, $2, $3, 'greenhouse', $4, true, 'active', 'tier_2',
                 'greenhouse-job-board-probe', now())
         ON CONFLICT (domain) DO NOTHING
         RETURNING id`,
        [name, domain, careersUrl, slug]
      )
      if (r.rowCount && r.rowCount > 0) inserted += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[discover-greenhouse] insert failed for ${slug} (${name}): ${msg}`)
    }
  }

  console.log(`\n[discover-greenhouse] inserted=${inserted}/${hits}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

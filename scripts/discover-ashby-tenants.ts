/**
 * Discover Ashby tenants by probing the public job-board API.
 *
 * Ashby's posting endpoint is open + cacheable but slow (~15-20s typical for
 * any board with >50 jobs). Critically — unlike Greenhouse — Ashby does NOT
 * sit behind a CloudFront WAF that blocks rapid probes. An IP can probe
 * thousands of slugs without earning a 403.
 *
 * The bottleneck is response latency, not throttling. We accept that and
 * tune for it:
 *   - concurrency=8 by default (matches harvester per-instance default)
 *   - 30s per-probe timeout (covers the slow-but-legit 17.6s avg success)
 *   - No artificial stagger — the API's own latency provides natural pacing
 *   - Checkpoint CSV so a multi-hour run survives interrupts/blocks
 *   - Auto-abort if >20% of recent probes return 403/429/5xx (WAF signature)
 *
 * Default wordlist is the in-repo seed files only (~1,700 candidates,
 * ~90-minute run). Pass --wordlist=full to also include active company
 * names from the DB (~22,000 candidates, ~12-hour run — run overnight).
 *
 *   npx tsx scripts/discover-ashby-tenants.ts                   # dry-run, seeds-only
 *   npx tsx scripts/discover-ashby-tenants.ts --execute
 *   npx tsx scripts/discover-ashby-tenants.ts --execute --wordlist=full
 *   npx tsx scripts/discover-ashby-tenants.ts --execute --concurrency=4 --stagger-ms=200
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
  Number.parseInt(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? "8", 10)
)
const stagger = Math.max(
  0,
  Number.parseInt(args.find((a) => a.startsWith("--stagger-ms="))?.split("=")[1] ?? "0", 10)
)
const wordlist = (args.find((a) => a.startsWith("--wordlist="))?.split("=")[1] ?? "seeds") as
  "seeds" | "full"
const cap = Number.parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "", 10)
const CAP = Number.isFinite(cap) && cap > 0 ? cap : Infinity
const CHECKPOINT = args.find((a) => a.startsWith("--checkpoint="))?.split("=")[1]
  ?? `/tmp/ashby-hits-${Date.now()}.csv`

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set in env — aborting")
  process.exit(1)
}

const PROBE_TIMEOUT_MS = 30_000
// Auto-abort if a sliding window of this many recent probes has more than
// this fraction returning a WAF-like status.
const WAF_WINDOW = 100
const WAF_THRESHOLD = 0.2

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
  const firstWord = cleaned.split(/\s+/)[0]
  if (firstWord) variants.add(slugify(firstWord))
  variants.add(slugify(name))

  return Array.from(variants).filter((s) => s.length >= 2 && s.length <= 60)
}

async function probeAshby(slug: string): Promise<{ ok: boolean; status: number }> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`
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

async function loadCandidateNames(pool: Pool, mode: "seeds" | "full"): Promise<string[]> {
  const seeds = new Set<string>()

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
      console.warn(`[discover-ashby] couldn't load ${mod}: ${err instanceof Error ? err.message : err}`)
    }
  }

  if (mode === "full") {
    const dbRows = await pool.query<{ name: string }>(
      `SELECT name FROM companies
        WHERE is_active = true
          AND duplicate_of_company_id IS NULL
          AND (ats_type IS NULL OR ats_type != 'ashby')`
    )
    for (const r of dbRows.rows) seeds.add(r.name)
  }

  return Array.from(seeds)
}

async function loadKnownAshbySlugs(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ ats_identifier: string | null }>(
    `SELECT ats_identifier FROM companies
      WHERE ats_type = 'ashby' AND ats_identifier IS NOT NULL`
  )
  return new Set(rows.map((r) => (r.ats_identifier ?? "").toLowerCase()).filter(Boolean))
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  console.log(`[discover-ashby] mode=${execute ? "execute" : "dry-run"} wordlist=${wordlist} concurrency=${concurrency} stagger=${stagger}ms`)

  const names = await loadCandidateNames(pool, wordlist)
  const knownSlugs = await loadKnownAshbySlugs(pool)

  const slugToName = new Map<string, string>()
  for (const name of names) {
    for (const slug of generateCandidates(name)) {
      if (knownSlugs.has(slug)) continue
      if (!slugToName.has(slug)) slugToName.set(slug, name)
    }
  }
  const candidates = Array.from(slugToName.keys()).slice(0, CAP === Infinity ? undefined : CAP)

  // Resume from checkpoint if present.
  const previouslyFound = new Set<string>()
  if (existsSync(CHECKPOINT)) {
    const csv = readFileSync(CHECKPOINT, "utf8").split("\n").slice(1)
    for (const line of csv) {
      const slug = line.split(",")[0]?.trim()
      if (slug) previouslyFound.add(slug)
    }
    console.log(`[discover-ashby] resuming from ${CHECKPOINT} (${previouslyFound.size} prior hits)`)
  } else {
    writeFileSync(CHECKPOINT, "slug,name\n")
  }

  console.log(`[discover-ashby] names=${names.length} known=${knownSlugs.size} candidates=${candidates.length}`)
  console.log(`[discover-ashby] checkpoint csv: ${CHECKPOINT}`)
  console.log(`[discover-ashby] timeout=${PROBE_TIMEOUT_MS}ms — expect this to take a while`)

  const limiter = pLimit(concurrency)
  let processed = 0
  let hits = previouslyFound.size
  let inserted = 0
  let timeouts = 0
  const recentStatuses: number[] = []
  let aborted = false
  const newSlugs: Array<{ slug: string; name: string }> = []
  for (const slug of previouslyFound) {
    newSlugs.push({ slug, name: slugToName.get(slug) ?? slug })
  }

  await Promise.all(
    candidates.map((slug) =>
      limiter(async () => {
        if (aborted) return
        if (previouslyFound.has(slug)) return
        if (stagger > 0) await sleep(stagger)

        processed += 1
        const { ok, status } = await probeAshby(slug)

        // Track recent status window for WAF detection.
        recentStatuses.push(status)
        if (recentStatuses.length > WAF_WINDOW) recentStatuses.shift()
        const wafLike = recentStatuses.filter((s) => s === 403 || s === 429 || (s >= 500 && s < 600)).length
        if (recentStatuses.length === WAF_WINDOW && wafLike / WAF_WINDOW > WAF_THRESHOLD && !aborted) {
          aborted = true
          console.warn(
            `\n[discover-ashby] ⚠ ${wafLike}/${WAF_WINDOW} of the last probes returned 403/429/5xx — aborting to avoid IP block. Resume later with --checkpoint=${CHECKPOINT}`
          )
          return
        }

        if (!ok) {
          if (status === 0) timeouts += 1
          if (processed % 100 === 0) {
            console.log(`  progress: ${processed}/${candidates.length} hits=${hits} timeouts=${timeouts} blocked=${wafLike}`)
          }
          return
        }

        hits += 1
        const name = slugToName.get(slug) ?? slug
        newSlugs.push({ slug, name })
        appendFileSync(CHECKPOINT, `${slug},${name.replace(/"/g, "'").replace(/,/g, ";")}\n`)

        if (processed % 50 === 0) {
          console.log(`  progress: ${processed}/${candidates.length} hits=${hits} timeouts=${timeouts}`)
        }
      })
    )
  )

  console.log(`\n[discover-ashby] probed=${processed} hits=${hits} timeouts=${timeouts}${aborted ? " (ABORTED on WAF signature)" : ""}`)

  if (!execute) {
    console.log("\nDry-run only. Use --execute to insert. Sample hits:")
    for (const h of newSlugs.slice(0, 20)) console.log(`  ${h.slug}  (${h.name})`)
    await pool.end()
    return
  }

  for (const { slug, name } of newSlugs) {
    const careersUrl = `https://jobs.ashbyhq.com/${slug}`
    const domain = `${slug}.ashby-discovered`
    try {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO companies
           (name, domain, careers_url, ats_type, ats_identifier,
            is_active, status, freshness_tier, discovered_via, next_harvest_at)
         VALUES ($1, $2, $3, 'ashby', $4, true, 'active', 'tier_2',
                 'ashby-job-board-probe', now())
         ON CONFLICT (domain) DO NOTHING
         RETURNING id`,
        [name, domain, careersUrl, slug]
      )
      if (r.rowCount && r.rowCount > 0) inserted += 1
    } catch (err) {
      console.warn(`[discover-ashby] insert failed for ${slug}: ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log(`\n[discover-ashby] inserted=${inserted}/${hits}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

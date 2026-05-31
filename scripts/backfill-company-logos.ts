/**
 * Backfill companies.logo_url using logo.dev as the primary source.
 *
 * Why: ~67% of active companies have NULL logo_url, leaving emails (which lack
 * a fallback chain) showing broken images, and forcing the web UI to wait two
 * favicon-service hops before deriving a working URL. Logo.dev has far better
 * coverage than the duckduckgo/google favicon services and the token is
 * already provisioned.
 *
 * Logic per row:
 *   - HEAD https://img.logo.dev/{domain}?token=...
 *   - 200 → real logo, store the URL
 *   - 202 → placeholder/initials; leave NULL so the frontend chain still runs
 *   - non-2xx → leave NULL
 *
 * Usage:
 *   npx tsx scripts/backfill-company-logos.ts                        # dry-run
 *   npx tsx scripts/backfill-company-logos.ts --execute               # apply
 *   npx tsx scripts/backfill-company-logos.ts --execute --limit=500   # smaller chunk
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const execute = args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "10000", 10))
const concurrency = Math.max(1, Number.parseInt(getArg("--concurrency=") ?? "16", 10))
const timeoutMs = Math.max(2000, Number.parseInt(getArg("--timeout-ms=") ?? "8000", 10))

const TOKEN =
  process.env.LOGO_DEV_TOKEN ||
  process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ||
  ""

if (!TOKEN) {
  console.error("LOGO_DEV_TOKEN not set in env — aborting")
  process.exit(1)
}

type Row = { id: string; name: string; domain: string }

/**
 * Some rows carry a "apex-placeholder" suffix (e.g. "warnerbros.apex-placeholder")
 * meaning we discovered the company but never resolved the real domain. Strip the
 * suffix and assume `.com` so logo.dev has a fighting chance.
 */
function probeDomainFor(rawDomain: string): string {
  const d = rawDomain.toLowerCase().trim()
  if (d.endsWith(".apex-placeholder")) return d.replace(/\.apex-placeholder$/, ".com")
  return d
}

function isObviouslyBadDomain(d: string): boolean {
  const t = d.toLowerCase().trim()
  if (!t || t.length < 4) return true
  if (t.includes(".placeholder")) return true
  if (t.includes(" ")) return true
  if (!/\./.test(t)) return true
  return false
}

async function probeLogoDev(domain: string): Promise<"hit" | "placeholder" | "fail"> {
  // logo.dev's CDN responds 404 to HEAD requests even for cached/valid logos,
  // so we have to use GET. We drain the body but ignore it.
  const url = `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(TOKEN)}`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { method: "GET", signal: ctrl.signal })
    // Eagerly consume body so the connection can be reused.
    try { await res.arrayBuffer() } catch {}
    clearTimeout(t)
    if (res.status === 200) return "hit"
    if (res.status === 202) return "placeholder"
    return "fail"
  } catch {
    return "fail"
  }
}

async function loadCandidates(pool: ReturnType<typeof getPostgresPool>): Promise<Row[]> {
  // Targets: rows with no logo, OR a logo from a free favicon service we know
  // 404s frequently (duckduckgo, google favicon). Skip ATS-host domains (smartrecruiters
  // tenants, *.wdN.myworkdayjobs.com, etc.) — they're discovery noise, not real
  // employer domains, and logo.dev can't resolve a logo from them.
  const { rows } = await pool.query<Row>(
    `SELECT id, name, domain
       FROM companies
      WHERE is_active = true
        AND duplicate_of_company_id IS NULL
        AND (
          logo_url IS NULL
          OR btrim(logo_url) = ''
          OR logo_url ILIKE '%icons.duckduckgo.com/ip3/%'
          OR logo_url ILIKE '%www.google.com/s2/favicons%'
        )
        AND domain IS NOT NULL
        AND btrim(domain) <> ''
        AND domain NOT ILIKE '%.placeholder'
        AND domain NOT ILIKE '%.greenhouse.io'
        AND domain NOT ILIKE '%.lever.co'
        AND domain NOT ILIKE '%.ashbyhq.com'
        AND domain NOT ILIKE '%.smartrecruiters.com'
        AND domain NOT ILIKE '%.workable.com'
        AND domain NOT ILIKE '%.icims.com'
        AND domain NOT ILIKE '%.bamboohr.com'
        AND domain NOT ILIKE '%.recruitee.com'
        AND domain NOT ILIKE '%.teamtailor.com'
        AND domain NOT ILIKE '%.applytojob.com'
        AND domain !~* '\\.wd[0-9]+\\.myworkdayjobs\\.com$'
      ORDER BY
        CASE COALESCE(freshness_tier, 'tier_2')
          WHEN 'tier_1' THEN 0
          WHEN 'tier_2' THEN 1
          WHEN 'tier_3' THEN 2
          ELSE 3
        END,
        last_crawled_at DESC NULLS LAST
      LIMIT $1`,
    [limit]
  )
  return rows.filter((r) => !isObviouslyBadDomain(r.domain))
}

async function main() {
  const pool = getPostgresPool()
  process.on("unhandledRejection", (reason) => {
    console.warn("[backfill-logos] unhandledRejection swallowed:", reason)
  })
  pool.on("error", (err) => {
    console.warn("[backfill-logos] idle pg client error:", err.message)
  })

  const candidates = await loadCandidates(pool)
  console.log(
    `[backfill-logos] mode=${execute ? "execute" : "dry-run"} concurrency=${concurrency} candidates=${candidates.length}`
  )
  if (candidates.length === 0) return

  const limiter = pLimit(concurrency)
  let hits = 0
  let placeholders = 0
  let fails = 0
  let processed = 0

  await Promise.all(
    candidates.map((row) =>
      limiter(async () => {
        processed += 1
        const probeDomain = probeDomainFor(row.domain)
        const outcome = await probeLogoDev(probeDomain)
        if (outcome === "hit") {
          hits += 1
          if (execute) {
            const url = `https://img.logo.dev/${encodeURIComponent(probeDomain)}?token=${encodeURIComponent(TOKEN)}`
            await pool
              .query(
                `UPDATE companies SET logo_url = $1, updated_at = now() WHERE id = $2`,
                [url, row.id]
              )
              .catch((err) =>
                console.warn(`[backfill-logos] update failed for ${row.id}:`, err.message)
              )
          }
        } else if (outcome === "placeholder") {
          placeholders += 1
        } else {
          fails += 1
        }
        if (processed % 500 === 0) {
          console.log(
            `[backfill-logos] progress=${processed}/${candidates.length} hits=${hits} placeholders=${placeholders} fails=${fails}`
          )
        }
      })
    )
  )

  console.log(
    `[backfill-logos] done hits=${hits} placeholders=${placeholders} fails=${fails} processed=${processed}`
  )
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * One-off: for rows where `companies.domain` is an ATS tenant subdomain
 * (e.g. `salesforce.wd12.myworkdayjobs.com`), derive a brand domain
 * (`salesforce.com`) and replace the favicon-CDN logo_url with a logo.dev URL
 * when logo.dev has a real mark.
 *
 * Targets the rows the main backfill skips because their domain is ATS-hosted.
 *
 * Usage:
 *   npx tsx scripts/backfill-ats-domain-logos.ts          # dry-run
 *   npx tsx scripts/backfill-ats-domain-logos.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const execute = args.includes("--execute")

const TOKEN =
  process.env.LOGO_DEV_TOKEN ||
  process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ||
  ""

if (!TOKEN) {
  console.error("LOGO_DEV_TOKEN not set in env — aborting")
  process.exit(1)
}

type Row = { id: string; name: string; domain: string }

function brandDomainFromAts(domain: string): string | null {
  const d = domain.toLowerCase().trim()
  // {brand}.wdN.myworkdayjobs.com → {brand}.com
  const wd = d.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/)
  if (wd?.[1]) return `${wd[1]}.com`
  // {brand}.applytojob.com → {brand}.com
  const atj = d.match(/^([a-z0-9-]+)\.applytojob\.com$/)
  if (atj?.[1]) return `${atj[1]}.com`
  return null
}

async function probeLogoDev(domain: string): Promise<boolean> {
  const url = `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(TOKEN)}`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, { method: "GET", signal: ctrl.signal })
    try { await res.arrayBuffer() } catch {}
    clearTimeout(t)
    return res.status === 200
  } catch {
    return false
  }
}

async function main() {
  const pool = getPostgresPool()
  const { rows } = await pool.query<Row>(
    `SELECT id, name, domain
       FROM companies
      WHERE is_active = true
        AND duplicate_of_company_id IS NULL
        AND logo_url ILIKE 'https://icons.duckduckgo.com%'
        AND (
          domain ~* '\\.wd[0-9]+\\.myworkdayjobs\\.com$'
          OR domain ILIKE '%.applytojob.com'
        )`
  )

  console.log(
    `[backfill-ats-logos] mode=${execute ? "execute" : "dry-run"} candidates=${rows.length}`
  )

  const limiter = pLimit(12)
  let hits = 0
  let fails = 0

  await Promise.all(
    rows.map((row) =>
      limiter(async () => {
        const brand = brandDomainFromAts(row.domain)
        if (!brand) {
          fails += 1
          return
        }
        const ok = await probeLogoDev(brand)
        if (!ok) {
          fails += 1
          return
        }
        hits += 1
        const url = `https://img.logo.dev/${encodeURIComponent(brand)}?token=${encodeURIComponent(TOKEN)}`
        if (execute) {
          await pool
            .query(
              `UPDATE companies SET logo_url = $1, updated_at = now() WHERE id = $2`,
              [url, row.id]
            )
            .catch((err) =>
              console.warn(`[backfill-ats-logos] update failed for ${row.id}:`, err.message)
            )
        } else {
          console.log(`  would update ${row.name}: ${row.domain} → ${brand}`)
        }
      })
    )
  )

  console.log(`[backfill-ats-logos] done hits=${hits} fails=${fails}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

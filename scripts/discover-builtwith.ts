/**
 * BuiltWith / Wappalyzer domain → ATS discovery.
 *
 *   # from a flat domain list (one per line; `#` comments / CSV ok)
 *   npx tsx scripts/discover-builtwith.ts --file=greenhouse-domains.txt
 *   cat domains.txt | npx tsx scripts/discover-builtwith.ts --stdin --execute
 *
 *   # straight from the BuiltWith Lists API (needs BUILTWITH_API_KEY)
 *   npx tsx scripts/discover-builtwith.ts --tech=Greenhouse --execute
 *
 * For each domain we find the careers page and either (a) enroll a concrete
 * adapter-matched ATS URL via enrollFromApplyUrl() — same path as the Dice /
 * JSearch aggregators — or (b) insert a typed placeholder company
 * (discovered_via='builtwith:<tech>') for a later tenant-resolution pass.
 * Dry-run by default; pass --execute to write.
 */

import fs from "node:fs"
import { loadEnvConfig } from "@next/env"
import type { Pool } from "pg"
import {
  fetchBuiltWithDomains,
  parseDomainList,
  resolveDomainAts,
} from "@/lib/harvester/discovery/builtwith-feeder"
import { enrollFromApplyUrl } from "@/lib/harvester/discovery/enroll-from-apply-url"
import { getPostgresPool } from "@/lib/postgres/server"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = !args.includes("--execute")
const useStdin = args.includes("--stdin")
const fileArg = args.find((a) => a.startsWith("--file="))?.slice("--file=".length)
const techArg = args.find((a) => a.startsWith("--tech="))?.slice("--tech=".length)
const limitArg = args.find((a) => a.startsWith("--limit="))
const limit = limitArg ? Math.max(1, Number(limitArg.slice("--limit=".length))) : Infinity
const concurrency = Math.max(
  1,
  Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? "8")
)
const source = techArg ? `builtwith:${techArg.toLowerCase()}` : "builtwith:list"
const PROBE_TIMEOUT_MS = 8_000

const probe = async ({ url, signal }: { url: string; signal?: AbortSignal }) => {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; HireovenAtsDiscovery/1.0; +https://hireoven.com)",
      },
    })
    const html = res.ok ? await res.text() : null
    return { ok: res.ok, status: res.status, html }
  } catch {
    return { ok: false, status: null, html: null }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

function titleCaseFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
}

async function loadDomains(): Promise<string[]> {
  if (techArg) {
    const apiKey = process.env.BUILTWITH_API_KEY?.trim()
    if (!apiKey) throw new Error("--tech requires BUILTWITH_API_KEY in the environment")
    const all: string[] = []
    let offset: string | undefined
    do {
      const { domains, nextOffset } = await fetchBuiltWithDomains({ tech: techArg, apiKey, offset })
      all.push(...domains)
      offset = nextOffset ?? undefined
    } while (offset && all.length < limit)
    return all
  }
  if (fileArg) return parseDomainList(fs.readFileSync(fileArg, "utf8"))
  if (useStdin) return parseDomainList(fs.readFileSync(0, "utf8"))
  throw new Error("provide one of --file=<path>, --stdin, or --tech=<Technology>")
}

async function insertPlaceholder(
  pool: Pool,
  args2: { domain: string; atsType: string; careersUrl: string }
): Promise<"inserted" | "known"> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM companies WHERE domain = $1 OR careers_url = $2 LIMIT 1`,
    [args2.domain, args2.careersUrl]
  )
  if (rows.length > 0) return "known"
  await pool.query(
    `INSERT INTO companies (
       name, domain, logo_url, careers_url, ats_type, ats_identifier,
       status, freshness_tier, discovered_via, is_active, raw_ats_config
     )
     VALUES ($1, $2, $3, $4, $5, NULL, 'active', 'tier_3', $6, true, $7::jsonb)
     ON CONFLICT DO NOTHING`,
    [
      titleCaseFromDomain(args2.domain),
      args2.domain,
      companyLogoUrlFromDomain(args2.domain) || null,
      args2.careersUrl,
      args2.atsType,
      source,
      JSON.stringify({ source, detected_careers_url: args2.careersUrl, slug_resolved: false }),
    ]
  )
  return "inserted"
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, max: number): Promise<T[]> {
  const results: T[] = []
  let idx = 0
  async function worker() {
    while (idx < tasks.length) {
      const current = idx++
      results.push(await tasks[current]!())
    }
  }
  await Promise.all(Array.from({ length: Math.min(max, tasks.length) }, worker))
  return results
}

async function main() {
  console.log(`[discover-builtwith] mode=${dryRun ? "dry-run" : "execute"} source=${source}`)
  const domains = (await loadDomains()).slice(0, limit === Infinity ? undefined : limit)
  console.log(`[discover-builtwith] domains to probe: ${domains.length}`)

  const pool = dryRun ? null : getPostgresPool()
  const stats = { enrolled: 0, updated: 0, placeholder: 0, known: 0, none: 0, errors: 0 }

  const tasks = domains.map((domain) => async () => {
    try {
      const res = await resolveDomainAts({ domain, probe })
      if (res.kind === "none") {
        stats.none += 1
        return
      }
      if (res.kind === "enroll") {
        console.log(`${dryRun ? "[dry-run] " : ""}${domain} -> enroll ${res.applyUrl}`)
        if (!dryRun && pool) {
          const r = await enrollFromApplyUrl(pool, {
            companyName: titleCaseFromDomain(domain),
            applyUrl: res.applyUrl,
            companyDomain: domain,
            source,
          })
          if (r?.enrolled) stats.enrolled += 1
          else if (r) stats.updated += 1
          else stats.none += 1
        }
        return
      }
      // placeholder
      console.log(`${dryRun ? "[dry-run] " : ""}${domain} -> placeholder ${res.atsType} (${res.careersUrl})`)
      if (!dryRun && pool) {
        const outcome = await insertPlaceholder(pool, {
          domain,
          atsType: res.atsType,
          careersUrl: res.careersUrl,
        })
        if (outcome === "inserted") stats.placeholder += 1
        else stats.known += 1
      }
    } catch (error) {
      stats.errors += 1
      console.error(`[discover-builtwith] error for ${domain}:`, error instanceof Error ? error.message : error)
    }
  })

  await runWithConcurrency(tasks, concurrency)
  console.log(
    `[discover-builtwith] enrolled=${stats.enrolled} updated=${stats.updated} placeholder=${stats.placeholder} known=${stats.known} none=${stats.none} errors=${stats.errors}`
  )
  if (pool) await pool.end()
}

main().catch((error) => {
  console.error("[discover-builtwith] fatal:", error)
  process.exit(1)
})

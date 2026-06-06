/**
 * Set logo_url for companies whose domain is an ATS subdomain
 * (e.g. bmo.wd3.myworkdayjobs.com, company.greenhouse.io)
 * by extracting the tenant slug and probing slug.com.
 *
 * Usage:
 *   npx tsx scripts/enrich-ats-subdomain-logos.ts
 *   npx tsx scripts/enrich-ats-subdomain-logos.ts --dry-run
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"

loadEnvConfig(process.cwd())

const DRY_RUN     = process.argv.includes("--dry-run")
const CONCURRENCY = 20
const TIMEOUT_MS  = 6_000
const LOGO_TOKEN  = process.env.LOGO_DEV_TOKEN ?? process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ?? ""

// ─── Tenant extraction ────────────────────────────────────────────────────────

function extractTenantSlug(domain: string): string | null {
  // workday: bmo.wd3.myworkdayjobs.com → bmo
  const workday = domain.match(/^([^.]+)\.wd\d+\.myworkdayjobs\.com$/i)
  if (workday) return workday[1].toLowerCase()

  // greenhouse: company.greenhouse.io → company
  const greenhouse = domain.match(/^([^.]+)\.greenhouse(?:-discovered)?\.io$/i)
    ?? domain.match(/^([^.]+)\.greenhouse-discovered$/i)
  if (greenhouse) return greenhouse[1].toLowerCase()

  // lever: company.lever.co or company.lever-discovered → company
  const lever = domain.match(/^([^.]+)\.lever(?:-discovered)?(?:\.co)?$/i)
  if (lever) return lever[1].toLowerCase()

  // ashby: company.ashbyhq.com or company.ashby-discovered → company
  const ashby = domain.match(/^([^.]+)\.ashby(?:-discovered|hq\.com)?$/i)
  if (ashby) return ashby[1].toLowerCase()

  // smartrecruiters: company.smartrecruiters-discovered → company
  const sr = domain.match(/^([^.]+)\.smartrecruiters-discovered$/i)
  if (sr) return sr[1].toLowerCase()

  // bamboohr: company.bamboohr.com or company.bamboohr-discovered → company
  const bamboo = domain.match(/^([^.]+)\.bamboohr(?:-discovered)?(?:\.com)?$/i)
  if (bamboo) return bamboo[1].toLowerCase()

  // builtin-discovery: company.builtin-discovery → company
  const builtin = domain.match(/^([^.]+)\.builtin-discovery$/i)
  if (builtin) return builtin[1].toLowerCase()

  // lca/uscis: company-name.lca-employer → company-name
  const lca = domain.match(/^([^.]+)\.(lca-employer|uscis-employer)$/i)
  if (lca) return lca[1].toLowerCase().replace(/-/g, "")

  return null
}

function slugToDomainCandidates(slug: string): string[] {
  const clean = slug.replace(/[^a-z0-9-]/g, "").replace(/-+/g, "")
  const hyphen = slug.replace(/[^a-z0-9-]/g, "")
  const candidates: string[] = []
  if (clean) candidates.push(`${clean}.com`)
  if (hyphen !== clean && hyphen) candidates.push(`${hyphen}.com`)
  return [...new Set(candidates)]
}

const ATS_HOST_RE = /\.(myworkdayjobs|greenhouse|lever|ashbyhq|smartrecruiters|bamboohr|icims|jobvite|taleo|successfactors)\.(?:com|io|co)$/i

async function probesDomain(domain: string): Promise<boolean> {
  for (const url of [`https://${domain}`, `https://www.${domain}`]) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Hireoven/1.0)" },
      })
      clearTimeout(t)
      if (res.status < 500) {
        const final = new URL(res.url ?? url)
        if (ATS_HOST_RE.test(final.hostname)) return false
        return true
      }
    } catch { /* DNS fail / timeout */ }
  }
  return false
}

// ─── Concurrency ──────────────────────────────────────────────────────────────

async function pMap<T, R>(items: T[], fn: (item: T, i: number) => Promise<R>, c: number): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: c }, worker))
  return results
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!LOGO_TOKEN) {
    throw new Error("LOGO_DEV_TOKEN or NEXT_PUBLIC_LOGO_DEV_TOKEN is required")
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const { rows } = await pool.query<{ id: string; name: string; domain: string }>(`
    SELECT id, name, domain
    FROM companies
    WHERE is_active = true
      AND (logo_url IS NULL OR logo_url = '')
      AND (
        domain LIKE '%.myworkdayjobs.com'
        OR domain LIKE '%.greenhouse.io'
        OR domain LIKE '%.greenhouse-discovered'
        OR domain LIKE '%.lever.co'
        OR domain LIKE '%.lever-discovered'
        OR domain LIKE '%.ashbyhq.com'
        OR domain LIKE '%.ashby-discovered'
        OR domain LIKE '%.smartrecruiters-discovered'
        OR domain LIKE '%.bamboohr.com'
        OR domain LIKE '%.bamboohr-discovered'
        OR domain LIKE '%.builtin-discovery'
        OR domain LIKE '%.lca-employer'
        OR domain LIKE '%.uscis-employer'
      )
    ORDER BY name
  `)

  console.log(`\nFound ${rows.length} ATS-subdomain companies without logos`)
  console.log(`Dry run: ${DRY_RUN} | Concurrency: ${CONCURRENCY}\n`)

  let resolved = 0, skipped = 0, failed = 0

  await pMap(rows, async (c, idx) => {
    const progress = `[${idx + 1}/${rows.length}]`
    const slug = extractTenantSlug(c.domain)
    if (!slug || slug.length < 2) {
      console.log(`${progress} ✗ ${c.name} (can't extract slug from ${c.domain})`)
      failed++
      return
    }

    const candidates = slugToDomainCandidates(slug)
    let resolvedDomain: string | null = null
    for (const d of candidates) {
      if (await probesDomain(d)) { resolvedDomain = d; break }
    }

    if (!resolvedDomain) {
      console.log(`${progress} ✗ ${c.name} (${slug}.com unreachable)`)
      failed++
      return
    }

    const logoUrl = `https://img.logo.dev/${resolvedDomain}?token=${LOGO_TOKEN}&size=256&format=png`
    console.log(`${progress} ✓ ${c.name} → ${resolvedDomain}`)
    resolved++

    if (!DRY_RUN) {
      try {
        await pool.query(
          `UPDATE companies SET logo_url = $1, updated_at = now() WHERE id = $2`,
          [logoUrl, c.id]
        )
      } catch (err: unknown) {
        if ((err as { code?: string }).code !== "23505") throw err
        console.log(`  ↳ skipped (conflict)`)
        skipped++
      }
    }
  }, CONCURRENCY)

  console.log(`\n── Results ──────────────────────`)
  console.log(`  Resolved : ${resolved}`)
  console.log(`  Failed   : ${failed}`)
  console.log(`  Skipped  : ${skipped}`)
  if (DRY_RUN) console.log(`  (dry run — no writes)`)

  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })

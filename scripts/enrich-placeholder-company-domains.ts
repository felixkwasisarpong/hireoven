/**
 * Resolve real domains for companies that have placeholder domains
 * (dice-*.placeholder, *.placeholder, etc.) and are missing a logo.
 *
 * Strategy:
 *   1. Strip legal suffixes from the company name to derive domain candidates.
 *   2. HTTP-probe each candidate — first to respond with a non-error status wins.
 *   3. Update companies.domain + companies.logo_url for verified companies.
 *
 * Usage:
 *   npx tsx scripts/enrich-placeholder-company-domains.ts
 *   npx tsx scripts/enrich-placeholder-company-domains.ts --dry-run
 *   npx tsx scripts/enrich-placeholder-company-domains.ts --limit=200 --concurrency=8
 *   npx tsx scripts/enrich-placeholder-company-domains.ts --dry-run --limit=50
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"

loadEnvConfig(process.cwd())

// ─── CLI flags ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const DRY_RUN     = argv.includes("--dry-run")
const limitArg    = argv.find(a => a.startsWith("--limit="))
const concArg     = argv.find(a => a.startsWith("--concurrency="))
const LIMIT       = limitArg ? Number(limitArg.split("=")[1]) : 0
const CONCURRENCY = Math.max(1, Math.min(20, Number(concArg?.split("=")[1] ?? "8")))
const PROBE_TIMEOUT_MS = 6_000
const LOGO_TOKEN  = process.env.LOGO_DEV_TOKEN ?? process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ?? ""

// ─── Legal suffix normalization ───────────────────────────────────────────────

const LEGAL_SUFFIX_RE = /[,\s]+(inc\.?|llc\.?|l\.l\.c\.?|ltd\.?|limited|corp\.?|corporation|co\.?|company|llp\.?|plc\.?|incorporated|group|holdings?|partners?|associates?|technologies|technology|solutions?|services?|systems?|consulting|staffing|international|global|usa|us|america[ns]?)\s*$/gi

// Dice/aggregator prefixes: "2846 Roche…", "6032-DePuy…", "*US AMR-Jones…"
// Only strip 4+ digit codes (J&J/Dice internal IDs) — 1-3 digit numbers are often brand names (3M, 2K, 360, 1-800)
// The *XY ZW- prefix can have spaces in the code part so match up to the last dash
const DICE_PREFIX_RE = /^(\*[^-]+-|\d{4,}[-\s])/

function cleanCompanyName(raw: string): string {
  let s = raw.trim()
  // Strip leading Dice numeric/code prefixes
  s = s.replace(DICE_PREFIX_RE, "").trim()
  // Strip legal suffixes iteratively
  let prev = ""
  while (s !== prev) {
    prev = s
    s = s.replace(LEGAL_SUFFIX_RE, "").trim()
  }
  // Remove remaining non-alphanumeric except spaces
  return s.replace(/[^a-zA-Z0-9\s]/g, "").trim()
}

// Reject slugs that are too short or clearly generic single-dictionary-words
const SKIP_SLUGS = new Set([
  "us", "co", "in", "on", "the", "a", "an", "one", "my", "go",
  "point", "stone", "south", "north", "east", "west", "central",
  "retail", "privacy", "consulting", "staffing", "logistics",
  "solutions", "services", "systems", "technology", "technologies",
  "salonspa", "spa", "salon", "group", "global", "national",
])

function generateCandidates(name: string): string[] {
  const cleaned = cleanCompanyName(name)
  if (!cleaned) return []

  const words  = cleaned.toLowerCase().split(/\s+/).filter(Boolean)
  const slug   = words.join("")
  const hyphen = words.join("-")
  const first  = words[0]
  const twoW   = words.slice(0, 2).join("")

  const seen = new Set<string>()
  const out: string[] = []
  const push = (d: string) => {
    const [pre] = d.split(".")
    if (!pre || pre.length < 3 || SKIP_SLUGS.has(pre)) return
    const t = d.trim().toLowerCase()
    if (!seen.has(t)) { seen.add(t); out.push(t) }
  }

  push(`${slug}.com`)
  if (twoW !== slug) push(`${twoW}.com`)
  if (hyphen !== slug) push(`${hyphen}.com`)
  if (first && first !== slug) push(`${first}.com`)

  return out
}

// ─── Domain probe ─────────────────────────────────────────────────────────────

const ATS_PATTERN = /\.(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workday\.com|icims\.com|jobvite\.com|taleo\.net|bamboohr\.com|workable\.com)$/i

async function probesDomain(domain: string): Promise<boolean> {
  const urls = [`https://${domain}`, `https://www.${domain}`]
  for (const url of urls) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Hireoven/1.0)" },
      })
      clearTimeout(timer)
      // Accept any non-server-error response — even 403/404 means the domain is live
      if (res.status < 500) {
        // Reject if we ended up on an ATS page (Greenhouse career page, etc.)
        const finalUrl = res.url ?? url
        if (ATS_PATTERN.test(new URL(finalUrl).hostname)) return false
        return true
      }
    } catch {
      // timeout / DNS fail — try next URL
    }
  }
  return false
}

async function resolveDomain(name: string): Promise<string | null> {
  const candidates = generateCandidates(name)
  for (const domain of candidates) {
    if (await probesDomain(domain)) return domain
  }
  return null
}

// ─── Concurrency helper ───────────────────────────────────────────────────────

async function pMap<T, R>(
  items: T[],
  fn: (item: T, idx: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!LOGO_TOKEN) {
    throw new Error("LOGO_DEV_TOKEN or NEXT_PUBLIC_LOGO_DEV_TOKEN is required")
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const { rows: companies } = await pool.query<{ id: string; name: string; domain: string }>(`
    SELECT DISTINCT c.id, c.name, c.domain
    FROM companies c
    JOIN jobs j ON j.company_id = c.id AND j.is_active = true
    WHERE c.domain LIKE '%.placeholder'
      AND (c.logo_url IS NULL OR c.logo_url = '')
    ORDER BY c.name
    ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ""}
  `)

  console.log(`\nFound ${companies.length} placeholder companies to resolve`)
  console.log(`Concurrency: ${CONCURRENCY} | Dry run: ${DRY_RUN}\n`)

  let resolved = 0
  let failed   = 0

  await pMap(companies, async (company, idx) => {
    const domain = await resolveDomain(company.name)
    const progress = `[${idx + 1}/${companies.length}]`

    if (!domain) {
      console.log(`${progress} ✗ ${company.name}`)
      failed++
      return
    }

    const logoUrl = `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=256&format=png`
    console.log(`${progress} ✓ ${company.name} → ${domain}`)
    resolved++

    if (!DRY_RUN) {
      try {
        await pool.query(
          `UPDATE companies SET domain = $1, logo_url = $2, updated_at = now()
           WHERE id = $3
             AND NOT EXISTS (SELECT 1 FROM companies WHERE domain = $1 AND id != $3)`,
          [domain, logoUrl, company.id]
        )
      } catch (err: unknown) {
        // 23505 = unique_violation — another company already claimed this domain; skip
        if ((err as { code?: string }).code !== "23505") throw err
        console.log(`  ↳ skipped (domain ${domain} already taken)`)
      }
    }
  }, CONCURRENCY)

  console.log(`\n── Results ─────────────────────────────`)
  console.log(`  Resolved : ${resolved}`)
  console.log(`  Failed   : ${failed}`)
  console.log(`  Total    : ${companies.length}`)
  if (DRY_RUN) console.log(`  (dry run — no DB writes)`)

  await pool.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

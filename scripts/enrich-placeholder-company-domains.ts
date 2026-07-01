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
// Safe mode: only the cleanly-named ATS-imported (*-tenant) companies — never the
// junky adzuna/dice *placeholder / *-discovered stubs, whose slug-ish names
// mis-guess to unrelated live domains (e.g. "550 Niagara…" → 550.com).
const TENANT_ONLY = argv.includes("--tenant-only")
const PROBE_TIMEOUT_MS = 6_000
// A real logo.dev brand mark is a substantial PNG; a parked/unknown domain
// returns 404 (fallback=404) or a tiny blank. Reject anything smaller.
const LOGO_MARK_MIN_BYTES = 700
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
  // First-word-only fallback is the riskiest (a short/numeric prefix like "21st"
  // in "21st Century Home Health" resolves to an unrelated brand's 21st.com).
  // Only use it when the first word is distinctive enough (>=5 chars, not numeric).
  if (first && first !== slug && first.length >= 5 && !/^\d+$/.test(first)) {
    push(`${first}.com`)
  }

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

/**
 * True only when logo.dev actually has a real brand mark for `domain`.
 * `fallback=404` makes logo.dev return 404 instead of a generated monogram when
 * it has no logo, so a live-but-generic domain (parked, wrong-company) is
 * rejected — the key guard against mis-branding a name that guessed to the wrong
 * live domain.
 */
async function hasLogoMark(domain: string): Promise<boolean> {
  const url = `https://img.logo.dev/${encodeURIComponent(domain)}?token=${LOGO_TOKEN}&size=128&format=png&fallback=404`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (res.status !== 200) return false
    if (!(res.headers.get("content-type") ?? "").startsWith("image/")) return false
    const bytes = (await res.arrayBuffer()).byteLength
    return bytes >= LOGO_MARK_MIN_BYTES
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
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

  // Safe mode: only *-tenant companies with a real (non-slug) name — an upper-case
  // letter or a space distinguishes "10x Genomics" from a bare slug like "abd".
  const domainFilter = TENANT_ONLY
    ? `c.domain LIKE '%-tenant' AND (c.name ~ '[A-Z]' OR c.name ~ ' ')`
    : `(c.domain LIKE '%placeholder' OR c.domain LIKE '%-discovered' OR c.domain LIKE '%-tenant')`

  const { rows: companies } = await pool.query<{ id: string; name: string; domain: string }>(`
    SELECT DISTINCT c.id, c.name, c.domain
    FROM companies c
    JOIN jobs j ON j.company_id = c.id AND j.is_active = true
    WHERE ${domainFilter}
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

    // Only store when logo.dev actually has a mark for the resolved domain —
    // rejects live-but-wrong / parked domains that would render a wrong or blank
    // logo. This is the guard that stops name-guess mis-branding.
    if (!(await hasLogoMark(domain))) {
      console.log(`${progress} ⊘ ${company.name} → ${domain} (no logo.dev mark)`)
      failed++
      return
    }

    const logoUrl = `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=256&format=png`
    console.log(`${progress} ✓ ${company.name} → ${domain}`)
    resolved++

    if (!DRY_RUN) {
      try {
        // Always set the logo (multiple companies may legitimately share a
        // brand domain's logo). Only adopt the real domain if no other company
        // already owns it, so we never trip the unique-domain constraint.
        await pool.query(
          `UPDATE companies SET
             logo_url = $2,
             domain = CASE
               WHEN NOT EXISTS (SELECT 1 FROM companies x WHERE x.domain = $1 AND x.id <> companies.id)
               THEN $1 ELSE companies.domain END,
             updated_at = now()
           WHERE id = $3`,
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

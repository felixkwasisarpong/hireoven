/**
 * Fix companies that are missing a real brand logo.
 *
 * For each target company we build a ranked list of candidate brand domains
 * (from the ATS tenant slug, careers_url, the stored domain, and the company
 * name), then probe logo.dev with `fallback=404` — which returns 200 only when
 * logo.dev actually has a real mark for that domain (unknown domains 404 instead
 * of silently returning a generated monogram). The first real hit is written to
 * companies.logo_url. Companies with no hit are SKIPPED and listed at the end.
 *
 * Targets (default: all):
 *   missing  — logo_url IS NULL / ''
 *   favicons — logo_url is a Google/DuckDuckGo favicon fallback
 *   all      — both of the above
 *
 * Usage:
 *   npx tsx scripts/fix-missing-logos.ts                 # dry-run, target=all
 *   npx tsx scripts/fix-missing-logos.ts --execute       # apply
 *   npx tsx scripts/fix-missing-logos.ts --execute --target=missing
 *   npx tsx scripts/fix-missing-logos.ts --limit=500 --execute
 *
 * Skipped companies are written to:
 *   scripts/output/skipped-logos.json
 *   scripts/output/skipped-logos.csv
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"

loadEnvConfig(process.cwd())

import { Pool } from "pg"

const args = process.argv.slice(2)
const execute = args.includes("--execute")
const targetArg = args.find((a) => a.startsWith("--target="))?.split("=")[1] ?? "all"
const TARGET: "missing" | "favicons" | "all" =
  targetArg === "missing" ? "missing" : targetArg === "favicons" ? "favicons" : "all"
const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1]
const LIMIT = limitArg ? Number(limitArg) : Infinity

const TOKEN = process.env.LOGO_DEV_TOKEN || process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN || ""
if (!TOKEN) {
  console.error("LOGO_DEV_TOKEN not set in env — aborting")
  process.exit(1)
}
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set in env — aborting")
  process.exit(1)
}

const OUT_DIR = path.join(process.cwd(), "scripts", "output")
const SKIPPED_JSON = path.join(OUT_DIR, "skipped-logos.json")
const SKIPPED_CSV = path.join(OUT_DIR, "skipped-logos.csv")

type Row = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  ats_type: string | null
  ats_identifier: string | null
}

const TLDS = ["com", "io", "ai", "co", "org"] as const

/** Trailing tokens that are legal/filler noise on a concatenated tenant slug. */
const TRAILING_NOISE = [
  "llc", "lp", "llp", "inc", "incorporated", "corp", "corporation", "ltd", "limited",
  "plc", "co", "company", "group", "holdings", "operating", "consulting", "consultancy",
  "associates", "partners", "services", "solutions", "technologies", "technology",
  "systems", "global", "international", "usa", "us",
]

/** Iteratively strip trailing legal/filler tokens from a concatenated slug (e.g. sharkninjaoperatingllc → sharkninja). */
function stripTrailingNoise(slug: string): string {
  let s = slug
  let changed = true
  while (changed && s.length > 3) {
    changed = false
    for (const t of TRAILING_NOISE) {
      if (s.length - t.length >= 3 && s.endsWith(t)) {
        s = s.slice(0, -t.length)
        changed = true
        break
      }
    }
  }
  return s
}

const ATS_HOST_RE =
  /(\.myworkdayjobs\.com|\.applytojob\.com|\.greenhouse\.io|\.lever\.co|\.lever-jobs\.com|\.ashbyhq\.com|\.icims\.com|\.smartrecruiters\.com|\.bamboohr\.com|\.rippling\.com)$/

/** Clean a slug to a-z0-9- (no leading/trailing dashes). */
function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "")
}

/** Tenant slug from the ATS identifier (first ':'-segment for workday-style ids). */
function slugFromAtsIdentifier(id: string | null): string {
  if (!id) return ""
  return slugify(id.split(":")[0] ?? "")
}

/** Tenant slug from a shared-ATS careers URL path, or company host stripped of careers/jobs prefix. */
function fromCareersUrl(careersUrl: string | null): { slug?: string; host?: string } {
  if (!careersUrl) return {}
  let parsed: URL
  try {
    parsed = new URL(careersUrl)
  } catch {
    return {}
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
  const firstSegment = parsed.pathname.replace(/^\/+/, "").split("/")[0]?.toLowerCase() ?? ""

  const sharedHosts = new Set([
    "jobs.lever.co",
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "boards.eu.greenhouse.io",
    "jobs.ashbyhq.com",
    "careers.smartrecruiters.com",
    "jobs.smartrecruiters.com",
  ])
  if (sharedHosts.has(host) && firstSegment && /^[a-z0-9-]+$/.test(firstSegment)) {
    return { slug: slugify(firstSegment) }
  }
  // Looks like the company's own site (e.g. careers.acme.com) — strip the careers prefix.
  if (!ATS_HOST_RE.test(host)) {
    const stripped = host.replace(/^(careers|jobs|talent|hire|work|join|recruiting)\./, "")
    if (/\./.test(stripped)) return { host: stripped }
  }
  return {}
}

/** Tenant slug + real-host candidate from the stored domain (handles synthetic *.x-discovered). */
function fromDomain(domain: string | null): { slug?: string; host?: string } {
  const d = (domain ?? "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
  if (!d) return {}

  // Synthetic placeholders: {tenant}.{ats}-discovered / .ats-placeholder / .lca-employer / .uscis-employer
  const synthetic = d.match(/^([a-z0-9-]+)\.(?:[a-z0-9-]+\.)?(?:[a-z0-9-]+-discovered|[a-z0-9-]+-placeholder|ats-placeholder|lca-employer|uscis-employer)$/)
  if (synthetic?.[1]) return { slug: slugify(synthetic[1]) }

  // Real ATS subdomain host → tenant slug
  let m = d.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/)
  if (m?.[1]) return { slug: slugify(m[1]) }
  m = d.match(/^(?:careers-)?([a-z0-9-]+)\.(?:applytojob\.com|greenhouse\.io|lever(?:-jobs)?\.co|ashbyhq\.com|icims\.com|smartrecruiters\.com|bamboohr\.com|rippling\.com)$/)
  if (m?.[1] && !["boards", "job-boards", "jobs", "careers", "ats"].includes(m[1])) {
    return { slug: slugify(m[1]) }
  }

  // Already a real-looking domain
  if (!ATS_HOST_RE.test(d) && /\.[a-z]{2,}$/.test(d) && !d.includes("-discovered") && !d.includes("-placeholder")) {
    return { host: d }
  }
  return {}
}

/** Collapse a company name to a domain root. */
function slugFromName(name: string): string {
  const stripped = name
    .toLowerCase()
    .replace(
      /\b(incorporated|inc|l\.?l\.?c\.?|llp|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|solutions|services|systems|the|us|usa|america|americas|north\s+america)\b/g,
      " "
    )
    .replace(/[^a-z0-9]+/g, "")
    .trim()
  return stripped.length >= 3 ? stripped : ""
}

function buildCandidates(row: Row): string[] {
  const out: string[] = []
  const push = (host: string | undefined) => {
    if (host && /\./.test(host)) out.push(host)
  }
  const pushSlugTlds = (slug: string | undefined, tlds: readonly string[]) => {
    if (!slug || slug.length < 2) return
    for (const tld of tlds) out.push(`${slug}.${tld}`)
  }

  const atsSlug = slugFromAtsIdentifier(row.ats_identifier)
  const careers = fromCareersUrl(row.careers_url)
  const dom = fromDomain(row.domain)
  const nameSlug = slugFromName(row.name)

  // 1. ATS tenant slug — strongest signal — try several TLDs
  pushSlugTlds(atsSlug, TLDS)
  // 1b. ATS slug with trailing legal/filler noise stripped (boomilp → boomi)
  const atsStripped = stripTrailingNoise(atsSlug)
  if (atsStripped !== atsSlug) pushSlugTlds(atsStripped, ["com", "io", "ai", "org"])
  // 2. Real host from careers_url (e.g. careers.acme.com → acme.com)
  push(careers.host)
  // 3. Careers-path slug (when it differs from the ATS slug)
  if (careers.slug && careers.slug !== atsSlug) pushSlugTlds(careers.slug, ["com", "io", "ai"])
  // 4. Real host / tenant slug from the stored domain
  push(dom.host)
  if (dom.slug && dom.slug !== atsSlug) pushSlugTlds(dom.slug, ["com", "io"])
  // 5. Company-name slug (last resort), plus a noise-stripped variant
  if (nameSlug && nameSlug !== atsSlug) {
    pushSlugTlds(nameSlug, ["com", "io"])
    const nameStripped = stripTrailingNoise(nameSlug)
    if (nameStripped !== nameSlug && nameStripped !== atsStripped) pushSlugTlds(nameStripped, ["com", "io"])
  }

  return Array.from(new Set(out)).slice(0, 18)
}

async function probeLogoDev(domain: string): Promise<boolean> {
  const url = `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(TOKEN)}&fallback=404`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, { method: "GET", signal: ctrl.signal })
    try {
      await res.arrayBuffer()
    } catch {
      /* ignore body */
    }
    clearTimeout(t)
    return res.status === 200
  } catch {
    return false
  }
}

function logoUrlFor(domain: string): string {
  return `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(TOKEN)}&size=256&format=png`
}

function whereForTarget(): string {
  switch (TARGET) {
    case "missing":
      return `(logo_url IS NULL OR logo_url = '')`
    case "favicons":
      return `(logo_url ILIKE '%google.com/s2/favicons%' OR logo_url ILIKE '%duckduckgo.com%')`
    case "all":
      return `(logo_url IS NULL OR logo_url = '' OR logo_url ILIKE '%google.com/s2/favicons%' OR logo_url ILIKE '%duckduckgo.com%')`
  }
}

type Skipped = {
  id: string
  name: string
  domain: string | null
  ats: string
  careers_url: string | null
  candidates: string[]
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  const { rows } = await pool.query<Row>(
    `SELECT id, name, domain, careers_url, ats_type, ats_identifier
       FROM companies
      WHERE is_active = true
        AND duplicate_of_company_id IS NULL
        AND ${whereForTarget()}
      ORDER BY job_count DESC NULLS LAST, name`
  )

  const targets = LIMIT === Infinity ? rows : rows.slice(0, LIMIT)
  console.log(
    `[fix-missing-logos] target=${TARGET} mode=${execute ? "EXECUTE" : "dry-run"} companies=${targets.length}` +
      (LIMIT === Infinity ? "" : ` (of ${rows.length})`)
  )

  const limiter = pLimit(12)
  let hits = 0
  let processed = 0
  const skipped: Skipped[] = []

  await Promise.all(
    targets.map((row) =>
      limiter(async () => {
        const candidates = buildCandidates(row)
        let matched: string | null = null
        for (const cand of candidates) {
          if (await probeLogoDev(cand)) {
            matched = cand
            break
          }
        }

        processed += 1
        if (processed % 200 === 0) {
          console.log(`  progress: ${processed}/${targets.length}  hits=${hits}  skipped=${skipped.length}`)
        }

        if (!matched) {
          skipped.push({
            id: row.id,
            name: row.name,
            domain: row.domain,
            ats: `${row.ats_type ?? "-"}:${row.ats_identifier ?? "-"}`,
            careers_url: row.careers_url,
            candidates,
          })
          return
        }

        hits += 1
        const url = logoUrlFor(matched)
        if (execute) {
          await pool
            .query(`UPDATE companies SET logo_url = $1, updated_at = now() WHERE id = $2`, [url, row.id])
            .catch((err) => console.warn(`  update failed for ${row.id}:`, err.message))
        } else if (hits <= 20) {
          console.log(`  would set ${row.name.slice(0, 38).padEnd(38)} → ${matched}`)
        }
      })
    )
  )

  await pool.end()

  // Write the full skipped list
  fs.mkdirSync(OUT_DIR, { recursive: true })
  skipped.sort((a, b) => a.name.localeCompare(b.name))
  fs.writeFileSync(
    SKIPPED_JSON,
    JSON.stringify(
      { generated_at: new Date().toISOString(), target: TARGET, mode: execute ? "execute" : "dry-run", count: skipped.length, skipped },
      null,
      2
    )
  )
  const csvEsc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`
  const csvLines = [
    "name,domain,ats,careers_url,candidates",
    ...skipped.map((s) =>
      [csvEsc(s.name), csvEsc(s.domain ?? ""), csvEsc(s.ats), csvEsc(s.careers_url ?? ""), csvEsc(s.candidates.join(" | "))].join(",")
    ),
  ]
  fs.writeFileSync(SKIPPED_CSV, csvLines.join("\n"))

  console.log(`\n[fix-missing-logos] done (${execute ? "EXECUTE" : "dry-run"})`)
  console.log(`  processed: ${processed}`)
  console.log(`  hits:      ${hits}`)
  console.log(`  skipped:   ${skipped.length}`)
  console.log(`  skipped report: ${SKIPPED_JSON}`)
  console.log(`                  ${SKIPPED_CSV}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

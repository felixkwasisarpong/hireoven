/**
 * Insert the ATS hits found by scripts/probe-ats-by-slug.ts into the
 * `companies` table so the harvester picks them up on the next tick.
 *
 * Behavior:
 *   - Reads data/builtinsf-ats-hits.jsonl (or --input).
 *   - For each hit, uses hit.domain when present (Greenhouse gave us a
 *     company_url). Otherwise synthesizes a placeholder domain of the form
 *     `{slug}.{ats}.ats-placeholder` so the NOT-NULL/UNIQUE constraint on
 *     companies.domain holds. Placeholder rows can be promoted later when
 *     the real apex domain is discovered.
 *   - careers_url is set to the canonical ATS board URL from the probe so
 *     the harvester can claim immediately. Also writes ats_type and
 *     ats_identifier.
 *   - Dedupe: skips rows already in DB by domain (real or placeholder)
 *     and by ats_identifier + ats_type pair to avoid duplicate boards.
 *
 * Usage:
 *   npx tsx scripts/seed-ats-slug-hits.ts            # dry-run
 *   npx tsx scripts/seed-ats-slug-hits.ts --execute  # insert
 *   npx tsx scripts/seed-ats-slug-hits.ts --execute --limit=500
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"
import { companyLogoUrlFromDomain } from "../lib/companies/logo-url"

const args = process.argv.slice(2)
const execute = args.includes("--execute")
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity
const inputPath = args.find((a) => a.startsWith("--input="))?.split("=")[1] ?? path.join(process.cwd(), "data", "builtinsf-ats-hits.jsonl")

type AtsType = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workday" | "icims" | "workable"
type Hit = {
  name: string
  slug: string
  ats_type: AtsType
  ats_identifier: string
  board_url: string
  jobs_count: number
  sample_titles: string[]
  company_url: string | null
  domain: string | null
  probed_at: string
}

function readJsonl<T>(p: string): T[] {
  if (!fs.existsSync(p)) {
    console.error(`Missing input: ${p}`)
    process.exit(1)
  }
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T)
}

function placeholderDomain(hit: Hit): string {
  // For Workday, the ats_identifier is "{tenant}:wd{N}:{site}" — use just the
  // tenant for a cleaner placeholder. Others use the slug directly.
  const idForDomain = hit.ats_type === "workday"
    ? (hit.ats_identifier.split(":")[0] ?? hit.ats_identifier)
    : hit.ats_identifier
  const slug = idForDomain.toLowerCase().replace(/[^a-z0-9-]/g, "")
  return `${slug}.${hit.ats_type}.ats-placeholder`
}

function cleanName(name: string): string {
  // Drop parenthetical disambiguators ("Fellow (fellowproducts.com)" → "Fellow")
  return name.replace(/\s*\([^)]*\)\s*/g, " ").trim()
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
}

async function main() {
  const hits = readJsonl<Hit>(inputPath)
  console.log(`Loaded ${hits.length} hits from ${inputPath}`)

  // Dedupe input by (ats_type, ats_identifier) — same slug may appear via two
  // different name variants; keep the first.
  const seen = new Set<string>()
  const unique: Hit[] = []
  for (const h of hits) {
    const k = `${h.ats_type}:${h.ats_identifier}`
    if (seen.has(k)) continue
    seen.add(k)
    unique.push(h)
  }
  console.log(`Unique by (ats_type, ats_identifier): ${unique.length}`)

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  // Pull existing companies and build lookup maps:
  //  - by domain (real + placeholder) → dedupe on subsequent runs
  //  - by (ats_type, ats_identifier) → don't reinsert the same board
  //  - by normalized name → if a company is already in the DB under its real
  //    domain (e.g. cloudflare.com), we UPDATE that row with the ATS instead
  //    of inserting a new placeholder.
  const candidateDomains = unique.map((h) => h.domain).filter((d): d is string => !!d)
  const candidatePlaceholders = unique.map((h) => placeholderDomain(h))
  const candidateNames = [...new Set(unique.map((h) => normalizeName(cleanName(h.name))))].filter(Boolean)

  const { rows: existingByDomain } = await pool.query<{ id: string; name: string; domain: string; ats_type: string | null }>(
    "SELECT id, name, domain, ats_type FROM companies WHERE domain = ANY($1::text[])",
    [[...candidateDomains, ...candidatePlaceholders]]
  )
  const domainTaken = new Set(existingByDomain.map((r) => r.domain))

  const { rows: existingByAts } = await pool.query<{ ats_type: string; ats_identifier: string }>(
    `SELECT ats_type, ats_identifier
       FROM companies
      WHERE ats_type = ANY($1::text[])
        AND ats_identifier = ANY($2::text[])`,
    [unique.map((h) => h.ats_type), unique.map((h) => h.ats_identifier)]
  )
  const atsTaken = new Set(existingByAts.map((r) => `${r.ats_type}:${r.ats_identifier}`))

  const { rows: existingByName } = await pool.query<{ id: string; name: string; domain: string; ats_type: string | null }>(
    "SELECT id, name, domain, ats_type FROM companies WHERE lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g')) = ANY($1::text[])",
    [candidateNames]
  )
  const nameToExisting = new Map<string, { id: string; name: string; domain: string; ats_type: string | null }>()
  for (const r of existingByName) nameToExisting.set(normalizeName(r.name), r)

  type Plan = { hit: Hit; action: "skip-ats" | "skip-domain" | "update-by-name" | "insert" ; existing?: { id: string; name: string; domain: string; ats_type: string | null } ; domain: string }
  const plans: Plan[] = []
  for (const h of unique) {
    const atsKey = `${h.ats_type}:${h.ats_identifier}`
    if (atsTaken.has(atsKey)) { plans.push({ hit: h, action: "skip-ats", domain: h.domain ?? placeholderDomain(h) }); continue }
    const nameKey = normalizeName(cleanName(h.name))
    const byName = nameKey ? nameToExisting.get(nameKey) : undefined
    if (byName && !byName.ats_type) {
      plans.push({ hit: h, action: "update-by-name", existing: byName, domain: byName.domain })
      continue
    }
    const d = h.domain ?? placeholderDomain(h)
    if (domainTaken.has(d)) { plans.push({ hit: h, action: "skip-domain", domain: d }); continue }
    plans.push({ hit: h, action: "insert", domain: d })
  }

  const counts = { insert: 0, "update-by-name": 0, "skip-ats": 0, "skip-domain": 0 } as Record<Plan["action"], number>
  for (const p of plans) counts[p.action]++
  console.log(`Plan: insert=${counts.insert}, update-by-name=${counts["update-by-name"]}, skip-ats=${counts["skip-ats"]}, skip-domain=${counts["skip-domain"]}`)

  const actionable = plans.filter((p) => p.action === "insert" || p.action === "update-by-name")
  const todo = actionable.slice(0, Number.isFinite(limit) ? limit : actionable.length)
  console.log(`This run (limit=${Number.isFinite(limit) ? limit : "none"}): ${todo.length}`)

  if (!execute) {
    console.log(`\n--- DRY RUN — sample (first 12) ---`)
    for (const p of todo.slice(0, 12)) {
      const h = p.hit
      const tag = p.action === "update-by-name"
        ? `UPDATE existing (${p.existing!.domain})`
        : h.domain ? "INSERT (real)" : "INSERT (placeholder)"
      console.log(`  [${h.ats_type.padEnd(15)}] ${cleanName(h.name).padEnd(28)} ${tag.padEnd(38)} jobs=${h.jobs_count}`)
    }
    console.log(`\nDry run only. Re-run with --execute to write.`)
    await pool.end()
    return
  }

  let inserted = 0
  let updated = 0
  for (const p of todo) {
    const h = p.hit
    if (p.action === "update-by-name") {
      const res = await pool.query(
        `UPDATE companies
            SET ats_type       = $1,
                ats_identifier = $2,
                careers_url    = COALESCE(careers_url, $3),
                is_active      = true
          WHERE id = $4
            AND (ats_type IS NULL OR ats_type = 'custom')`,
        [h.ats_type, h.ats_identifier, h.board_url, p.existing!.id]
      )
      if (res.rowCount && res.rowCount > 0) updated++
    } else {
      const domain = p.domain
      const logo = h.domain ? companyLogoUrlFromDomain(h.domain, "google-favicon") : null
      const res = await pool.query(
        `INSERT INTO companies
           (name, domain, careers_url, logo_url, ats_type, ats_identifier,
            is_active, status, sponsors_h1b, sponsorship_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,true,'active',false,35)
         ON CONFLICT (domain) DO NOTHING
         RETURNING id`,
        [cleanName(h.name), domain, h.board_url, logo, h.ats_type, h.ats_identifier]
      )
      if (res.rowCount && res.rowCount > 0) inserted++
    }
  }
  console.log(`\nDone. Inserted ${inserted} new rows; updated ${updated} existing rows by name.`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })

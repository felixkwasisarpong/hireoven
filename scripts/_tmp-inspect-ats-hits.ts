import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import fs from "node:fs"
import { Pool } from "pg"

type Hit = {
  name: string
  slug: string
  ats_type: "greenhouse" | "lever" | "ashby" | "smartrecruiters"
  ats_identifier: string
  board_url: string
  jobs_count: number
  sample_titles: string[]
  company_url: string | null
  domain: string | null
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
const cleanName = (s: string) => s.replace(/\s*\([^)]*\)\s*/g, " ").trim()
const placeholderDomain = (h: Hit) => `${h.ats_identifier.toLowerCase().replace(/[^a-z0-9-]/g, "")}.${h.ats_type}.ats-placeholder`

async function main() {
  const hits = fs.readFileSync("data/builtinsf-ats-hits.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Hit)
  const seen = new Set<string>()
  const uniq: Hit[] = []
  for (const h of hits) { const k = `${h.ats_type}:${h.ats_identifier}`; if (seen.has(k)) continue; seen.add(k); uniq.push(h) }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined })

  const candidatePlaceholders = uniq.map((h) => placeholderDomain(h))
  const candidateRealDomains = uniq.map((h) => h.domain).filter((d): d is string => !!d)
  const candidateNames = [...new Set(uniq.map((h) => norm(cleanName(h.name))))].filter(Boolean)

  const { rows: existingByDomain } = await pool.query<{ id: string; name: string; domain: string; ats_type: string | null }>(
    "SELECT id, name, domain, ats_type FROM companies WHERE domain = ANY($1::text[])",
    [[...candidatePlaceholders, ...candidateRealDomains]]
  )
  const domainTaken = new Set(existingByDomain.map((r) => r.domain))

  const { rows: existingByAts } = await pool.query<{ ats_type: string; ats_identifier: string }>(
    `SELECT ats_type, ats_identifier FROM companies WHERE ats_type = ANY($1::text[]) AND ats_identifier = ANY($2::text[])`,
    [uniq.map((h) => h.ats_type), uniq.map((h) => h.ats_identifier)]
  )
  const atsTaken = new Set(existingByAts.map((r) => `${r.ats_type}:${r.ats_identifier}`))

  const { rows: existingByName } = await pool.query<{ id: string; name: string; domain: string; ats_type: string | null }>(
    "SELECT id, name, domain, ats_type FROM companies WHERE lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g')) = ANY($1::text[])",
    [candidateNames]
  )
  const nameToExisting = new Map<string, { id: string; name: string; domain: string; ats_type: string | null }>()
  for (const r of existingByName) nameToExisting.set(norm(r.name), r)

  type Plan = { hit: Hit; action: "skip-ats" | "skip-domain" | "update-by-name" | "insert"; existing?: { id: string; name: string; domain: string; ats_type: string | null }; domain: string; risk: "low" | "med" | "high" }
  const plans: Plan[] = []
  for (const h of uniq) {
    const atsKey = `${h.ats_type}:${h.ats_identifier}`
    const cleaned = cleanName(h.name)
    const nameKey = norm(cleaned)
    const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0)
    // Heuristic risk: single-token name + Lever/Ashby + slug == normalized name + low job count
    const singleToken = tokens.length === 1
    const veryShortName = nameKey.length <= 5
    const lowJobs = h.jobs_count <= 3
    const noBoardNameValidation = h.ats_type === "lever" || h.ats_type === "ashby"
    let risk: "low" | "med" | "high" = "low"
    if (singleToken && noBoardNameValidation && lowJobs) risk = "high"
    else if (singleToken && noBoardNameValidation) risk = "med"
    else if (veryShortName && noBoardNameValidation) risk = "med"
    else risk = "low"
    let action: Plan["action"]
    let domain = h.domain ?? placeholderDomain(h)
    let existing: Plan["existing"] | undefined
    if (atsTaken.has(atsKey)) action = "skip-ats"
    else {
      const byName = nameKey ? nameToExisting.get(nameKey) : undefined
      if (byName && !byName.ats_type) { action = "update-by-name"; existing = byName; domain = byName.domain }
      else if (domainTaken.has(domain)) action = "skip-domain"
      else action = "insert"
    }
    plans.push({ hit: h, action, existing, domain, risk })
  }

  const actionable = plans.filter((p) => p.action === "insert" || p.action === "update-by-name")

  // Counts
  const byAction: Record<string, number> = {}
  const byAts: Record<string, number> = {}
  const byRisk: Record<string, number> = { low: 0, med: 0, high: 0 }
  for (const p of plans) byAction[p.action] = (byAction[p.action] ?? 0) + 1
  for (const p of actionable) {
    byAts[p.hit.ats_type] = (byAts[p.hit.ats_type] ?? 0) + 1
    byRisk[p.risk]++
  }
  console.log("Counts by action:", byAction)
  console.log("Actionable by ATS:", byAts)
  console.log("Actionable by risk heuristic:", byRisk)

  // Dump CSV
  const lines = [
    [
      "action", "risk", "ats_type", "ats_identifier", "name", "clean_name",
      "board_url", "jobs_count", "sample_title_1", "has_real_domain",
      "domain_to_use", "existing_db_name", "existing_db_domain"
    ].join(","),
  ]
  for (const p of plans) {
    const h = p.hit
    const cells = [
      p.action, p.risk, h.ats_type, h.ats_identifier,
      JSON.stringify(h.name), JSON.stringify(cleanName(h.name)),
      h.board_url, String(h.jobs_count),
      JSON.stringify((h.sample_titles[0] ?? "").slice(0, 80)),
      h.domain ? "yes" : "no",
      p.domain, p.existing ? JSON.stringify(p.existing.name) : "", p.existing ? p.existing.domain : "",
    ]
    lines.push(cells.join(","))
  }
  fs.writeFileSync("data/builtinsf-ats-hits-plan.csv", lines.join("\n"))
  console.log(`\nFull plan → data/builtinsf-ats-hits-plan.csv (${plans.length} rows)`)

  // Show high-risk samples
  const high = plans.filter((p) => p.risk === "high" && (p.action === "insert" || p.action === "update-by-name"))
  console.log(`\n=== ${high.length} HIGH-RISK candidates (single-token name + Lever/Ashby + ≤3 jobs) — review carefully ===`)
  for (const p of high.slice(0, 25)) {
    const h = p.hit
    console.log(`  [${h.ats_type}] ${cleanName(h.name).padEnd(24)} → ${h.ats_identifier.padEnd(20)} jobs=${h.jobs_count}  titles: ${h.sample_titles.slice(0, 2).join(" | ").slice(0, 90)}`)
  }
  if (high.length > 25) console.log(`  ... +${high.length - 25} more (see CSV)`)

  // Top hits by job count (these are the highest-value catches)
  console.log(`\n=== Top 20 actionable hits by jobs_count ===`)
  const topJobs = [...actionable].sort((a, b) => b.hit.jobs_count - a.hit.jobs_count).slice(0, 20)
  for (const p of topJobs) {
    const h = p.hit
    console.log(`  [${h.ats_type.padEnd(15)}] ${cleanName(h.name).padEnd(28)} jobs=${String(h.jobs_count).padStart(5)}  slug=${h.ats_identifier}`)
  }

  // Group by ats and sample
  for (const ats of ["greenhouse", "ashby", "lever", "smartrecruiters"] as const) {
    const items = actionable.filter((p) => p.hit.ats_type === ats)
    console.log(`\n=== ${ats.toUpperCase()}: ${items.length} actionable; random 8 ===`)
    const sample = [...items].sort(() => Math.random() - 0.5).slice(0, 8)
    for (const p of sample) {
      console.log(`  ${cleanName(p.hit.name).padEnd(28)} slug=${p.hit.ats_identifier.padEnd(22)} jobs=${p.hit.jobs_count}  | ${p.hit.sample_titles[0]?.slice(0, 60) ?? ""}`)
    }
  }

  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })

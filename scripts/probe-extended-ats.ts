/**
 * Phase 2 ATS probe: Workday + iCIMS + Workable.
 *
 * Same idea as scripts/probe-ats-by-slug.ts but for ATSes whose public
 * surface is messier:
 *   - Workable: clean JSON API at apply.workable.com/api/v3/accounts/{slug}/jobs
 *   - Workday:  tenant subdomain probe across shards (wd1/wd2/wd3/wd5/wd10/wd12),
 *               then resolveWorkdaySite() to discover the site name.
 *   - iCIMS:    HTML check on careers-{slug}.icims.com / {slug}.icims.com.
 *
 * Input:  data/builtinsf-list.jsonl (default), minus names already in the DB
 *         (case-insensitive) and minus names already in builtinsf-ats-hits.jsonl
 *         from the v1 sweep.
 * Output: data/builtinsf-ats-hits-extended.jsonl (same shape as v1 hits so
 *         seed-ats-slug-hits.ts can consume it with --input).
 *
 * Usage:
 *   npx tsx scripts/probe-extended-ats.ts --concurrency=10 --limit=200      # smoke
 *   npx tsx scripts/probe-extended-ats.ts --concurrency=16                  # full
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"
import { resolveWorkdaySite } from "../lib/harvester/discovery/workday-resolver"

const args = process.argv.slice(2)
const concurrency = Math.max(1, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1]) || 12)
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity
const timeoutMs = Number(args.find((a) => a.startsWith("--timeout="))?.split("=")[1]) || 6000
const inputPath = args.find((a) => a.startsWith("--input="))?.split("=")[1] ?? path.join(process.cwd(), "data", "builtinsf-list.jsonl")
const v1HitsPath = args.find((a) => a.startsWith("--v1-hits="))?.split("=")[1] ?? path.join(process.cwd(), "data", "builtinsf-ats-hits.jsonl")
const outPath = args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? path.join(process.cwd(), "data", "builtinsf-ats-hits-extended.jsonl")
const skipDbCheck = args.includes("--skip-db-check")
const onlyAts = args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? null // "workday" | "workable" | "icims"

const UA = "Mozilla/5.0 (compatible; HireovenAtsProbe/1.0; +https://hireoven.com)"

const STOPWORDS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
  "ltd", "llc", "lp", "llp", "limited", "plc", "the", "and", "of", "for",
  "group", "holdings", "holding", "international", "global", "us", "usa",
  "america", "north", "solutions", "technologies", "technology", "systems",
  "labs", "studio", "studios", "media", "ventures", "partners", "capital",
  "agency", "ai",
])

const WD_SHARDS = ["1", "2", "3", "5", "10", "12"] as const

type AtsType = "workday" | "icims" | "workable" | "greenhouse" | "lever" | "ashby" | "smartrecruiters"
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
type ListEntry = { name: string; profile_path: string; brief: string | null }

function readJsonl<T>(p: string): T[] {
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T)
}
function appendJsonl<T>(p: string, items: T[]) {
  if (!items.length) return
  fs.appendFileSync(p, items.map((i) => JSON.stringify(i)).join("\n") + "\n")
}

function nameTokens(name: string): string[] {
  const cleaned = name.replace(/\([^)]*\)/g, " ")
  return cleaned
    .toLowerCase()
    .replace(/[.,&'`]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}
function parenHint(name: string): string | null {
  const m = name.match(/\(([^)]+)\)/)
  if (!m) return null
  const inner = m[1].trim().toLowerCase()
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(inner)) return inner.replace(/^www\./, "")
  return null
}
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}
function nameMatchesBoard(inputName: string, boardName: string | null | undefined): boolean {
  if (!boardName) return false
  const inputN = normalize(inputName), boardN = normalize(boardName)
  if (!inputN || !boardN) return false
  if (inputN === boardN) return true
  if (boardN.includes(inputN) || inputN.includes(boardN)) return true
  const inputTokens = new Set(nameTokens(inputName))
  const boardTokens = new Set(nameTokens(boardName))
  if (inputTokens.size === 0 || boardTokens.size === 0) return false
  let overlap = 0
  for (const t of inputTokens) if (boardTokens.has(t)) overlap++
  return overlap / inputTokens.size >= 0.5 && overlap >= 2
}
function slugCandidates(name: string): string[] {
  const tokens = nameTokens(name)
  if (tokens.length === 0) return []
  const out = new Set<string>()
  out.add(tokens.join(""))
  out.add(tokens.join("-"))
  out.add(tokens[0])
  if (tokens.length >= 2) out.add(tokens.slice(0, 2).join(""))
  return [...out].filter((s) => s.length >= 3 && s.length <= 40)
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: string | null; json: any | null }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, ...init, headers: { "user-agent": UA, ...(init?.headers ?? {}) } })
    let body: string | null = null
    let json: any = null
    try {
      const ct = res.headers.get("content-type") ?? ""
      if (ct.includes("application/json")) json = await res.json()
      else body = await res.text()
    } catch {}
    return { ok: res.ok, status: res.status, body, json }
  } catch { return { ok: false, status: 0, body: null, json: null } } finally { clearTimeout(t) }
}

// --- Workable -------------------------------------------------------------

async function probeWorkable(slug: string, name: string, hint: string | null): Promise<Hit | null> {
  const url = `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(slug)}/jobs?state=published&limit=10`
  const r = await fetchWithTimeout(url, { headers: { accept: "application/json" } })
  if (!r.ok || !r.json) return null
  const results = r.json.results as Array<{ title: string; department?: string }> | undefined
  if (!Array.isArray(results) || results.length === 0) return null
  const sampleTitles = results.slice(0, 5).map((j) => j.title).filter(Boolean)
  // Workable response includes account name in some shapes; fall back to slug match.
  const accountName: string | undefined = r.json.account?.name
  const okByName = nameMatchesBoard(name, accountName) || nameMatchesBoard(name, slug)
  const okByDomain = hint && (slug.includes(hint.split(".")[0]) || hint.split(".")[0].includes(slug))
  if (!okByName && !okByDomain) return null
  return {
    name, slug,
    ats_type: "workable",
    ats_identifier: slug,
    board_url: `https://apply.workable.com/${slug}/`,
    jobs_count: results.length, // capped at limit=10; not the true total
    sample_titles: sampleTitles,
    company_url: null,
    domain: null,
    probed_at: new Date().toISOString(),
  }
}

// --- Workday --------------------------------------------------------------

async function probeWorkdayTenant(tenant: string): Promise<{ tenant: string; wd: string } | null> {
  for (const wd of WD_SHARDS) {
    const url = `https://${tenant}.wd${wd}.myworkdayjobs.com/wday/cxs/${tenant}/sites`
    const r = await fetchWithTimeout(url, { headers: { accept: "application/json" } })
    if (r.status === 200) return { tenant, wd }
  }
  return null
}

async function workdayJobsCount(tenant: string, wd: string, site: string): Promise<{ count: number; titles: string[] }> {
  const url = `https://${tenant}.wd${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ appliedFacets: {}, limit: 5, offset: 0, searchText: "" }),
  })
  if (!r.ok || !r.json) return { count: 0, titles: [] }
  const total = Number(r.json.total ?? 0)
  const postings = (r.json.jobPostings as Array<{ title: string }> | undefined) ?? []
  return { count: total || postings.length, titles: postings.slice(0, 5).map((p) => p.title).filter(Boolean) }
}

async function probeWorkday(slug: string, name: string, _hint: string | null): Promise<Hit | null> {
  // Strict slug → tenant gate: only treat slug as tenant when name token-matches.
  if (!nameMatchesBoard(name, slug)) return null
  const tenantHit = await probeWorkdayTenant(slug)
  if (!tenantHit) return null
  const resolved = await resolveWorkdaySite({ tenant: tenantHit.tenant, wd: `wd${tenantHit.wd}` }).catch(() => null)
  const site = resolved?.site ?? "External"
  const jobs = await workdayJobsCount(tenantHit.tenant, tenantHit.wd, site)
  if (jobs.count === 0) return null
  return {
    name, slug: tenantHit.tenant,
    ats_type: "workday",
    ats_identifier: `${tenantHit.tenant}:wd${tenantHit.wd}:${site}`,
    board_url: `https://${tenantHit.tenant}.wd${tenantHit.wd}.myworkdayjobs.com/en-US/${site}`,
    jobs_count: jobs.count,
    sample_titles: jobs.titles,
    company_url: null,
    domain: null,
    probed_at: new Date().toISOString(),
  }
}

// --- iCIMS ----------------------------------------------------------------

async function probeIcims(slug: string, name: string, _hint: string | null): Promise<Hit | null> {
  // Strict slug gate same as Workday — too easy to land on a random tenant otherwise.
  if (!nameMatchesBoard(name, slug)) return null
  // Two common host shapes.
  const candidates = [`careers-${slug}.icims.com`, `${slug}.icims.com`]
  for (const host of candidates) {
    const url = `https://${host}/jobs/intro`
    const r = await fetchWithTimeout(url, { headers: { accept: "text/html" } })
    if (!r.ok || !r.body) continue
    const html = r.body
    // Verify it's actually an iCIMS-branded page with job listings.
    if (!/icims/i.test(html)) continue
    // Pull a few job titles if present. iCIMS markup is variable but job titles
    // commonly appear as <a class="iCIMS_Anchor">Title</a> on the search page.
    const titlesPage = await fetchWithTimeout(`https://${host}/jobs/search?ss=1&searchKeyword=&searchLocation=`, { headers: { accept: "text/html" } })
    const titles: string[] = []
    if (titlesPage.body) {
      const re = /<a[^>]*class="[^"]*iCIMS_Anchor[^"]*"[^>]*>([^<]{4,120})<\/a>/g
      let m: RegExpExecArray | null
      while ((m = re.exec(titlesPage.body)) && titles.length < 5) titles.push(m[1].trim())
    }
    if (titles.length === 0) continue
    return {
      name, slug,
      ats_type: "icims",
      ats_identifier: slug,
      board_url: `https://${host}/jobs/search?ss=1`,
      jobs_count: titles.length,
      sample_titles: titles,
      company_url: null,
      domain: null,
      probed_at: new Date().toISOString(),
    }
  }
  return null
}

const PROBES: Array<{ name: string; fn: (slug: string, name: string, hint: string | null) => Promise<Hit | null> }> = [
  { name: "workable", fn: probeWorkable },
  { name: "workday", fn: probeWorkday },
  { name: "icims", fn: probeIcims },
]

async function probeOne(inputName: string): Promise<Hit | null> {
  const hint = parenHint(inputName)
  const slugs = slugCandidates(inputName)
  if (hint) {
    const sld = hint.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "")
    if (sld && sld.length >= 3 && !slugs.includes(sld)) slugs.unshift(sld)
  }
  for (const slug of slugs) {
    for (const probe of PROBES) {
      if (onlyAts && probe.name !== onlyAts) continue
      const hit = await probe.fn(slug, inputName, hint)
      if (hit) return hit
    }
  }
  return null
}

async function main() {
  const list = readJsonl<ListEntry>(inputPath)
  console.log(`Input: ${inputPath} (${list.length} entries)`)

  // Skip names from the v1 ATS hits sweep (we already know their ATS).
  const v1Hits = readJsonl<{ name: string }>(v1HitsPath)
  const v1Names = new Set(v1Hits.map((h) => h.name.toLowerCase()))
  console.log(`v1 hits to skip: ${v1Names.size}`)

  // Skip names already in DB.
  let dbNames = new Set<string>()
  if (!skipDbCheck) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL!,
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
    })
    const { rows } = await pool.query<{ name: string }>("SELECT lower(name) AS name FROM companies")
    dbNames = new Set(rows.map((r) => r.name))
    await pool.end()
    console.log(`DB names to skip: ${dbNames.size}`)
  }

  const prior = readJsonl<Hit>(outPath)
  const priorNames = new Set(prior.map((h) => h.name.toLowerCase()))
  console.log(`Existing hits in output: ${prior.length}`)

  const candidates = list.filter((e) => {
    const n = e.name.toLowerCase()
    return !dbNames.has(n) && !v1Names.has(n) && !priorNames.has(n)
  })
  const todo = candidates.slice(0, Number.isFinite(limit) ? limit : candidates.length)
  console.log(`Candidates to probe this run: ${todo.length} (filtered from ${candidates.length})`)

  let done = 0
  let hits = 0
  const byAts: Record<string, number> = {}
  const queue = [...todo]
  async function worker() {
    while (queue.length) {
      const entry = queue.shift()!
      const hit = await probeOne(entry.name)
      done++
      if (hit) {
        hits++
        byAts[hit.ats_type] = (byAts[hit.ats_type] ?? 0) + 1
        appendJsonl(outPath, [hit])
      }
      if (done % 25 === 0) {
        console.log(`  ${done}/${todo.length} — hits: ${hits} (${((hits / done) * 100).toFixed(1)}%) ${JSON.stringify(byAts)}  last: ${entry.name}${hit ? " → " + hit.ats_type : ""}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const final = readJsonl<Hit>(outPath)
  const totals: Record<string, number> = {}
  for (const h of final) totals[h.ats_type] = (totals[h.ats_type] ?? 0) + 1
  console.log(`\nDone. Probed ${done}, hits this run: ${hits}. Total in ${outPath}: ${final.length}`)
  console.log(`By ATS:`, totals)
}

main().catch((e) => { console.error(e); process.exit(1) })

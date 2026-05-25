/**
 * Probe ATS APIs directly using slug candidates derived from company names.
 *
 * Why: BuiltIn / Cloudflare-blocked profiles never gave us a domain, so the
 * existing careers-URL discovery pipeline can't run. But many of those
 * companies post jobs on Greenhouse / Lever / Ashby / SmartRecruiters under
 * a slug that's derivable from the company name. We probe those APIs
 * directly (JSON, no Playwright, no HTML scraping) and accept the first slug
 * that returns a valid jobs board with a company-name match.
 *
 * Pipeline:
 *   1. Read names from data/builtinsf-list.jsonl (or --input).
 *   2. For each name not already in the DB (by name match), generate slug
 *      candidates.
 *   3. Probe Greenhouse → Lever → Ashby → SmartRecruiters in that order.
 *   4. Accept the first ATS that returns 200 + non-empty jobs[] AND has a
 *      name-token match in jobs metadata.
 *   5. Try to recover an apex domain from the board's company_url field.
 *      If we can't, write the hit anyway and leave domain blank for the DB
 *      step to skip (or synthesize).
 *
 * Output: data/builtinsf-ats-hits.jsonl (resumable). Each row:
 *   { name, slug, ats_type, ats_identifier, board_url, jobs_count,
 *     sample_titles, company_url, domain, probed_at }
 *
 * Usage:
 *   npx tsx scripts/probe-ats-by-slug.ts --concurrency=12 --limit=200      # smoke
 *   npx tsx scripts/probe-ats-by-slug.ts --concurrency=20                  # full sweep
 *   npx tsx scripts/probe-ats-by-slug.ts --input=data/builtinsf-list.jsonl
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"

const args = process.argv.slice(2)
const concurrency = Math.max(1, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1]) || 12)
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity
const timeoutMs = Number(args.find((a) => a.startsWith("--timeout="))?.split("=")[1]) || 8000
const inputPath = args.find((a) => a.startsWith("--input="))?.split("=")[1] ?? path.join(process.cwd(), "data", "builtinsf-list.jsonl")
const outPath = args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? path.join(process.cwd(), "data", "builtinsf-ats-hits.jsonl")
const skipDbCheck = args.includes("--skip-db-check")

const UA = "Mozilla/5.0 (compatible; HireovenAtsProbe/1.0; +https://hireoven.com)"

const STOPWORDS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
  "ltd", "llc", "lp", "llp", "limited", "plc", "the", "and", "of", "for",
  "group", "holdings", "holding", "international", "global", "us", "usa",
  "america", "north", "solutions", "technologies", "technology", "systems",
  "labs", "studio", "studios", "media", "ventures", "partners", "capital",
  "agency", "ai",
])

type ListEntry = { name: string; profile_path: string; brief: string | null }
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
  probed_at: string
}

function readJsonl<T>(p: string): T[] {
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T)
}
function appendJsonl<T>(p: string, items: T[]) {
  if (!items.length) return
  fs.appendFileSync(p, items.map((i) => JSON.stringify(i)).join("\n") + "\n")
}

function nameTokens(name: string): string[] {
  // Strip parenthetical disambiguators (we extract those separately via parenHint).
  const cleaned = name.replace(/\([^)]*\)/g, " ")
  return cleaned
    .toLowerCase()
    .replace(/[.,&'`]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

// Some BuiltIn names embed an apex domain in parens, e.g.
// "Fellow (fellowproducts.com)". Use that as a strong validator when present.
function parenHint(name: string): string | null {
  const m = name.match(/\(([^)]+)\)/)
  if (!m) return null
  const inner = m[1].trim().toLowerCase()
  // Looks like a domain?
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(inner)) return inner.replace(/^www\./, "")
  return null
}

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

// Validate that the canonical board name from the ATS actually refers to the
// same company. Looser when the name is multi-token (more signal); stricter
// for single-token names where many unrelated companies might share the slug.
function nameMatchesBoard(inputName: string, boardName: string | null | undefined): boolean {
  if (!boardName) return false
  const inputN = normalizeForCompare(inputName)
  const boardN = normalizeForCompare(boardName)
  if (!inputN || !boardN) return false
  if (inputN === boardN) return true
  // Substring either way (covers "Fellow Products" vs "Fellow", "Watershed" vs "Watershed Climate")
  if (boardN.includes(inputN) || inputN.includes(boardN)) return true
  // Token-overlap fallback for messy multi-word names
  const inputTokens = new Set(nameTokens(inputName))
  const boardTokens = new Set(nameTokens(boardName))
  if (inputTokens.size === 0 || boardTokens.size === 0) return false
  let overlap = 0
  for (const t of inputTokens) if (boardTokens.has(t)) overlap++
  // Need at least half the input tokens to appear in the board name.
  return overlap / inputTokens.size >= 0.5 && overlap >= 2
}

function domainMatchesHint(domain: string | null, hint: string | null): boolean {
  if (!hint) return false
  if (!domain) return false
  const d = domain.toLowerCase().replace(/^www\./, "")
  const h = hint.toLowerCase().replace(/^www\./, "")
  return d === h || d.endsWith("." + h) || h.endsWith("." + d)
}

function slugCandidates(name: string): string[] {
  const tokens = nameTokens(name)
  if (tokens.length === 0) return []
  const out = new Set<string>()
  // Variants
  out.add(tokens.join(""))         // mochihealth
  out.add(tokens.join("-"))        // mochi-health
  out.add(tokens[0])               // mochi
  out.add("join" + tokens.join("")) // joinmochi (common pattern)
  if (tokens.length >= 2) {
    out.add(tokens.slice(0, 2).join("")) // first 2 concat
  }
  // Drop very short candidates that would match noisy generic slugs.
  return [...out].filter((s) => s.length >= 3 && s.length <= 40)
}

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; body: any | null }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": UA, accept: "application/json" } })
    let body: any = null
    try { body = await res.json() } catch {}
    return { ok: res.ok, status: res.status, body }
  } catch { return { ok: false, status: 0, body: null } } finally { clearTimeout(t) }
}

function domainFromCompanyUrl(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, "") } catch { return null }
}

// --- ATS probes -----------------------------------------------------------

async function probeGreenhouse(slug: string, name: string, hintDomain: string | null): Promise<Hit | null> {
  const board = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`)
  if (!board.ok || !board.body) return null
  const boardName: string | null = board.body?.name ?? null
  const company_url: string | null = board.body?.company_url ?? null
  const domain = domainFromCompanyUrl(company_url)
  // Strong validators: either the board name matches the input name, OR the
  // company_url domain matches the paren hint from the input name.
  const okByName = nameMatchesBoard(name, boardName)
  const okByDomain = hintDomain && domainMatchesHint(domain, hintDomain)
  if (!okByName && !okByDomain) return null
  const jobsRes = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`)
  const jobs = jobsRes.body?.jobs as Array<{ title: string }> | undefined
  if (!jobsRes.ok || !jobs || jobs.length === 0) return null
  const sampleTitles = jobs.slice(0, 5).map((j) => j.title).filter(Boolean)
  return {
    name, slug,
    ats_type: "greenhouse",
    ats_identifier: slug,
    board_url: `https://boards.greenhouse.io/${slug}`,
    jobs_count: jobs.length,
    sample_titles: sampleTitles,
    company_url,
    domain,
    probed_at: new Date().toISOString(),
  }
}

async function probeLever(slug: string, name: string, hintDomain: string | null): Promise<Hit | null> {
  const jobsRes = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`)
  const jobs = jobsRes.body as Array<{ text: string; applyUrl?: string; hostedUrl?: string; categories?: { team?: string } }> | undefined
  if (!jobsRes.ok || !Array.isArray(jobs) || jobs.length === 0) return null
  const sampleTitles = jobs.slice(0, 5).map((j) => j.text).filter(Boolean)
  // Lever doesn't expose a canonical company name; use the slug itself + paren
  // hint as the validator. The slug must match the input name strictly OR
  // the paren hint domain must match (when present).
  const slugLooksLikeName = nameMatchesBoard(name, slug)
  const okByDomain = hintDomain != null && (slug.includes(hintDomain.split(".")[0]) || hintDomain.split(".")[0].includes(slug))
  if (!slugLooksLikeName && !okByDomain) return null
  return {
    name, slug,
    ats_type: "lever",
    ats_identifier: slug,
    board_url: `https://jobs.lever.co/${slug}`,
    jobs_count: jobs.length,
    sample_titles: sampleTitles,
    company_url: null,
    domain: null,
    probed_at: new Date().toISOString(),
  }
}

async function probeAshby(slug: string, name: string, hintDomain: string | null): Promise<Hit | null> {
  // Ashby's public job board API. Empty board still returns 200 with empty jobs[].
  const res = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`)
  const jobs = res.body?.jobs as Array<{ title: string }> | undefined
  if (!res.ok || !jobs || jobs.length === 0) return null
  const sampleTitles = jobs.slice(0, 5).map((j) => j.title).filter(Boolean)
  // Ashby also lacks board-level company name; rely on slug↔name match.
  const slugLooksLikeName = nameMatchesBoard(name, slug)
  const okByDomain = hintDomain != null && (slug.includes(hintDomain.split(".")[0]) || hintDomain.split(".")[0].includes(slug))
  if (!slugLooksLikeName && !okByDomain) return null
  return {
    name, slug,
    ats_type: "ashby",
    ats_identifier: slug,
    board_url: `https://jobs.ashbyhq.com/${slug}`,
    jobs_count: jobs.length,
    sample_titles: sampleTitles,
    company_url: null,
    domain: null,
    probed_at: new Date().toISOString(),
  }
}

async function probeSmartRecruiters(slug: string, name: string, hintDomain: string | null): Promise<Hit | null> {
  const res = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings`)
  const content = res.body?.content as Array<{ name: string; company?: { name?: string } }> | undefined
  if (!res.ok || !content || content.length === 0) return null
  const sampleTitles = content.slice(0, 5).map((j) => j.name).filter(Boolean)
  const companyName = content[0]?.company?.name ?? null
  const okByName = nameMatchesBoard(name, companyName) || nameMatchesBoard(name, slug)
  const okByDomain = hintDomain != null && (slug.includes(hintDomain.split(".")[0]) || hintDomain.split(".")[0].includes(slug))
  if (!okByName && !okByDomain) return null
  return {
    name, slug,
    ats_type: "smartrecruiters",
    ats_identifier: slug,
    board_url: `https://careers.smartrecruiters.com/${slug}`,
    jobs_count: content.length,
    sample_titles: sampleTitles,
    company_url: null,
    domain: null,
    probed_at: new Date().toISOString(),
  }
}

const PROBES = [probeGreenhouse, probeAshby, probeLever, probeSmartRecruiters]

async function probeOne(name: string): Promise<Hit | null> {
  const slugs = slugCandidates(name)
  const hint = parenHint(name)
  // Also try the paren-hint SLD as a slug candidate (e.g. fellowproducts.com → fellowproducts).
  if (hint) {
    const sld = hint.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "")
    if (sld && !slugs.includes(sld) && sld.length >= 3) slugs.unshift(sld)
  }
  for (const slug of slugs) {
    for (const probe of PROBES) {
      const hit = await probe(slug, name, hint)
      if (hit) return hit
    }
  }
  return null
}

async function main() {
  const list = readJsonl<ListEntry>(inputPath)
  if (list.length === 0) {
    console.error(`No entries at ${inputPath}`)
    process.exit(1)
  }
  console.log(`Input: ${inputPath} (${list.length} entries)`)

  // Skip names already known to the DB (by case-insensitive name) so we don't
  // spam ATS endpoints for companies that are already wired up.
  let knownNames = new Set<string>()
  if (!skipDbCheck) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL!,
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
    })
    const { rows } = await pool.query<{ name: string }>("SELECT lower(name) AS name FROM companies")
    knownNames = new Set(rows.map((r) => r.name))
    await pool.end()
    console.log(`Loaded ${knownNames.size} known company names from DB`)
  }

  const prior = readJsonl<Hit>(outPath)
  const priorNames = new Set(prior.map((h) => h.name.toLowerCase()))
  console.log(`Existing hits in output: ${prior.length}`)

  const candidates = list.filter((e) => !knownNames.has(e.name.toLowerCase()) && !priorNames.has(e.name.toLowerCase()))
  const todo = candidates.slice(0, Number.isFinite(limit) ? limit : candidates.length)
  console.log(`Candidates to probe this run: ${todo.length} (skipping ${candidates.length - todo.length} due to --limit)`)

  let done = 0
  let hits = 0
  const queue = [...todo]
  async function worker() {
    while (queue.length) {
      const entry = queue.shift()!
      const hit = await probeOne(entry.name)
      done++
      if (hit) {
        hits++
        appendJsonl(outPath, [hit])
      }
      if (done % 25 === 0) {
        console.log(`  ${done}/${todo.length} — hits: ${hits} (${((hits / done) * 100).toFixed(1)}%)  last: ${entry.name}${hit ? " → " + hit.ats_type + ":" + hit.slug : ""}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const final = readJsonl<Hit>(outPath)
  const byAts: Record<string, number> = {}
  for (const h of final) byAts[h.ats_type] = (byAts[h.ats_type] ?? 0) + 1
  console.log(`\nDone. Probed ${done}, hits this run: ${hits}. Total hits in ${outPath}: ${final.length}`)
  console.log(`By ATS:`, byAts)
}

main().catch((e) => { console.error(e); process.exit(1) })

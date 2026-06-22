/**
 * One-off: re-attribute the "Jack Jill External ATS" aggregator jobs.
 *
 * jobs.ashbyhq.com/jack-jill-external-ats is NOT an employer ATS — it's an
 * aggregator feed run by Jack & Jill (jackandjill.ai, an AI career agent) that
 * lists OTHER startups' jobs. All such jobs were ingested under one fake company
 * with the real employer embedded in the title ("... at AgentMail").
 *
 * This splits them back out:
 *   - matched   : title employer matches an existing real company -> reassign
 *   - by-domain : employer string is a domain (console.com) -> upsert company + logo.dev
 *   - by-name   : real-looking name, no domain -> create placeholder company
 *   - anonymous : "stealth / well-funded / high-growth ... startup" -> deactivate job
 * Then it stops the harvester from re-pulling the board.
 *
 *   npx tsx scripts/reattribute-jackjill-jobs.ts            # dry-run (report only)
 *   npx tsx scripts/reattribute-jackjill-jobs.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())
const execute = process.argv.includes("--execute")

const JJ_ID = "696cb6df-ee52-424f-b9e2-41968c664a8d"
const LOGO_TOKEN = "pk_MACdTFH8R7amdP1xzJHfow"

type Job = { id: string; title: string }
type Comp = { id: string; name: string; domain: string }

function parseEmployer(title: string): string | null {
  const m = title.match(/\bat\s+([^]+?)\s*$/i)
  if (!m) return null
  const e = m[1].replace(/\s*\((?:[^()]*)\)\s*$/, "").trim()
  return e || null
}
function cleanTitle(title: string): string {
  return title.replace(/\s+at\s+[^]+?$/i, "").trim()
}
function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|corp|ltd|co|the)\b/g, "").replace(/\s+/g, " ").trim()
}
const ANON_RE =
  /\b(stealth|well[- ]?funded|rapidly[- ]?growing|high[- ]?growth|fast[- ]?growing|vc[- ]?backed|early[- ]?stage|series [a-d]|seed[- ]?stage|venture[- ]?backed|growth[- ]?stage)\b/i
function isAnonymous(e: string): boolean {
  if (ANON_RE.test(e)) return true
  // pure descriptor ending in startup/company/platform with no proper noun
  if (/\b(startup|company|platform|business)\s*$/i.test(e) && !/[A-Z][a-z]/.test(e.replace(/\b(AI|the|a|an)\b/gi, ""))) return true
  return false
}
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i
function asDomain(e: string): string | null {
  const t = e.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")
  return DOMAIN_RE.test(t) && /\.(com|ai|io|co|tech|net|org|dev|app|xyz)$/i.test(t) ? t : null
}
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "company"
}
const logo = (d: string) => `https://img.logo.dev/${d}?token=${LOGO_TOKEN}&size=256&format=png`

async function main() {
  console.log(`[reattribute-jj] mode=${execute ? "execute" : "dry-run"}`)
  const pool = getPostgresPool()
  const { rows: jobs } = await pool.query<Job>(`SELECT id, title FROM jobs WHERE company_id=$1 AND is_active`, [JJ_ID])
  const { rows: comps } = await pool.query<Comp>(`SELECT id, name, domain FROM companies`)

  const byName = new Map<string, Comp>()
  const byDomain = new Map<string, Comp>()
  for (const c of comps) {
    const n = norm(c.name)
    if (n && !byName.has(n)) byName.set(n, c)
    if (c.domain) byDomain.set(c.domain.toLowerCase(), c)
  }

  const buckets = { matched: 0, byDomain: 0, byName: 0, anonymous: 0, noParse: 0 }
  const createdDomains = new Map<string, string>() // domain -> companyId (within this run)
  const newCompanyCache = new Map<string, string>() // synthetic key -> companyId

  async function ensureCompanyByDomain(name: string, domain: string): Promise<string> {
    const existing = byDomain.get(domain) ?? (createdDomains.has(domain) ? ({ id: createdDomains.get(domain)! } as Comp) : null)
    if (existing) return existing.id
    if (!execute) { createdDomains.set(domain, "DRYRUN"); return "DRYRUN" }
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, domain, careers_url, logo_url, is_active)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (domain) DO UPDATE SET logo_url=COALESCE(NULLIF(companies.logo_url,''), EXCLUDED.logo_url)
       RETURNING id`,
      [name, domain, `https://${domain}`, logo(domain)]
    )
    const id = rows[0]!.id
    createdDomains.set(domain, id)
    return id
  }
  async function ensureCompanyByName(name: string): Promise<string> {
    const synthDomain = `jj-${slug(name)}.sourced`
    if (newCompanyCache.has(synthDomain)) return newCompanyCache.get(synthDomain)!
    const existing = byDomain.get(synthDomain)
    if (existing) { newCompanyCache.set(synthDomain, existing.id); return existing.id }
    if (!execute) { newCompanyCache.set(synthDomain, "DRYRUN"); return "DRYRUN" }
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, domain, careers_url, is_active) VALUES ($1,$2,$3,true)
       ON CONFLICT (domain) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      [name, synthDomain, `https://${synthDomain}`]
    )
    const id = rows[0]!.id
    newCompanyCache.set(synthDomain, id)
    return id
  }

  const sampleByName: string[] = []
  for (const job of jobs) {
    const employer = parseEmployer(job.title)
    if (!employer) { buckets.noParse++; continue }
    const newTitle = cleanTitle(job.title)

    if (isAnonymous(employer)) {
      buckets.anonymous++
      if (execute) await pool.query(`UPDATE jobs SET is_active=false, closed_at=now() WHERE id=$1`, [job.id])
      continue
    }
    const hit = byName.get(norm(employer))
    if (hit && !/placeholder|discovered|\.sourced/.test(hit.domain)) {
      buckets.matched++
      if (execute) await pool.query(`UPDATE jobs SET company_id=$1, title=$2 WHERE id=$3`, [hit.id, newTitle, job.id])
      continue
    }
    const dom = asDomain(employer)
    if (dom) {
      buckets.byDomain++
      const cid = await ensureCompanyByDomain(employer.replace(/\.(com|ai|io|co|tech|net|org|dev|app|xyz)$/i, ""), dom)
      if (execute) await pool.query(`UPDATE jobs SET company_id=$1, title=$2 WHERE id=$3`, [cid, newTitle, job.id])
      continue
    }
    buckets.byName++
    if (sampleByName.length < 30) sampleByName.push(employer)
    const cid = await ensureCompanyByName(employer)
    if (execute) await pool.query(`UPDATE jobs SET company_id=$1, title=$2 WHERE id=$3`, [cid, newTitle, job.id])
  }

  // Stop the harvester from re-pulling the aggregator board.
  if (execute) {
    await pool.query(
      `UPDATE companies SET ats_type=NULL, ats_identifier=NULL, direct_ats_identifier=NULL, direct_ats_url=NULL, is_active=false WHERE id=$1`,
      [JJ_ID]
    )
  }

  console.log("[reattribute-jj] buckets:", JSON.stringify(buckets))
  console.log(`[reattribute-jj] new companies (by-domain=${createdDomains.size}, by-name=${newCompanyCache.size})`)
  console.log("[reattribute-jj] sample by-name (placeholder) employers:", sampleByName.join(" | "))
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })

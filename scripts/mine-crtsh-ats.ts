/**
 * Bulk-mine crt.sh Certificate Transparency logs for ATS tenant subdomains.
 *
 * crt.sh logs every TLS certificate ever issued, including wildcard certs for
 * ATS-hosted job boards. Every `company.bamboohr.com`, `company.teamtailor.com`,
 * `company.icims.com`, etc. appears here within days of the cert being issued.
 *
 * Unlike the cron-based crtsh stage (limited to 300s), this script runs without
 * a time budget and processes the full crt.sh result set for each ATS apex.
 *
 * Targets (subdomain-per-tenant ATSes):
 *   bamboohr, teamtailor, recruitee, jazzhr, personio,
 *   successfactors, taleo, icims, workable
 *
 * Usage:
 *   npx tsx scripts/mine-crtsh-ats.ts                          # dry-run all
 *   npx tsx scripts/mine-crtsh-ats.ts --execute
 *   npx tsx scripts/mine-crtsh-ats.ts --execute --ats=bamboohr,teamtailor
 *
 * Env:
 *   DATABASE_URL — required
 */

import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { detectAdapter } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { discoverHostsForApex } from "@/lib/harvester/discovery/crtsh"
import { humanizeSeedSlug } from "@/app/api/cron/discover-companies/route"
import type { AtsName } from "@/lib/harvester/adapters"

// ─── Targets ─────────────────────────────────────────────────────────────────

type CrtshTarget = {
  ats: AtsName
  apex: string
  /** Map a discovered host + slug to the canonical careers URL, or null to skip. */
  toUrl: (host: string, slug: string) => string | null
}

// Vendor-reserved subdomains that should never be enrolled as tenants.
const BAMBOOHR_RESERVED = new Set(["www","api","app","cdn","files","static","help","support","status","blog","careers","jobs","hire","recruiting","enterprise","trial","demo"])
const ICIMS_RESERVED    = new Set(["www","api","cdn","developer","images","community","partners","trust","legal","app","status","support","help","blog","careers"])
const SF_RESERVED       = new Set(["www","api","cdn","help","support","blog","status","app","login","sso","service"])
const TALEO_RESERVED    = new Set(["www","api","cdn","app","help","support","status","blog","careers","jobs"])
const TT_RESERVED       = new Set(["www","api","cdn","app","help","support","status","blog","careers","jobs","hire","media"])

const CRTSH_TARGETS: CrtshTarget[] = [
  {
    ats: "bamboohr",
    apex: "bamboohr.com",
    toUrl: (h, s) => {
      if (BAMBOOHR_RESERVED.has(s.toLowerCase())) return null
      return `https://${h}/careers`
    },
  },
  {
    ats: "teamtailor",
    apex: "teamtailor.com",
    toUrl: (h, s) => {
      if (TT_RESERVED.has(s.toLowerCase())) return null
      return `https://${h}/`
    },
  },
  {
    ats: "recruitee",
    apex: "recruitee.com",
    toUrl: (h, s) => {
      if (s.toLowerCase() === "www" || s.toLowerCase() === "app") return null
      return `https://${h}/`
    },
  },
  {
    ats: "jazzhr",
    apex: "applytojob.com",
    toUrl: (h, s) => {
      if (s.toLowerCase() === "www") return null
      return `https://${h}/`
    },
  },
  {
    ats: "personio",
    apex: "personio.com",
    toUrl: (h) => {
      const l = h.toLowerCase()
      if (l.endsWith(".jobs.personio.com") || l.endsWith(".jobs.personio.de")) return `https://${l}/`
      return null
    },
  },
  {
    ats: "successfactors",
    apex: "successfactors.com",
    toUrl: (h, s) => {
      if (SF_RESERVED.has(s.toLowerCase())) return null
      // SuccessFactors career sites are at {company}.successfactors.com/careers or /sf/careers
      return `https://${h}/careers`
    },
  },
  {
    ats: "taleo",
    apex: "taleo.net",
    toUrl: (h, s) => {
      if (TALEO_RESERVED.has(s.toLowerCase())) return null
      return `https://${h}/careersection/jobsearch.ftl`
    },
  },
  {
    ats: "icims",
    apex: "icims.com",
    toUrl: (h, s) => {
      if (ICIMS_RESERVED.has(s.toLowerCase())) return null
      if (!/^\w[\w-]*$/.test(s)) return null
      return `https://${h}/jobs/search`
    },
  },
  {
    ats: "workable",
    apex: "workable.com",
    toUrl: (_h, s) => {
      if (s.toLowerCase() === "www" || s.toLowerCase() === "apply") return null
      return `https://apply.workable.com/${s}/`
    },
  },
]

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2)
const execute   = args.includes("--execute")
const atsFilter = args.find(a => a.startsWith("--ats="))?.split("=")[1]?.split(",").map(s => s.trim()) ?? []

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error("DATABASE_URL not set — aborting"); process.exit(1) }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  const targets = atsFilter.length > 0
    ? CRTSH_TARGETS.filter(t => atsFilter.includes(t.ats))
    : CRTSH_TARGETS

  if (targets.length === 0) {
    console.error(`No targets match --ats=${atsFilter.join(",")}. Available: ${CRTSH_TARGETS.map(t => t.ats).join(", ")}`)
    await pool.end(); process.exit(1)
  }

  console.log(`[mine-crtsh] mode=${execute ? "execute" : "dry-run"}`)
  console.log(`[mine-crtsh] targets: ${targets.map(t => t.apex).join(", ")}`)

  // Load all known (ats_type, ats_identifier) pairs once — used for dedup.
  const { rows: knownRows } = await pool.query<{ ats_type: string; ats_identifier: string }>(
    `SELECT ats_type, lower(ats_identifier) AS ats_identifier
       FROM companies WHERE ats_type IS NOT NULL AND ats_identifier IS NOT NULL`
  )
  const knownKeys = new Set(knownRows.map(r => `${r.ats_type}:${r.ats_identifier}`))
  console.log(`[mine-crtsh] known companies with ATS: ${knownKeys.size}`)

  const totals = { found: 0, new: 0, enrolled: 0, skipped: 0, errors: 0 }

  for (const target of targets) {
    console.log(`\n[mine-crtsh] querying crt.sh for *.${target.apex} …`)

    let hosts
    try {
      hosts = await discoverHostsForApex(target.apex, { timeoutMs: 120_000, maxAttempts: 3 })
    } catch (err) {
      console.warn(`  ⚠ crt.sh query failed for ${target.apex}: ${err instanceof Error ? err.message : err}`)
      continue
    }

    console.log(`  crt.sh returned ${hosts.length} hosts for ${target.apex}`)
    totals.found += hosts.length

    // Map hosts → canonical URLs, detect adapter, dedup.
    const newCandidates: Array<{ url: string; ats: string; slug: string; domain: string }> = []
    const batchSeen = new Set<string>()

    for (const h of hosts) {
      const url = target.toUrl(h.host, h.slug)
      if (!url) continue

      const det = detectAdapter(url)
      if (!det || det.adapter.name !== target.ats) continue

      const slug  = det.slug.toLowerCase()
      const key   = `${target.ats}:${slug}`
      if (batchSeen.has(key)) continue
      batchSeen.add(key)

      if (knownKeys.has(key)) continue

      let domain: string
      try { domain = new URL(url).hostname } catch { domain = url }

      newCandidates.push({ url, ats: target.ats, slug: det.slug, domain })
    }

    totals.new += newCandidates.length
    console.log(`  ${batchSeen.size} unique tenants → ${newCandidates.length} new (not in DB)`)
    if (newCandidates.length === 0) continue

    if (!execute) {
      console.log(`  sample: ${newCandidates.slice(0, 5).map(c => c.slug).join(", ")}`)
      continue
    }

    let apexEnrolled = 0
    for (const c of newCandidates) {
      const careersUrl = canonicalCareersUrl(c.ats as AtsName, c.slug) ?? c.url
      const name       = humanizeSeedSlug(c.ats, c.slug)
      try {
        const r = await pool.query(
          `INSERT INTO companies
             (name, domain, careers_url, ats_type, ats_identifier,
              is_active, status, freshness_tier, discovered_via)
           VALUES ($1,$2,$3,$4,$5,true,'active','tier_3','crtsh-bulk-miner')
           ON CONFLICT (domain) DO NOTHING
           RETURNING id`,
          [name, c.domain, careersUrl, c.ats, c.slug]
        )
        if (r.rowCount && r.rowCount > 0) {
          knownKeys.add(`${c.ats}:${c.slug.toLowerCase()}`)
          apexEnrolled++
          totals.enrolled++
        } else {
          totals.skipped++
        }
      } catch (err) {
        totals.errors++
        if (totals.errors <= 5) {
          console.warn(`  insert error for ${c.slug}: ${err instanceof Error ? err.message : err}`)
        }
      }
    }
    console.log(`  apex=${target.apex} → enrolled=${apexEnrolled}`)
  }

  console.log(`\n[mine-crtsh] DONE`)
  console.log(`  crt.sh hosts found:  ${totals.found}`)
  console.log(`  new (not in DB):     ${totals.new}`)
  console.log(`  enrolled:            ${totals.enrolled}`)
  console.log(`  skipped (conflict):  ${totals.skipped}`)
  console.log(`  errors:              ${totals.errors}`)
  if (!execute) console.log("\nDry-run — use --execute to write to DB.")

  if (execute && totals.enrolled > 0) {
    await pool.query(
      `INSERT INTO discovery_runs (channel, candidates_found, candidates_enrolled, candidates_held, candidates_rejected)
       VALUES ('crtsh-bulk-miner',$1,$2,0,0)`,
      [totals.new, totals.enrolled]
    ).catch(() => {})
  }

  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })

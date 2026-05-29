/**
 * Replace ATS-tenant subdomains in companies.domain with the real brand
 * domain.
 *
 * Example: salesforce.wd12.myworkdayjobs.com → salesforce.com.
 *
 * Steps per row:
 *   1. Derive a brand-domain candidate from the existing ATS subdomain.
 *   2. Probe logo.dev — if it returns 200, we have a real brand mark
 *      and can trust the derived domain.
 *   3. Check the UNIQUE constraint by selecting companies WHERE domain =
 *      candidate. If a different row already owns it, log + skip (we
 *      don't auto-merge to avoid breaking jobs.company_id foreign keys
 *      in a one-shot run).
 *   4. Otherwise UPDATE domain and refresh logo_url to the canonical
 *      logo.dev URL for the new domain.
 *
 * Side effects: writes a backup CSV at /tmp/ats-domain-backfill-<ts>.csv
 * with id, old_domain, new_domain so we can revert with a simple SQL
 * upsert if needed.
 *
 *   npx tsx scripts/backfill-ats-domains.ts          # executes
 *   npx tsx scripts/backfill-ats-domains.ts --dry-run
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { writeFileSync, appendFileSync } from "node:fs"

loadEnvConfig(process.cwd())

import { Pool } from "pg"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1]
const ROW_LIMIT = limitArg ? Number(limitArg) : Infinity

const TOKEN =
  process.env.LOGO_DEV_TOKEN ||
  process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ||
  ""

if (!TOKEN) {
  console.error("LOGO_DEV_TOKEN not set in env — aborting")
  process.exit(1)
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set in env — aborting")
  process.exit(1)
}

const BACKUP_PATH = `/tmp/ats-domain-backfill-${Date.now()}.csv`

type Row = {
  id: string
  name: string
  domain: string
  careers_url: string | null
}

// Generic subdomain prefixes that ATSes use as shared hosts (not real tenant
// names). If the first subdomain matches one of these, we can't derive a brand.
const GENERIC_ATS_PREFIXES = new Set([
  "jobs", "boards", "board", "job-boards", "careers", "career",
  "talent", "hire", "work", "join", "ats", "apply", "applications",
  "www", "app", "main",
])

function brandFromAtsDomain(domain: string): string | null {
  const d = domain.toLowerCase().trim()
  const accept = (tenant: string | undefined): string | null => {
    if (!tenant || GENERIC_ATS_PREFIXES.has(tenant) || tenant.length < 2) return null
    return `${tenant}.com`
  }
  let m: RegExpMatchArray | null

  m = d.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/)
  if (m) return accept(m[1])

  m = d.match(/^([a-z0-9-]+)\.applytojob\.com$/)
  if (m) return accept(m[1])

  m = d.match(/^([a-z0-9-]+)\.greenhouse\.io$/)
  if (m) return accept(m[1])

  m = d.match(/^([a-z0-9-]+)\.lever(?:-jobs)?\.co$/)
  if (m) return accept(m[1])

  m = d.match(/^([a-z0-9-]+)\.ashbyhq\.com$/)
  if (m) return accept(m[1])

  m = d.match(/^(?:careers-)?([a-z0-9-]+)\.icims\.com$/)
  if (m) return accept(m[1])

  m = d.match(/^([a-z0-9-]+)\.smartrecruiters\.com$/)
  if (m) return accept(m[1])

  m = d.match(/^([a-z0-9-]+)\.bamboohr\.com$/)
  if (m) return accept(m[1])

  m = d.match(/^([a-z0-9-]+)\.rippling\.com$/)
  if (m) return accept(m[1])

  return null
}

function brandFromCareersUrl(careersUrl: string | null): string | null {
  if (!careersUrl) return null
  let parsed: URL
  try {
    parsed = new URL(careersUrl)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
  const firstSegment = parsed.pathname.replace(/^\/+/, "").split("/")[0]?.toLowerCase() ?? ""

  const sharedHosts = [
    "jobs.lever.co",
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "jobs.ashbyhq.com",
    "careers.smartrecruiters.com",
    "boards.eu.greenhouse.io",
  ]
  if (sharedHosts.includes(host) && /^[a-z0-9-]+$/.test(firstSegment)) {
    return `${firstSegment}.com`
  }
  return null
}

async function probeLogoDev(domain: string): Promise<boolean> {
  const url = `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(TOKEN)}`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, { method: "GET", signal: ctrl.signal })
    try { await res.arrayBuffer() } catch { /* ignore */ }
    clearTimeout(t)
    return res.status === 200
  } catch {
    return false
  }
}

function logoUrlFor(brand: string): string {
  return `https://img.logo.dev/${encodeURIComponent(brand)}?token=${encodeURIComponent(TOKEN)}&size=256&format=png`
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  // Pull every active row whose domain matches an ATS pattern.
  const { rows } = await pool.query<Row>(
    `SELECT id, name, domain, careers_url
       FROM companies
      WHERE is_active = true
        AND duplicate_of_company_id IS NULL
        AND (
          domain ~* '\\.wd\\d+\\.myworkdayjobs\\.com$'
          OR domain ILIKE '%.applytojob.com'
          OR domain ILIKE '%.greenhouse.io'
          OR domain ~* '\\.lever(-jobs)?\\.co$'
          OR domain ILIKE '%.ashbyhq.com'
          OR domain ILIKE '%.icims.com'
          OR domain ILIKE '%.smartrecruiters.com'
          OR domain ILIKE '%.bamboohr.com'
          OR domain ILIKE '%.rippling.com'
        )
      ORDER BY job_count DESC NULLS LAST, name`
  )

  const work = rows.slice(0, ROW_LIMIT)
  console.log(`[backfill-ats-domains] mode=${dryRun ? "dry-run" : "execute"} candidates=${work.length}`)

  if (!dryRun) {
    writeFileSync(BACKUP_PATH, "id,old_domain,new_domain\n")
    console.log(`[backfill-ats-domains] backup CSV: ${BACKUP_PATH}`)
  }

  const limiter = pLimit(12)
  let renamed = 0
  let collisions = 0
  let nocandidate = 0
  let noprobe = 0
  const collisionSample: string[] = []
  const nocandidateSample: string[] = []

  await Promise.all(
    work.map((row) =>
      limiter(async () => {
        const candidate = brandFromAtsDomain(row.domain) ?? brandFromCareersUrl(row.careers_url)
        if (!candidate) {
          nocandidate += 1
          if (nocandidateSample.length < 10) nocandidateSample.push(`${row.name}  ${row.domain}`)
          return
        }

        // Confidence check: logo.dev must have a real brand mark.
        if (!(await probeLogoDev(candidate))) {
          noprobe += 1
          return
        }

        // UNIQUE constraint check — skip if another row already owns the target.
        const existing = await pool.query<{ id: string }>(
          `SELECT id FROM companies WHERE lower(domain) = lower($1) AND id <> $2 LIMIT 1`,
          [candidate, row.id]
        )
        if (existing.rowCount && existing.rowCount > 0) {
          collisions += 1
          if (collisionSample.length < 10) {
            collisionSample.push(`${row.name}  ${row.domain} → ${candidate} (already taken by ${existing.rows[0].id})`)
          }
          return
        }

        if (dryRun) {
          renamed += 1
          if (renamed <= 10) console.log(`  would rename ${row.name}: ${row.domain} → ${candidate}`)
          return
        }

        try {
          await pool.query(
            `UPDATE companies
                SET domain = $1,
                    logo_url = $2,
                    updated_at = now()
              WHERE id = $3`,
            [candidate, logoUrlFor(candidate), row.id]
          )
          appendFileSync(BACKUP_PATH, `${row.id},${row.domain},${candidate}\n`)
          renamed += 1
        } catch (err) {
          // Concurrent insert claimed the domain between our check and update.
          collisions += 1
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(`[backfill-ats-domains] update failed for ${row.id} (${row.domain}→${candidate}): ${msg}`)
        }

        if ((renamed + collisions + nocandidate + noprobe) % 100 === 0) {
          console.log(
            `  progress: renamed=${renamed} collisions=${collisions} no-candidate=${nocandidate} no-probe=${noprobe}`
          )
        }
      })
    )
  )

  console.log(`\n[backfill-ats-domains] done`)
  console.log(`  renamed:        ${renamed}`)
  console.log(`  collisions:     ${collisions}`)
  console.log(`  no candidate:   ${nocandidate}`)
  console.log(`  no logo.dev:    ${noprobe}`)

  if (collisionSample.length > 0) {
    console.log(`\nCollision sample (skipped — target domain already owned):`)
    for (const s of collisionSample) console.log(`  ${s}`)
  }
  if (nocandidateSample.length > 0) {
    console.log(`\nNo-candidate sample (couldn't derive brand from ATS domain):`)
    for (const s of nocandidateSample) console.log(`  ${s}`)
  }

  if (!dryRun) {
    console.log(`\nTo revert all renames in this run:`)
    console.log(`  psql $DATABASE_URL -c "\\copy ats_rename_backup FROM '${BACKUP_PATH}' WITH (FORMAT csv, HEADER true);"`)
    console.log(`  then UPDATE companies SET domain = old FROM ats_rename_backup WHERE companies.id = ats_rename_backup.id;`)
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

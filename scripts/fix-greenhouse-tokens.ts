/**
 * Probe Greenhouse's public boards API to find the correct token for companies
 * that currently 404 on their stored ats_identifier.
 *
 * For each candidate, tries:
 *   1. Current ats_identifier
 *   2. Slugified company name + common variants
 * The first token that returns 200 from boards-api.greenhouse.io wins.
 *
 * DRY RUN by default; --execute to write.
 *
 *   npx tsx scripts/fix-greenhouse-tokens.ts
 *   npx tsx scripts/fix-greenhouse-tokens.ts --execute
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"

const execute = process.argv.includes("--execute")

type Candidate = {
  id: string
  name: string
  ats_identifier: string | null
  careers_url: string
  direct_ats_url: string | null
  job_count: number | null
}

async function fetchBoardOk(token: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number | null; jobs: number | null }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`,
      { signal: ctrl.signal, headers: { accept: "application/json" } }
    )
    if (!res.ok) return { ok: false, status: res.status, jobs: null }
    const body = (await res.json()) as { jobs?: unknown[] }
    return { ok: true, status: 200, jobs: Array.isArray(body.jobs) ? body.jobs.length : 0 }
  } catch {
    return { ok: false, status: null, jobs: null }
  } finally {
    clearTimeout(t)
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^-+|-+$/g, "")
}

function tokenCandidates(name: string, currentToken: string | null): string[] {
  const set = new Set<string>()
  if (currentToken) set.add(currentToken)
  const base = slug(name)
  set.add(base)
  // common suffix variants
  for (const suf of ["careers", "jobs", "inc", "hq", "corporate", "corp", "team", "ai"]) {
    set.add(base + suf)
    set.add(base + "-" + suf)
  }
  // kebab variant
  set.add(name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]+/g, ""))
  return [...set].filter(Boolean)
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  const { rows } = await pool.query<Candidate>(
    `SELECT c.id, c.name, c.ats_identifier, c.careers_url, c.direct_ats_url, c.job_count
     FROM companies c
     WHERE c.ats_type = 'greenhouse'
       AND c.is_active = true
       AND c.status = 'active'
       AND c.name IN ('Coinbase','DoorDash','GitHub','HashiCorp','Hebbia','Klarna','Patreon','Plaid','Ramp','Retool','Revolut','Sourcegraph','Grammarly')
     ORDER BY c.name`
  )

  console.log(`Probing ${rows.length} real-brand candidates...\n`)
  type Result = { id: string; name: string; current: string | null; found: string | null; jobs: number | null }
  const results: Result[] = []
  for (const r of rows) {
    const candidates = tokenCandidates(r.name, r.ats_identifier)
    let found: { token: string; jobs: number | null } | null = null
    let tried = 0
    for (const tok of candidates) {
      tried++
      const res = await fetchBoardOk(tok)
      if (res.ok) {
        found = { token: tok, jobs: res.jobs }
        break
      }
    }
    const status = found
      ? `✓ found token "${found.token}" (${found.jobs} jobs)`
      : `✗ no valid token among ${tried} candidates`
    console.log(`  ${r.name.padEnd(15)} (current: ${r.ats_identifier ?? "(null)"})  ${status}`)
    results.push({ id: r.id, name: r.name, current: r.ats_identifier, found: found?.token ?? null, jobs: found?.jobs ?? null })
  }

  const fixable = results.filter((r) => r.found && r.found !== r.current)
  const deadEnd = results.filter((r) => !r.found)

  console.log(`\nSummary:`)
  console.log(`  Discovered new token: ${fixable.length}`)
  console.log(`  No working token found: ${deadEnd.length}`)

  if (!execute) {
    console.log(`\nDry run only. Re-run with --execute to write fixes (and deactivate dead-ends).`)
    await pool.end()
    return
  }

  for (const r of fixable) {
    await pool.query(
      `UPDATE companies
       SET ats_identifier = $2,
           careers_url    = 'https://boards.greenhouse.io/' || $2,
           direct_ats_url = 'https://boards.greenhouse.io/' || $2,
           updated_at     = now()
       WHERE id = $1`,
      [r.id, r.found]
    )
  }
  for (const r of deadEnd) {
    await pool.query(
      `UPDATE companies
       SET is_active = false,
           status    = 'dead',
           notes     = COALESCE(notes || E'\n', '') || 'greenhouse_token_unresolved; deactivated 2026-05-22',
           updated_at = now()
       WHERE id = $1`,
      [r.id]
    )
  }
  console.log(`\nDone. Updated ${fixable.length} tokens; deactivated ${deadEnd.length} unresolvable.`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })

/**
 * Backfill companies.careers_url with canonical URLs (HTTPS, ATS-aware, job-URL–inferred).
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Loads env from .env.local via @next/env (same as Next.js).
 *
 * Usage: npx tsx scripts/backfill-company-careers-urls.ts
 * Options: --dry-run (print only, no updates)
 */

import { loadEnvConfig } from "@next/env"
import { createClient } from "@supabase/supabase-js"
import {
  deriveCanonicalCareersUrl,
  type CompanyUrlInput,
} from "../lib/companies/canonical-careers-url"

loadEnvConfig(process.cwd())

const dryRun = process.argv.includes("--dry-run")

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: companies, error: cErr } = await supabase
    .from("companies")
    .select("id, name, domain, careers_url, ats_type, ats_identifier")

  if (cErr || !companies) {
    console.error(cErr?.message ?? "No companies")
    process.exit(1)
  }

  const { data: jobs, error: jErr } = await supabase
    .from("jobs")
    .select("company_id, apply_url")
    .eq("is_active", true)

  if (jErr) {
    console.error(jErr.message)
    process.exit(1)
  }

  const applyByCompany = new Map<string, string[]>()
  for (const row of jobs ?? []) {
    const cid = row.company_id as string
    const au = row.apply_url as string
    if (!cid || !au) continue
    const list = applyByCompany.get(cid) ?? []
    list.push(au)
    applyByCompany.set(cid, list)
  }

  let updated = 0
  let unchanged = 0

  for (const row of companies) {
    const input: CompanyUrlInput = {
      domain: row.domain,
      careers_url: row.careers_url,
      ats_type: row.ats_type,
      ats_identifier: row.ats_identifier,
    }
    const applyUrls = applyByCompany.get(row.id) ?? []
    const next = deriveCanonicalCareersUrl(input, { applyUrls })

    const prev = row.careers_url?.trim() ?? ""
    if (prev === next) {
      unchanged++
      continue
    }

    console.log(
      `${dryRun ? "[dry-run] " : ""}${row.name} (${row.domain})\n  ${prev || "(empty)"}\n  → ${next}`
    )

    if (!dryRun) {
      const { error } = await supabase
        .from("companies")
        .update({ careers_url: next, updated_at: new Date().toISOString() })
        .eq("id", row.id)
      if (error) {
        console.error(`  FAILED: ${error.message}`)
      } else {
        updated++
      }
    } else {
      updated++
    }
  }

  console.log(
    `\nDone. ${dryRun ? "Would update" : "Updated"}: ${updated}, unchanged: ${unchanged}, companies: ${companies.length}`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

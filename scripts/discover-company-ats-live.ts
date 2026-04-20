/**
 * Live ATS discovery by fetching company careers pages and scanning ATS signatures.
 *
 * Usage:
 *   npx tsx scripts/discover-company-ats-live.ts --limit=300
 *   npx tsx scripts/discover-company-ats-live.ts --limit=300 --dry-run
 *
 * Notes:
 * - Requires network access.
 * - This script updates companies.ats_type when detection confidence is high/medium.
 * - Existing non-custom ats_type values are preserved unless --overwrite is passed.
 */

import { loadEnvConfig } from "@next/env"
import { createClient } from "@supabase/supabase-js"
import { detectAtsFromHtml } from "../lib/companies/ats-signatures"
import { detectAtsFromUrl } from "../lib/companies/detect-ats"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const overwrite = args.includes("--overwrite")
const limitArg = args.find((arg) => arg.startsWith("--limit="))
const limit = Math.max(1, Number(limitArg?.split("=")[1] ?? "1200"))
const concurrency = 10

type CompanyRow = {
  id: string
  name: string
  domain: string
  careers_url: string
  ats_type: string | null
}

async function fetchHtml(url: string, timeoutMs = 8000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HireovenAtsDiscovery/1.0; +https://hireoven.com)",
      },
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function buildCandidateUrls(careersUrl: string): string[] {
  const out = new Set<string>()
  out.add(careersUrl)

  try {
    const parsed = new URL(careersUrl)
    const origin = parsed.origin
    out.add(origin)
    out.add(`${origin}/careers`)
    out.add(`${origin}/jobs`)
    out.add(`${origin}/careers/`)
    out.add(`${origin}/jobs/`)
  } catch {
    // ignore malformed careers URL
  }

  return [...out]
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number
): Promise<T[]> {
  const results: T[] = []
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      const current = idx
      idx += 1
      const result = await tasks[current]()
      results.push(result)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, tasks.length) }).map(() => worker())
  )
  return results
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase
    .from("companies")
    .select("id, name, domain, careers_url, ats_type")
    .eq("is_active", true)
    .not("careers_url", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit)

  if (error || !data) {
    throw new Error(error?.message ?? "Could not load companies")
  }

  const companies = data as CompanyRow[]
  console.log(`Loaded ${companies.length} companies for ATS discovery.`)

  const { data: jobsData } = await supabase
    .from("jobs")
    .select("company_id, apply_url")
    .eq("is_active", true)
    .not("apply_url", "is", null)
    .limit(100000)

  const applyUrlsByCompany = new Map<string, string[]>()
  for (const row of jobsData ?? []) {
    const companyId = row.company_id as string | null
    const applyUrl = row.apply_url as string | null
    if (!companyId || !applyUrl) continue
    const list = applyUrlsByCompany.get(companyId) ?? []
    list.push(applyUrl)
    applyUrlsByCompany.set(companyId, list)
  }

  let discovered = 0
  let updated = 0
  let skipped = 0

  const tasks = companies.map((company) => async () => {
    const existingType = company.ats_type?.toLowerCase() ?? null
    if (!overwrite && existingType && existingType !== "custom" && existingType !== "unknown") {
      skipped += 1
      return
    }

    let detection: ReturnType<typeof detectAtsFromHtml> = null

    const applyHits = (applyUrlsByCompany.get(company.id) ?? [])
      .map((url) => detectAtsFromUrl(url))
      .filter((hit): hit is NonNullable<typeof hit> => Boolean(hit))
    if (applyHits.length > 0) {
      detection = {
        atsType: applyHits[0].atsType,
        confidence: applyHits[0].confidence,
        reasons: ["Detected from existing apply_url patterns"],
      }
    }

    if (!detection) {
      const candidateUrls = buildCandidateUrls(company.careers_url)
      for (const candidate of candidateUrls) {
        const html = await fetchHtml(candidate)
        if (!html) continue
        const hit = detectAtsFromHtml({ url: candidate, html })
        if (!hit) continue
        detection = hit
        break
      }
    }

    if (!detection) {
      skipped += 1
      return
    }

    discovered += 1
    console.log(
      `${dryRun ? "[dry-run] " : ""}${company.name} (${company.domain}) -> ${detection.atsType} [${detection.confidence}]`
    )

    if (dryRun) return

    const { error: updateError } = await supabase
      .from("companies")
      .update({
        ats_type: detection.atsType,
        updated_at: new Date().toISOString(),
      })
      .eq("id", company.id)

    if (updateError) {
      console.error(`  FAILED: ${updateError.message}`)
      return
    }
    updated += 1
  })

  await runWithConcurrency(tasks, concurrency)

  console.log(
    `\nDone. discovered=${discovered}, updated=${dryRun ? 0 : updated}, skipped=${skipped}`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

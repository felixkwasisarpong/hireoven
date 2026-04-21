/**
 * Backfill job descriptions from apply URLs.
 *
 * Examples:
 *   npx tsx scripts/backfill-job-descriptions.ts
 *   npx tsx scripts/backfill-job-descriptions.ts --include-inactive --concurrency=12
 *   npx tsx scripts/backfill-job-descriptions.ts --all --limit=500 --dry-run
 */

import { loadEnvConfig } from "@next/env"
import { createClient } from "@supabase/supabase-js"
import { extractSkillsFromText } from "../lib/crawler/normalizer"
import { cleanJobDescription, fetchJobDescription } from "../lib/jobs/description"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const includeInactive = args.includes("--include-inactive")
const allRows = args.includes("--all")
const onlyMissing = !allRows
const limitArg = args.find((arg) => arg.startsWith("--limit="))
const concurrencyArg = args.find((arg) => arg.startsWith("--concurrency="))
const timeoutArg = args.find((arg) => arg.startsWith("--timeout-ms="))
const limit = Math.max(0, Number(limitArg?.split("=")[1] ?? "0"))
const concurrency = Math.max(
  1,
  Math.min(32, Number(concurrencyArg?.split("=")[1] ?? "10"))
)
const timeoutMs = Math.max(2000, Number(timeoutArg?.split("=")[1] ?? "12000"))

type JobRow = {
  id: string
  title: string
  apply_url: string
  description: string | null
  is_active: boolean
  raw_data: Record<string, unknown> | null
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
      results.push(await tasks[current]())
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, tasks.length) }).map(() => worker())
  )
  return results
}

async function loadJobs(supabase: any) {
  const pageSize = 1000
  let page = 0
  const rows: JobRow[] = []

  while (true) {
    let query = supabase
      .from("jobs")
      .select("id, title, apply_url, description, is_active, raw_data")
      .order("updated_at", { ascending: true })
      .range(page * pageSize, page * pageSize + pageSize - 1)

    if (!includeInactive) {
      query = query.eq("is_active", true)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const batch = (data ?? []) as JobRow[]
    if (batch.length === 0) break
    rows.push(...batch)
    if (batch.length < pageSize) break
    page += 1
  }

  return rows
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

  const loaded = await loadJobs(supabase)
  let candidates = loaded

  if (onlyMissing) {
    candidates = candidates.filter((row) => !cleanJobDescription(row.description))
  }

  if (limit > 0) {
    candidates = candidates.slice(0, limit)
  }

  let scanned = 0
  let fetched = 0
  let updated = 0
  let unchanged = 0
  let failed = 0

  console.log(
    `Loaded ${loaded.length} jobs. Candidates=${candidates.length} (missingOnly=${onlyMissing}, includeInactive=${includeInactive}, dryRun=${dryRun})`
  )

  await runWithConcurrency(
    candidates.map((row) => async () => {
      scanned += 1
      const extracted = await fetchJobDescription(row.apply_url, timeoutMs)
      if (!extracted) {
        failed += 1
        if (scanned % 50 === 0) {
          console.log(
            `Progress: scanned=${scanned}, fetched=${fetched}, updated=${updated}, unchanged=${unchanged}, failed=${failed}`
          )
        }
        return
      }

      fetched += 1
      const normalizedExisting = cleanJobDescription(row.description)
      if (normalizedExisting && normalizedExisting === extracted) {
        unchanged += 1
        return
      }

      if (dryRun) {
        updated += 1
        console.log(`[dry-run] ${row.title} (${row.id}) -> ${extracted.length} chars`)
        return
      }

      const nextRaw =
        row.raw_data && typeof row.raw_data === "object" && !Array.isArray(row.raw_data)
          ? { ...row.raw_data }
          : {}
      nextRaw.description_source = "scraped_apply_url"
      nextRaw.description_backfilled_at = new Date().toISOString()

      const { error } = await supabase
        .from("jobs")
        .update({
          description: extracted,
          skills: extractSkillsFromText(row.title, extracted),
          raw_data: nextRaw as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", row.id)

      if (error) {
        failed += 1
        return
      }
      updated += 1

      if (scanned % 50 === 0) {
        console.log(
          `Progress: scanned=${scanned}, fetched=${fetched}, updated=${updated}, unchanged=${unchanged}, failed=${failed}`
        )
      }
    }),
    concurrency
  )

  console.log(
    `Done. scanned=${scanned}, fetched=${fetched}, updated=${updated}, unchanged=${unchanged}, failed=${failed}`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

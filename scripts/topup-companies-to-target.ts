/**
 * Top up companies table to a target count.
 *
 * Usage:
 *   npx tsx scripts/topup-companies-to-target.ts --target=1000
 *   npx tsx scripts/topup-companies-to-target.ts --target=1000 --dry-run
 *
 * Note:
 * - This creates synthetic companies for load/crawl pipeline testing.
 * - Do not use synthetic rows for production-facing company quality.
 */

import { loadEnvConfig } from "@next/env"
import { createClient } from "@supabase/supabase-js"

loadEnvConfig(process.cwd())

const dryRun = process.argv.includes("--dry-run")
const targetArg = process.argv.find((arg) => arg.startsWith("--target="))
const target = Math.max(1, Number(targetArg?.split("=")[1] ?? "1000"))
const BATCH = 100

const INDUSTRIES = [
  "Technology",
  "Finance",
  "Healthcare",
  "Retail",
  "Education",
  "Logistics",
  "Artificial Intelligence",
  "Cybersecurity",
] as const

const SIZES = ["startup", "small", "medium", "large", "enterprise"] as const
const ATS_TYPES = ["greenhouse", "lever", "workday", "ashby", "jobvite", "custom"] as const

type InsertRow = {
  name: string
  domain: string
  careers_url: string
  logo_url: string | null
  industry: string
  size: string
  ats_type: string
  is_active: boolean
  sponsors_h1b: boolean
  sponsorship_confidence: number
}

function syntheticRow(n: number): InsertRow {
  const industry = INDUSTRIES[n % INDUSTRIES.length]
  const size = SIZES[n % SIZES.length]
  const ats = ATS_TYPES[n % ATS_TYPES.length]
  const sponsors = n % 3 !== 0
  const confidence = sponsors ? 65 + (n % 30) : 25 + (n % 20)
  const slug = `hireoven-seed-${String(n).padStart(4, "0")}`
  const domain = `${slug}.example.com`

  return {
    name: `Hireoven Seed Company ${String(n).padStart(4, "0")}`,
    domain,
    careers_url: `https://${domain}/careers`,
    logo_url: null,
    industry,
    size,
    ats_type: ats,
    is_active: true,
    sponsors_h1b: sponsors,
    sponsorship_confidence: confidence,
  }
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

  const { count, error: countError } = await supabase
    .from("companies")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true)

  if (countError) {
    throw new Error(`Could not count companies: ${countError.message}`)
  }

  const currentCount = count ?? 0
  const needed = Math.max(0, target - currentCount)
  console.log(`Current active companies: ${currentCount}`)
  console.log(`Target: ${target}`)
  console.log(`Need to add: ${needed}`)

  if (needed === 0) {
    console.log("No top-up required.")
    return
  }

  const rows: InsertRow[] = []
  for (let i = 1; i <= needed; i += 1) {
    rows.push(syntheticRow(currentCount + i))
  }

  if (dryRun) {
    console.log("Dry run. Sample rows:")
    console.log(rows.slice(0, 3))
    return
  }

  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const { error } = await supabase.from("companies").upsert(chunk, {
      onConflict: "domain",
      ignoreDuplicates: false,
    })
    if (error) {
      throw new Error(`Top-up failed at batch ${i / BATCH + 1}: ${error.message}`)
    }
    inserted += chunk.length
    console.log(`Upserted ${inserted} / ${rows.length}`)
  }

  console.log(`Done. Added ${inserted} rows. Active companies should now be ~${target}.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

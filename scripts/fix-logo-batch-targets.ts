/**
 * One-off logo backfill for a hand-curated batch of companies whose marks were
 * missing or wrong in the feed. Each is an active company carrying a synthetic
 * ATS/discovery domain (so the auto-backfill skips it — it never guesses a
 * domain from the name), or a row whose stored logo pointed at a dead/wrong
 * domain that only resolved to a logo.dev monogram.
 *
 * For each target we set logo_url from the verified brand domain via
 * companyLogoUrlFromDomain(). We do NOT touch `domain` — those values are
 * dedup/harvest keys; the logo renders from logo_url regardless. Every brand
 * domain below was validated against logo.dev `fallback=404` (real mark, not a
 * generated monogram) before being listed here.
 *
 * Targeted by exact id; idempotent (only writes when logo_url would change).
 *
 *   npx tsx scripts/fix-logo-batch-targets.ts            # dry-run
 *   npx tsx scripts/fix-logo-batch-targets.ts --execute  # apply
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

const execute = process.argv.includes("--execute")

type Target = { id: string; label: string; brandDomain: string }

const TARGETS: Target[] = [
  // bjak.com — three active dupes of the same brand, all missing a logo.
  { id: "b139ccaa-8193-4c25-a8b8-d0964c7d6306", label: "Bjakcareer", brandDomain: "bjak.com" },
  { id: "eea2e756-431b-4d78-84ab-235e3abd5e25", label: "Bjak (ashby)", brandDomain: "bjak.com" },
  { id: "f51fafef-9455-4eba-ae32-f72b3e7628e1", label: "Bjak 1 (workable)", brandDomain: "bjak.com" },

  { id: "687853e5-20c7-4ffc-8e0a-0b0a7f7ecfa3", label: "Arena Investors LP", brandDomain: "arenaco.com" },
  { id: "97f5bf8d-4009-488d-831b-43f38d382dba", label: "Smoothcommerce", brandDomain: "smooth.tech" },
  { id: "df5aac96-a45b-4a60-acba-e0f60033a923", label: "Smardt", brandDomain: "smardt.com" },

  // Active row had a broken/typo'd domain (isnsoftwareoration.com) → monogram-less logo.
  { id: "9a2180b5-6a07-434b-876b-1c373f5e5e5e", label: "Isn Software Corporation", brandDomain: "isn.com" },

  // Active row's logo pointed at odin-dynamics.com, which logo.dev only renders
  // as a monogram. Real brand domain is odindynamics.ai.
  { id: "a32d8eca-8fec-4467-8894-c8fc95688566", label: "Odin Dynamics", brandDomain: "odindynamics.ai" },

  { id: "b5289ee1-67f8-4830-86e3-486e7d095f77", label: "Carfair", brandDomain: "carfaircomposites.com" },
  { id: "f0ef38f2-8bf7-40e1-9103-e01eeafa13d3", label: "Care Harmony", brandDomain: "care-harmony.com" },

  // Pocket (YC W26) — inactive; currently a YC bookface S3 image. Real domain heypocket.com.
  { id: "aa848ae9-c6dd-416f-a848-7ee65fdae52d", label: "Pocket (W26)", brandDomain: "heypocket.com" },
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  console.log(`\n[logo-batch] mode=${execute ? "EXECUTE" : "dry-run"}  targets=${TARGETS.length}\n`)

  let changed = 0
  let already = 0
  let missing = 0

  for (const t of TARGETS) {
    const logoUrl = companyLogoUrlFromDomain(t.brandDomain)
    if (!logoUrl) {
      console.log(`SKIP  ${t.label}: companyLogoUrlFromDomain("${t.brandDomain}") returned empty`)
      continue
    }

    const { rows } = await pool.query<{ name: string; domain: string | null; logo_url: string | null }>(
      `SELECT name, domain, logo_url FROM companies WHERE id = $1`,
      [t.id]
    )
    if (rows.length === 0) {
      console.log(`MISS  ${t.label}: id ${t.id} not found`)
      missing += 1
      continue
    }
    const row = rows[0]!
    const same = (row.logo_url ?? "") === logoUrl
    if (same) {
      console.log(`OK    ${t.label}: already set → ${logoUrl}`)
      already += 1
      continue
    }

    console.log(`${execute ? "SET  " : "WOULD"} ${t.label} (${row.name})`)
    console.log(`        from: ${row.logo_url ?? "∅"}`)
    console.log(`        to:   ${logoUrl}`)

    if (execute) {
      const { rowCount } = await pool.query(
        `UPDATE companies SET logo_url = $1, updated_at = now()
          WHERE id = $2 AND logo_url IS DISTINCT FROM $1`,
        [logoUrl, t.id]
      )
      if (rowCount) changed += 1
    } else {
      changed += 1
    }
  }

  console.log(
    `\n[logo-batch] ${execute ? "applied" : "would change"}=${changed}  already=${already}  missing=${missing}` +
      `${execute ? "" : "  — re-run with --execute"}`
  )
  await pool.end()
}

main().catch((e) => {
  console.error("\n[logo-batch] failed:", e)
  process.exit(1)
})

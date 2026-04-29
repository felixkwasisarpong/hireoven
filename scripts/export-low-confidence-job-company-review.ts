import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { normalizeCrawlerJobForPersistence } from "@/lib/jobs/normalization"
import type { EmploymentType, SeniorityLevel } from "@/types"

loadEnvConfig(process.cwd())

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const limit = Math.max(1, Number(limitArg?.split("=")[1] ?? "500"))
const maxConfidenceArg = process.argv.find((arg) => arg.startsWith("--max-confidence="))
const maxConfidence = Math.max(0, Math.min(1, Number(maxConfidenceArg?.split("=")[1] ?? "0.62")))

type Row = {
  id: string
  company_id: string
  title: string
  company_name: string | null
  company_domain: string | null
  careers_url: string | null
  logo_url: string | null
  ats_type: string | null
  location: string | null
  apply_url: string
  external_id: string | null
  description: string | null
  employment_type: EmploymentType | null
  seniority_level: SeniorityLevel | null
  is_remote: boolean | null
  is_hybrid: boolean | null
  requires_authorization: boolean | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  sponsors_h1b: boolean | null
  sponsorship_score: number | null
  visa_language_detected: string | null
}

function csv(value: unknown) {
  const text = String(value ?? "")
  return `"${text.replace(/"/g, '""')}"`
}

function getPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({ connectionString, ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined })
}

async function main() {
  const pool = getPool()
  const nowIso = new Date().toISOString()

  try {
    const { rows } = await pool.query<Row>(
      `SELECT j.*, c.name AS company_name, c.domain AS company_domain,
              c.careers_url, c.logo_url, c.ats_type
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.is_active = true
       ORDER BY j.updated_at ASC
       LIMIT $1`,
      [limit]
    )

    console.log([
      "job_id",
      "company_id",
      "company",
      "title",
      "confidence",
      "requires_review",
      "issues",
      "careers_url",
      "domain",
      "logo_url",
      "ats_type",
      "apply_url",
    ].map(csv).join(","))

    for (const row of rows) {
      const normalization = normalizeCrawlerJobForPersistence({
        rawJob: {
          externalId: row.external_id ?? undefined,
          title: row.title,
          url: row.apply_url,
          description: row.description ?? undefined,
          location: row.location ?? undefined,
          company: row.company_name,
          companyDomain: row.company_domain,
        },
        crawledAtIso: nowIso,
        existing: {
          description: row.description,
          employment_type: row.employment_type,
          seniority_level: row.seniority_level,
          is_remote: row.is_remote,
          is_hybrid: row.is_hybrid,
          requires_authorization: row.requires_authorization,
          salary_min: row.salary_min,
          salary_max: row.salary_max,
          salary_currency: row.salary_currency,
          sponsors_h1b: row.sponsors_h1b,
          sponsorship_score: row.sponsorship_score,
          visa_language_detected: row.visa_language_detected,
        },
      })
      const validation = normalization.canonical.validation
      if (!validation.requires_review && validation.confidence_score > maxConfidence) continue

      console.log([
        row.id,
        row.company_id,
        row.company_name,
        row.title,
        validation.confidence_score,
        validation.requires_review,
        validation.issues.map((issue) => issue.code).join(";"),
        row.careers_url,
        row.company_domain,
        row.logo_url,
        row.ats_type,
        row.apply_url,
      ].map(csv).join(","))
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

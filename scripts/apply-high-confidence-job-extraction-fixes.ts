import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { normalizeCrawlerJobForPersistence } from "@/lib/jobs/normalization"
import type { EmploymentType, SeniorityLevel } from "@/types"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const limit = Math.max(1, Number(limitArg?.split("=")[1] ?? "100"))
const minConfidenceArg = process.argv.find((arg) => arg.startsWith("--min-confidence="))
const minConfidence = Math.max(0, Math.min(1, Number(minConfidenceArg?.split("=")[1] ?? "0.72")))

type JobRow = {
  id: string
  title: string
  company_name: string | null
  company_domain: string | null
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
  raw_data: Record<string, unknown> | null
}

function getPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({ connectionString, ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined })
}

async function main() {
  const pool = getPool()
  const nowIso = new Date().toISOString()
  let updated = 0
  let skipped = 0

  try {
    const { rows } = await pool.query<JobRow>(
      `SELECT j.*, c.name AS company_name, c.domain AS company_domain
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.is_active = true
       ORDER BY j.updated_at ASC
       LIMIT $1`,
      [limit]
    )

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

      if (
        normalization.canonical.validation.requires_review ||
        normalization.canonical.validation.confidence_score < minConfidence
      ) {
        skipped += 1
        continue
      }

      const nextRawData = {
        ...(row.raw_data ?? {}),
        normalization: {
          version: normalization.canonical.schema_version,
          normalized_at: normalization.canonical.normalized_at,
          confidence_score: normalization.canonical.validation.confidence_score,
          completeness_score: normalization.canonical.validation.completeness_score,
          requires_review: normalization.canonical.validation.requires_review,
          issues: normalization.canonical.validation.issues,
        },
        normalized: normalization.canonical,
        structured_job: normalization.structuredData,
        view: {
          page: normalization.pageView,
          card: normalization.cardView,
        },
      }

      console.log(`${execute ? "updating" : "would update"} ${row.id} ${row.title}`)
      if (execute) {
        await pool.query(
          `UPDATE jobs
           SET normalized_title=$1, description=$2, location=$3, employment_type=$4,
               seniority_level=$5, is_remote=$6, is_hybrid=$7, salary_min=$8,
               salary_max=$9, salary_currency=$10, sponsors_h1b=$11,
               sponsorship_score=$12, requires_authorization=$13,
               visa_language_detected=$14, skills=$15, raw_data=$16::jsonb,
               updated_at=$17
           WHERE id=$18::uuid`,
          [
            normalization.nextColumns.normalized_title,
            normalization.nextColumns.description,
            normalization.nextColumns.location,
            normalization.nextColumns.employment_type,
            normalization.nextColumns.seniority_level,
            normalization.nextColumns.is_remote,
            normalization.nextColumns.is_hybrid,
            normalization.nextColumns.salary_min,
            normalization.nextColumns.salary_max,
            normalization.nextColumns.salary_currency,
            normalization.nextColumns.sponsors_h1b,
            normalization.nextColumns.sponsorship_score,
            normalization.nextColumns.requires_authorization,
            normalization.nextColumns.visa_language_detected,
            normalization.nextColumns.skills,
            JSON.stringify(nextRawData),
            nowIso,
            row.id,
          ]
        )
      }
      updated += 1
    }

    console.log(`${execute ? "Updated" : "Would update"} ${updated}; skipped ${skipped}`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

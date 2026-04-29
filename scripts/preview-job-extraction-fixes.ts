import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { normalizeCrawlerJobForPersistence } from "@/lib/jobs/normalization"

loadEnvConfig(process.cwd())

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const limit = Math.max(1, Number(limitArg?.split("=")[1] ?? "50"))

type JobRow = {
  id: string
  title: string
  company_name: string | null
  company_domain: string | null
  location: string | null
  apply_url: string
  external_id: string | null
  description: string | null
  employment_type: string | null
  seniority_level: string | null
  is_remote: boolean | null
  is_hybrid: boolean | null
  requires_authorization: boolean | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  sponsors_h1b: boolean | null
  sponsorship_score: number | null
  visa_language_detected: string | null
  skills: string[] | null
}

function getPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({ connectionString, ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined })
}

function changed(before: unknown, after: unknown) {
  return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)
}

async function main() {
  const pool = getPool()
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
        crawledAtIso: new Date().toISOString(),
        existing: {
          description: row.description,
          employment_type: row.employment_type as any,
          seniority_level: row.seniority_level as any,
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

      const changes = {
        title: changed(row.title, normalization.canonical.header.title.value),
        location: changed(row.location, normalization.nextColumns.location),
        salary: changed([row.salary_min, row.salary_max], [normalization.nextColumns.salary_min, normalization.nextColumns.salary_max]),
        skills: changed(row.skills ?? [], normalization.nextColumns.skills),
        sections: Object.values(normalization.canonical.sections).reduce((sum, section) => sum + section.items.length, 0),
      }

      console.log(JSON.stringify({
        jobId: row.id,
        company: row.company_name,
        title: row.title,
        confidence: normalization.canonical.validation.confidence_score,
        requiresReview: normalization.canonical.validation.requires_review,
        changes,
        topSkills: normalization.nextColumns.skills.slice(0, 5),
      }))
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

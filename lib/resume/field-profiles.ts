/**
 * Corpus-grounded field skill profiles.
 *
 * For each field in FIELDS, select that field's real jobs (seeded by the field's
 * signature terms over title/skills), then aggregate the skills those jobs
 * actually list. The result — skill + share (fraction of the field's jobs that
 * list it) — is what scoreResumeAgainstProfiles() scores a resume against, so
 * the "field fit" reflects genuine employer demand, not hand-picked keywords.
 *
 * Server-only (pg). Refreshed by api/cron/refresh-field-profiles.
 */

import type { Pool } from "pg"
import { FIELDS, type FieldProfile } from "@/lib/resume/signal"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"

// A field needs at least this many matched jobs for its profile to be trusted;
// below it we skip storing and the detector falls back to keyword signatures.
const MIN_JOBS = 20
const LOOKBACK_DAYS = 120
const TOP_SKILLS = 30

export async function buildAndStoreFieldProfiles(
  pool: Pool,
): Promise<Array<{ field: string; jobCount: number; skills: number; stored: boolean }>> {
  const results: Array<{ field: string; jobCount: number; skills: number; stored: boolean }> = []

  for (const f of FIELDS) {
    const seeds = [...new Set([...(f.strong ?? []), ...f.signals])].map((s) => `%${s.toLowerCase()}%`)

    // A job belongs to the field if its title/normalized_title, or any of its
    // listed skills, hits a seed term.
    const where = `
      j.is_active = true
      AND ${sqlPublishedJob("j")}
      AND ${sqlJobLocatedInUsa("j")}
      AND j.first_detected_at > now() - interval '${LOOKBACK_DAYS} days'
      AND (
        j.title ILIKE ANY($1::text[])
        OR j.normalized_title ILIKE ANY($1::text[])
        OR EXISTS (SELECT 1 FROM unnest(j.skills) s WHERE s ILIKE ANY($1::text[]))
      )
    `

    const cnt = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM jobs j WHERE ${where}`, [seeds])
    const jobCount = cnt.rows[0]?.n ?? 0
    if (jobCount < MIN_JOBS) {
      results.push({ field: f.key, jobCount, skills: 0, stored: false })
      continue
    }

    const sk = await pool.query<{ skill: string; n: number }>(
      `SELECT lower(btrim(skill)) AS skill, COUNT(*)::int AS n
         FROM jobs j, unnest(j.skills) AS skill
        WHERE ${where} AND btrim(skill) <> ''
        GROUP BY 1
        ORDER BY n DESC
        LIMIT ${TOP_SKILLS}`,
      [seeds],
    )
    const skills = sk.rows.map((r) => ({ skill: r.skill, share: Math.min(1, r.n / jobCount) }))

    await pool.query(
      `INSERT INTO field_skill_profiles (field_key, label, job_count, skills, generated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (field_key)
       DO UPDATE SET label = EXCLUDED.label, job_count = EXCLUDED.job_count,
                     skills = EXCLUDED.skills, generated_at = now()`,
      [f.key, f.label, jobCount, JSON.stringify(skills)],
    )
    results.push({ field: f.key, jobCount, skills: skills.length, stored: true })
  }

  return results
}

/** Read stored field profiles for corpus-grounded scoring. Empty ⇒ fall back. */
export async function getFieldProfiles(pool: Pool): Promise<FieldProfile[]> {
  const { rows } = await pool.query<{ field_key: string; label: string; job_count: number; skills: unknown }>(
    `SELECT field_key, label, job_count, skills FROM field_skill_profiles`,
  )
  return rows.map((r) => ({
    key: r.field_key,
    label: r.label,
    jobCount: r.job_count,
    skills: Array.isArray(r.skills) ? (r.skills as Array<{ skill: string; share: number }>) : [],
  }))
}

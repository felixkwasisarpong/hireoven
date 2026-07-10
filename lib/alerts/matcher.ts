import { getPostgresPool } from "@/lib/postgres/server"
import type { Job, JobAlert } from "@/types"

function normalizedList(values?: string[] | null) {
  return (values ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Whole-word / whole-phrase matcher. Bounds the keyword by non-alphanumeric
 *  edges so "java" no longer matches "javascript", "go" no longer matches
 *  "goldman"/"category", "ai" no longer matches "maintenance", etc. — the
 *  substring matching that made alert results noisy. */
function keywordRegex(keyword: string): RegExp {
  return new RegExp(`(?:^|[^a-z0-9+#])${escapeRegExp(keyword)}(?:[^a-z0-9+#]|$)`, "i")
}

function matchesKeywords(alert: JobAlert, job: Job) {
  const keywords = normalizedList(alert.keywords)
  if (!keywords.length) return true

  const title = `${job.title} ${job.normalized_title ?? ""}`.toLowerCase()
  const skills = (job.skills ?? []).map((skill) => skill.toLowerCase())

  return keywords.some((keyword) => {
    const re = keywordRegex(keyword)
    if (re.test(title)) return true
    // Skills: exact token or whole-word match (not substring).
    return skills.some((skill) => skill === keyword || re.test(skill))
  })
}

function matchesLocations(alert: JobAlert, job: Job) {
  const locations = normalizedList(alert.locations)
  if (!locations.length) return true

  const jobLocation = job.location?.toLowerCase() ?? ""
  return locations.some((location) => {
    if (location === "remote") return job.is_remote
    return Boolean(jobLocation) && jobLocation.includes(location)
  })
}

function matchesSeniority(alert: JobAlert, job: Job) {
  if (!alert.seniority_levels?.length) return true
  if (!job.seniority_level) return false
  return alert.seniority_levels.includes(job.seniority_level)
}

function matchesEmploymentType(alert: JobAlert, job: Job) {
  if (!alert.employment_types?.length) return true
  if (!job.employment_type) return false
  return alert.employment_types.includes(job.employment_type)
}

function matchesRemoteOnly(alert: JobAlert, job: Job) {
  if (!alert.remote_only) return true
  return job.is_remote
}

function matchesSponsorship(alert: JobAlert, job: Job) {
  if (!alert.sponsorship_required) return true
  if (job.sponsors_h1b === true) return true
  if ((job.sponsorship_score ?? 0) <= 60) return false
  if (/(^|\\.)dice\\.com/i.test(job.apply_url)) return false
  return true
}

function matchesCompanyIds(alert: JobAlert, job: Job) {
  if (!alert.company_ids?.length) return true
  return alert.company_ids.includes(job.company_id)
}

export function matchesAlert(alert: JobAlert, job: Job) {
  return (
    matchesKeywords(alert, job) &&
    matchesLocations(alert, job) &&
    matchesSeniority(alert, job) &&
    matchesEmploymentType(alert, job) &&
    matchesRemoteOnly(alert, job) &&
    matchesSponsorship(alert, job) &&
    matchesCompanyIds(alert, job)
  )
}

export async function matchJobToAlerts(job: Job): Promise<JobAlert[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<JobAlert>(`SELECT * FROM job_alerts WHERE is_active = true`)

  return rows.filter((alert: JobAlert) => matchesAlert(alert, job))
}

export async function matchJobToWatchlists(job: Job): Promise<string[]> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ user_id: string | null }>(
    `SELECT user_id FROM watchlist WHERE company_id = $1`,
    [job.company_id]
  )

  return Array.from(
    new Set(
      rows
        .map((row: { user_id: string | null }) => row.user_id)
        .filter((value: string | null): value is string => Boolean(value))
    )
  )
}

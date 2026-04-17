import { createAdminClient } from "@/lib/supabase/admin"
import type { Job, JobAlert } from "@/types"

function normalizedList(values?: string[] | null) {
  return (values ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function matchesKeywords(alert: JobAlert, job: Job) {
  const keywords = normalizedList(alert.keywords)
  if (!keywords.length) return true

  const title = `${job.title} ${job.normalized_title ?? ""}`.toLowerCase()
  const skills = (job.skills ?? []).map((skill) => skill.toLowerCase())

  return keywords.some((keyword) => {
    if (title.includes(keyword)) return true
    return skills.some((skill) => skill.includes(keyword))
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
  return job.sponsors_h1b === true || (job.sponsorship_score ?? 0) > 60
}

function matchesCompanyIds(alert: JobAlert, job: Job) {
  if (!alert.company_ids?.length) return true
  return alert.company_ids.includes(job.company_id)
}

function matchesAlert(alert: JobAlert, job: Job) {
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
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("job_alerts")
    .select("*")
    .eq("is_active", true)

  if (error) throw error

  return ((data ?? []) as JobAlert[]).filter((alert) => matchesAlert(alert, job))
}

export async function matchJobToWatchlists(job: Job): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("watchlist")
    .select("user_id")
    .eq("company_id", job.company_id)

  if (error) throw error

  return Array.from(
    new Set(
      ((data ?? []) as Array<{ user_id: string | null }>)
        .map((row) => row.user_id)
        .filter((value): value is string => Boolean(value))
    )
  )
}

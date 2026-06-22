export type JobFreshnessInput = {
  first_detected_at?: string | Date | null
  posted_at?: string | Date | null
}

export function sqlNotificationFreshnessDate(alias = "jobs"): string {
  return `COALESCE(${alias}.posted_at, ${alias}.first_detected_at)`
}

export function notificationFreshnessDate(
  job: JobFreshnessInput
): string | Date | null | undefined {
  return job.posted_at ?? job.first_detected_at
}

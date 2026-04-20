/**
 * Best-effort company domain for logo fallbacks when stored logo_url fails.
 * Skips known ATS hostnames so we don't show the wrong favicon.
 */
const ATS_HOST_PATTERNS =
  /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs|workday\.com|smartrecruiters|icims|taleo|jobvite|breezy|comeet|rippling|notion\.so|linkedin\.com|indeed\.com|glassdoor/i

export function domainFromApplyUrl(applyUrl: string | null | undefined): string | null {
  if (!applyUrl?.trim()) return null
  try {
    const host = new URL(applyUrl).hostname.replace(/^www\./, "")
    if (!host || ATS_HOST_PATTERNS.test(host)) return null
    return host
  } catch {
    return null
  }
}

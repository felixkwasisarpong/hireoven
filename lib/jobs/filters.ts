const BLOCKED_TITLE_PATTERNS = [
  /^(login|log(?:\s+)?in|log back in!?)$/i,
  /^go back to our career portal$/i,
  /^by category$/i,
  /^by job title$/i,
  /^search jobs?$/i,
  /^go to (?:first|prev(?:ious)?|next|last) page(?:\s*[›»>]+)?$/i,
  /^(?:first|prev(?:ious)?|next|last) page(?:\s*[›»>]+)?$/i,
  /^page \d+$/i,
  /^(?:view|see) all jobs?$/i,
  /^(?:unknown role|no jobs? found|no job found|job opening|open role)$/i,
  /^work in [\w\s,().-]+$/i,
  /^explore (?:jobs|careers|roles)/i,
  /^contractor roles?$/i,
  /^remote opportunities?$/i,
  /^hybrid opportunities?$/i,
  // Bare call-to-action text scraped as a title. These are rare in absolute
  // terms (~0.1% of listings) but they repeat, while real titles are diverse —
  // so they climb straight into any "top roles today" ranking and end up
  // headlining the daily email. Anchored to the whole string on purpose:
  // "Apply Engineering Manager" and the healthcare titles CNA / EMT / LPN /
  // RBT / LVN / PCA are all real and must survive.
  /^apply(?:\s+(?:now|here|today))?$/i,
  /^(?:view|see)\s+(?:job|jobs|details|posting|opening|more)$/i,
  /^(?:learn|read|find out)\s+more$/i,
  /^(?:more\s+)?(?:details|info(?:rmation)?)$/i,
  /^job$/i,
  /^click here$/i,
  /^\s*\.css-/i,
  /\{-webkit-|-webkit-text-decoration/,
]

const BLOCKED_PATH_PATTERNS = [/\/jobs\/login$/i, /\/jobs\/intro$/i, /\/intro$/i]

// Generic listing / search-results URLs that don't point to a specific posting.
// LinkedIn's "linkster" public discovery emits URLs like
// `linkedin.com/jobs/<slug>-jobs?trk=public_jobs_linkster_link` — a search
// page, not a real posting. Real postings live at `linkedin.com/jobs/view/<id>`.
const BLOCKED_HOST_PATH_PATTERNS: Array<{ host: RegExp; path: RegExp }> = [
  { host: /(^|\.)linkedin\.com$/i, path: /^\/jobs\/[^/]+-jobs$/i },
]

export function isBlockedCrawlTitle(title: string): boolean {
  const normalized = title.replace(/\s+/g, " ").trim()
  if (!normalized || normalized.length < 3) return true
  return BLOCKED_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isBlockedApplyUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, "")
    if (BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(path))) return true
    if (parsed.searchParams.has("loginOnly") && parsed.searchParams.get("loginOnly") === "1") {
      return true
    }
    const host = parsed.hostname
    if (BLOCKED_HOST_PATH_PATTERNS.some(({ host: h, path: p }) => h.test(host) && p.test(path))) {
      return true
    }
    return false
  } catch {
    return false
  }
}

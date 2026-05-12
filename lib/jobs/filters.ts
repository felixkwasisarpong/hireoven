const BLOCKED_TITLE_PATTERNS = [
  /^(login|log(?:\s+)?in|log back in!?)$/i,
  /^go back to our career portal$/i,
  /^by category$/i,
  /^by job title$/i,
  /^search jobs?$/i,
  /^work in [\w\s,().-]+$/i,
  /^explore (?:jobs|careers|roles)/i,
  /^contractor roles?$/i,
  /^remote opportunities?$/i,
  /^hybrid opportunities?$/i,
  /^\s*\.css-/i,
  /\{-webkit-|-webkit-text-decoration/,
]

const BLOCKED_PATH_PATTERNS = [/\/jobs\/login$/i, /\/jobs\/intro$/i, /\/intro$/i]

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
    return false
  } catch {
    return false
  }
}

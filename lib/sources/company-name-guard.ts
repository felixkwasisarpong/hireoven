/**
 * Guards against garbage company names that slip through aggregator APIs:
 * recruiter email addresses, phone numbers, job titles used as company names,
 * placeholder strings, and other noise.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[\d\s\-().+]{7,}$/
const URL_RE   = /^https?:\/\//i

// Names that are clearly not companies
const GARBAGE_PATTERNS: ReadonlyArray<RegExp> = [
  /^n\/?a$/i,
  /^unknown$/i,
  /^not\s+listed$/i,
  /^confidential$/i,
  /^various$/i,
  /^multiple$/i,
  /^staffing\s+agency$/i,
]

export function isValidCompanyName(name: string | null | undefined): boolean {
  if (!name) return false
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 200) return false
  if (EMAIL_RE.test(trimmed)) return false
  if (PHONE_RE.test(trimmed)) return false
  if (URL_RE.test(trimmed)) return false
  if (GARBAGE_PATTERNS.some((re) => re.test(trimmed))) return false
  return true
}

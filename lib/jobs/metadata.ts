const EMPLOYMENT_RULES: Array<{
  type: InferredEmploymentType
  pattern: RegExp
}> = [
  { type: "internship", pattern: /\b(internship|intern|co[\s-]?op)\b/i },
  { type: "parttime", pattern: /\bpart[\s-]?time\b/i },
  {
    type: "contract",
    pattern:
      /\b(contractor|contract[\s-]?(role|position|employment)|temporary|temp(?:orary)?|freelance|contingent)\b/i,
  },
  { type: "fulltime", pattern: /\bfull[\s-]?time\b/i },
]

const SENIORITY_RULES: Array<{
  level: InferredSeniorityLevel
  pattern: RegExp
}> = [
  { level: "exec", pattern: /\b(chief|ceo|cto|cfo|coo|president|founder)\b/i },
  { level: "vp", pattern: /\b(vice president|vp)\b/i },
  { level: "director", pattern: /\bdirector\b/i },
  { level: "principal", pattern: /\bprincipal\b/i },
  { level: "staff", pattern: /\bstaff\b/i },
  { level: "senior", pattern: /\b(senior|sr\.?)\b/i },
  { level: "mid", pattern: /\b(mid|intermediate|ii|iii)\b/i },
  { level: "junior", pattern: /\b(junior|jr\.?|entry[\s-]?level)\b/i },
  { level: "intern", pattern: /\b(internship|intern|co[\s-]?op)\b/i },
]

const REMOTE_NEGATIVE_PATTERNS = [
  /\b(onsite|on[\s-]?site)\s+only\b/i,
  /\bno remote\b/i,
  /\bnot remote\b/i,
]

const AUTH_REQUIRED_PATTERNS = [
  /\bauthorized to work\b/i,
  /\bwork authorization\b/i,
  /\beligible to work\b/i,
  /\bwithout (current|future)?\s*(visa|employment)?\s*sponsorship\b/i,
  /\bno (visa|employment|work) sponsorship\b/i,
  /\bmust be a u\.?s\.?\s+citizen\b/i,
  /\bmust be (currently )?authorized\b/i,
]

const AUTH_NOT_REQUIRED_PATTERNS = [
  /\bvisa sponsorship (is )?available\b/i,
  /\bwill sponsor\b/i,
  /\bsponsorship available\b/i,
]

const EXPERIENCE_RANGE_RE =
  /\b(\d{1,2})\s*(?:\+|plus|to|-|–|\u2014)\s*(?:(\d{1,2}))?\s+years?\b/i
const EXPERIENCE_MIN_RE = /\bminimum of\s+(\d{1,2})\s+years?\b/i

const SALARY_RANGE_RE =
  /(?:(USD|US\$|\$|EUR|€|GBP|£)\s*)?([0-9]{2,3}(?:[,\d]{0,6})(?:\.\d+)?)\s*(k|m)?\s*(?:-|–|\u2014|to)\s*(?:(USD|US\$|\$|EUR|€|GBP|£)\s*)?([0-9]{2,3}(?:[,\d]{0,6})(?:\.\d+)?)\s*(k|m)?(?:\s*\/\s*(yr|year|annum))?/i

export type InferredEmploymentType =
  | "fulltime"
  | "parttime"
  | "contract"
  | "internship"

export type InferredSeniorityLevel =
  | "intern"
  | "junior"
  | "mid"
  | "senior"
  | "staff"
  | "principal"
  | "director"
  | "vp"
  | "exec"

export type InferredJobMetadata = {
  employmentType: InferredEmploymentType | null
  seniorityLevel: InferredSeniorityLevel | null
  isRemote: boolean | null
  isHybrid: boolean | null
  requiresAuthorization: boolean | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
}

function toTextBlob(...parts: Array<string | null | undefined>) {
  return parts
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
}

function parseCompensationAmount(raw: string, suffix: string | undefined): number | null {
  const numeric = Number.parseFloat(raw.replace(/,/g, ""))
  if (!Number.isFinite(numeric) || numeric <= 0) return null

  let amount = numeric
  const unit = suffix?.toLowerCase()
  if (unit === "k") amount *= 1000
  if (unit === "m") amount *= 1_000_000
  if (!unit && amount < 1000) amount *= 1000

  const rounded = Math.round(amount)
  if (rounded < 10_000 || rounded > 2_000_000) return null
  return rounded
}

function normalizeCurrency(raw: string | undefined): string | null {
  if (!raw) return "USD"
  const token = raw.toUpperCase()
  if (token === "$" || token === "US$" || token === "USD") return "USD"
  if (token === "€" || token === "EUR") return "EUR"
  if (token === "£" || token === "GBP") return "GBP"
  return null
}

export function inferEmploymentType(
  title: string | null | undefined,
  description: string | null | undefined
): InferredEmploymentType | null {
  const blob = toTextBlob(title, description)
  if (!blob) return null

  for (const rule of EMPLOYMENT_RULES) {
    if (rule.pattern.test(blob)) return rule.type
  }
  return null
}

export function inferSeniorityLevel(
  title: string | null | undefined,
  description: string | null | undefined
): InferredSeniorityLevel | null {
  const titleBlob = toTextBlob(title)
  for (const rule of SENIORITY_RULES) {
    if (rule.pattern.test(titleBlob)) return rule.level
  }

  const descriptionBlob = toTextBlob(description)
  for (const rule of SENIORITY_RULES) {
    if (rule.pattern.test(descriptionBlob)) return rule.level
  }

  return null
}

export function inferWorkModel(
  location: string | null | undefined,
  description: string | null | undefined
): { isRemote: boolean | null; isHybrid: boolean | null } {
  const blob = toTextBlob(location, description)
  if (!blob) return { isRemote: null, isHybrid: null }

  const hasHybrid = /\bhybrid\b/i.test(blob)
  const hasRemote = /\bremote\b/i.test(blob)
  const hasRemoteNegative = REMOTE_NEGATIVE_PATTERNS.some((pattern) => pattern.test(blob))
  const hasOnsite = /\b(onsite|on[\s-]?site)\b/i.test(blob)

  const isHybrid = hasHybrid ? true : null
  let isRemote: boolean | null = null

  if (hasRemote && !hasRemoteNegative) {
    isRemote = hasHybrid ? false : true
  } else if (hasOnsite && !hasHybrid) {
    isRemote = false
  }

  return { isRemote, isHybrid }
}

export function inferRequiresAuthorization(
  description: string | null | undefined
): boolean | null {
  const text = toTextBlob(description)
  if (!text) return null

  if (AUTH_NOT_REQUIRED_PATTERNS.some((pattern) => pattern.test(text))) return false
  if (AUTH_REQUIRED_PATTERNS.some((pattern) => pattern.test(text))) return true
  return null
}

export function extractSalaryRange(
  text: string | null | undefined
): { min: number; max: number; currency: string } | null {
  const blob = toTextBlob(text)
  if (!blob) return null

  const match = blob.match(SALARY_RANGE_RE)
  if (!match) return null

  const leftCurrency = normalizeCurrency(match[1])
  const rightCurrency = normalizeCurrency(match[4])
  const currency = leftCurrency ?? rightCurrency ?? "USD"

  const left = parseCompensationAmount(match[2], match[3])
  const right = parseCompensationAmount(match[5], match[6])
  if (!left || !right) return null

  const min = Math.min(left, right)
  const max = Math.max(left, right)
  if (max - min < 3_000) return null

  return { min, max, currency }
}

export function extractExperienceLabel(text: string | null | undefined): string | null {
  const blob = toTextBlob(text)
  if (!blob) return null

  const range = blob.match(EXPERIENCE_RANGE_RE)
  if (range) {
    const min = Number.parseInt(range[1], 10)
    const max = range[2] ? Number.parseInt(range[2], 10) : null
    if (Number.isFinite(min) && min > 0) {
      if (max && Number.isFinite(max) && max >= min) return `${min} - ${max} years`
      return `${min}+ years`
    }
  }

  const minimum = blob.match(EXPERIENCE_MIN_RE)
  if (minimum) {
    const years = Number.parseInt(minimum[1], 10)
    if (Number.isFinite(years) && years > 0) return `${years}+ years`
  }

  return null
}

export function extractEducationLabel(text: string | null | undefined): string | null {
  const blob = toTextBlob(text)
  if (!blob) return null

  if (/\b(ph\.?d|doctorate)\b/i.test(blob)) return "PhD preferred"
  if (/\b(master'?s|msc|mba)\b/i.test(blob)) return "Master's degree preferred"
  if (/\b(bachelor'?s|bs\/ba|b\.?s\.?|b\.?a\.?)\b/i.test(blob))
    return "Bachelor's degree or equivalent"
  if (/\bassociate'?s degree\b/i.test(blob)) return "Associate degree or equivalent"
  return null
}

export function inferJobMetadata(input: {
  title: string | null | undefined
  description: string | null | undefined
  location?: string | null | undefined
}): InferredJobMetadata {
  const employmentType = inferEmploymentType(input.title, input.description)
  const seniorityLevel = inferSeniorityLevel(input.title, input.description)
  const workModel = inferWorkModel(input.location, input.description)
  const requiresAuthorization = inferRequiresAuthorization(input.description)
  const salaryRange = extractSalaryRange(input.description)

  return {
    employmentType,
    seniorityLevel,
    isRemote: workModel.isRemote,
    isHybrid: workModel.isHybrid,
    requiresAuthorization,
    salaryMin: salaryRange?.min ?? null,
    salaryMax: salaryRange?.max ?? null,
    salaryCurrency: salaryRange?.currency ?? null,
  }
}

import { cleanJobDescription } from "@/lib/jobs/description"
import { extractSalaryRange, inferEmploymentType } from "@/lib/jobs/metadata"
import type { Job } from "@/types"
import type {
  EmploymentTypeValue,
  EvidenceBackedJobFact,
  EvidenceSource,
  JobEvidenceFacts,
  JobFactConfidence,
  NormalizedSalary,
  WorkModeValue,
} from "@/types/job-evidence-facts"

function toRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

function asTrimmedString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim())
}

function uniqueLocations(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of values) {
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/** Split when ATS uses separators; do not break hyphens inside place names. */
function splitAtsLocationLine(line: string): string[] {
  const parts = line
    .split(/\s*(?:;|\||\n)\s*|\s+[/]\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length > 1) return parts
  if (/,/.test(line) && (line.match(/,/g) ?? []).length >= 2) {
    return line
      .split(/,(?![^()]*\))/) // simple split, keeps "City, ST, Country" as challenge — keep simple: split " X, " patterns for multiple offices
      .map((p) => p.trim())
      .filter(Boolean)
  }
  return [line.trim()].filter(Boolean)
}

function readAtsLocationCandidates(job: Job, raw: Record<string, unknown> | null): {
  values: string[]
  evidence: string[]
} {
  const values: string[] = []
  const evidence: string[] = []

  const fromColumn = asTrimmedString(job.location)
  if (fromColumn) {
    for (const part of splitAtsLocationLine(fromColumn)) {
      values.push(part)
    }
    evidence.push(`Location field: ${fromColumn}`)
  }

  for (const key of ["locations", "offices", "location_names", "ats_locations", "all_locations"] as const) {
    const arr = asStringArray(raw?.[key])
    for (const x of arr) {
      values.push(x)
    }
    if (arr.length) {
      evidence.push(`Structured locations from feed (${key})`)
    }
  }

  return { values: uniqueLocations(values), evidence }
}

function readCareersPageLocation(raw: Record<string, unknown> | null): { values: string[]; evidence: string[] } {
  if (!raw) return { values: [], evidence: [] }
  const keys = [
    "careers_page_location",
    "careersLocation",
    "careers_location",
    "careers_listing_location",
  ] as const
  const values: string[] = []
  const evidence: string[] = []
  for (const k of keys) {
    const s = asTrimmedString(raw[k])
    if (s) {
      values.push(s)
      evidence.push(`Careers page metadata (${k}): ${s}`)
    }
  }
  return { values: uniqueLocations(values), evidence }
}

function readCompanyHqFromRaw(raw: Record<string, unknown> | null): { hq: string | null; path: string | null } {
  if (!raw) return { hq: null, path: null }
  const tryKeys = ["company_hq", "company_hq_name", "headquarters", "hq", "headquarter_city"] as const
  for (const k of tryKeys) {
    const s = asTrimmedString(raw[k])
    if (s) return { hq: s, path: k }
  }
  const nested = toRecord(raw["company"])
  if (nested) {
    for (const k of ["headquarters", "hq", "headquarter"] as const) {
      const s = asTrimmedString(nested[k])
      if (s) return { hq: s, path: `company.${k}` }
    }
  }
  return { hq: null, path: null }
}

const OFFICE_GEO_PATTERNS: Array<{
  re: RegExp
  take: (m: RegExpMatchArray) => string | null
}> = [
  { re: /office\s*locations?:\s*([^\n.]+?)(?:\.|$)/i, take: (m) => m[1]?.trim() ?? null },
  { re: /(?:located in|based in|role is based in)\s*([A-Z][^\n,]{1,80}(?:,?\s*(?:[A-Z]{2}|[A-Z][a-z]+)){0,3})/, take: (m) => m[1]?.trim() ?? null },
]

function parseLocationsFromDescription(description: string | null | undefined): { values: string[]; evidence: string[] } {
  if (!description?.trim()) return { values: [], evidence: [] }
  const values: string[] = []
  const evidence: string[] = []
  for (const { re, take } of OFFICE_GEO_PATTERNS) {
    const m = description.match(re)
    if (m) {
      const t = take(m)
      if (t) {
        values.push(t)
        evidence.push(`Description excerpt: “${t.slice(0, 120)}${t.length > 120 ? "…" : ""}”`)
      }
    }
  }
  return { values: uniqueLocations(values), evidence: uniqueStrings(evidence) }
}

function extractRemoteWithinLines(description: string | null | undefined): string[] {
  if (!description?.trim()) return []
  const out: string[] = []
  for (const line of description.split("\n").slice(0, 40)) {
    const t = line.trim()
    if (!t) continue
    if (/^remote within\b/i.test(t) || /\bremote within the\s+/i.test(t)) {
      out.push(`Description says: ${t.slice(0, 200)}${t.length > 200 ? "…" : ""}`)
    }
  }
  return uniqueStrings(out)
}

function uniqueStrings(xs: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of xs) {
    if (seen.has(x)) continue
    seen.add(x)
    out.push(x)
  }
  return out
}

function isRemoteLocationLabel(s: string): boolean {
  const t = s.trim().toLowerCase()
  return /^(fully?\s+)?remote(?:\b|\s*[-—]\s*)/i.test(s) || t === "remote" || /^remote[\s,;-]+/i.test(s)
}

const REMOTE_BARE = /\bremote\b/i
const REMOTE_DESC =
  /\b(work from home|wfh|remote[-\s]?(?:first|only|within)?|work\s+remotely|distributed|anywhere in|100%\s*remote|remote within)\b/i
const HYBRID_DESC =
  /\b(hybrid|2\s*days in (?:the )?office|3\s*days in (?:the )?office|2-?3 days (?:a week )?on-?site|flexible office schedule|partially remote)\b/i
const ONSITE_DESC =
  /\b(on-?site|in[-\s]office|in person|must be located in|relocation required|on[-\s]prem|office[-\s]based|report(?:s|ing) to the office)\b/i

function collectWorkModeSignals(
  job: Job,
  locationText: string | null,
  textBlob: string
): { remote: boolean; hybrid: boolean; onsite: boolean; hits: string[] } {
  const hits: string[] = []
  const t = String(textBlob)
  if (locationText && isRemoteLocationLabel(locationText)) {
    hits.push(`Location string suggests remote: “${locationText}”`)
  }
  if (job.is_hybrid) hits.push("Structured flag: hybrid role")
  if (job.is_remote) hits.push("Structured flag: remote role")

  if (HYBRID_DESC.test(t)) {
    const m = t.match(HYBRID_DESC)
    if (m) hits.push(`Description keyword: “${m[0]}”`)
  }
  if (REMOTE_DESC.test(t) || (REMOTE_BARE.test(t) && !/\bno remote\b/i.test(t) && !/\bnot remote\b/i.test(t))) {
    const m = t.match(REMOTE_DESC) ?? t.match(REMOTE_BARE)
    if (m) hits.push(`Description keyword: “${m[0]}”`)
  }
  if (ONSITE_DESC.test(t)) {
    if (!/\bno\s+on-?site\b/i.test(t) && !/\bnot\s+on-?site\b/i.test(t)) {
      const m = t.match(ONSITE_DESC)
      if (m) hits.push(`Description keyword: “${m[0]}”`)
    }
  }

  const remoteBareOk =
    REMOTE_BARE.test(t) && !/no remote|not remote|onsite only/i.test(t) && !/non[\s-]remote/i.test(t)
  return {
    remote:
      job.is_remote ||
      (REMOTE_DESC.test(t) && !/no remote|not remote|onsite only/i.test(t)) ||
      remoteBareOk ||
      Boolean(locationText && isRemoteLocationLabel(locationText)),
    hybrid: job.is_hybrid || HYBRID_DESC.test(t),
    onsite:
      ONSITE_DESC.test(t) && !/\bno\s+on-?site\b/i.test(t) && !/\bnot\s+on-?site\b/i.test(t),
    hits,
  }
}

function resolveWorkMode(
  job: Job,
  textBlob: string
): {
  value: WorkModeValue | null
  confidence: JobFactConfidence
  source: EvidenceSource
  evidence: string[]
  reason?: string
} {
  const loc = asTrimmedString(job.location)
  const s = collectWorkModeSignals(job, loc, textBlob)
  const evidence = uniqueStrings(s.hits)
  const structRemote = job.is_remote
  const structHybrid = job.is_hybrid
  if (structRemote && structHybrid) {
    return {
      value: "hybrid",
      confidence: "medium",
      source: "ats_metadata",
      evidence: uniqueStrings([...evidence, "Job lists both remote and hybrid/onsite; treating as hybrid."]),
      reason: "Conflicting structure flags (remote and hybrid) were both set; hybrid is a common interpretation when both appear.",
    }
  }
  if (s.hybrid && s.remote && !structHybrid && !structRemote) {
    if (s.hybrid && s.remote) {
      if (HYBRID_DESC.test(textBlob) && REMOTE_DESC.test(textBlob)) {
        return {
          value: "hybrid",
          confidence: "medium",
          source: "job_description",
          evidence: uniqueStrings([...evidence, "Description contains both remote-style and hybrid-style language."]),
          reason: "Description signals both remote and hybrid; hybrid was chosen to reflect partial office work.",
        }
      }
    }
  }
  if (structRemote && !structHybrid) {
    return { value: "remote", confidence: "high", source: "ats_metadata", evidence, reason: undefined }
  }
  if (structHybrid) {
    return { value: "hybrid", confidence: "high", source: "ats_metadata", evidence, reason: undefined }
  }
  if (s.hybrid) {
    return { value: "hybrid", confidence: s.hits.length > 0 ? "medium" : "low", source: "job_description", evidence, reason: undefined }
  }
  if (s.remote && s.onsite) {
    return {
      value: "hybrid",
      confidence: "medium",
      source: "job_description",
      evidence: uniqueStrings([...evidence, "Description includes both remote-style and in-office / on-site phrasing."]),
      reason: "Treating as hybrid to reflect mixed signals in the text.",
    }
  }
  if (s.remote) {
    return { value: "remote", confidence: "medium", source: "job_description", evidence, reason: undefined }
  }
  if (s.onsite) {
    return {
      value: "onsite",
      confidence: "medium",
      source: "job_description",
      evidence: evidence.length ? evidence : ["On-site or in-office phrasing in description"],
    }
  }
  if (loc && !isRemoteLocationLabel(loc) && !REMOTE_DESC.test(textBlob) && !HYBRID_DESC.test(textBlob)) {
    return {
      value: "onsite",
      confidence: "medium",
      source: "ats_metadata",
      evidence: uniqueStrings([
        ...evidence,
        `A specific place is listed in the location field: “${loc}” and no remote/hybrid wording was detected.`,
      ]),
      reason:
        "Inferred on-site from the listed worksite; the posting may still allow hybrid/remote in sections we did not parse. Verify the full job description.",
    }
  }
  return {
    value: null,
    confidence: "low",
    source: "derived",
    evidence: [],
    reason: "Work arrangement is not clear from the fields we can parse.",
  }
}

const TEMPORARY_DESC = /\b(temporary|seasonal)\b/i

function mapAtsEmployment(et: Job["employment_type"]): EmploymentTypeValue | null {
  if (et == null) return null
  if (et === "fulltime") return "full_time"
  if (et === "parttime") return "part_time"
  if (et === "contract") return "contract"
  if (et === "internship") return "internship"
  return "unknown"
}

function inferEmploymentFromText(title: string, description: string | null | undefined): {
  value: EmploymentTypeValue
  evidence: string[]
} {
  const blob = [title, description ?? ""].join("\n")
  if (TEMPORARY_DESC.test(blob)) {
    return { value: "temporary", evidence: ['Description matches "temporary" or "seasonal" role language.'] }
  }
  const legacy = inferEmploymentType(title, description)
  if (legacy === "fulltime") return { value: "full_time", evidence: ['Title or description says "full-time".'] }
  if (legacy === "parttime") return { value: "part_time", evidence: ['Title or description says "part-time".'] }
  if (legacy === "contract") return { value: "contract", evidence: ['Title or description indicates contract/contractor role.'] }
  if (legacy === "internship") return { value: "internship", evidence: ['Title or description indicates an internship.'] }
  return { value: "unknown", evidence: [] }
}

function buildEmploymentFact(job: Job): EvidenceBackedJobFact<EmploymentTypeValue> {
  if (job.employment_type) {
    const structured = mapAtsEmployment(job.employment_type)
    if (structured && structured !== "unknown") {
      return {
        value: structured,
        confidence: "high",
        source: "ats_metadata",
        evidence: [`Employment type in posting: ${job.employment_type}`],
      }
    }
  }
  const inferred = inferEmploymentFromText(job.title, job.description)
  if (inferred.value === "unknown") {
    return {
      value: null,
      confidence: "low",
      source: "derived",
      evidence: [],
      reason: "Employment type is not set and could not be recognized from the title or description.",
    }
  }
  return {
    value: inferred.value,
    confidence: "medium",
    source: "job_description",
    evidence: inferred.evidence,
  }
}

function isUsdCurrency(c: string | null | undefined): boolean {
  if (c == null || c === "") return true
  return c === "USD" || c === "$" || c.toLowerCase() === "usd"
}

/** Parse hourly $60 - $80 / hr, $60/hr, etc. */
function parseHourlyRange(text: string | null | undefined): {
  min: number
  max: number
  evidence: string
} | null {
  if (!text?.trim()) return null
  const t = text.replace(/\u00a0/g, " ")
  const range =
    t.match(
      /(?:US\$|\$|USD)\s*([\d,]+(?:\.\d+)?)\s*[-–—]\s*(?:US\$|\$|USD)\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*hr|\/h\b|per\s*hour|an?\s*hour|\/hour)/i
    ) ??
    t.match(
      /([\d,]+(?:\.\d+)?)\s*[-–—]\s*([\d,]+(?:\.\d+)?)\s*(?:USD|US\$|\$)?\s*(?:\/\s*hr|\/h\b|per\s*hour)/i
    )
  if (range) {
    const min = Number.parseFloat(range[1].replace(/,/g, ""))
    const max = Number.parseFloat(range[2].replace(/,/g, ""))
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0) {
      const lo = Math.min(min, max)
      const hi = Math.max(min, max)
      return { min: lo, max: hi, evidence: `Hourly range found in text: “${range[0].trim().slice(0, 80)}”` }
    }
  }
  const single = t.match(/(?:US\$|\$|USD)\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*hr|\/h\b|per\s*hour)(?!\s*[-–—])/i)
  if (single) {
    const n = Number.parseFloat(single[1].replace(/,/g, ""))
    if (Number.isFinite(n) && n > 0) {
      return { min: n, max: n, evidence: `Hourly rate in text: “${single[0].trim().slice(0, 80)}”` }
    }
  }
  return null
}

const ANNUAL_EXPLICIT =
  /(?:US\$|\$|USD|€|£|EUR|GBP)\s*([0-9][\d,]{0,6}(?:\.\d+)?)(?:\s*-\s*|\s+to\s+)(?:US\$|\$|USD|€|£)?\s*([0-9][\d,]{0,6}(?:\.\d+)?)\s*(k|K)?/i

function parseExplicitAnnualMentionForEvidenceBlob(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(ANNUAL_EXPLICIT)
  if (m) return m[0].trim().slice(0, 120)
  return null
}

type SalaryEstimateFromRaw = { min: number; max: number; evidence: string[]; reason: string }

function readEstimatedSalaryFromRaw(
  raw: Record<string, unknown> | null
): SalaryEstimateFromRaw | null {
  if (!raw) return null
  if (asTrimmedString(raw["salary_kind"]) === "estimated" || asTrimmedString(raw["compensation_kind"]) === "estimated") {
    const min = toFiniteNumber(raw["estimated_salary_min"] ?? raw["salary_min_estimated"])
    const max = toFiniteNumber(raw["estimated_salary_max"] ?? raw["salary_max_estimated"])
    if (min != null && max != null) {
      return {
        min: Math.min(min, max),
        max: Math.max(min, max),
        evidence: ["Estimated pay range is attached to this job record in derived metadata."],
        reason: "This salary was not posted by the employer in the main compensation fields; it is an internal estimate for reference only.",
      }
    }
  }
  if (asTrimmedString(raw["pay_estimate_source"]) === "model") {
    const min = toFiniteNumber(raw["pay_estimate_min"])
    const max = toFiniteNumber(raw["pay_estimate_max"])
    if (min != null && max != null) {
      return {
        min: Math.min(min, max),
        max: Math.max(min, max),
        evidence: ["Model-based pay estimate stored on the job's metadata."],
        reason: "This salary was not posted by the employer; it is estimated from role, market, and location signals we store for this record.",
      }
    }
  }
  return null
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim()) {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function buildSalaryFact(job: Job, raw: Record<string, unknown> | null): EvidenceBackedJobFact<NormalizedSalary> {
  const notFound = (): NormalizedSalary => ({
    kind: "not_found",
    currency: "USD",
    period: "unknown",
  })
  if (!isUsdCurrency(job.salary_currency)) {
    return {
      value: notFound(),
      confidence: "low",
      source: "derived",
      evidence: [],
      reason: `Compensation is not in USD in our records (currency: ${job.salary_currency || "n/a"}); we do not display a converted amount.`,
    }
  }
  if (job.salary_min != null && job.salary_max != null) {
    return {
      value: {
        kind: "posted",
        min: job.salary_min,
        max: job.salary_max,
        currency: "USD",
        period: "year",
      },
      confidence: "high",
      source: "ats_metadata",
      evidence: [
        `Structured range: $${formatUsdNumber(job.salary_min)} to $${formatUsdNumber(job.salary_max)} ${job.salary_currency === "USD" || !job.salary_currency ? "USD" : job.salary_currency} (annual)`,
      ],
    }
  }
  const cleaned = cleanJobDescription(job.description) ?? job.description
  const est = readEstimatedSalaryFromRaw(raw)
  if (est) {
    return {
      value: {
        kind: "estimated",
        min: est.min,
        max: est.max,
        currency: "USD",
        period: "year",
      },
      confidence: "medium",
      source: "derived",
      evidence: est.evidence,
      reason: est.reason,
    }
  }
  const hourly = parseHourlyRange(cleaned)
  if (hourly) {
    return {
      value: { kind: "posted", min: hourly.min, max: hourly.max, currency: "USD", period: "hour" },
      confidence: "medium",
      source: "salary_parser",
      evidence: [hourly.evidence],
    }
  }
  const annual = extractSalaryRange(cleaned)
  if (annual && annual.currency === "USD" && isUsdCurrency(annual.currency)) {
    return {
      value: { kind: "posted", min: annual.min, max: annual.max, currency: "USD", period: "year" },
      confidence: "medium",
      source: "salary_parser",
      evidence: (() => {
        const hit = parseExplicitAnnualMentionForEvidenceBlob(cleaned)
        if (hit) return [`"${hit}${hit.length >= 120 ? "…" : ""}"`]
        return ['Annual compensation range found in the job description text (parsed).']
      })(),
    }
  }
  return {
    value: notFound(),
    confidence: "low",
    source: "derived",
    evidence: [],
    reason: "No posted or reliably parsed pay range in structured fields or description; nothing is shown on the card.",
  }
}

function formatUsdNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
}

function buildLocationFact(job: Job, raw: Record<string, unknown> | null, description: string | null | undefined): EvidenceBackedJobFact<string[]> {
  const ats = readAtsLocationCandidates(job, raw)
  const careers = readCareersPageLocation(raw)
  const geo = parseLocationsFromDescription(description)
  const remoteWithinEvidence = extractRemoteWithinLines(description)

  if (ats.values.length) {
    const all = uniqueLocations([...ats.values, ...careers.values, ...geo.values])
    const evidence = uniqueStrings([
      ...ats.evidence,
      ...careers.evidence,
      ...geo.evidence,
      ...remoteWithinEvidence,
    ])
    return {
      value: all,
      confidence: "high",
      source: "ats_metadata",
      evidence: evidence.length ? evidence : ['Structured "location" fields from the posting'],
    }
  }
  if (careers.values.length) {
    return {
      value: uniqueLocations([...careers.values, ...geo.values]),
      confidence: "medium",
      source: "company_careers_page",
      evidence: uniqueStrings([...careers.evidence, ...geo.evidence, ...remoteWithinEvidence]),
    }
  }
  if (geo.values.length) {
    return {
      value: geo.values,
      confidence: "medium",
      source: "geo_parser",
      evidence: uniqueStrings([...geo.evidence, ...remoteWithinEvidence]),
    }
  }
  if (remoteWithinEvidence.length) {
    if (asTrimmedString(job.location) && isRemoteLocationLabel(asTrimmedString(job.location)!)) {
      return {
        value: [asTrimmedString(job.location)!],
        confidence: "medium",
        source: "job_description",
        evidence: remoteWithinEvidence,
      }
    }
  }
  if (asTrimmedString(job.location)) {
    return {
      value: [asTrimmedString(job.location)!],
      confidence: "medium",
      source: "ats_metadata",
      evidence: uniqueStrings([`Location field: ${job.location}`, ...remoteWithinEvidence]),
    }
  }
  const { hq, path } = readCompanyHqFromRaw(raw)
  if (hq) {
    return {
      value: [hq],
      confidence: "low",
      source: "derived",
      evidence: path ? [`Field ${path} on the job/company record: ${hq}`] : [hq],
      reason:
        "This location comes from a company- or system-level field (for example, headquarters) and is not confirmed as the role's worksite from the job posting. Treat as a weak hint only.",
    }
  }
  return {
    value: null,
    confidence: "low",
    source: "derived",
    evidence: [],
    reason: "No work location is available from the posting in our data.",
  }
}

/**
 * Build evidence-backed job facts (location, work mode, employment, salary) for UI display.
 * Does not guess salary, work locations, or remote status beyond documented inference rules.
 */
export function buildJobEvidenceFacts(job: Job): JobEvidenceFacts {
  const raw = toRecord(job.raw_data)
  const desc = job.description
  const cleaned = cleanJobDescription(desc) ?? desc ?? ""
  const textForWork = [job.title, job.normalized_title, cleaned].filter(Boolean).join("\n")
  const wm = resolveWorkMode(job, textForWork)
  const workModeFact: EvidenceBackedJobFact<WorkModeValue> = {
    value: wm.value,
    confidence: wm.confidence,
    source: wm.source,
    evidence: wm.evidence,
    reason: wm.reason,
  }
  return {
    location: buildLocationFact(job, raw, desc),
    workMode: workModeFact,
    employmentType: buildEmploymentFact(job),
    salary: buildSalaryFact(job, raw),
  }
}

// --- display helpers (card row) — safe strings only, no hidden guessing ---

function roundK(n: number): string {
  if (n >= 1_000) {
    return `${Math.round(n / 1000)}k`
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
}

function formatDisplaySalary(ns: NormalizedSalary): string | null {
  if (ns.kind === "not_found") return null
  if (ns.kind === "estimated" && ns.min != null && ns.max != null) {
    return `Estimated $${roundK(ns.min)}–$${roundK(ns.max)}`
  }
  if (ns.min == null || ns.max == null) return null
  if (ns.period === "hour") {
    if (ns.min === ns.max) {
      return `$${ns.min.toLocaleString("en-US")}/hr`
    }
    return `$${ns.min.toLocaleString("en-US")}–$${ns.max.toLocaleString("en-US")}/hr`
  }
  // posted annual
  return `$${roundK(ns.min)}–$${roundK(ns.max)}`
}

export function formatWorkModeForCard(mode: "remote" | "hybrid" | "onsite" | "unknown"): string | null {
  if (mode === "unknown") return null
  if (mode === "onsite") return "On-site"
  return mode.charAt(0).toUpperCase() + mode.slice(1)
}

export function formatEmploymentTypeForCard(et: EmploymentTypeValue): string | null {
  switch (et) {
    case "full_time":
      return "Full-time"
    case "part_time":
      return "Part-time"
    case "contract":
      return "Contract"
    case "internship":
      return "Internship"
    case "temporary":
      return "Temporary"
    default:
      return null
  }
}

export function formatLocationForCard(value: string[] | null): { text: string | null; extra: number } {
  if (!value || value.length === 0) return { text: null, extra: 0 }
  if (value.length === 1) return { text: value[0], extra: 0 }
  if (value.length === 2) return { text: value.join(" · "), extra: 0 }
  return { text: value[0], extra: value.length - 1 }
}

export type JobCardFactId = "location" | "workMode" | "employmentType" | "salary"

export type JobCardFactItem = {
  id: JobCardFactId
  displayText: string
  label: string
  /** Popover / dialog title */
  factTitle: string
  fact: EvidenceBackedJobFact<unknown>
}

const FACT_PRIORITY: JobCardFactId[] = ["salary", "location", "workMode", "employmentType"]

/**
 * Picks at most 4 evidence-backed items for the main card row, prioritizing posted salary.
 */
export function labelEvidenceSource(source: EvidenceSource): string {
  const m: Record<EvidenceSource, string> = {
    ats_metadata: "ATS / posting fields",
    job_description: "Job description",
    company_careers_page: "Company careers page",
    salary_parser: "Salary text parser",
    geo_parser: "Location text parser",
    derived: "Derived (low-trust) signal",
  }
  return m[source]
}

export function buildJobCardFactList(facts: JobEvidenceFacts, max = 4): JobCardFactItem[] {
  const out: JobCardFactItem[] = []
  for (const id of FACT_PRIORITY) {
    if (out.length >= max) break
    if (id === "salary") {
      const v = facts.salary.value
      if (v == null || v.kind === "not_found") continue
      const d = formatDisplaySalary(v)
      if (!d) continue
      out.push({
        id: "salary",
        displayText: d,
        label: "Salary",
        factTitle: "Salary",
        fact: facts.salary,
      })
      continue
    }
    if (id === "location") {
      const v = facts.location.value
      if (v == null || v.length === 0) continue
      const { text, extra } = formatLocationForCard(v)
      if (!text) continue
      out.push({
        id: "location",
        displayText: extra > 0 ? `${text} +${extra} locations` : text,
        label: "Location",
        factTitle: "Location",
        fact: facts.location,
      })
      continue
    }
    if (id === "workMode") {
      const w = facts.workMode.value
      if (w == null) continue
      const t = formatWorkModeForCard(w)
      if (!t) continue
      out.push({ id: "workMode", displayText: t, label: "Work mode", factTitle: "Work mode", fact: facts.workMode })
      continue
    }
    if (id === "employmentType") {
      const e = facts.employmentType.value
      if (e == null) continue
      const t = formatEmploymentTypeForCard(e)
      if (!t) continue
      out.push({
        id: "employmentType",
        displayText: t,
        label: "Employment",
        factTitle: "Employment type",
        fact: facts.employmentType,
      })
    }
  }
  return out
}

/**
 * Y Combinator's Work at a Startup (workatastartup.com) source adapter.
 *
 * WAAS exposes its data via Inertia.js page props embedded in a `data-page`
 * attribute on the root <div>. That gives us:
 *   - /jobs                                → 30 jobs (listing summaries)
 *   - /jobs/l/<role-slug>                  → 30 jobs filtered to one role
 *   - /jobs/<id>                           → full job detail with descriptionHtml
 *
 * The listing endpoint doesn't appear to paginate via query params; instead
 * we fan out across role filters to broaden coverage. Each role pulls up to
 * 30 of the freshest postings for that vertical.
 *
 * No anti-bot beyond standard Cloudflare browser headers. No auth required
 * for the public listing/detail pages.
 */

const WAAS_BASE = "https://www.workatastartup.com"

const WAAS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

const WAAS_DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": WAAS_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
}

export const WAAS_ROLE_SLUGS = [
  "software-engineer",
  "engineering-manager",
  "designer",
  "product-manager",
  "data-science",
  "operations",
  "sales-manager",
  "marketing",
  "recruiting",
  "founder",
] as const

export type WaasRoleSlug = (typeof WAAS_ROLE_SLUGS)[number]

// ─── Listing types ──────────────────────────────────────────────────────────

/** Summary shape returned by the /jobs[/l/<role>] listing page. */
export type WaasJobSummary = {
  id: number
  title: string
  /** e.g. "Fulltime" / "Intern" / "Contract" */
  jobType: string | null
  location: string | null
  /** Human-readable role category, e.g. "Software engineer" */
  roleType: string | null
  /** Free-form salary string, e.g. "$200K - $250K" */
  salary: string | null
  companyName: string
  companySlug: string
  /** YC batch identifier, e.g. "S15", "W24" */
  companyBatch: string | null
  companyOneLiner: string | null
  companyLogoUrl: string | null
  companyLastActiveAt: string | null
  /** WAAS-provided apply URL (typically routes through YC auth) */
  applyUrl: string
}

// ─── Detail types ───────────────────────────────────────────────────────────

export type WaasJobDetail = {
  job: {
    id: number
    title: string
    salaryRange: string | null
    equityRange: string | null
    location: string | null
    jobType: string | null
    sponsorsVisa: boolean | null
    minExperience: string | null
    skills: string[] | null
    descriptionHtml: string | null
    interviewProcessHtml: string | null
  }
  company: {
    id?: number
    name: string
    slug: string
    oneLiner?: string | null
    description?: string | null
    websiteUrl?: string | null
    locations?: string[] | null
    batch?: string | null
    logoUrl?: string | null
    employees?: number | null
  } | null
  applyUrl: string | null
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function htmlDecode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

/**
 * Extract the Inertia.js page props from a WAAS HTML response.
 * Pages render a `<div id="app" data-page='{...JSON...}' />` shell;
 * the JSON contains `{ component, props, url, version, ... }`.
 */
function extractInertiaProps<T = unknown>(html: string): T | null {
  const match = html.match(/data-page=["']([^"']+)["']/)
  if (!match) return null
  try {
    const raw = htmlDecode(match[1])
    const data = JSON.parse(raw) as { props?: T }
    return data.props ?? null
  } catch {
    return null
  }
}

async function fetchWaasHtml(path: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const url = path.startsWith("http") ? path : `${WAAS_BASE}${path}`
  try {
    const res = await fetchImpl(url, {
      headers: WAAS_DEFAULT_HEADERS,
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch a WAAS jobs listing. Without a role slug returns the firehose (30
 * mixed-role jobs). With a slug returns 30 jobs in that vertical.
 *
 * Use multiple role slugs to broaden coverage — WAAS doesn't expose
 * pagination on the public listing endpoints.
 */
export async function fetchWaasListing(
  role?: WaasRoleSlug,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<WaasJobSummary[]> {
  const path = role ? `/jobs/l/${role}` : "/jobs"
  const html = await fetchWaasHtml(path, opts.fetchImpl)
  if (!html) return []

  const props = extractInertiaProps<{ jobs?: WaasJobSummary[] }>(html)
  return props?.jobs ?? []
}

/**
 * Fetch the full detail props for a single WAAS job. Returns null if the
 * page errors or doesn't expose Inertia props.
 */
export async function fetchWaasJobDetail(
  id: number,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<WaasJobDetail | null> {
  const html = await fetchWaasHtml(`/jobs/${id}`, opts.fetchImpl)
  if (!html) return null
  return extractInertiaProps<WaasJobDetail>(html)
}

// ─── Salary / work-mode parsing ─────────────────────────────────────────────

/**
 * Parse a WAAS salary string like "$200K - $250K" into a structured range.
 * Returns nulls when the string is empty, "Not provided", or unparseable.
 * Equity ranges (e.g. "0.5% - 1.0%") are ignored.
 */
export function parseWaasSalary(raw: string | null | undefined): {
  min: number | null
  max: number | null
  currency: string
} {
  if (!raw) return { min: null, max: null, currency: "USD" }
  const trimmed = raw.trim()
  if (!trimmed || /not\s+provided|unspecified|negotiable/i.test(trimmed)) {
    return { min: null, max: null, currency: "USD" }
  }
  // Equity rows look like "0.5% - 1.0%" — skip.
  if (/%\s*$/.test(trimmed) || /equity/i.test(trimmed)) {
    return { min: null, max: null, currency: "USD" }
  }
  const currencyMatch = trimmed.match(/\b(USD|EUR|GBP|CAD)\b/i)
  const currency = currencyMatch?.[1]?.toUpperCase() ?? "USD"

  // "$200K - $250K" / "$120,000 - $160,000" / "200K-250K"
  const numbers = [...trimmed.matchAll(/\$?\s*([\d,]+(?:\.\d+)?)\s*([KkMm])?/g)]
    .map((m) => {
      const base = Number(m[1].replace(/,/g, ""))
      if (!Number.isFinite(base)) return null
      const suffix = (m[2] ?? "").toLowerCase()
      if (suffix === "k") return Math.round(base * 1000)
      if (suffix === "m") return Math.round(base * 1_000_000)
      return Math.round(base)
    })
    .filter((n): n is number => n !== null && n > 0)

  if (numbers.length === 0) return { min: null, max: null, currency }
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0], currency }
  return { min: numbers[0], max: numbers[numbers.length - 1], currency }
}

/**
 * Infer remote/hybrid flags from the WAAS location field, which is free-form
 * (e.g. "Remote", "San Francisco, CA / Remote", "Hybrid – New York", "Anywhere").
 */
export function parseWaasWorkMode(location: string | null | undefined): {
  isRemote: boolean
  isHybrid: boolean
} {
  if (!location) return { isRemote: false, isHybrid: false }
  const l = location.toLowerCase()
  const isHybrid = /hybrid/.test(l)
  const isRemote = /remote|anywhere|work\s+from\s+home|wfh/.test(l)
  return { isRemote, isHybrid: isHybrid && !isRemote }
}

/**
 * Strip the HTML-only descriptionHtml down to a plain-text form, preserving
 * paragraph and list breaks. Matches the shape we store in jobs.description.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return ""
  return html
    .replace(/<\/(p|div|li|br|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>(?=)/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*\n+/g, "\n\n")
    .trim()
}

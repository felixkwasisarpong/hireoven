/**
 * Site detection and job-page detection utilities.
 *
 * These are pure functions — they accept an optional url string and an
 * optional Document, defaulting to window.location.href / the global document
 * only when running inside Chrome. They are safe to import in tests or Node
 * environments as long as callers supply the url argument explicitly.
 *
 * Relationship to ats.ts:
 *   detectATS()  → which ATS platform owns the application form (7 providers)
 *   detectSite() → which major site/board are we currently on (8 sites)
 *   Both are complementary; content scripts may call both.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type SupportedSite =
  | "linkedin"
  | "indeed"
  | "glassdoor"
  | "handshake"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "icims"
  | "smartrecruiters"
  | "unknown"

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function currentHref(): string {
  return typeof window !== "undefined" ? window.location.href : ""
}

// ── Site detection ────────────────────────────────────────────────────────────

type SiteHostRule = { match: (host: string) => boolean; site: SupportedSite }

/**
 * Ordered list of hostname → site rules.
 * Checked top-to-bottom; first match wins.
 */
const SITE_HOST_RULES: SiteHostRule[] = [
  {
    match: h => h === "www.linkedin.com" || h === "linkedin.com" || h.endsWith(".linkedin.com"),
    site: "linkedin",
  },
  {
    // boards.greenhouse.io, job-boards.greenhouse.io, app.greenhouse.io, greenhouse.io
    match: h => h === "greenhouse.io" || h.endsWith(".greenhouse.io"),
    site: "greenhouse",
  },
  {
    match: h => h === "jobs.lever.co" || h.endsWith(".lever.co"),
    site: "lever",
  },
  {
    match: h => h === "jobs.ashbyhq.com" || h.endsWith(".ashbyhq.com"),
    site: "ashby",
  },
  {
    // [company].myworkdayjobs.com or [company].workdayjobs.com
    match: h =>
      h.endsWith(".myworkdayjobs.com") ||
      h === "myworkdayjobs.com" ||
      h.endsWith(".workdayjobs.com") ||
      h === "workdayjobs.com",
    site: "workday",
  },
  {
    match: h => h === "www.indeed.com" || h === "indeed.com" || h.endsWith(".indeed.com"),
    site: "indeed",
  },
  {
    match: h =>
      h === "www.glassdoor.com" || h === "glassdoor.com" || h.endsWith(".glassdoor.com"),
    site: "glassdoor",
  },
  {
    // joinhandshake.com — Handshake's main domain (university job board)
    match: h => h === "joinhandshake.com" || h.endsWith(".joinhandshake.com"),
    site: "handshake",
  },
  {
    // jobs.icims.com, [company].icims.com — iCIMS-hosted apply pages
    match: h => h === "icims.com" || h.endsWith(".icims.com"),
    site: "icims",
  },
  {
    // jobs.smartrecruiters.com / careers.smartrecruiters.com / [tenant].smartrecruiters.com
    match: h => h === "smartrecruiters.com" || h.endsWith(".smartrecruiters.com"),
    site: "smartrecruiters",
  },
]

/**
 * Query params that identify an embedded ATS job even on a company-branded domain.
 * When present the site is identified without a hostname match.
 */
const SITE_QUERY_PARAM_RULES: Array<{ param: string; site: SupportedSite }> = [
  { param: "gh_jid", site: "greenhouse" }, // Greenhouse embed: ?gh_jid=12345
]

/**
 * Returns which major job site or ATS the given URL belongs to.
 * Defaults to window.location.href when url is omitted.
 */
export function detectSite(url?: string): SupportedSite {
  const href = url ?? currentHref()
  const parsed = parseUrl(href)
  if (!parsed) return "unknown"

  const host = parsed.hostname.toLowerCase()

  for (const rule of SITE_HOST_RULES) {
    if (rule.match(host)) return rule.site
  }

  for (const { param, site } of SITE_QUERY_PARAM_RULES) {
    if (parsed.searchParams.has(param)) return site
  }

  return "unknown"
}

// ── Job-page detection ────────────────────────────────────────────────────────

/**
 * Site-specific URL path patterns that strongly indicate a single job-detail
 * or application page (not a search/list page).
 *
 * Patterns are tested against pathname.toLowerCase() unless noted.
 */
const JOB_DETAIL_TESTS: Partial<Record<SupportedSite, (path: string, params: URLSearchParams) => boolean>> = {
  linkedin: (path, params) =>
    // /jobs/view/[id]                           — full standalone job page
    // /jobs/search/?currentJobId=X              — search/list page with a job in the side pane
    // /jobs/collections/recommended/?currentJobId=X — same pattern in collections
    /^\/jobs\/view\//.test(path) || params.has("currentJobId"),

  greenhouse: (path, params) =>
    // boards|job-boards.greenhouse.io/company/jobs/[numericId]
    // greenhouse.io/job_app  (direct or embedded application form link)
    /\/jobs\/\d+/.test(path) ||
    /\/job_app/.test(path) ||
    // Embedded on company domain: ?gh_jid=<id>
    params.has("gh_jid"),

  lever: (path) =>
    // jobs.lever.co/company/[uuid]  — UUIDs are 8-4-4-4-12 hex
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(path),

  ashby: (path) =>
    // jobs.ashbyhq.com/Company/[job-slug]  — requires 2+ non-empty path segments
    /^\/[^/]+\/[^/?#]+/.test(path),

  workday: (path) =>
    // [company].myworkdayjobs.com/Site/job/Location/Title/ID
    /\/job\//.test(path),

  indeed: (path) =>
    // indeed.com/viewjob?jk=…  or tracked click redirects
    /^\/(viewjob|rc\/clk|pagead)/.test(path),

  glassdoor: (path, params) =>
    // glassdoor.com/job-listing/Title-Company-JV_…
    /^\/job-listing\//.test(path) ||
    // Partner/redirect links carry the job listing ID as ?jl=
    params.has("jl"),

  handshake: (path) =>
    // joinhandshake.com/stu/jobs/<id>  or  /jobs/<id>
    /^\/(?:[a-z]{2,4}\/)?jobs\/\d+/.test(path),

  icims: (path) =>
    // *.icims.com/jobs/<id>/<slug> or /jobs/<id>/<slug>/job  or /jobs/<id>/<slug>/login
    /\/jobs\/\d+/.test(path),

  smartrecruiters: (path) =>
    // jobs.smartrecruiters.com/<tenant>/<numeric-id-or-slug>
    /^\/[^/]+\/[^/?#]+/.test(path),
}

/**
 * Generic query-param signals that indicate a specific job on an unknown
 * company domain with an embedded ATS (e.g. example.com/careers?job_id=42).
 */
const GENERIC_JOB_PARAMS = [
  "job_id",
  "jobId",
  "jobid",
  "position_id",
  "positionId",
  "opening_id",
  "reqId",
  "req_id",
  "vacancy_id",
] as const

/**
 * Returns true when JSON-LD or microdata on the page declares a JobPosting
 * schema — the most reliable DOM signal for a job detail page.
 */
function domLooksLikeJobDetailPage(doc: Document): boolean {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
  for (const script of scripts) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = JSON.parse(script.textContent ?? "")
      if (hasJobPostingType(data)) return true
    } catch {
      // Malformed JSON-LD — skip
    }
  }
  return doc.querySelector('[itemtype*="JobPosting"]') !== null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasJobPostingType(data: any): boolean {
  if (!data || typeof data !== "object") return false
  const isJobPosting = (t: unknown) => t === "JobPosting"
  const types: unknown[] = Array.isArray(data["@type"]) ? data["@type"] : [data["@type"]]
  if (types.some(isJobPosting)) return true
  // Walk @graph arrays
  if (Array.isArray(data["@graph"])) {
    for (const node of data["@graph"] as unknown[]) {
      if (hasJobPostingType(node)) return true
    }
  }
  return false
}

/**
 * Returns true when the URL (and optionally the DOM) strongly suggest the
 * user is on a single job detail or application page — NOT a search list.
 *
 * Call with just a URL for fast, synchronous checks.
 * Pass doc to enable JSON-LD / microdata fallback for unrecognized sites.
 */
export function isProbablyJobPage(url?: string, doc?: Document): boolean {
  const href = url ?? currentHref()
  const parsed = parseUrl(href)
  if (!parsed) return false

  const path = parsed.pathname.toLowerCase()
  const params = parsed.searchParams

  // Embedded Greenhouse on any domain — always a specific job
  if (params.has("gh_jid")) return true

  const site = detectSite(href)
  const test = JOB_DETAIL_TESTS[site]

  if (test !== undefined) {
    return test(path, params)
  }

  // Unknown site — check generic ATS job-ID query params
  for (const param of GENERIC_JOB_PARAMS) {
    if (params.has(param)) return true
  }

  // DOM fallback for unrecognized sites (slower — only when doc is provided)
  if (doc !== undefined) {
    return domLooksLikeJobDetailPage(doc)
  }

  return false
}

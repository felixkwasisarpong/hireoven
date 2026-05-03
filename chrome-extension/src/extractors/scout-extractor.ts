/**
 * Hireoven Scout Bar — Job extractor.
 *
 * Pure DOM/URL-based extraction. No backend calls, no AI. Returns a normalized
 * job snapshot the Scout Bar (and later integrations) can render.
 *
 * Strategy per call:
 *   1. Dispatch by detectSite() to a source-specific DOM extractor.
 *   2. Merge with JSON-LD JobPosting (when present) — DOM wins on conflict.
 *   3. Fall back to canonical URL / OG meta for canonicalUrl.
 *   4. Compute a confidence score from how many key fields were filled.
 *
 * Distinct from the legacy `extractors/job.ts` which targets the older
 * `ExtractedJob` shape in `types.ts` consumed by background/popup. The two
 * extractors coexist; the Scout Bar imports this one.
 */

import { detectSite, type SupportedSite } from "../detectors/site"

// ── Public type ───────────────────────────────────────────────────────────────

export type ExtractedJob = {
  source: SupportedSite
  url: string
  canonicalUrl?: string
  title?: string
  company?: string
  location?: string
  descriptionText?: string
  salaryText?: string
  employmentType?: string
  /** Remote / Hybrid / On-site — pulled from a visible pill or location string. */
  workModeText?: string
  applyUrl?: string
  detectedAts?: SupportedSite
  /**
   * True when the page or description signals an "actively hiring/recruiting"
   * urgency cue. Same regex as JobCardV2's fallback detector for consistency.
   */
  activelyHiring?: boolean
  /**
   * Posting time as shown on the source page. Preferred order:
   *   - JSON-LD datePosted (ISO 8601)
   *   - DOM <time datetime="...">
   *   - Visible relative text ("2 days ago", "Reposted 1 week ago")
   * Stored as the raw string the page presented; clients render as-is or parse.
   */
  postedAt?: string
  /**
   * Visible "X ago" string parsed from the page metadata row. Distinct from
   * `postedAt` (which can also hold an ISO timestamp from JSON-LD) — clients
   * that want to render the user-visible age string verbatim should prefer
   * this field.
   */
  postedAgeText?: string
  /**
   * "Over 100 people clicked apply", "23 applicants", etc. — the engagement
   * snippet LinkedIn (and a few others) include in the metadata row. Useful
   * for the Detail Scout panel; never used as a filter.
   */
  applicantActivityText?: string
  /** True when the metadata row contains "Promoted". */
  promoted?: boolean
  /** True when the page declares "Responses managed off LinkedIn". */
  managedOffLinkedIn?: boolean
  confidence: "high" | "medium" | "low"
  extractedAt: string
}

/**
 * Parse LinkedIn's top-card metadata row, e.g.:
 *   "New York, NY · 22 hours ago · Over 100 people clicked apply ·
 *    Promoted by hirer · Responses managed off LinkedIn"
 *
 * Splits on "·" and classifies each segment by content. Keeps the first
 * location-like segment only — the rest are routed to specific fields so
 * downstream code never has to re-parse a kitchen-sink string.
 */
export function parseLinkedInMetadataRow(text: string): {
  location?: string
  postedAgeText?: string
  applicantActivityText?: string
  promoted?: boolean
  managedOffLinkedIn?: boolean
} {
  if (!text) return {}
  const cleaned = text.replace(/\s+/g, " ").trim()
  const segments = cleaned.split(/[·•]/).map((s) => s.trim()).filter(Boolean)

  const out: {
    location?: string
    postedAgeText?: string
    applicantActivityText?: string
    promoted?: boolean
    managedOffLinkedIn?: boolean
  } = {}

  for (const seg of segments) {
    if (!out.postedAgeText && /\bago\b/i.test(seg)) {
      out.postedAgeText = seg
      continue
    }
    if (
      !out.applicantActivityText &&
      /(applicants?|people\s+clicked\s+apply|clicked\s+apply|over\s+\d+\s+applicants?)/i.test(seg)
    ) {
      out.applicantActivityText = seg
      continue
    }
    if (/\bpromoted\b/i.test(seg)) {
      out.promoted = true
      continue
    }
    if (/responses\s+managed\s+off\s+linkedin/i.test(seg)) {
      out.managedOffLinkedIn = true
      continue
    }
    // First plausible location wins. Heuristic: contains a comma OR matches a
    // location-y pattern. Skip segments that are clearly not locations.
    if (
      !out.location &&
      seg.length < 80 &&
      !/responses|managed|hirer|reposted/i.test(seg) &&
      (/,/.test(seg) || /\b(remote|hybrid|on[-\s]?site)\b/i.test(seg) || /^[A-Z]/.test(seg))
    ) {
      out.location = seg
    }
  }

  // Fallback for managedOffLinkedIn — sometimes appears outside the row.
  if (!out.managedOffLinkedIn && /responses\s+managed\s+off\s+linkedin/i.test(cleaned)) {
    out.managedOffLinkedIn = true
  }

  return out
}

// Single source of truth — also mirrored in the analyze/save routes and
// components/jobs/JobCardV2.tsx (keep all four in lockstep).
//
// Detects:
//   - actively recruiting / hiring / seeking
//   - actively reviewing (applicants | applications | candidates)
//   - urgently hiring / urgent hiring / urgent(ly) need
//   - hiring now / now hiring
//   - immediate(ly) hire / hiring / need / opening
//   - high(ly) priority role
export const ACTIVELY_HIRING_RE =
  /\b(?:actively\s+(?:recruiting|hiring|seeking|reviewing\s+(?:applicants?|applications?|candidates?))|urgently?\s+hiring|hiring\s+now|now\s+hiring|immediate(?:ly)?\s+(?:hire|hiring|need|opening)|urgent(?:ly)?\s+(?:hiring|need)|high(?:ly)?\s+priority\s+role)\b/i

function detectActivelyHiring(...texts: Array<string | undefined>): boolean {
  return texts.some((t) => t && ACTIVELY_HIRING_RE.test(t))
}

// ── Helpers (exported per spec) ───────────────────────────────────────────────

/** Normalize whitespace and non-breaking spaces. Returns undefined for empty. */
export function cleanText(value?: string): string | undefined {
  if (!value) return undefined
  const out = value.replace(/ /g, " ").replace(/\s+/g, " ").trim()
  return out || undefined
}

/** First non-empty text from a list of CSS selectors. */
export function firstText(selectors: string[], doc: Document = document): string | undefined {
  for (const selector of selectors) {
    let el: Element | null = null
    try {
      el = doc.querySelector(selector)
    } catch {
      continue // invalid selector — skip
    }
    if (el) {
      const text = cleanText(el.textContent ?? undefined)
      if (text) return text
    }
  }
  return undefined
}

/** First non-empty text from a list of CSS selectors scoped within a single element. */
function firstTextWithin(root: Element, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    let el: Element | null = null
    try {
      el = root.querySelector(selector)
    } catch {
      continue
    }
    if (el) {
      const text = cleanText(el.textContent ?? undefined)
      if (text) return text
    }
  }
  return undefined
}

/** Extract visible text content from main/article landmarks (or body). */
export function getVisiblePageText(doc: Document = document): string {
  const main =
    doc.querySelector("main") ??
    doc.querySelector("[role=main]") ??
    doc.querySelector("article") ??
    doc.body
  if (!main) return ""
  return cleanText(main.textContent ?? undefined) ?? ""
}

// ── JSON-LD JobPosting fallback ───────────────────────────────────────────────

type LdValue = string | number | undefined
interface LdAddress {
  addressLocality?: LdValue
  addressRegion?: LdValue
  addressCountry?: LdValue | { name?: LdValue }
}
interface LdJobLocation {
  address?: LdAddress
}
interface LdHiringOrg {
  name?: string
}
interface LdJobPosting {
  "@type"?: string | string[]
  title?: string
  hiringOrganization?: LdHiringOrg | string
  jobLocation?: LdJobLocation | LdJobLocation[]
  description?: string
  employmentType?: string | string[]
  url?: string
  datePosted?: string
}

function isJobPostingType(node: unknown): node is LdJobPosting {
  if (!node || typeof node !== "object") return false
  const type = (node as { "@type"?: unknown })["@type"]
  if (type === "JobPosting") return true
  if (Array.isArray(type) && type.includes("JobPosting")) return true
  return false
}

function findJobPosting(data: unknown): LdJobPosting | null {
  if (!data || typeof data !== "object") return null
  if (isJobPostingType(data)) return data
  const graph = (data as { "@graph"?: unknown })["@graph"]
  if (Array.isArray(graph)) {
    for (const node of graph) {
      const found = findJobPosting(node)
      if (found) return found
    }
  }
  return null
}

function postingToFields(p: LdJobPosting): Partial<ExtractedJob> {
  const company =
    typeof p.hiringOrganization === "string"
      ? p.hiringOrganization
      : p.hiringOrganization?.name

  let location: string | undefined
  const loc = Array.isArray(p.jobLocation) ? p.jobLocation[0] : p.jobLocation
  if (loc?.address) {
    const parts = [loc.address.addressLocality, loc.address.addressRegion]
      .map((v) => (typeof v === "string" ? v : undefined))
      .filter((v): v is string => Boolean(v))
    if (parts.length > 0) location = parts.join(", ")
  }

  const employmentType = Array.isArray(p.employmentType)
    ? p.employmentType.join(", ")
    : p.employmentType

  // Strip HTML from description (JSON-LD descriptions sometimes contain HTML)
  const description = p.description?.replace(/<[^>]+>/g, " ")

  return {
    title: cleanText(p.title),
    company: cleanText(company),
    location: cleanText(location),
    descriptionText: cleanText(description),
    employmentType: cleanText(employmentType),
    canonicalUrl: cleanText(p.url),
    postedAt: cleanText(p.datePosted),
  }
}

// ── DOM postedAt helpers ──────────────────────────────────────────────────────

/**
 * Read a <time> element's `datetime` attribute (preferred, ISO 8601) or
 * its visible text content from the first selector that resolves.
 */
function firstTimeAttr(selectors: string[], doc: Document): string | undefined {
  for (const selector of selectors) {
    let el: Element | null = null
    try {
      el = doc.querySelector(selector)
    } catch {
      continue
    }
    if (!el) continue
    const dt = el.getAttribute("datetime")
    if (dt) return cleanText(dt)
    const txt = cleanText(el.textContent ?? undefined)
    if (txt) return txt
  }
  return undefined
}

function extractFromJsonLd(doc: Document): Partial<ExtractedJob> {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
  for (const script of scripts) {
    try {
      const data: unknown = JSON.parse(script.textContent ?? "")
      const posting = findJobPosting(data)
      if (posting) return postingToFields(posting)
    } catch {
      // malformed JSON — skip
    }
  }
  return {}
}

function readCanonicalUrl(doc: Document): string | undefined {
  const link = doc.querySelector("link[rel='canonical']") as HTMLLinkElement | null
  if (link?.href) return link.href
  const og = doc.querySelector("meta[property='og:url']") as HTMLMetaElement | null
  return og?.content || undefined
}

// ── Hostname / path helpers (Lever, Ashby, Workday have company in URL) ──────

function companyFromPathFirstSegment(pathname: string): string | undefined {
  const m = pathname.match(/^\/([^/?#]+)/)
  if (!m || !m[1]) return undefined
  return cleanText(m[1].replace(/[-_]/g, " "))
}

function companyFromSubdomain(hostname: string): string | undefined {
  const parts = hostname.replace(/^www\./i, "").split(".")
  if (parts.length < 3) return undefined
  return cleanText(parts[0]?.replace(/[-_]/g, " "))
}

// ── Per-source extractors ─────────────────────────────────────────────────────

/**
 * Parse LinkedIn's canonical <title>/og:title pattern, which is extremely
 * reliable across signed-in/signed-out states and React hydration phases:
 *   "{Company} hiring {Title} in {Location} | LinkedIn"
 */
function parseLinkedInTitleTag(s: string | undefined | null): {
  company?: string
  title?: string
  location?: string
} {
  if (!s) return {}
  const m = s.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+(.+?))?\s*\|\s*LinkedIn\s*$/i)
  if (!m) return {}
  return {
    company: cleanText(m[1]),
    title: cleanText(m[2]),
    location: cleanText(m[3] ?? undefined),
  }
}

function extractLinkedIn(doc: Document): Partial<ExtractedJob> {
  // LinkedIn renders job content in two layouts:
  //   1. /jobs/view/[id]/                — standalone, full page
  //   2. /jobs/search/?currentJobId=[id] — side-pane (DOM under .scaffold-layout__detail)
  // Side-pane wrapping classes wrap the same top-card child classes, so we
  // scope a few selectors to each container to give the cascade extra hits.

  // Scoped side-pane selectors — match these first when on /jobs/search.
  const SIDE_PANE_SCOPES = [
    ".scaffold-layout__detail",
    ".jobs-search__job-details",
    ".jobs-search-results-list__detail",
    "#main-content",
  ]
  const scoped = (sel: string) =>
    SIDE_PANE_SCOPES.map((scope) => `${scope} ${sel}`)

  // LinkedIn rotates DOM classes frequently. Cascade from current → legacy.
  let title = firstText(
    [
      ...scoped(".job-details-jobs-unified-top-card__job-title"),
      ...scoped("h1[class*='top-card']"),
      // Current /jobs/view standalone
      ".job-details-jobs-unified-top-card__job-title h1",
      ".job-details-jobs-unified-top-card__job-title",
      "h1.job-details-jobs-unified-top-card__job-title",
      // Public (signed-out) job page
      "h1.top-card-layout__title",
      "h1.topcard__title",
      // Legacy
      "h1.t-24.t-bold",
      "h1.jobs-unified-top-card__job-title",
      "h1[class*='top-card']",
      "h1",
    ],
    doc,
  )
  let company = firstText(
    [
      ...scoped(".job-details-jobs-unified-top-card__company-name a"),
      ...scoped(".job-details-jobs-unified-top-card__company-name"),
      ...scoped("a[href*='/company/']"),
      // Standalone /jobs/view variants
      ".job-details-jobs-unified-top-card__company-name a",
      ".job-details-jobs-unified-top-card__company-name",
      // Public
      ".topcard__org-name-link",
      ".top-card-layout__second-subline a",
      // Legacy
      ".jobs-unified-top-card__company-name a",
      ".jobs-unified-top-card__company-name",
      "a[href*='/company/']",
    ],
    doc,
  )
  // The whole metadata row — we'll parse it into location + posted age +
  // applicant activity + promoted/managed flags below.
  const metadataRowText = firstText(
    [
      ...scoped(".job-details-jobs-unified-top-card__primary-description-container"),
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".job-details-jobs-unified-top-card__primary-description",
      ".jobs-unified-top-card__primary-description",
      ".jobs-unified-top-card__primary-description-without-tagline",
      // Public layout
      ".topcard__flavor-row",
      ".topcard__flavor--bullet",
    ],
    doc,
  )
  const meta = parseLinkedInMetadataRow(metadataRowText ?? "")

  // Use the parsed clean location; fall back to single-bullet selectors only
  // if the metadata-row parser returned nothing.
  let location = meta.location ?? firstText(
    [
      ".job-details-jobs-unified-top-card__bullet",
      ".topcard__flavor--bullet",
      ".jobs-unified-top-card__bullet",
    ],
    doc,
  )
  let descriptionText = firstText(
    [
      ...scoped("#job-details"),
      ...scoped(".jobs-description__content"),
      // Standalone
      "#job-details",
      ".jobs-description__content .jobs-box__html-content",
      ".jobs-description__content",
      ".jobs-box__html-content",
      // Legacy
      ".jobs-description__container",
      ".jobs-description-content__text",
      ".description__text",
      ".show-more-less-html__markup",
    ],
    doc,
  )

  // Active-card fallback for /jobs/search?currentJobId=X URLs.
  // The page's <title> is the search-page title (useless), but the active job
  // card in the left rail carries the real job title and company.
  if (!title || !company) {
    let parsed: URL | null = null
    try { parsed = new URL(window.location.href) } catch { /* fall through */ }
    const jobIdParam = parsed?.searchParams.get("currentJobId")
    if (jobIdParam) {
      const card =
        doc.querySelector(`[data-job-id="${jobIdParam}"]`) ??
        doc.querySelector(`[data-occludable-job-id="${jobIdParam}"]`)
      if (card) {
        if (!title) {
          title = firstTextWithin(card, [
            "[class*='job-card-list__title']",
            "[class*='job-card-container__link']",
            "a[class*='job-card']",
            "h3 a",
            "strong a",
            "a",
          ])
        }
        if (!company) {
          company = firstTextWithin(card, [
            "[class*='job-card-container__primary-description']",
            "[class*='job-card-container__company-name']",
            ".artdeco-entity-lockup__subtitle",
            "[class*='subtitle']",
          ])
        }
      }
    }
  }

  // Fallback: parse the LinkedIn page <title>. Only useful on /jobs/view/
  // standalone URLs — pattern is "{Company} hiring {Title} in {Location} | LinkedIn".
  // No-op on /jobs/search URLs (where <title> is the search results title).
  const fromTitle = parseLinkedInTitleTag(doc.title)
  title    = title    ?? fromTitle.title
  company  = company  ?? fromTitle.company
  location = location ?? fromTitle.location

  // Second-tier fallback: og:title (same pattern as <title>)
  if (!company || !title || !location) {
    const ogTitle = (doc.querySelector("meta[property='og:title']") as HTMLMetaElement | null)?.content
    const fromOg = parseLinkedInTitleTag(ogTitle)
    title    = title    ?? fromOg.title
    company  = company  ?? fromOg.company
    location = location ?? fromOg.location
  }

  // Last-resort: grab all text in the side-pane scaffold container. LinkedIn's
  // side-pane description nests under shifting class names; #job-details and
  // .jobs-description__content sometimes miss. Scope broadly to avoid grabbing
  // the search-results list. Prefer this over og:description (359 chars) so
  // the server normalizer has the full JD text to extract location/skills/etc.
  if (!descriptionText) {
    for (const scope of SIDE_PANE_SCOPES) {
      const container = doc.querySelector(scope)
      if (container) {
        const txt = cleanText(container.textContent ?? undefined)
        // Sanity floor: a real description is typically > 400 chars; below that
        // it's likely metadata/header chrome only.
        if (txt && txt.length > 400) {
          descriptionText = txt.slice(0, 12000)
          break
        }
      }
    }
  }

  // og:description as final fallback (preview-length, but better than nothing).
  if (!descriptionText) {
    const ogDesc = (doc.querySelector("meta[property='og:description']") as HTMLMetaElement | null)?.content
    if (ogDesc) descriptionText = cleanText(ogDesc)
  }

  // External apply URL: LinkedIn renders a non-Easy-Apply button as
  //   <a class="jobs-apply-button" target="_blank" href="EXTERNAL">Apply</a>
  // and Easy Apply as a <button> with no href. We want the external URL when
  // present so the dashboard can link the user straight to the company's ATS
  // instead of routing through LinkedIn.
  const applyUrl = findLinkedInExternalApplyHref(doc)

  // Posted-at: <time datetime="..."> in the top card, or visible relative text
  // ("Reposted 2 days ago"). LinkedIn renders a posted-time span next to the
  // top card; class names rotate but the <time> tag is consistent.
  const postedAt = firstTimeAttr(
    [
      ".job-details-jobs-unified-top-card__primary-description-container time",
      ".jobs-unified-top-card__posted-date",
      "time[datetime]",
      ".posted-time-ago__text",
    ],
    doc,
  )

  // Work mode + employment type from the "job insight" pills LinkedIn renders
  // under the metadata row (Remote, Hybrid, On-site, Full-time, etc.).
  const insightTexts = collectTexts(
    [
      ...scoped(".job-details-jobs-unified-top-card__job-insight"),
      ".job-details-jobs-unified-top-card__job-insight",
      ".job-details-fit-level-preferences li",
      ".jobs-unified-top-card__job-insight",
      ".description__job-criteria-text",
    ],
    doc,
  )
  const insightBlob = insightTexts.join(" | ")
  const workModeText = pickFirstMatch(insightBlob, [
    /\bRemote\b/i,
    /\bHybrid\b/i,
    /\bOn[-\s]?site\b/i,
  ]) ?? pickFirstMatch(`${location ?? ""} ${descriptionText?.slice(0, 1500) ?? ""}`, [
    /\bRemote\b/i,
    /\bHybrid\b/i,
    /\bOn[-\s]?site\b/i,
  ])
  const employmentType = pickFirstMatch(insightBlob, [
    /\bFull[-\s]?time\b/i,
    /\bPart[-\s]?time\b/i,
    /\bContract\b/i,
    /\bInternship\b/i,
    /\bTemporary\b/i,
  ])

  return {
    title,
    company,
    location,
    descriptionText,
    postedAt,
    postedAgeText: meta.postedAgeText,
    applicantActivityText: meta.applicantActivityText,
    promoted: meta.promoted,
    managedOffLinkedIn: meta.managedOffLinkedIn,
    workModeText,
    employmentType,
    applyUrl,
  }
}

// Collect text from every selector that matches (vs firstText which stops at the first).
function collectTexts(selectors: string[], doc: Document): string[] {
  const out: string[] = []
  const seen = new Set<Element>()
  for (const sel of selectors) {
    let nodes: NodeListOf<Element>
    try { nodes = doc.querySelectorAll(sel) } catch { continue }
    nodes.forEach((n) => {
      if (seen.has(n)) return
      seen.add(n)
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim()
      if (t) out.push(t)
    })
  }
  return out
}

function pickFirstMatch(haystack: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = haystack.match(re)
    if (m) return m[0]
  }
  return undefined
}

/**
 * Find a non-Easy-Apply external apply URL on a LinkedIn job page.
 * Returns undefined if the only apply path is LinkedIn's Easy Apply (in-app).
 *
 * LinkedIn signals this pattern in two ways:
 *   1. Anchor with href on a non-LinkedIn host (signed-in DOM, sometimes)
 *   2. Anchor with data-tracking-control-name containing "apply-link-offsite"
 *      (LinkedIn's own marker for external/offsite apply)
 *
 * Easy Apply jobs render as <button> with no href and no offsite tracking
 * marker — those return undefined here, and the dashboard correctly links
 * back to the LinkedIn page where the in-app apply modal lives.
 */
function findLinkedInExternalApplyHref(doc: Document): string | undefined {
  // Pass 1: any anchor with an explicit external href.
  const anchors = doc.querySelectorAll<HTMLAnchorElement>(
    [
      "a.jobs-apply-button[href]",
      "a[class*='jobs-apply-button'][href]",
      "a[data-tracking-control-name*='apply-link-offsite'][href]",
      "a[data-tracking-control-name*='jobdetails_topcard_inapply'][href]",
      "a[data-tracking-control-name*='apply'][href][target='_blank']",
      "a[data-control-name='job_apply_external'][href]",
      "a[data-test-app-aware-link][href][target='_blank']",
    ].join(","),
  )
  for (const a of anchors) {
    const href = a.href
    if (!href || !/^https?:/i.test(href)) continue
    let host = ""
    try {
      host = new URL(href).hostname.toLowerCase().replace(/^www\./, "")
    } catch {
      continue
    }
    if (host.endsWith("linkedin.com") || host.endsWith("licdn.com")) continue
    return href
  }

  // Pass 2: LinkedIn redirector — href is on linkedin.com but encodes the
  // real destination in a query param. Common patterns:
  //   /redir/redirect?url=ENCODED
  //   /jobs/view/.../?…trk=apply&jobsApplyOffsiteUrl=ENCODED
  for (const a of anchors) {
    const href = a.href
    if (!href) continue
    try {
      const u = new URL(href)
      for (const key of ["url", "jobsApplyOffsiteUrl", "applyUrl", "redirect"]) {
        const v = u.searchParams.get(key)
        if (v && /^https?:/i.test(v)) {
          const dest = new URL(v).hostname.toLowerCase().replace(/^www\./, "")
          if (!dest.endsWith("linkedin.com") && !dest.endsWith("licdn.com")) {
            return v
          }
        }
      }
    } catch {
      // skip malformed
    }
  }

  return undefined
}

function extractGreenhouse(doc: Document): Partial<ExtractedJob> {
  const title = firstText(
    [
      // job-boards.greenhouse.io (current template)
      ".job__title h1",
      ".job__title",
      // boards.greenhouse.io (legacy template)
      ".app-title",
      ".job-post-title",
      ".header h1",
      "h1.section-header",
      "h1",
    ],
    doc,
  )
  const location = firstText(
    [
      // job-boards.greenhouse.io
      ".job__location",
      // legacy
      ".location",
      ".job-post-location",
      ".header .location",
    ],
    doc,
  )
  const descriptionText = firstText(
    [
      // job-boards.greenhouse.io
      ".job__description",
      // legacy
      "#content .section-wrapper",
      "#content",
      ".content",
      "article",
    ],
    doc,
  )

  // Company: try DOM, then page <title> ("Job Application for {title} at {company}"),
  // then fall back to URL slug.
  let company = firstText(
    [".company-name", "header .company a", ".header h2", ".board__title"],
    doc,
  )
  if (!company) {
    const m = doc.title.match(/\bat\s+(.+?)\s*$/i)
    if (m && m[1]) company = cleanText(m[1])
  }
  if (!company) {
    company = companyFromPathFirstSegment(window.location.pathname)
  }

  // Greenhouse: the application form lives on the same page. If we detect it,
  // the apply URL is the page URL (resolving the form's relative action).
  const form = doc.querySelector(
    "form#application-form, form.application--form, form[action*='boards'], form[action*='job-boards']",
  ) as HTMLFormElement | null
  let applyUrl: string | undefined
  if (form) {
    const action = form.getAttribute("action") ?? ""
    if (action) {
      try {
        applyUrl = new URL(action, window.location.href).href
      } catch {
        applyUrl = window.location.href
      }
    } else {
      applyUrl = window.location.href
    }
  }
  return { title, company, location, descriptionText, applyUrl }
}

function extractLever(doc: Document): Partial<ExtractedJob> {
  const title = firstText(
    [
      ".posting-headline h2",
      "[data-qa='posting-name']",
      ".section.page-centered h2",
      ".posting-headline",
      "h2",
    ],
    doc,
  )
  const company =
    firstText([".main-header-text a", ".main-header-text", "[data-qa='company-name']"], doc) ??
    companyFromPathFirstSegment(window.location.pathname)
  const location = firstText(
    [
      ".posting-categories .location",
      ".sort-by-time.posting-category.medium-category-label",
      "[data-qa='posting-location']",
    ],
    doc,
  )
  const descriptionText = firstText(
    [
      "[data-qa='job-description']",
      ".content-wrapper",
      ".section.page-centered",
      ".section-wrapper",
    ],
    doc,
  )
  const applyAnchor = doc.querySelector(
    "a.postings-btn[href*='apply'], a.template-btn-submit[href*='apply']",
  ) as HTMLAnchorElement | null
  return {
    title,
    company,
    location,
    descriptionText,
    applyUrl: applyAnchor?.href || undefined,
  }
}

function extractAshby(doc: Document): Partial<ExtractedJob> {
  const title = firstText(
    ["h1.ashby-job-posting-heading", "h1[class*='heading']", "h1"],
    doc,
  )
  const company =
    firstText(
      [".ashby-organization-info", ".ashby-job-posting-org", "[class*='organization']"],
      doc,
    ) ?? companyFromPathFirstSegment(window.location.pathname)
  const location = firstText(
    [
      ".ashby-job-posting-brief-description div",
      ".ashby-job-posting-location",
      "[class*='location']",
    ],
    doc,
  )
  const descriptionText = firstText(
    [
      ".ashby-job-posting-description",
      ".ashby-job-posting-content",
      "[class*='posting-description']",
    ],
    doc,
  )
  return { title, company, location, descriptionText }
}

function extractWorkday(doc: Document): Partial<ExtractedJob> {
  const title = firstText(
    [
      "[data-automation-id='jobPostingHeader']",
      "h1[data-automation-id='jobPostingHeader']",
      "h2[data-automation-id='jobPostingHeader']",
      "h1",
    ],
    doc,
  )
  const location = firstText(
    [
      "[data-automation-id='locations']",
      "[data-automation-id='jobPostingDetail-location']",
    ],
    doc,
  )
  const employmentType = firstText(
    [
      "[data-automation-id='time']",
      "[data-automation-id='jobPostingDetail-time']",
    ],
    doc,
  )
  const descriptionText = firstText(
    ["[data-automation-id='jobPostingDescription']"],
    doc,
  )
  const company = companyFromSubdomain(window.location.hostname)
  // Workday: "Posted N Days Ago" — automation-id varies, fall through alternates.
  const postedAt = firstTimeAttr(
    [
      "[data-automation-id='postedOn']",
      "[data-automation-id*='postedOn']",
      "[data-automation-id*='posted']",
      "time[datetime]",
    ],
    doc,
  )
  return { title, company, location, descriptionText, employmentType, postedAt }
}

function extractIndeed(doc: Document): Partial<ExtractedJob> {
  const title = firstText(
    [
      "h1.jobsearch-JobInfoHeader-title",
      "h1[data-testid='jobsearch-JobInfoHeader-title']",
      "h1",
    ],
    doc,
  )
  const company = firstText(
    [
      "[data-testid='inlineHeader-companyName']",
      ".jobsearch-CompanyInfoContainer a",
      ".jobsearch-InlineCompanyRating-companyHeader",
    ],
    doc,
  )
  const location = firstText(
    [
      "[data-testid='inlineHeader-companyLocation']",
      "[data-testid='job-location']",
      ".jobsearch-JobInfoHeader-subtitle",
    ],
    doc,
  )
  const salaryText = firstText(
    ["[data-testid='attribute_snippet_compensation']", "#salaryInfoAndJobType"],
    doc,
  )
  const descriptionText = firstText(
    ["#jobDescriptionText", ".jobsearch-JobComponent-description"],
    doc,
  )
  const postedAt = firstTimeAttr(
    [
      "[data-testid='myJobsStateDate']",
      "span.date",
      "time[datetime]",
    ],
    doc,
  )
  return { title, company, location, salaryText, descriptionText, postedAt }
}

function extractGlassdoor(doc: Document): Partial<ExtractedJob> {
  const title = firstText(
    ["[data-test='job-title']", "h1[class*='JobTitle']", "h1"],
    doc,
  )
  const company = firstText(
    ["[data-test='employer-name']", "div[class*='EmployerProfile']"],
    doc,
  )
  const location = firstText(
    ["[data-test='location']", "div[class*='JobLocation']"],
    doc,
  )
  const salaryText = firstText(
    ["[data-test='detailSalary']", "[class*='salaryEstimate']"],
    doc,
  )
  const descriptionText = firstText(
    [
      "[data-test='jobDescriptionContainer']",
      "div[class*='JobDetails_jobDescription']",
    ],
    doc,
  )
  const postedAt = firstTimeAttr(
    [
      "[data-test='job-age']",
      "div[class*='JobDetails_jobDate']",
      "time[datetime]",
    ],
    doc,
  )
  return { title, company, location, salaryText, descriptionText, postedAt }
}

function extractUnknown(doc: Document): Partial<ExtractedJob> {
  // Best effort. Most company career pages follow one of these <title> patterns:
  //   "Job Title at Company Name"
  //   "Job Title - Company Name"
  //   "Job Title | Company Name"
  //   "Company Name - Job Title"  (less common, harder to disambiguate)
  const rawTitle = cleanText(doc.title) ?? ""
  let title: string | undefined = rawTitle
  let company: string | undefined

  const atMatch = rawTitle.match(/^(.+?)\s+at\s+(.+?)(?:\s*[|·•—]\s*.+)?$/i)
  const dashMatch = rawTitle.match(/^(.+?)\s+[-–—|]\s+(.+?)$/)

  if (atMatch) {
    title = cleanText(atMatch[1])
    company = cleanText(atMatch[2])
  } else if (dashMatch) {
    // Heuristic: shorter side is usually the company.
    const a = cleanText(dashMatch[1])
    const b = cleanText(dashMatch[2])
    if (a && b) {
      if (a.length < b.length) {
        company = a
        title = b
      } else {
        title = a
        company = b
      }
    }
  }

  // Try OG meta as a backup for both fields
  const ogTitle = (doc.querySelector("meta[property='og:title']") as HTMLMetaElement | null)?.content
  const ogSiteName = (doc.querySelector("meta[property='og:site_name']") as HTMLMetaElement | null)?.content
  if (!title && ogTitle) title = cleanText(ogTitle)
  if (!company && ogSiteName) company = cleanText(ogSiteName)

  return {
    title,
    company,
    descriptionText: getVisiblePageText(doc).slice(0, 8000) || undefined,
  }
}

// ── Confidence ────────────────────────────────────────────────────────────────

function computeConfidence(data: Partial<ExtractedJob>): "high" | "medium" | "low" {
  const hasTitle = Boolean(data.title)
  const hasCompany = Boolean(data.company)
  const hasDescription = Boolean(data.descriptionText)
  if (hasTitle && hasCompany && hasDescription) return "high"
  if (hasTitle && (hasCompany || hasDescription)) return "medium"
  return "low"
}

// ── Main entry point ──────────────────────────────────────────────────────────

// Per-source extractors. New SupportedSite values may join before we have a
// dedicated extractor; the fallback in extractJob() routes them through
// extractUnknown (JSON-LD + microdata only) rather than failing.
const SOURCE_EXTRACTORS: Partial<Record<SupportedSite, (doc: Document) => Partial<ExtractedJob>>> = {
  linkedin:   extractLinkedIn,
  greenhouse: extractGreenhouse,
  lever:      extractLever,
  ashby:      extractAshby,
  workday:    extractWorkday,
  indeed:     extractIndeed,
  glassdoor:  extractGlassdoor,
  unknown:    extractUnknown,
}

const DESCRIPTION_MAX = 12000

export function extractJob(doc: Document = document, url?: string): ExtractedJob {
  const targetUrl = url ?? window.location.href
  const source = detectSite(targetUrl)

  // DOM extraction (source-specific) merged with JSON-LD fallback.
  // DOM takes precedence: it's typically more accurate than schema.org markup
  // when both exist, since SPAs sometimes render stale schema.
  const fromJsonLd = extractFromJsonLd(doc)
  const fromDom = (SOURCE_EXTRACTORS[source] ?? extractUnknown)(doc)

  const merged: Partial<ExtractedJob> = {
    title: fromDom.title ?? fromJsonLd.title,
    company: fromDom.company ?? fromJsonLd.company,
    location: fromDom.location ?? fromJsonLd.location,
    descriptionText: fromDom.descriptionText ?? fromJsonLd.descriptionText,
    salaryText: fromDom.salaryText ?? fromJsonLd.salaryText,
    employmentType: fromDom.employmentType ?? fromJsonLd.employmentType,
    workModeText: fromDom.workModeText,
    applyUrl: fromDom.applyUrl ?? fromJsonLd.applyUrl,
    canonicalUrl: fromDom.canonicalUrl ?? fromJsonLd.canonicalUrl ?? readCanonicalUrl(doc),
    // JSON-LD datePosted (ISO) preferred; fall back to DOM-extracted relative text.
    postedAt: fromJsonLd.postedAt ?? fromDom.postedAt,
    postedAgeText: fromDom.postedAgeText,
    applicantActivityText: fromDom.applicantActivityText,
    promoted: fromDom.promoted,
    managedOffLinkedIn: fromDom.managedOffLinkedIn,
  }

  // Trim oversized descriptions to keep state lean.
  if (merged.descriptionText && merged.descriptionText.length > DESCRIPTION_MAX) {
    merged.descriptionText = merged.descriptionText.slice(0, DESCRIPTION_MAX) + "…"
  }

  const activelyHiring = detectActivelyHiring(merged.title, merged.descriptionText)

  return {
    source,
    url: targetUrl,
    canonicalUrl: merged.canonicalUrl,
    title: merged.title,
    company: merged.company,
    location: merged.location,
    descriptionText: merged.descriptionText,
    salaryText: merged.salaryText,
    employmentType: merged.employmentType,
    workModeText: merged.workModeText,
    applyUrl: merged.applyUrl,
    detectedAts: source !== "unknown" ? source : undefined,
    activelyHiring: activelyHiring || undefined,
    postedAt: merged.postedAt,
    postedAgeText: merged.postedAgeText,
    applicantActivityText: merged.applicantActivityText,
    promoted: merged.promoted,
    managedOffLinkedIn: merged.managedOffLinkedIn,
    confidence: computeConfidence(merged),
    extractedAt: new Date().toISOString(),
  }
}

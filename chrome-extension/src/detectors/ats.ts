import type { ATSProvider, PageType, DetectedPage, ExtensionPageMode } from "../types"
import { hasLdJsonJobPostingHint } from "../extractors/job"

// ── URL-based ATS detection ───────────────────────────────────────────────────

const ATS_URL_PATTERNS: Array<{ pattern: RegExp; provider: ATSProvider }> = [
  { pattern: /myworkdayjobs\.com/i, provider: "workday" },
  { pattern: /workday\.com\/[^/]+\/d\/[^/]+\/job\//i, provider: "workday" },
  { pattern: /boards\.greenhouse\.io/i, provider: "greenhouse" },
  { pattern: /greenhouse\.io\/job_app/i, provider: "greenhouse" },
  /** Embedded Greenhouse job on company domain (e.g. braincorp.com/open-positions?gh_jid=…) */
  { pattern: /[?&]gh_jid=\d+/i, provider: "greenhouse" },
  { pattern: /jobs\.lever\.co/i, provider: "lever" },
  { pattern: /ashbyhq\.com/i, provider: "ashby" },
  { pattern: /\.icims\.com/i, provider: "icims" },
  { pattern: /jobs\.smartrecruiters\.com/i, provider: "smartrecruiters" },
  { pattern: /smartrecruiters\.com\/[^/]+\/job\//i, provider: "smartrecruiters" },
  { pattern: /\.bamboohr\.com/i, provider: "bamboohr" },
]

// ── DOM-based ATS fingerprints ────────────────────────────────────────────────

const ATS_DOM_FINGERPRINTS: Array<{ selector: string; provider: ATSProvider }> = [
  // Workday
  { selector: "[data-automation-id='jobPostingDescription']", provider: "workday" },
  { selector: "[data-automation-id='jobPostingHeader']", provider: "workday" },
  // Greenhouse
  { selector: "#grnhse_app", provider: "greenhouse" },
  { selector: ".greenhouse-jobboard", provider: "greenhouse" },
  { selector: "[data-greenhouse-id]", provider: "greenhouse" },
  { selector: '[id*="greenhouse"]', provider: "greenhouse" },
  { selector: '[id*="Greenhouse"]', provider: "greenhouse" },
  // Lever
  { selector: ".posting-apply", provider: "lever" },
  { selector: ".posting-categories", provider: "lever" },
  // Ashby
  { selector: "[data-testid='job-posting']", provider: "ashby" },
  { selector: "._ashby-application-form-container", provider: "ashby" },
  // iCIMS
  { selector: "#icims_content", provider: "icims" },
  { selector: ".iCIMS_JobsBoardPageWrapper", provider: "icims" },
  // SmartRecruiters
  { selector: ".job-section-description", provider: "smartrecruiters" },
  { selector: "[data-test='job-info']", provider: "smartrecruiters" },
  // BambooHR
  { selector: "#bamboohr-apply", provider: "bamboohr" },
  { selector: ".BambooHR-ATS-board", provider: "bamboohr" },
]

// ── Page type detection ───────────────────────────────────────────────────────

const APPLICATION_FORM_INDICATORS = [
  // Generic form indicators
  "form[action*='apply']",
  "form[id*='apply']",
  "form[class*='apply']",
  "[id*='application-form']",
  "[class*='application-form']",
  // ATS-specific
  "#grnhse_app form",
  ".lever-apply-form",
  "[data-automation-id='applicationSummaryStep']",
  "._ashby-application-form",
  ".sr-apply-step",
  "#icims_content form",
]

const JOB_LISTING_INDICATORS = [
  // Generic (do NOT match every ld+json page — verified JobPosting handled below via extractFromJsonLd)
  "[itemtype*='JobPosting']",
  // ATS-specific
  "[data-automation-id='jobPostingHeader']",
  ".posting-headline",
  ".job-post-title",
  ".ashby-job-posting-brief-description",
  "[data-test='job-title']",
  ".iCIMS_JobsBoardPageTitle",
]

export function detectATS(url: string): ATSProvider {
  for (const { pattern, provider } of ATS_URL_PATTERNS) {
    if (pattern.test(url)) return provider
  }
  for (const { selector, provider } of ATS_DOM_FINGERPRINTS) {
    if (document.querySelector(selector)) return provider
  }
  return "generic"
}

export function detectPageType(): PageType {
  for (const selector of APPLICATION_FORM_INDICATORS) {
    if (document.querySelector(selector)) return "application_form"
  }
  for (const selector of JOB_LISTING_INDICATORS) {
    if (document.querySelector(selector)) return "job_listing"
  }
  // Deep JSON-LD walk (handles @graph, arrays) — same logic as job extraction
  if (hasLdJsonJobPostingHint()) return "job_listing"
  return "unknown"
}

/** Individual posting detail pages and major job boards — path + query hints (SPA-safe). */
export function looksLikeLikelyJobPage(url: string): boolean {
  const u = url.toLowerCase()

  try {
    const parsed = new URL(url)
    const keys = [...parsed.searchParams.keys()]
    for (const key of keys) {
      // Greenhouse Lever-style ids, Workday reqs, ATS query tokens
      if (
        /^(?:gh_jid|job(?:_|-|)id|position(?:_|-|)id|opening(?:_|-|)id|vacancy(?:_|-|)?id|reqid|req_id|jf|listing_?id)$/i.test(
          key,
        )
      ) {
        return true
      }
    }
  } catch {
    // ignore malformed URL
  }

  if (
    /\/(?:job[s]?(?:\/|$)|career[s]?(?:\/|$)|opening[s]?(?:\/|$)|open(?:-)?position[s]?(?:\/|$)|position[s]?(?:\/|$)|vacanc(?:y|ies)(?:\/|$)|opportunit|employment|recruit(?:ment)?|stellenausschreibung|offres?\/emploi|emplois?\/|ofertas?\/|anstellungen)/.test(
      u,
    )
  ) {
    return true
  }

  if (
    /linkedin\.com\/(?:jobs|talent\/)/.test(u) ||
    /indeed\.com\/(viewjob|rc\/clk|pagead)/.test(u) ||
    /glassdoor\.com\/job-listing/.test(u) ||
    /(?:ziprecruiter|greenhouse)\./.test(u) ||
    /monster\.(?:com|co\.[a-z]{2})/.test(u) ||
    /welcometothejungle\.com\/.*\/jobs/.test(u)
  ) {
    return true
  }

  if (/\/apply(?:\?|\/|$)/.test(u) && /\/(?:job|position|opening|role|career)/.test(u)) return true

  return false
}

export function detectPage(): DetectedPage {
  const url = window.location.href
  const ats = detectATS(url)
  let pageType = detectPageType()
  /** SPA / skeleton pages may miss fingerprints on first paint; URL + DOM second pass. */
  if (pageType === "unknown" && peekDomLooksLikeDetailJobListing()) pageType = "job_listing"
  const title = document.title || null
  return { ats, pageType, url, title }
}

function count(nodes: NodeListOf<Element>): number {
  return nodes.length
}

export function isLikelySearchResultsPage(): boolean {
  const url = window.location.href.toLowerCase()
  const path = `${window.location.pathname}${window.location.search}`.toLowerCase()

  if (/linkedin\.com\/jobs\/search/.test(url)) return true
  if (/glassdoor\.com\/job\//.test(url) && /jobs\.htm|srch_|findjobs|keyword/.test(path)) return true

  const selectors = [
    "li.jobs-search-results__list-item",
    "div.job-card-container",
    "[data-test='jobListing']",
    "article[class*='JobCard']",
    "li[class*='JobsList_jobListItem']",
    "a[href*='/jobs/view/']",
    "a[href*='job-listing']",
  ]

  let maxHit = 0
  for (const selector of selectors) {
    maxHit = Math.max(maxHit, count(document.querySelectorAll(selector)))
  }
  return maxHit >= 3
}

export function detectExtensionPageMode(): ExtensionPageMode {
  const page = detectPage()
  if (page.pageType === "application_form") return "application_form"
  if (isLikelySearchResultsPage()) return "search_results"
  if (page.pageType === "job_listing" || looksLikeLikelyJobPage(page.url)) return "job_detail"
  return "unknown"
}

/** Cheap DOM signals when microdata or long job-description copy appears after hydration. */
function peekDomLooksLikeDetailJobListing(): boolean {
  if (
    document.querySelector(
      '[itemtype*="JobPosting"], [data-qa="job-title"]',
    )
  )
    return true

  const main = document.querySelector("main, [role=main], article")
  if (!(main instanceof Element)) return false
  const t = main.textContent ?? ""
  if (t.length < 400) return false
  const hits = (
    t.match(
      /\b(?:responsibilit|requirements|qualifications|what you(?:'|’)?ll\s+do|minimum\s+(?:qualifica|education)|years?\s+of\s+experience|full[- ]?time|compensation|benefits|submit\s+your\s+(?:cv|resume))\b/gi,
    ) ?? []
  ).length
  return hits >= 2
}

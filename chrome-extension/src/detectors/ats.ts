import type { ATSProvider, PageType, DetectedPage } from "../types"

// ── URL-based ATS detection ───────────────────────────────────────────────────

const ATS_URL_PATTERNS: Array<{ pattern: RegExp; provider: ATSProvider }> = [
  { pattern: /myworkdayjobs\.com/i, provider: "workday" },
  { pattern: /workday\.com\/[^/]+\/d\/[^/]+\/job\//i, provider: "workday" },
  { pattern: /boards\.greenhouse\.io/i, provider: "greenhouse" },
  { pattern: /greenhouse\.io\/job_app/i, provider: "greenhouse" },
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
  // Generic
  "[itemtype*='JobPosting']",
  "script[type='application/ld+json']",
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
  // Fallback: check JSON-LD for JobPosting schema
  const scripts = document.querySelectorAll("script[type='application/ld+json']")
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent ?? "")
      const types: string[] = Array.isArray(data["@type"]) ? data["@type"] : [data["@type"]]
      if (types.some((t) => t === "JobPosting")) return "job_listing"
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return "unknown"
}

export function detectPage(): DetectedPage {
  const url = window.location.href
  const ats = detectATS(url)
  const pageType = detectPageType()
  const title = document.title || null
  return { ats, pageType, url, title }
}

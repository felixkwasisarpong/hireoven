import type { ATSProvider, ExtractedJob } from "../types"

// ── Utility helpers ───────────────────────────────────────────────────────────

function text(selector: string, root: Element | Document = document): string | null {
  const el = root.querySelector(selector)
  return el?.textContent?.trim() || null
}

function attr(selector: string, attribute: string, root: Element | Document = document): string | null {
  const el = root.querySelector(selector)
  return el?.getAttribute(attribute)?.trim() || null
}

function firstText(...selectors: string[]): string | null {
  for (const sel of selectors) {
    const val = text(sel)
    if (val) return val
  }
  return null
}

function firstAttr(attribute: string, ...selectors: string[]): string | null {
  for (const sel of selectors) {
    const val = attr(sel, attribute)
    if (val) return val
  }
  return null
}

/** Extract salary from a text string using common patterns. */
function extractSalaryFromText(source: string): string | null {
  const match = source.match(/\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*(?:\/\s*(?:yr|year|hour|hr|mo|month))?)?/i)
  return match?.[0] ?? null
}

// ── JSON-LD JobPosting extraction ─────────────────────────────────────────────

interface JobPostingSchema {
  "@type"?: string | string[]
  title?: string
  hiringOrganization?: { name?: string }
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string } } | Array<{ address?: { addressLocality?: string; addressRegion?: string } }>
  description?: string
  baseSalary?: { value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string } }
}

function extractFromJsonLd(): Partial<ExtractedJob> {
  const scripts = document.querySelectorAll("script[type='application/ld+json']")
  for (const script of scripts) {
    try {
      const data: JobPostingSchema = JSON.parse(script.textContent ?? "")
      const types: string[] = Array.isArray(data["@type"]) ? data["@type"] : [data["@type"] ?? ""]
      if (!types.some((t) => t === "JobPosting")) continue

      const loc = Array.isArray(data.jobLocation) ? data.jobLocation[0] : data.jobLocation
      const addr = loc?.address
      const location = addr
        ? [addr.addressLocality, addr.addressRegion].filter(Boolean).join(", ") || null
        : null

      let salary: string | null = null
      const salaryData = data.baseSalary?.value
      if (salaryData) {
        if (salaryData.minValue && salaryData.maxValue) {
          salary = `$${salaryData.minValue.toLocaleString()} – $${salaryData.maxValue.toLocaleString()}`
          if (salaryData.unitText) salary += ` / ${salaryData.unitText}`
        } else if (salaryData.value) {
          salary = `$${salaryData.value.toLocaleString()}`
        }
      }

      return {
        title: data.title ?? null,
        company: data.hiringOrganization?.name ?? null,
        location,
        description: data.description ?? null,
        salary,
      }
    } catch {
      // skip malformed
    }
  }
  return {}
}

// ── OpenGraph / meta extraction ───────────────────────────────────────────────

/**
 * Many job pages put the pattern "Job Title at Company Name" or
 * "Company Name | Job Title" in <title> or og:title.
 * Extract the company name from these common patterns.
 */
function companyFromTitle(titleStr: string | null): string | null {
  if (!titleStr) return null

  // "Senior Engineer at Acme Corp" / "Senior Engineer @ Acme Corp"
  const atMatch = titleStr.match(/\bat\s+([^|·\-–—]+?)(?:\s*[|·\-–—]|$)/i)
  if (atMatch) return atMatch[1].trim()

  // "Acme Corp - Senior Engineer" or "Acme Corp | Senior Engineer"
  const pipeMatch = titleStr.match(/^([^|·\-–—]+?)\s*[|·\-–—]\s*.{5,}$/)
  if (pipeMatch) {
    const candidate = pipeMatch[1].trim()
    // Skip if it looks like a job title (contains role keywords)
    if (!/\b(engineer|manager|analyst|designer|developer|director|lead|intern|scientist|head|vp|vice president)\b/i.test(candidate)) {
      return candidate
    }
  }

  return null
}

/** Convert a hostname to a human-readable company name fallback. */
function companyFromHostname(): string | null {
  const host = window.location.hostname
    .replace(/^www\./, "")
    .replace(/\.(com|io|co|net|org|ai|careers?)(\..+)?$/, "")
    .replace(/[-_]/g, " ")
    .trim()
  if (!host || host.length < 2) return null
  // Capitalise first letter of each word
  return host.replace(/\b\w/g, (c) => c.toUpperCase())
}

function extractFromMeta(): Partial<ExtractedJob> {
  const ogTitle = firstAttr("content", "meta[property='og:title']", "meta[name='title']")
  const siteName = firstAttr("content", "meta[property='og:site_name']")
  const pageTitle = document.title || null

  // Try company from og:site_name first, then parse from title strings
  const company =
    siteName?.trim() ||
    companyFromTitle(ogTitle) ||
    companyFromTitle(pageTitle) ||
    companyFromHostname()

  return {
    title: ogTitle ?? pageTitle ?? null,
    company: company ?? null,
    description:
      firstAttr("content", "meta[property='og:description']", "meta[name='description']") ?? null,
  }
}

// ── ATS-specific extractors ───────────────────────────────────────────────────

function extractWorkday(): Partial<ExtractedJob> {
  return {
    title: firstText(
      "[data-automation-id='jobPostingHeader']",
      "[data-automation-id='Job_Posting_Title']",
    ),
    company: firstText(
      "[data-automation-id='jobPostingCompanyInfo'] h3",
      "[data-automation-id='company']",
    ),
    location: firstText(
      "[data-automation-id='locations']",
      "[data-automation-id='location']",
      "[data-automation-id='jobPostingLocation']",
    ),
    description: firstText(
      "[data-automation-id='jobPostingDescription']",
      ".css-3vfmsk",
    ),
    salary: firstText(
      "[data-automation-id='salary']",
      "[data-automation-id='compensation']",
    ),
  }
}

function extractGreenhouse(): Partial<ExtractedJob> {
  return {
    title: firstText("h1.app-title", ".job-post-title", ".job__title h1", "h1"),
    company: firstText(".company-name", ".job__location + span", "[class*='company']"),
    location: firstText(".location", ".job__location", "[class*='location']"),
    description: firstText("#content", ".job-post-description", ".job-description", ".content"),
    salary: (() => {
      const body = document.body.textContent ?? ""
      return extractSalaryFromText(body)
    })(),
  }
}

function extractLever(): Partial<ExtractedJob> {
  return {
    title: firstText(".posting-headline h2", ".posting-header h2", "h2"),
    company: (() => {
      const logo = document.querySelector<HTMLImageElement>(".main-header-logo img")
      return logo?.alt?.trim() || firstText(".posting-categories .posting-category")
    })(),
    location: firstText(
      ".posting-categories .sort-by-location",
      ".location",
      "[class*='location']",
    ),
    description: firstText(".section[data-qa='job-description']", ".posting-description"),
    salary: (() => {
      const body = document.body.textContent ?? ""
      return extractSalaryFromText(body)
    })(),
  }
}

function extractAshby(): Partial<ExtractedJob> {
  return {
    title: firstText(
      "h1._1n6cnkw0",
      "[class*='job-title']",
      "[class*='JobTitle']",
      "[class*='posting-title']",
      "h1",
    ),
    company: (() => {
      const logo = document.querySelector<HTMLImageElement>("._jqhkf1 img, [class*='logo'] img")
      return logo?.alt?.trim() || firstText("[class*='company-name']", "[class*='companyName']")
    })(),
    location: firstText("[class*='location']", "[class*='Location']"),
    description: firstText(
      "[class*='job-description']",
      "[class*='JobDescription']",
      "[class*='posting-description']",
    ),
    salary: firstText("[class*='salary']", "[class*='compensation']", "[class*='Compensation']"),
  }
}

function extractICIMS(): Partial<ExtractedJob> {
  return {
    title: firstText(
      ".iCIMS_JobsBoardPageTitle",
      "#icims_content h1",
      ".icims-page-header h1",
    ),
    company: firstText(".iCIMS_CompanyName", "[class*='company']"),
    location: firstText(".iCIMS_FieldDisplay_Job_Location", "[class*='location']"),
    description: firstText("#icims_content .iCIMS_JobsBoardJobDescriptionContainer", "#job-content"),
    salary: (() => {
      const body = document.body.textContent ?? ""
      return extractSalaryFromText(body)
    })(),
  }
}

function extractSmartRecruiters(): Partial<ExtractedJob> {
  return {
    title: firstText(
      "h1.job-title",
      "[data-test='job-title']",
      "[class*='JobTitle']",
      "h1",
    ),
    company: firstText(
      "[data-test='company-name']",
      ".company-name",
      "[class*='companyName']",
    ),
    location: firstText(
      "[data-test='job-location']",
      ".job-location",
      "[class*='location']",
    ),
    description: firstText(".job-section-description", "[data-test='job-description']"),
    salary: firstText("[data-test='job-salary']", "[class*='salary']"),
  }
}

function extractBambooHR(): Partial<ExtractedJob> {
  return {
    title: firstText(".BambooHR-ATS-Jobs-Item-Title", "h2.BambooHR-ATS-board-headline", "h1"),
    company: (() => {
      const logo = document.querySelector<HTMLImageElement>(".BambooHR-ATS-header-logo img")
      return logo?.alt?.trim() || null
    })(),
    location: firstText(".BambooHR-ATS-Jobs-Item-Location", "[class*='location']"),
    description: firstText("#BambooHR-ATS-board-description", ".BambooHR-ATS-body"),
    salary: (() => {
      const body = document.body.textContent ?? ""
      return extractSalaryFromText(body)
    })(),
  }
}

function extractGeneric(): Partial<ExtractedJob> {
  return {
    title: firstText(
      "[class*='job-title']",
      "[class*='jobtitle']",
      "[class*='JobTitle']",
      "[id*='job-title']",
      "h1",
    ),
    company: firstText(
      "[class*='company-name']",
      "[class*='companyName']",
      "[class*='employer']",
    ),
    location: firstText(
      "[class*='location']",
      "[class*='Location']",
      "[class*='city']",
    ),
    description: firstText(
      "[class*='job-description']",
      "[class*='jobDescription']",
      "[class*='description']",
      "main",
      "article",
    ),
    salary: (() => {
      const body = document.body.textContent ?? ""
      return extractSalaryFromText(body)
    })(),
  }
}

// ── Main extractor ─────────────────────────────────────────────────────────────

const ATS_EXTRACTORS: Record<ATSProvider, () => Partial<ExtractedJob>> = {
  workday: extractWorkday,
  greenhouse: extractGreenhouse,
  lever: extractLever,
  ashby: extractAshby,
  icims: extractICIMS,
  smartrecruiters: extractSmartRecruiters,
  bamboohr: extractBambooHR,
  generic: extractGeneric,
}

/** Merge sources, preferring more specific over generic. */
function merge(...sources: Array<Partial<ExtractedJob>>): Partial<ExtractedJob> {
  const result: Partial<ExtractedJob> = {}
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const k = key as keyof ExtractedJob
      if (!result[k] && value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(result as any)[k] = value
      }
    }
  }
  return result
}

export function extractJob(ats: ATSProvider): ExtractedJob {
  const jsonLd = extractFromJsonLd()
  const meta = extractFromMeta()
  const atsSpecific = ATS_EXTRACTORS[ats]()

  // Priority: ATS-specific > JSON-LD > meta
  const merged = merge(atsSpecific, jsonLd, meta)

  return {
    title: merged.title ?? null,
    company: merged.company ?? null,
    location: merged.location ?? null,
    description: merged.description
      ? merged.description.slice(0, 5000) // cap to avoid huge payloads
      : null,
    salary: merged.salary ?? null,
    url: window.location.href,
    ats,
  }
}

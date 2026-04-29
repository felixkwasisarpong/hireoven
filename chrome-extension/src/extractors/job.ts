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

function rootText(root: Element | Document = document): string {
  return root.textContent?.replace(/\s+/g, " ").trim() ?? ""
}

function matchText(source: string, pattern: RegExp): string | null {
  const match = source.match(pattern)
  return match?.[0]?.trim() ?? null
}

function detectWorkMode(location: string | null, sourceText: string): string | null {
  const source = `${location ?? ""} ${sourceText}`.toLowerCase()
  if (/\bhybrid\b/.test(source)) return "Hybrid"
  if (/\bremote\b/.test(source)) return "Remote"
  if (/\bon[-\s]?site\b/.test(source) || /\bon site\b/.test(source)) return "On-site"
  return null
}

function detectEmploymentType(sourceText: string): string | null {
  const source = sourceText.toLowerCase()
  if (/\bfull[-\s]?time\b/.test(source)) return "Full-time"
  if (/\bpart[-\s]?time\b/.test(source)) return "Part-time"
  if (/\bcontract(?:or)?\b/.test(source)) return "Contract"
  if (/\bintern(ship)?\b/.test(source)) return "Internship"
  if (/\btemporary\b/.test(source)) return "Temporary"
  return null
}

function detectPostedAt(sourceText: string): string | null {
  const source = sourceText.replace(/\s+/g, " ").trim()
  return (
    matchText(source, /\b(?:posted\s+)?\d+\+?\s*(?:minute|hour|day|week|month|year)s?\s+ago\b/i) ??
    matchText(source, /\b(?:posted\s+)?(?:today|yesterday|just posted|new)\b/i)
  )
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
  hiringOrganization?: { name?: string; logo?: string | { url?: string } }
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string } } | Array<{ address?: { addressLocality?: string; addressRegion?: string } }>
  description?: string
  datePosted?: string
  employmentType?: string | string[]
  baseSalary?: { value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string } }
}

export function extractFromJsonLd(): Partial<ExtractedJob> {
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

      const companyLogo =
        typeof data.hiringOrganization?.logo === "string"
          ? data.hiringOrganization.logo
          : data.hiringOrganization?.logo?.url ?? null
      const employmentType = Array.isArray(data.employmentType)
        ? data.employmentType[0] ?? null
        : data.employmentType ?? null
      const sourceText = `${data.description ?? ""} ${employmentType ?? ""}`

      return {
        title: data.title ?? null,
        company: data.hiringOrganization?.name ?? null,
        companyLogo,
        location,
        workMode: detectWorkMode(location, sourceText),
        employmentType,
        postedAt: data.datePosted ?? null,
        description: data.description ?? null,
        salary,
        salaryRange: salary,
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
  const companyLogo = firstAttr("content", "meta[property='og:image']", "meta[name='twitter:image']")

  // Try company from og:site_name first, then parse from title strings
  const company =
    siteName?.trim() ||
    companyFromTitle(ogTitle) ||
    companyFromTitle(pageTitle) ||
    companyFromHostname()

  return {
    title: ogTitle ?? pageTitle ?? null,
    company: company ?? null,
    companyLogo: companyLogo ?? null,
    description:
      firstAttr("content", "meta[property='og:description']", "meta[name='description']") ?? null,
  }
}

// ── ATS-specific extractors ───────────────────────────────────────────────────

function extractWorkday(): Partial<ExtractedJob> {
  const location = firstText(
    "[data-automation-id='locations']",
    "[data-automation-id='location']",
    "[data-automation-id='jobPostingLocation']",
  )
  const description = firstText(
    "[data-automation-id='jobPostingDescription']",
    ".css-3vfmsk",
  )
  const salary = firstText(
    "[data-automation-id='salary']",
    "[data-automation-id='compensation']",
  )
  const sourceText = `${location ?? ""} ${description ?? ""}`
  return {
    title: firstText(
      "[data-automation-id='jobPostingHeader']",
      "[data-automation-id='Job_Posting_Title']",
    ),
    company: firstText(
      "[data-automation-id='jobPostingCompanyInfo'] h3",
      "[data-automation-id='company']",
    ),
    companyLogo: firstAttr("src", "img[data-automation-id='companyLogo']", "header img"),
    location,
    workMode: detectWorkMode(location, sourceText),
    employmentType: detectEmploymentType(sourceText),
    postedAt: detectPostedAt(sourceText),
    description,
    salary,
    salaryRange: salary,
  }
}

function extractGreenhouse(): Partial<ExtractedJob> {
  const location = firstText(".location", ".job__location", "[class*='location']")
  const description = firstText("#content", ".job-post-description", ".job-description", ".content")
  const sourceText = `${location ?? ""} ${description ?? ""}`
  const salary = (() => {
    const body = document.body.textContent ?? ""
    return extractSalaryFromText(body)
  })()
  return {
    title: firstText("h1.app-title", ".job-post-title", ".job__title h1", "h1"),
    company: firstText(".company-name", ".job__location + span", "[class*='company']"),
    companyLogo: firstAttr("src", ".company-logo img", "img[alt*='logo' i]"),
    location,
    workMode: detectWorkMode(location, sourceText),
    employmentType: detectEmploymentType(sourceText),
    postedAt: detectPostedAt(sourceText),
    description,
    salary,
    salaryRange: salary,
  }
}

function extractLever(): Partial<ExtractedJob> {
  const location = firstText(
    ".posting-categories .sort-by-location",
    ".location",
    "[class*='location']",
  )
  const description = firstText(".section[data-qa='job-description']", ".posting-description")
  const sourceText = `${location ?? ""} ${description ?? ""}`
  const salary = (() => {
    const body = document.body.textContent ?? ""
    return extractSalaryFromText(body)
  })()
  const companyLogo = attr(".main-header-logo img", "src")
  return {
    title: firstText(".posting-headline h2", ".posting-header h2", "h2"),
    company: (() => {
      const logo = document.querySelector<HTMLImageElement>(".main-header-logo img")
      return logo?.alt?.trim() || firstText(".posting-categories .posting-category")
    })(),
    companyLogo: companyLogo ?? null,
    location,
    workMode: detectWorkMode(location, sourceText),
    employmentType: detectEmploymentType(sourceText),
    postedAt: detectPostedAt(sourceText),
    description,
    salary,
    salaryRange: salary,
  }
}

function extractAshby(): Partial<ExtractedJob> {
  const location = firstText("[class*='location']", "[class*='Location']")
  const description = firstText(
    "[class*='job-description']",
    "[class*='JobDescription']",
    "[class*='posting-description']",
  )
  const salary = firstText("[class*='salary']", "[class*='compensation']", "[class*='Compensation']")
  const sourceText = `${location ?? ""} ${description ?? ""}`
  const companyLogo = firstAttr("src", "._jqhkf1 img", "[class*='logo'] img")
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
    companyLogo: companyLogo ?? null,
    location,
    workMode: detectWorkMode(location, sourceText),
    employmentType: detectEmploymentType(sourceText),
    postedAt: detectPostedAt(sourceText),
    description,
    salary,
    salaryRange: salary,
  }
}

function extractICIMS(): Partial<ExtractedJob> {
  const location = firstText(".iCIMS_FieldDisplay_Job_Location", "[class*='location']")
  const description = firstText("#icims_content .iCIMS_JobsBoardJobDescriptionContainer", "#job-content")
  const salary = (() => {
    const body = document.body.textContent ?? ""
    return extractSalaryFromText(body)
  })()
  const sourceText = `${location ?? ""} ${description ?? ""}`
  return {
    title: firstText(
      ".iCIMS_JobsBoardPageTitle",
      "#icims_content h1",
      ".icims-page-header h1",
    ),
    company: firstText(".iCIMS_CompanyName", "[class*='company']"),
    companyLogo: firstAttr("src", ".iCIMS_CompanyLogo img", "img[alt*='logo' i]"),
    location,
    workMode: detectWorkMode(location, sourceText),
    employmentType: detectEmploymentType(sourceText),
    postedAt: detectPostedAt(sourceText),
    description,
    salary,
    salaryRange: salary,
  }
}

function extractSmartRecruiters(): Partial<ExtractedJob> {
  const location = firstText(
    "[data-test='job-location']",
    ".job-location",
    "[class*='location']",
  )
  const description = firstText(".job-section-description", "[data-test='job-description']")
  const salary = firstText("[data-test='job-salary']", "[class*='salary']")
  const sourceText = `${location ?? ""} ${description ?? ""}`
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
    companyLogo: firstAttr("src", "[data-test='company-logo'] img", ".company-logo img", "img[alt*='logo' i]"),
    location,
    workMode: detectWorkMode(location, sourceText),
    employmentType: detectEmploymentType(sourceText),
    postedAt: detectPostedAt(sourceText),
    description,
    salary,
    salaryRange: salary,
  }
}

function extractBambooHR(): Partial<ExtractedJob> {
  const location = firstText(".BambooHR-ATS-Jobs-Item-Location", "[class*='location']")
  const description = firstText("#BambooHR-ATS-board-description", ".BambooHR-ATS-body")
  const salary = (() => {
    const body = document.body.textContent ?? ""
    return extractSalaryFromText(body)
  })()
  const sourceText = `${location ?? ""} ${description ?? ""}`
  const logo = attr(".BambooHR-ATS-header-logo img", "src")
  return {
    title: firstText(".BambooHR-ATS-Jobs-Item-Title", "h2.BambooHR-ATS-board-headline", "h1"),
    company: (() => {
      const logo = document.querySelector<HTMLImageElement>(".BambooHR-ATS-header-logo img")
      return logo?.alt?.trim() || null
    })(),
    companyLogo: logo ?? null,
    location,
    workMode: detectWorkMode(location, sourceText),
    employmentType: detectEmploymentType(sourceText),
    postedAt: detectPostedAt(sourceText),
    description,
    salary,
    salaryRange: salary,
  }
}

function extractGeneric(): Partial<ExtractedJob> {
  const location = firstText(
    "[class*='location']",
    "[class*='Location']",
    "[class*='city']",
  )
  const description = firstText(
    "[class*='job-description']",
    "[class*='jobDescription']",
    "[class*='description']",
    "main",
    "article",
  )
  const salary = (() => {
    const body = document.body.textContent ?? ""
    return extractSalaryFromText(body)
  })()
  const sourceText = `${location ?? ""} ${description ?? ""}`
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
    companyLogo: firstAttr("src", "img[alt*='logo' i]", "header img"),
    location,
    workMode: detectWorkMode(location, sourceText),
    employmentType: detectEmploymentType(sourceText),
    postedAt: detectPostedAt(sourceText),
    description,
    salary,
    salaryRange: salary,
  }
}

function hasTextMatch(
  selector: string,
  pattern: RegExp,
  root: ParentNode = document
): boolean {
  return Array.from(root.querySelectorAll(selector)).some((node) =>
    pattern.test(node.textContent?.replace(/\s+/g, " ").trim() ?? "")
  )
}

function extractLinkedInCompanyAbout(): Partial<ExtractedJob> {
  const aboutRoot =
    document.querySelector<HTMLElement>(
      ".jobs-company__box,.jobs-company,.job-details-jobs-unified-top-card__company-summary",
    ) ?? null
  if (!aboutRoot) return {}

  const summary =
    firstText(
      ".jobs-company__box p",
      ".jobs-company__box .jobs-company__company-description",
      ".jobs-company__box .t-14",
      ".job-details-jobs-unified-top-card__company-summary p",
    ) ?? null
  const aboutText = rootText(aboutRoot)

  const foundedMatch =
    aboutText.match(/\bfounded(?:\s+in)?\s*[:\-]?\s*((?:19|20)\d{2})\b/i) ??
    aboutText.match(/\b((?:19|20)\d{2})\s+(?:founded|established)\b/i)
  const foundedYear = foundedMatch?.[1] ? Number.parseInt(foundedMatch[1], 10) : null

  const employeeCount =
    aboutText.match(
      /\b(\d{1,3}(?:,\d{3})*(?:\s*-\s*\d{1,3}(?:,\d{3})*)?\+?\s*(?:employees?|people|team members))\b/i,
    )?.[1] ?? null

  const industry =
    aboutText.match(/\bindustry\s*[:\-]?\s*([a-z0-9&/, +.-]{2,80})\b/i)?.[1]?.trim() ??
    null

  return {
    companySummary: summary,
    companyFoundedYear: Number.isFinite(foundedYear) ? foundedYear : null,
    companyEmployeeCount: employeeCount,
    companyIndustry: industry,
  }
}

function extractLinkedIn(): Partial<ExtractedJob> {
  const topRoot =
    document.querySelector<HTMLElement>(
      ".jobs-unified-top-card,.jobs-details-top-card__content,[data-view-name='job-details']",
    ) ?? document.body
  const location = firstText(
    ".jobs-unified-top-card__bullet",
    ".jobs-unified-top-card__secondary-description",
    ".jobs-details-top-card__primary-description-container",
  )
  const description = firstText(".jobs-description-content", ".jobs-box__html-content", "[class*='jobs-description']")
  const salaryRange = extractSalaryFromText(rootText(document.body))
  const topText = rootText(topRoot)
  const easyApply =
    hasTextMatch("button,a", /\beasy apply\b/i, topRoot) ||
    Boolean(document.querySelector("button.jobs-apply-button"))
  const activelyHiring = /\bactively hiring\b/i.test(topText)
  const topApplicantSignal = /\btop applicant\b/i.test(topText)
  const companyVerified =
    Boolean(topRoot.querySelector("[aria-label*='verified' i],[title*='verified' i]")) ||
    /\bverified\b/i.test(
      rootText(
        document.querySelector(
          ".jobs-unified-top-card__company-name,.job-details-jobs-unified-top-card__company-name",
        ) ?? topRoot
      )
    )
  const sponsorshipSignal = (() => {
    const source = `${topText} ${description ?? ""}`.toLowerCase()
    if (/(?:no|not)\s+(?:visa|sponsorship)|without sponsorship|cannot sponsor|must be authorized to work/.test(source)) {
      return "No sponsorship"
    }
    if (/(visa|sponsorship|h-1b|h1b|opt|cpt|work authorization)/.test(source)) {
      return "Visa details mentioned"
    }
    return null
  })()
  const about = extractLinkedInCompanyAbout()

  return {
    title: firstText(
      ".jobs-unified-top-card__job-title",
      ".jobs-details-top-card__job-title",
      ".job-details-jobs-unified-top-card__job-title",
      "[data-job-title]",
    ),
    company: firstText(
      "a.jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__primary-description-without-tagline a",
    ),
    companyLogo: firstAttr(
      "src",
      ".jobs-unified-top-card__company-logo img",
      ".job-details-jobs-unified-top-card__company-logo img",
      "img[alt*='logo' i]",
    ),
    companyVerified,
    location,
    workMode: detectWorkMode(location, topText),
    employmentType: detectEmploymentType(topText),
    postedAt: detectPostedAt(topText),
    description,
    salaryRange,
    salary: salaryRange,
    easyApply,
    activelyHiring,
    topApplicantSignal,
    sponsorshipSignal,
    ...about,
  }
}

function extractGlassdoor(): Partial<ExtractedJob> {
  return {
    title: firstText('[data-test="job-title"]', "[class*='JobDetails_jobTitle']"),
    company: firstText("[data-employer-name]", "[class*='EmployerProfile']"),
    location: firstText('[data-test="job-location"]', "[class*='location']"),
    description: firstText(
      "[data-description]",
      '[id="JobDescriptionContent"]',
      "[class*='jobDescriptionContent']",
      "[class*='JobDescription']",
    ),
  }
}

function hostnameBoardExtras(): Partial<ExtractedJob> {
  try {
    const h = window.location.hostname.replace(/^www\./i, "").toLowerCase()
    if (h.includes("linkedin.com")) return extractLinkedIn()
    if (h.includes("glassdoor.com")) return extractGlassdoor()
  } catch {
    /* ignore */
  }
  return {}
}

export function hasLdJsonJobPostingHint(): boolean {
  for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
    const t = script.textContent ?? ""
    if (t.includes("JobPosting") && t.includes("@type")) return true
  }
  return false
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

export function extractJobWithMeta(ats: ATSProvider): {
  job: ExtractedJob
  foundJsonLdJobPosting: boolean
} {
  const jsonLd = extractFromJsonLd()
  const meta = extractFromMeta()
  const atsSpecific = ATS_EXTRACTORS[ats]()

  const merged = merge(atsSpecific, hostnameBoardExtras(), jsonLd, meta)

  const job: ExtractedJob = {
    title: merged.title ?? null,
    company: merged.company ?? null,
    companyLogo: merged.companyLogo ?? null,
    companyVerified:
      typeof merged.companyVerified === "boolean" ? merged.companyVerified : null,
    location: merged.location ?? null,
    workMode: merged.workMode ?? null,
    employmentType: merged.employmentType ?? null,
    postedAt: merged.postedAt ?? null,
    description: merged.description ? merged.description.slice(0, 5000) : null,
    salary: merged.salary ?? null,
    salaryRange: merged.salaryRange ?? merged.salary ?? null,
    easyApply: typeof merged.easyApply === "boolean" ? merged.easyApply : null,
    activelyHiring:
      typeof merged.activelyHiring === "boolean" ? merged.activelyHiring : null,
    topApplicantSignal:
      typeof merged.topApplicantSignal === "boolean" ? merged.topApplicantSignal : null,
    companySummary: merged.companySummary ?? null,
    companyFoundedYear:
      typeof merged.companyFoundedYear === "number"
        ? Math.round(merged.companyFoundedYear)
        : null,
    companyEmployeeCount: merged.companyEmployeeCount ?? null,
    companyIndustry: merged.companyIndustry ?? null,
    sponsorshipSignal: merged.sponsorshipSignal ?? null,
    matchedSkills: Array.isArray(merged.matchedSkills) ? merged.matchedSkills : null,
    missingSkills: Array.isArray(merged.missingSkills) ? merged.missingSkills : null,
    matchScore:
      typeof merged.matchScore === "number" && Number.isFinite(merged.matchScore)
        ? Math.max(0, Math.min(100, Math.round(merged.matchScore)))
        : null,
    matchLabel: merged.matchLabel ?? null,
    url: merged.url ?? window.location.href,
    ats,
  }

  return {
    job,
    foundJsonLdJobPosting: Object.keys(jsonLd).length > 0 || hasLdJsonJobPostingHint(),
  }
}

export function shouldShowScoutBar(j: ExtractedJob, foundJsonLdJobPosting: boolean): boolean {
  if (foundJsonLdJobPosting) return true
  return Boolean(
    j.title?.trim() ||
      j.company?.trim() ||
      j.location?.trim() ||
      j.description?.trim() ||
      j.salary?.trim(),
  )
}

/** @deprecated Prefer extractJobWithMeta for SPA gating. */
export function extractJob(ats: ATSProvider): ExtractedJob {
  return extractJobWithMeta(ats).job
}

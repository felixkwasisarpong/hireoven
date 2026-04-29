import type { ATSProvider, ExtractedJob } from "../types"
import { detectATS } from "../detectors/ats"

export type OverlaySite = "linkedin" | "glassdoor" | "indeed" | "generic"
export type OverlayCardRole = "result" | "detail"

export interface JobCardSnapshot {
  key: string
  host: HTMLElement
  title: string | null
  company: string | null
  companyLogo?: string | null
  companyVerified?: boolean | null
  location: string | null
  workMode?: string | null
  employmentType?: string | null
  postedAt?: string | null
  description: string | null
  salary?: string | null
  salaryRange?: string | null
  easyApply?: boolean | null
  activelyHiring?: boolean | null
  topApplicantSignal?: boolean | null
  companySummary?: string | null
  companyFoundedYear?: number | null
  companyEmployeeCount?: string | null
  companyIndustry?: string | null
  sponsorshipSignal?: string | null
  url: string | null
  ats: ATSProvider
  site: OverlaySite
  role: OverlayCardRole
}

export interface SiteContext {
  site: OverlaySite
  isSearchPage: boolean
  cards: JobCardSnapshot[]
}

const MAX_CARDS = 48

function visible(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el) return false
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false
  const r = el.getBoundingClientRect()
  return r.width > 24 && r.height > 20
}

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

function text(root: Element | Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const el = root.querySelector(selector)
    const value = el?.textContent?.trim()
    if (value) return value
  }
  return null
}

function nodeText(root: Element | Document): string {
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
  return null
}

function detectPostedAt(sourceText: string): string | null {
  return (
    matchText(sourceText, /\b(?:posted\s+)?\d+\+?\s*(?:minute|hour|day|week|month|year)s?\s+ago\b/i) ??
    matchText(sourceText, /\b(?:posted\s+)?(?:today|yesterday|just posted|new)\b/i)
  )
}

function detectSalary(sourceText: string): string | null {
  return matchText(sourceText, /\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*(?:\/\s*(?:yr|year|hour|hr|mo|month))?)?/i)
}

function asAbsUrl(href: string | null): string | null {
  if (!href) return null
  try {
    return new URL(href, window.location.href).toString()
  } catch {
    return null
  }
}

function firstLink(root: Element, selectors: string[]): HTMLAnchorElement | null {
  for (const selector of selectors) {
    const el = root.querySelector(selector)
    if (el instanceof HTMLAnchorElement && el.href) return el
  }
  return null
}

function hostnameSite(): OverlaySite {
  const h = window.location.hostname.replace(/^www\./, "").toLowerCase()
  if (h.includes("linkedin.com")) return "linkedin"
  if (h.includes("glassdoor.com")) return "glassdoor"
  if (h.includes("indeed.com")) return "indeed"
  return "generic"
}

function makeKey(
  site: OverlaySite,
  url: string | null,
  title: string | null,
  company: string | null,
  location: string | null,
  role: OverlayCardRole,
  idx: number,
): string {
  const base = url ? canonicalJobUrl(url) : `${norm(title)}|${norm(company)}|${norm(location)}`
  return `${site}:${role}:${base || "unknown"}:${idx}`
}

function canonicalJobUrl(url: string): string {
  try {
    const u = new URL(url)
    const h = u.hostname.replace(/^www\./, "").toLowerCase()
    if (h.includes("linkedin.com")) {
      const m = u.pathname.match(/\/jobs\/view\/(\d+)/)
      if (m?.[1]) return `linkedin:/jobs/view/${m[1]}`
      return `linkedin:${u.pathname}`
    }
    if (h.includes("glassdoor.com")) {
      const p = u.pathname.replace(/\/$/, "")
      return `glassdoor:${p}`
    }
    if (h.includes("indeed.com")) {
      const jk = u.searchParams.get("jk") ?? u.searchParams.get("vjk")
      if (jk) return `indeed:jk/${jk}`
      return `indeed:${u.pathname}`
    }
    return `${u.origin}${u.pathname}`
  } catch {
    return url
  }
}

function findLinkedInCards(): HTMLElement[] {
  const buckets = [
    ...Array.from(document.querySelectorAll<HTMLElement>("li.jobs-search-results__list-item")),
    ...Array.from(document.querySelectorAll<HTMLElement>("div.job-card-container")),
    ...Array.from(document.querySelectorAll<HTMLElement>("li.scaffold-layout__list-item")),
  ]
  const seen = new Set<HTMLElement>()
  const cards: HTMLElement[] = []
  for (const item of buckets) {
    if (seen.has(item)) continue
    seen.add(item)
    if (!visible(item)) continue
    const hasLink = item.querySelector("a[href*='/jobs/view/']")
    if (!hasLink) continue
    cards.push(item)
    if (cards.length >= MAX_CARDS) break
  }
  return cards
}

function mapLinkedInCards(hosts: HTMLElement[]): JobCardSnapshot[] {
  return hosts.map((host, idx) => {
    const link = firstLink(host, [
      "a.job-card-container__link",
      "a.base-card__full-link",
      "a[href*='/jobs/view/']",
    ])
    const title =
      text(host, [
        ".job-card-list__title",
        ".base-search-card__title",
        ".job-card-container__link",
        "h3",
      ]) ??
      link?.textContent?.trim() ??
      null

    const company = text(host, [
      ".job-card-container__company-name",
      ".base-search-card__subtitle",
      "h4",
    ])

    const location = text(host, [
      ".job-card-container__metadata-item",
      ".job-search-card__location",
      ".base-search-card__metadata",
    ])

    const description = host.getAttribute("aria-label") ?? null
    const hostText = nodeText(host)
    const salary = detectSalary(hostText)
    const url = asAbsUrl(link?.href ?? null)
    const companyLogo =
      host.querySelector<HTMLImageElement>("img.ivm-view-attr__img--centered,img[data-delayed-url],img")?.src ??
      null

    return {
      key: makeKey("linkedin", url, title, company, location, "result", idx),
      host,
      title,
      company,
      companyLogo,
      companyVerified:
        Boolean(host.querySelector("[aria-label*='verified' i],[title*='verified' i]")) ||
        /\bverified\b/i.test(hostText),
      location,
      workMode: detectWorkMode(location, hostText),
      employmentType: detectEmploymentType(hostText),
      postedAt: detectPostedAt(hostText),
      description,
      salary,
      salaryRange: salary,
      easyApply: /\beasy apply\b/i.test(hostText),
      activelyHiring: /\bactively hiring\b/i.test(hostText),
      topApplicantSignal: /\btop applicant\b/i.test(hostText),
      url,
      ats: "generic",
      site: "linkedin",
      role: "result",
    }
  })
}

function linkedInDetailFallback(): JobCardSnapshot[] {
  const detailRoot = document.querySelector<HTMLElement>(
    ".jobs-search__job-details--container,.jobs-details,.scaffold-layout__detail",
  )
  const top = document.querySelector<HTMLElement>(
    ".jobs-unified-top-card,.jobs-details-top-card__content,[data-view-name='job-details']",
  )
  const anchor = top ?? detailRoot
  if (!visible(anchor)) return []
  const metaRoot = top ?? detailRoot ?? document
  const title = text(metaRoot, [
    ".jobs-unified-top-card__job-title",
    ".jobs-details-top-card__job-title",
    "h1",
  ])
  const company = text(metaRoot, [
    ".jobs-unified-top-card__company-name",
    "a[href*='/company/']",
  ])
  const location = text(metaRoot, [
    ".jobs-unified-top-card__bullet",
    ".jobs-unified-top-card__secondary-description",
  ])
  const description =
    document.querySelector(".jobs-description-content")?.textContent?.trim()?.slice(0, 1600) ?? null
  const detailText = nodeText(metaRoot)
  const companySummary =
    text(document, [
      ".jobs-company__box p",
      ".jobs-company__box .jobs-company__company-description",
      ".job-details-jobs-unified-top-card__company-summary p",
    ]) ?? null
  const aboutText =
    nodeText(
      document.querySelector(
        ".jobs-company__box,.jobs-company,.job-details-jobs-unified-top-card__company-summary",
      ) ?? metaRoot
    )
  const foundedYear =
    Number.parseInt(
      aboutText.match(/\bfounded(?:\s+in)?\s*[:\-]?\s*((?:19|20)\d{2})\b/i)?.[1] ??
        "",
      10
    ) || null
  const employeeCount =
    aboutText.match(
      /\b(\d{1,3}(?:,\d{3})*(?:\s*-\s*\d{1,3}(?:,\d{3})*)?\+?\s*(?:employees?|people|team members))\b/i,
    )?.[1] ?? null
  const companyIndustry =
    aboutText.match(/\bindustry\s*[:\-]?\s*([a-z0-9&/, +.-]{2,80})\b/i)?.[1]?.trim() ?? null
  const salary = detectSalary(`${detailText} ${description ?? ""}`)
  const detailLink = (detailRoot ?? top)?.querySelector<HTMLAnchorElement>("a[href*='/jobs/view/']")
  let url = asAbsUrl(detailLink?.href ?? null)
  if (!url) {
    try {
      const cur = new URL(window.location.href)
      const id = cur.searchParams.get("currentJobId")
      if (id) url = `https://www.linkedin.com/jobs/view/${id}/`
    } catch {
      // ignore URL parse issues
    }
  }
  if (!url) url = window.location.href

  return [
    {
      key: makeKey("linkedin", url, title, company, location, "detail", 0),
      host: anchor,
      title,
      company,
      companyLogo:
        document.querySelector<HTMLImageElement>(
          ".jobs-unified-top-card__company-logo img,.job-details-jobs-unified-top-card__company-logo img,img[alt*='logo' i]",
        )?.src ?? null,
      companyVerified:
        Boolean(anchor.querySelector("[aria-label*='verified' i],[title*='verified' i]")) ||
        /\bverified\b/i.test(detailText),
      location,
      workMode: detectWorkMode(location, detailText),
      employmentType: detectEmploymentType(detailText),
      postedAt: detectPostedAt(detailText),
      description,
      salary,
      salaryRange: salary,
      easyApply:
        /\beasy apply\b/i.test(detailText) ||
        Array.from(document.querySelectorAll("button,a")).some((node) =>
          /\beasy apply\b/i.test(node.textContent ?? "")
        ),
      activelyHiring: /\bactively hiring\b/i.test(detailText),
      topApplicantSignal: /\btop applicant\b/i.test(detailText),
      companySummary,
      companyFoundedYear: foundedYear,
      companyEmployeeCount: employeeCount,
      companyIndustry,
      sponsorshipSignal: (() => {
        const source = `${detailText} ${description ?? ""}`.toLowerCase()
        if (/(?:no|not)\s+(?:visa|sponsorship)|without sponsorship|cannot sponsor|must be authorized to work/.test(source)) {
          return "No sponsorship"
        }
        if (/(visa|sponsorship|h-1b|h1b|opt|cpt|work authorization)/.test(source)) {
          return "Visa details mentioned"
        }
        return null
      })(),
      url,
      ats: "generic",
      site: "linkedin",
      role: "detail",
    },
  ]
}

function findGlassdoorCards(): HTMLElement[] {
  const buckets = [
    ...Array.from(document.querySelectorAll<HTMLElement>("[data-test='jobListing']")),
    ...Array.from(document.querySelectorAll<HTMLElement>("li[class*='JobsList_jobListItem']")),
    ...Array.from(document.querySelectorAll<HTMLElement>("article[class*='JobCard']")),
  ]
  const seen = new Set<HTMLElement>()
  const cards: HTMLElement[] = []
  for (const item of buckets) {
    if (seen.has(item)) continue
    seen.add(item)
    if (!visible(item)) continue
    const hasLink = item.querySelector("a[href*='job-listing']")
    if (!hasLink) continue
    cards.push(item)
    if (cards.length >= MAX_CARDS) break
  }
  return cards
}

function mapGlassdoorCards(hosts: HTMLElement[]): JobCardSnapshot[] {
  return hosts.map((host, idx) => {
    const link = firstLink(host, [
      "a[data-test='job-title']",
      "a[href*='job-listing']",
      "a[class*='JobCard_jobTitle']",
    ])

    const title =
      text(host, [
        "[data-test='job-title']",
        "[class*='JobCard_jobTitle']",
        "h2",
        "h3",
      ]) ??
      link?.textContent?.trim() ??
      null

    const company = text(host, [
      "[data-test='employer-name']",
      "[class*='EmployerProfile_compactEmployerName']",
      "[class*='EmployerProfile']",
    ])

    const location = text(host, [
      "[data-test='location']",
      "[class*='JobCard_location']",
      "[class*='location']",
    ])

    const description = text(host, [
      "[class*='JobCard_jobDescriptionSnippet']",
      "[class*='description']",
    ])

    const url = asAbsUrl(link?.href ?? null)

    return {
      key: makeKey("glassdoor", url, title, company, location, "result", idx),
      host,
      title,
      company,
      location,
      description,
      url,
      ats: "generic",
      site: "glassdoor",
      role: "result",
    }
  })
}

function glassdoorDetailFallback(): JobCardSnapshot[] {
  const top = document.querySelector<HTMLElement>(
    "[data-test='job-title'],[class*='JobDetails_jobTitle'],main",
  )
  if (!visible(top)) return []

  const container =
    top.closest("main,article,section") instanceof HTMLElement
      ? (top.closest("main,article,section") as HTMLElement)
      : top

  const title = text(document, ["[data-test='job-title']", "[class*='JobDetails_jobTitle']", "h1"])
  const company = text(document, ["[data-test='employer-name']", "[data-employer-name]", "[class*='EmployerProfile']"])
  const location = text(document, ["[data-test='location']", "[data-test='job-location']", "[class*='location']"])
  const description =
    text(document, ["#JobDescriptionContainer", "[id='JobDescriptionContent']", "[class*='JobDescription']"])
  const url = window.location.href

  return [
    {
      key: makeKey("glassdoor", url, title, company, location, "detail", 0),
      host: container,
      title,
      company,
      location,
      description,
      url,
      ats: "generic",
      site: "glassdoor",
      role: "detail",
    },
  ]
}

function findIndeedCards(): HTMLElement[] {
  const buckets = [
    ...Array.from(document.querySelectorAll<HTMLElement>("[data-testid='slider_item']")),
    ...Array.from(document.querySelectorAll<HTMLElement>(".job_seen_beacon")),
    ...Array.from(document.querySelectorAll<HTMLElement>(".cardOutline")),
    ...Array.from(document.querySelectorAll<HTMLElement>("[data-jk]")),
  ]
  const seen = new Set<HTMLElement>()
  const cards: HTMLElement[] = []
  for (const item of buckets) {
    if (seen.has(item)) continue
    seen.add(item)
    if (!visible(item)) continue
    if (!item.querySelector("h2.jobTitle a, [data-testid='job-title'], a[href*='viewjob'], a[href*='/jk=']")) continue
    cards.push(item)
    if (cards.length >= MAX_CARDS) break
  }
  return cards
}

function mapIndeedCards(hosts: HTMLElement[]): JobCardSnapshot[] {
  return hosts.map((host, idx) => {
    const link = firstLink(host, [
      "h2.jobTitle a",
      "[data-testid='job-title']",
      "a[href*='viewjob']",
      "a.tapItem",
    ])

    const title =
      text(host, ["h2.jobTitle span[title]", "h2.jobTitle", "[data-testid='job-title']"]) ??
      link?.textContent?.trim() ??
      null

    const company = text(host, [
      "[data-testid='company-name']",
      ".companyName",
      "span.companyName",
    ])

    const location = text(host, [
      "[data-testid='text-location']",
      ".companyLocation",
      "div.companyLocation",
    ])

    const description = text(host, [
      "[data-testid='job-snippet']",
      ".job-snippet",
      ".underShelfFooter",
    ])

    const hostText = nodeText(host)
    const salary = detectSalary(hostText) ?? text(host, ["[data-testid='attribute_snippet_testid']"])
    const url = asAbsUrl(link?.href ?? null)

    return {
      key: makeKey("indeed", url, title, company, location, "result", idx),
      host,
      title,
      company,
      location,
      workMode: detectWorkMode(location, hostText),
      employmentType: detectEmploymentType(hostText),
      postedAt: detectPostedAt(hostText),
      description,
      salary,
      salaryRange: salary,
      easyApply:
        /\beasily apply\b|\bapply now\b/i.test(hostText) ||
        Boolean(host.querySelector("[data-testid='indeedApply']")),
      url,
      ats: "generic",
      site: "indeed",
      role: "result",
    }
  })
}

function indeedDetailFallback(): JobCardSnapshot[] {
  const top = document.querySelector<HTMLElement>(
    "[data-testid='jobsearch-JobInfoHeader-title'], .jobsearch-JobInfoHeader-title, h1.jobTitle, h1",
  )
  const root =
    document.querySelector<HTMLElement>(".jobsearch-RightPane, .jobsearch-ViewJobLayout, main") ?? top
  if (!visible(root)) return []

  const title = text(document, [
    "[data-testid='jobsearch-JobInfoHeader-title']",
    ".jobsearch-JobInfoHeader-title",
    "h1.jobTitle",
    "h1",
  ])
  const company = text(document, [
    "[data-testid='inlineHeader-companyName']",
    ".jobsearch-CompanyInfoContainer a",
    "[data-company-name]",
  ])
  const location = text(document, [
    "[data-testid='inlineHeader-companyLocation']",
    "[data-testid='job-location']",
    ".companyLocation",
  ])
  const description = text(document, [
    "#jobDescriptionText",
    "[data-testid='jobDescriptionText']",
    ".jobsearch-JobComponent-description",
  ])
  const detailText = nodeText(root ?? document)
  const salary = detectSalary(detailText) ?? text(document, ["[data-testid='attribute_snippet_testid']"])
  const url = window.location.href

  return [
    {
      key: makeKey("indeed", url, title, company, location, "detail", 0),
      host: root,
      title,
      company,
      location,
      workMode: detectWorkMode(location, detailText),
      employmentType: detectEmploymentType(detailText),
      postedAt: detectPostedAt(detailText),
      description,
      salary,
      salaryRange: salary,
      easyApply:
        /\bapply now\b|\beasily apply\b/i.test(detailText) ||
        Boolean(document.querySelector("[data-testid='indeedApplyButton']")),
      sponsorshipSignal: (() => {
        const source = `${detailText} ${description ?? ""}`.toLowerCase()
        if (/(?:no|not)\s+(?:visa|sponsorship)|without sponsorship|cannot sponsor/.test(source)) {
          return "No sponsorship"
        }
        if (/(visa|sponsorship|h-1b|h1b|opt|cpt|work authorization)/.test(source)) {
          return "Visa details mentioned"
        }
        return null
      })(),
      url,
      ats: "generic",
      site: "indeed",
      role: "detail",
    },
  ]
}

function genericDetailFallback(): JobCardSnapshot[] {
  const host =
    document.querySelector<HTMLElement>("main article,main,[role='main'],article") ?? document.body
  if (!visible(host)) return []

  const title = text(document, [
    "h1",
    "[class*='job-title']",
    "[class*='JobTitle']",
    "[data-test='job-title']",
  ])
  const company = text(document, [
    "[class*='company-name']",
    "[class*='companyName']",
    "[data-test='employer-name']",
  ])
  const location = text(document, [
    "[class*='location']",
    "[data-test='job-location']",
    "[itemprop='jobLocation']",
  ])
  const description =
    text(document, [
      "[data-automation-id='jobPostingDescription']",
      "[class*='job-description']",
      "[class*='JobDescription']",
    ]) ?? document.body.textContent?.trim()?.slice(0, 1800) ?? null

  const url = window.location.href
  const ats = detectATS(url)

  return [
    {
      key: makeKey("generic", url, title, company, location, "detail", 0),
      host,
      title,
      company,
      location,
      description,
      url,
      ats,
      site: "generic",
      role: "detail",
    },
  ]
}

function inferSearchPage(site: OverlaySite, cardsLen: number): boolean {
  if (cardsLen >= 2) return true
  const path = `${window.location.pathname}${window.location.search}`.toLowerCase()
  if (site === "linkedin" && /\/jobs\/search/.test(path)) return true
  if (site === "glassdoor" && /\/job\//.test(path) && /(?:jobs\.htm|srch_|findjobs|keyword)/.test(path)) return true
  if (site === "indeed" && /\/jobs(?:\?|$)/.test(path)) return true
  return false
}

export function extractSiteContext(): SiteContext {
  const site = hostnameSite()

  if (site === "linkedin") {
    const resultCards = mapLinkedInCards(findLinkedInCards())
    const detailCard = linkedInDetailFallback()[0] ?? null
    let resolved = resultCards

    if (resolved.length === 0 && detailCard) {
      resolved = [detailCard]
    } else if (resolved.length > 0 && detailCard) {
      resolved = [...resolved, detailCard]
    }

    return {
      site,
      isSearchPage: inferSearchPage(site, resultCards.length),
      cards: resolved,
    }
  }

  if (site === "glassdoor") {
    const resultCards = mapGlassdoorCards(findGlassdoorCards())
    const detailCard = glassdoorDetailFallback()[0] ?? null
    let resolved = resultCards

    if (resolved.length === 0 && detailCard) {
      resolved = [detailCard]
    } else if (resolved.length > 0 && detailCard) {
      resolved = [...resolved, detailCard]
    }

    return {
      site,
      isSearchPage: inferSearchPage(site, resultCards.length),
      cards: resolved,
    }
  }

  if (site === "indeed") {
    const resultCards = mapIndeedCards(findIndeedCards())
    const detailCard = indeedDetailFallback()[0] ?? null
    let resolved = resultCards

    if (resolved.length === 0 && detailCard) {
      resolved = [detailCard]
    } else if (resolved.length > 0 && detailCard) {
      resolved = [...resolved, detailCard]
    }

    return {
      site,
      isSearchPage: inferSearchPage(site, resultCards.length),
      cards: resolved,
    }
  }

  const genericCards = genericDetailFallback()
  return {
    site,
    isSearchPage: false,
    cards: genericCards,
  }
}

export function toExtractedJob(card: JobCardSnapshot): ExtractedJob {
  return {
    title: card.title,
    company: card.company,
    companyLogo: card.companyLogo ?? null,
    companyVerified: card.companyVerified ?? null,
    location: card.location,
    workMode: card.workMode ?? null,
    employmentType: card.employmentType ?? null,
    postedAt: card.postedAt ?? null,
    description: card.description,
    salary: card.salary ?? null,
    salaryRange: card.salaryRange ?? card.salary ?? null,
    easyApply: card.easyApply ?? null,
    activelyHiring: card.activelyHiring ?? null,
    topApplicantSignal: card.topApplicantSignal ?? null,
    companySummary: card.companySummary ?? null,
    companyFoundedYear: card.companyFoundedYear ?? null,
    companyEmployeeCount: card.companyEmployeeCount ?? null,
    companyIndustry: card.companyIndustry ?? null,
    sponsorshipSignal: card.sponsorshipSignal ?? null,
    matchedSkills: null,
    missingSkills: null,
    matchScore: null,
    matchLabel: null,
    url: card.url ?? window.location.href,
    ats: card.ats,
  }
}

export function findDetailDescriptionRoot(card: JobCardSnapshot): HTMLElement | null {
  if (card.role !== "detail") return null

  if (card.site === "linkedin") {
    return (
      document.querySelector<HTMLElement>(
        ".jobs-search__job-details--container .jobs-description-content__text,.jobs-search__job-details--container .jobs-description-content,.jobs-description-content__text,.jobs-description-content,.jobs-box__html-content",
      ) ?? null
    )
  }

  if (card.site === "glassdoor") {
    return (
      document.querySelector<HTMLElement>(
        "#JobDescriptionContainer,[id='JobDescriptionContent'],[class*='JobDescription'],[data-test='jobDescription']",
      ) ?? null
    )
  }

  if (card.site === "indeed") {
    return (
      document.querySelector<HTMLElement>(
        "#jobDescriptionText,[data-testid='jobDescriptionText'],.jobsearch-JobComponent-description",
      ) ?? null
    )
  }

  const scoped =
    card.host.querySelector<HTMLElement>(
      "[data-automation-id='jobPostingDescription'],[class*='job-description'],[class*='JobDescription']",
    ) ?? null

  if (scoped) return scoped
  return card.host
}

export function findPrimaryActionLink(card: JobCardSnapshot): HTMLAnchorElement | null {
  const root = card.host
  if (!root.isConnected) return null
  const link = root.querySelector<HTMLAnchorElement>(
    "a.job-card-container__link,a.base-card__full-link,a[href*='/jobs/view/'],a[data-test='job-title'],a[href*='job-listing']",
  )
  return link ?? null
}

export function sponsorshipHintFromText(card: JobCardSnapshot): boolean | null {
  const source = `${card.title ?? ""} ${card.description ?? ""} ${card.location ?? ""}`.toLowerCase()
  if (!source.trim()) return null
  if (/(?:no|not)\s+(?:visa|sponsorship)|without\s+sponsorship|unable\s+to\s+sponsor/.test(source)) return false
  if (/(?:h-1b|h1b|visa|sponsorship|opt|cpt|work authorization)/.test(source)) return true
  return null
}

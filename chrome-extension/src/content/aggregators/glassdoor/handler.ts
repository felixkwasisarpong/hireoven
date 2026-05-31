import {
  AggregatorHandler,
  bootstrapAggregator,
  type ApplyMode,
  type PostedAtPrecision,
  type ScrapedJob,
  type WorkMode,
} from "../base"
import { isSuppressed, recordDismiss } from "../cta-suppression"
import { createPill, injectPillsAfter } from "../pill"

const JOB_LISTING_RE = /^\/job-listing\//
const JOB_SEARCH_RE = /^\/Job\/.+SRCH/

export class GlassdoorHandler extends AggregatorHandler {
  readonly site = "glassdoor" as const

  /** Track companies enriched this session to avoid spamming the endpoint on re-renders. */
  private enrichedCompanies = new Set<string>()

  isJobPage(): boolean {
    const path = window.location.pathname
    return JOB_LISTING_RE.test(path) || JOB_SEARCH_RE.test(path)
  }

  scrapeJob(): ScrapedJob | null {
    const sourceId = this.extractJobId()
    if (!sourceId) return null

    const title = this.text([
      "[data-test='job-title']",
      "[class*='JobDetails_jobTitle']",
      "h1",
    ])
    if (!title) return null

    const companyAnchor = document.querySelector<HTMLAnchorElement>(
      "[data-test='employer-name'] a, [class*='EmployerProfile'] a",
    )
    const company =
      companyAnchor?.textContent?.trim() ??
      this.text([
        "[data-test='employer-name']",
        "[class*='EmployerProfile_compactEmployerName']",
        "[class*='EmployerProfile']",
      ])
    if (!company) return null

    const location =
      this.text([
        "[data-test='location']",
        "[data-test='job-location']",
        "[class*='location']",
      ]) ?? ""

    const description =
      document.querySelector<HTMLElement>(
        "#JobDescriptionContainer, [id='JobDescriptionContent'], [class*='JobDescription']",
      )?.innerText?.trim() ?? ""

    const detailText = `${location} ${description}`
    const workMode = parseWorkMode(detailText)

    const { salary, salaryConfirmed } = this.extractSalary()
    const { postedAt, postedAtPrecision } = parsePostedAt()
    const applyMode = this.detectApplyMode()

    const job: ScrapedJob = {
      site: this.site,
      sourceId,
      title,
      company,
      companyUrl: companyAnchor?.href,
      location,
      workMode,
      postedAt,
      postedAtPrecision,
      description,
      salary,
      salaryConfirmed,
      applyMode,
      metadata: {
        givenToGetWalled: this.detectGiveToGetWall(),
      },
    }

    // Brief: company enrichment always runs on job-listing pages.
    this.maybeEnrichCompany(company)

    return job
  }

  detectApplyMode(): ApplyMode {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, a"))
    for (const btn of buttons) {
      const txt = (btn.textContent ?? "").trim().toLowerCase()
      if (txt === "easy apply") return { kind: "internal_easyapply", driver: "linkedin" }
      // ^ Glassdoor's Easy Apply is delegated through LinkedIn auth in many cases;
      //   we mark the driver as 'linkedin' so the dispatcher picks the right handler.
      if (
        txt === "apply on employer site" ||
        txt === "apply on company site" ||
        txt === "apply now" ||
        txt === "apply"
      ) {
        return { kind: "external_redirect" }
      }
    }
    return { kind: "unknown" }
  }

  injectPill(_target: Element, job: ScrapedJob): void {
    if (job.applyMode.kind === "closed") return
    const target = this.findPillTarget()
    if (!target) return

    void isSuppressed(this.site).then((suppressed) => {
      if (suppressed) return
      const primary = createPill({
        variant: "green",
        copy: "Apply with Apex",
        testId: "apex-pill-glassdoor-primary",
        dismissible: true,
        onDismiss: () => void recordDismiss(this.site),
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          chrome.runtime.sendMessage(
            { type: "APEX_OPEN_APPLY_FLOW", site: this.site, jobId: job.sourceId, scrapedJob: job },
            () => {
              void chrome.runtime.lastError
            },
          )
        },
      })

      const secondary = createPill({
        variant: "secondary",
        copy: "Save company to Apex",
        testId: "apex-pill-glassdoor-secondary",
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          // Force a re-enrich on explicit user click, even if we already auto-enriched.
          this.enrichedCompanies.delete(job.company.toLowerCase())
          this.maybeEnrichCompany(job.company, { explicit: true })
        },
      })

      injectPillsAfter(target, [primary, secondary])
    })
  }

  protected findPillTarget(): Element | null {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, a"))
    for (const btn of buttons) {
      const txt = (btn.textContent ?? "").trim().toLowerCase()
      if (
        txt === "apply on employer site" ||
        txt === "apply on company site" ||
        txt === "easy apply" ||
        txt === "apply now" ||
        txt === "apply"
      ) {
        return btn
      }
    }
    return (
      document.querySelector("[data-test='applyButton']") ??
      document.querySelector("[class*='ApplyButton']") ??
      null
    )
  }

  // ── Glassdoor-specific helpers ─────────────────────────────────────────────

  private extractJobId(): string | null {
    // Glassdoor uses several URL forms:
    //   .../senior-eng-figma-JV_IC1147401_KO0,24_IM759.htm
    //   .../some-job-JV_1234567.htm
    //   ?jobListingId=1234567
    const urlMatch = window.location.href.match(/JV_(?:[A-Z]{1,3})?(\d+)|jobListingId=(\d+)/)
    if (urlMatch) {
      const id = urlMatch[1] ?? urlMatch[2]
      if (id) return id
    }
    const active = document.querySelector<HTMLElement>(
      "[data-test='jobListing'][data-id], [data-test='jobListing'].selected, [data-test='jobListing'][aria-selected='true']",
    )
    const dataId = active?.getAttribute("data-id")
    if (dataId && /^\d+$/.test(dataId)) return dataId
    const path = window.location.pathname.match(/\/job-listing\/.+?-(?:JV_)?(\d+)(?:\.htm)?$/)
    return path?.[1] ?? null
  }

  private extractSalary(): { salary?: string; salaryConfirmed?: boolean } {
    const employerStated = !!document.querySelector(
      "[data-test='detailSalary'][data-source='employer'], [class*='employer-provided-salary']",
    )
    const text =
      this.text([
        "[data-test='detailSalary']",
        "[class*='Salary']",
        ".salary",
      ]) ?? undefined
    if (!text) return {}
    return { salary: text, salaryConfirmed: employerStated }
  }

  private detectGiveToGetWall(): boolean {
    if (document.querySelector("[class*='gtgWall'], [class*='giveToGet']")) return true
    const text = (document.body.innerText ?? "").toLowerCase()
    return /sign up to read|create a free account to read/.test(text)
  }

  private maybeEnrichCompany(companyName: string, options?: { explicit?: boolean }): void {
    if (!companyName) return
    const key = companyName.toLowerCase()
    if (this.enrichedCompanies.has(key)) return
    this.enrichedCompanies.add(key)

    const signals = this.extractCompanySignals()
    if (!chrome.runtime?.id) return
    chrome.runtime.sendMessage(
      {
        type: "APEX_ENRICH_COMPANY",
        source: "glassdoor",
        companyName,
        explicit: !!options?.explicit,
        signals,
      },
      () => {
        void chrome.runtime.lastError
      },
    )
  }

  private extractCompanySignals(): Record<string, unknown> {
    const ratingText = this.text([
      "[data-test='rating']",
      "[class*='rating-info__rating']",
      "[class*='employerRating']",
    ])
    const rating = ratingText ? Number(ratingText.match(/\d+(?:\.\d+)?/)?.[0]) : undefined

    const reviewCountText = this.text([
      "[data-test='reviewCount']",
      "[class*='ReviewSummary_reviewCount']",
      "[class*='reviewsCount']",
    ])
    const reviewCount = reviewCountText
      ? Number(reviewCountText.replace(/[^\d]/g, "")) || undefined
      : undefined

    const ceoApproval = parsePercent(
      this.text(["[data-test='ceoApproval']", "[class*='CEOApproval']"]),
    )
    const recommendToFriend = parsePercent(
      this.text(["[data-test='recommendToFriend']", "[class*='RecommendToFriend']"]),
    )
    const roleSpecificSalaryRange = this.text([
      "[data-test='roleSalary']",
      "[class*='roleSalary']",
      "[class*='SalaryRange']",
    ])
    const pros = this.collectReviewPhrases("pros")
    const cons = this.collectReviewPhrases("cons")

    return {
      rating: Number.isFinite(rating) ? rating : null,
      reviewCount: reviewCount ?? null,
      ceoApproval: ceoApproval ?? null,
      recommendToFriend: recommendToFriend ?? null,
      roleSpecificSalaryRange: roleSpecificSalaryRange ?? null,
      pros,
      cons,
    }
  }

  private collectReviewPhrases(kind: "pros" | "cons"): string[] {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(
        `[data-test='${kind}'], [class*='Reviews_${kind}'], [class*='${kind}Phrase']`,
      ),
    )
    const phrases: string[] = []
    for (const section of sections) {
      const text = section.innerText?.trim()
      if (!text) continue
      // Each section may host multiple snippets — split on common separators.
      const parts = text
        .split(/[\n•·]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 6 && s.length < 240 && !/^(pros|cons)$/i.test(s))
      for (const part of parts) {
        phrases.push(part)
        if (phrases.length >= 5) return phrases
      }
    }
    return phrases.slice(0, 5)
  }

  private text(selectors: string[]): string | null {
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel)
      const value = el?.textContent?.trim()
      if (value) return value
    }
    return null
  }
}

// ── Free helpers ──────────────────────────────────────────────────────────────

function parseWorkMode(source: string): WorkMode | undefined {
  const t = source.toLowerCase()
  if (/\bhybrid\b/.test(t)) return "hybrid"
  if (/\bremote\b/.test(t)) return "remote"
  if (/\bon[\s-]?site\b/.test(t)) return "onsite"
  return undefined
}

function parsePostedAt(): { postedAt: string; postedAtPrecision: PostedAtPrecision } {
  const now = Date.now()
  const ageEl =
    document.querySelector<HTMLElement>("[data-test='job-age'], [class*='JobAge'], [class*='listing-age']") ?? null
  const text = (ageEl?.textContent ?? "").toLowerCase().trim()

  // Brief: Glassdoor uses '30d+' buckets — when bucket detected, set
  // postedAtPrecision: 'bucket' and timestamp = now - 30 days.
  if (/30\s*d\+|30\+\s*days/.test(text)) {
    return {
      postedAt: new Date(now - 30 * 24 * 60 * 60_000).toISOString(),
      postedAtPrecision: "bucket",
    }
  }
  const m = text.match(/(\d+)\s*(d|day|h|hour|hr|w|week|m|month)s?\s*(?:ago)?/)
  if (!m) {
    if (/today|just posted|new/.test(text)) {
      return { postedAt: new Date(now).toISOString(), postedAtPrecision: "exact" }
    }
    return { postedAt: new Date(now).toISOString(), postedAtPrecision: "day" }
  }
  const n = Number(m[1])
  const unit = m[2]
  const ms =
    unit === "h" || unit === "hour" || unit === "hr"
      ? n * 60 * 60_000
      : unit === "d" || unit === "day"
      ? n * 24 * 60 * 60_000
      : unit === "w" || unit === "week"
      ? n * 7 * 24 * 60 * 60_000
      : n * 30 * 24 * 60 * 60_000
  const precision: PostedAtPrecision =
    unit === "h" || unit === "hour" || unit === "hr" ? "exact" : "day"
  return { postedAt: new Date(now - ms).toISOString(), postedAtPrecision: precision }
}

function parsePercent(s: string | null): number | undefined {
  if (!s) return undefined
  const m = s.match(/(\d+)\s*%/)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

bootstrapAggregator(new GlassdoorHandler())

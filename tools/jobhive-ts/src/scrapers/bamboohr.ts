/**
 * BambooHR — TS port of jobhive.scrapers.bamboohr.
 *
 * BambooHR's old `/careers/list` JSON endpoint was deprecated in 2024 (every
 * tenant 404s there). The current public source of truth is the embedded
 * careers widget, static HTML grouped by department:
 *
 *   GET https://{slug}.bamboohr.com/jobs/embed2.php
 *
 * Each department is a <li class="BambooHR-ATS-Department-Item"> whose header
 * div names the department and whose <ul> holds one
 * <li id="bhrPositionID_{id}" class="BambooHR-ATS-Jobs-Item"> per job (anchor
 * = title + href, span.BambooHR-ATS-Location = "City, ST").
 *
 * Descriptions and the richer per-job fields come from the SPA's public JSON
 * XHR: GET https://{slug}.bamboohr.com/careers/{id}/detail → result.jobOpening
 * (description HTML, employmentStatusLabel, compensation, datePosted,
 * location{city,state,addressCountry}, locationType). We fan that out
 * (capped) to enrich each job.
 */

import { BaseScraper, register } from "../base.js"
import { fetchJson, fetchText, cleanHtml, parseIso } from "../http.js"
import {
  CompanyNotFoundError,
  ScraperError,
  type EmploymentType,
  type ReplicaJob,
} from "../types.js"

const WIDGET = (slug: string) => `https://${slug}.bamboohr.com/jobs/embed2.php`
const DETAIL = (slug: string, id: string) =>
  `https://${slug}.bamboohr.com/careers/${id}/detail`

// Cap detail fan-out at 40 jobs, concurrency ~8 (matches the Python
// MAX_CONCURRENCY; keeps a single tenant scrape from hammering the widget).
const MAX_DETAIL = 40
const DETAIL_CONCURRENCY = 8

// BambooHR's `employmentStatusLabel` is freeform but tenants stick to a small
// set. Map (substring match) to the shared employment-type enum.
const EMPLOYMENT_TYPE_MAP: Array<[string, EmploymentType]> = [
  ["full-time", "FULL_TIME"],
  ["fulltime", "FULL_TIME"],
  ["full time", "FULL_TIME"],
  ["regular full-time", "FULL_TIME"],
  ["part-time", "PART_TIME"],
  ["parttime", "PART_TIME"],
  ["part time", "PART_TIME"],
  ["regular part-time", "PART_TIME"],
  ["contract", "CONTRACT"],
  ["contractor", "CONTRACT"],
  ["temporary", "TEMPORARY"],
  ["temp", "TEMPORARY"],
  ["seasonal", "TEMPORARY"],
  ["intern", "INTERN"],
  ["internship", "INTERN"],
]

// One department block; body runs until the next dept block or end-of-doc.
const DEPARTMENT_BLOCK_RE =
  /<li id="bhrDepartmentID_\d+"[^>]*class="BambooHR-ATS-Department-Item"[^>]*>([\s\S]*?)(?=<li id="bhrDepartmentID_|$)/gi
// One job position <li>.
const POSITION_RE =
  /<li id="bhrPositionID_(\d+)"[^>]*class="BambooHR-ATS-Jobs-Item"[^>]*>([\s\S]*?)<\/li>/gi
const POSITION_LINK_RE = /<a[^>]+href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/i
const POSITION_LOCATION_RE =
  /<span[^>]*class="BambooHR-ATS-Location"[^>]*>\s*([^<]+?)\s*<\/span>/i

type ParsedPosition = { id: string; title: string; applyUrl: string; location?: string }

type JobOpening = {
  description?: string
  employmentStatusLabel?: string
  compensation?: string
  datePosted?: string
  location?: { city?: string; state?: string; addressCountry?: string }
  locationType?: string | number
}

class BambooHrScraper extends BaseScraper {
  readonly ats = "bamboohr"

  async fetch(slug: string): Promise<ReplicaJob[]> {
    const html = await fetchText(WIDGET(slug), { timeoutMs: 30_000 })
    // fetchText returns null on any non-2xx (incl. 404) or network error. The
    // widget is a 200 even for tenants with zero open jobs, so a null here is
    // an unknown/missing tenant — mirror the Python 404 → not-found.
    if (html == null) throw new CompanyNotFoundError(`BambooHR tenant not found: ${slug}`)

    const parsed = this.parseWidget(html)
    const jobs = parsed.map((p) => this.toJob(p))

    // Detail fan-out (capped) with a small concurrency pool. Best-effort:
    // detail failures leave listing-derived fields intact.
    const targets = jobs.slice(0, MAX_DETAIL)
    let next = 0
    const worker = async () => {
      for (;;) {
        const i = next++
        if (i >= targets.length) return
        await this.enrichOne(slug, targets[i])
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(DETAIL_CONCURRENCY, targets.length) }, worker),
    )

    return jobs
  }

  private parseWidget(html: string): ParsedPosition[] {
    const out: ParsedPosition[] = []
    const seen = new Set<string>()
    let consumedEnd = 0

    // Walk department blocks; each job inherits nothing beyond listing fields
    // here (department isn't part of ReplicaJob), but we honour the same
    // dedupe-and-straggler traversal as the Python.
    for (const dept of html.matchAll(DEPARTMENT_BLOCK_RE)) {
      consumedEnd = (dept.index ?? 0) + dept[0].length
      for (const p of this.parsePositions(dept[1])) {
        if (seen.has(p.id)) continue
        seen.add(p.id)
        out.push(p)
      }
    }
    // Stragglers rendered outside any department block.
    for (const p of this.parsePositions(html.slice(consumedEnd))) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
    return out
  }

  private parsePositions(body: string): ParsedPosition[] {
    const out: ParsedPosition[] = []
    for (const m of body.matchAll(POSITION_RE)) {
      const id = m[1]
      const inner = m[2]
      const link = POSITION_LINK_RE.exec(inner)
      if (!link) continue
      const title = cleanHtml(link[2])
      if (!title) continue
      const href = link[1].trim()
      const applyUrl = href.startsWith("http")
        ? href
        : href.startsWith("//")
          ? `https:${href}`
          : href // widget hrefs are protocol-relative //{slug}.bamboohr.com/...
      out.push({ id, title, applyUrl, location: this.parseLocation(inner) })
    }
    return out
  }

  private parseLocation(body: string): string | undefined {
    const m = POSITION_LOCATION_RE.exec(body)
    return m ? m[1].trim() || undefined : undefined
  }

  private toJob(p: ParsedPosition): ReplicaJob {
    return {
      externalId: `bamboohr:${p.id}`,
      title: p.title,
      applyUrl: p.applyUrl,
      location: p.location,
    }
  }

  /** Hydrate one job in place from `/careers/{id}/detail` JSON. Best-effort. */
  private async enrichOne(slug: string, job: ReplicaJob): Promise<void> {
    const id = job.externalId.slice("bamboohr:".length)
    const res = await fetchJson<{ result?: { jobOpening?: JobOpening } }>(
      DETAIL(slug, id),
      {
        timeoutMs: 20_000,
        headers: { accept: "application/json", "x-requested-with": "XMLHttpRequest" },
      },
    )
    if (!res.ok) return
    const opening = res.data.result?.jobOpening
    if (!opening || typeof opening !== "object") return
    this.applyOpening(job, opening)
  }

  /** Fill fields the listing pass left empty; canonical location replaces the
   * terse "City, ST" snippet. */
  private applyOpening(job: ReplicaJob, opening: JobOpening): void {
    const desc = cleanHtml(opening.description)
    if (desc) job.description = desc

    const emp = opening.employmentStatusLabel
    if (typeof emp === "string" && emp.trim()) {
      const norm = emp.trim().toLowerCase()
      for (const [needle, mapped] of EMPLOYMENT_TYPE_MAP) {
        if (norm.includes(needle)) {
          job.employmentType = mapped
          break
        }
      }
    }

    const comp = opening.compensation
    if (typeof comp === "string" && comp.trim() && job.salaryMin == null) {
      // No numeric parse available — BambooHR ships freeform text; surface the
      // currency if it looks like a plain currency code, else leave numeric
      // salary fields unset (matches the Python which only fills a summary).
      const cur = /\b([A-Z]{3})\b/.exec(comp.trim())
      if (cur) job.salaryCurrency = cur[1]
    }

    const posted = parseIso(opening.datePosted)
    if (posted && !job.postedAt) job.postedAt = posted

    const loc = opening.location
    if (loc && typeof loc === "object") {
      const parts = [loc.city, loc.state, loc.addressCountry]
        .map((v) => (v ?? "").toString().trim())
        .filter(Boolean)
      const canonical = parts.join(", ")
      if (canonical) job.location = canonical
    }

    // locationType "1"/"2"/"remote" → remote; "0" → on-site/hybrid (BambooHR
    // doesn't distinguish hybrid).
    const lt = opening.locationType
    if (lt != null && job.workMode == null) {
      const s = String(lt).trim().toLowerCase()
      if (s === "1" || s === "2" || s === "true" || s.includes("remote")) {
        job.workMode = "remote"
      } else if (s === "0") {
        job.workMode = "onsite"
      }
    }
  }
}

register(new BambooHrScraper())

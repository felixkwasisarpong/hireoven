/**
 * Zoho Recruit public career-site adapter.
 *
 * Zoho Recruit serves job listings on a public career page at:
 *   https://{tenant}.zohorecruit.com/jobs/Careers
 *
 * The page is server-rendered HTML. All active job postings are embedded as a
 * JSON array inside a hidden `<input type="hidden" value="[{...}]">` element
 * where the JSON is HTML-entity-encoded (&#34; = ", &amp; = &, etc.).
 *
 * Job fields available inline:
 *   id, Posting_Title, Job_Description, City, State, Country, Remote_Job,
 *   Job_Type, Industry, Work_Experience, Date_Opened, Keep_on_Career_Site
 *
 * Apply URL pattern:
 *   https://{tenant}.zohorecruit.com/jobs/Careers/{id}/{title-slug}?source=CareerSite
 *
 * ats_identifier: tenant subdomain (e.g. "unit21" for unit21.zohorecruit.com)
 *
 * Note: The entire job board is rendered on a single page — no pagination.
 * Companies with very large job boards may require the "load more" JS interaction
 * but most SMB Zoho Recruit boards are single-page.
 */

import {
  hashContent,
  envConcurrency,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { harvesterFetch } from "@/lib/harvester/http-agent"

const CAREERS_PATH = "/jobs/Careers"
const SOURCE_PARAM = "?source=CareerSite"

// Marker that identifies the hidden input containing job JSON
const JOB_DATA_MARKER = 'type="hidden" value="[{&#34;Remote_Job&#34;'

type ZohoJob = {
  id?: string
  Posting_Title?: string
  Job_Opening_Name?: string
  Job_Description?: string
  City?: string | null
  State?: string | null
  Country?: string | null
  Remote_Job?: boolean
  Job_Type?: string
  Industry?: string
  Work_Experience?: string
  Date_Opened?: string
  Keep_on_Career_Site?: boolean
  Is_Locked?: boolean
  Publish?: boolean
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
}

function extractJobsFromHtml(html: string): ZohoJob[] | null {
  const markerIdx = html.indexOf(JOB_DATA_MARKER)
  if (markerIdx < 0) return null

  // The value starts after `type="hidden" value="`
  const valStart = markerIdx + 'type="hidden" value="'.length

  // Scan forward to find the closing " that is NOT part of &#34;
  let pos = valStart
  while (pos < html.length) {
    if (html[pos] === '"') {
      // &#34; looks like: ...&  #  3  4  ;  " — check the 4 chars before
      const prev = html.slice(Math.max(0, pos - 4), pos)
      if (!prev.endsWith("&#3")) break
    }
    pos++
  }

  const encoded = html.slice(valStart, pos)
  const decoded = decodeHtmlEntities(encoded)

  try {
    return JSON.parse(decoded) as ZohoJob[]
  } catch {
    return null
  }
}

function titleToSlug(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
}

function mapWorkMode(remote: boolean | undefined): string | undefined {
  if (remote === true) return "remote"
  return undefined
}

function mapEmploymentType(type: string | undefined): string | undefined {
  if (!type) return undefined
  const v = type.toLowerCase()
  if (v.includes("intern")) return "internship"
  if (v.includes("full") || v === "full_time") return "full-time"
  if (v.includes("part") || v === "part_time") return "part-time"
  if (v.includes("contract")) return "contract"
  return type
}

function flattenLocation(job: ZohoJob): string | undefined {
  const parts = [job.City, job.State, job.Country].filter(
    (p): p is string => Boolean(p)
  )
  return parts.length > 0 ? parts.join(", ") : undefined
}

function mapJob(job: ZohoJob, host: string): HarvestedJob | null {
  const id = job.id?.trim()
  const title = (job.Posting_Title ?? job.Job_Opening_Name)?.trim()
  if (!id || !title) return null

  // Skip unpublished or hidden jobs
  if (job.Keep_on_Career_Site === false || job.Is_Locked === true) return null

  const slug = titleToSlug(title)
  const applyUrl = `https://${host}${CAREERS_PATH}/${id}/${slug}${SOURCE_PARAM}`
  const location = flattenLocation(job)
  const workMode = mapWorkMode(job.Remote_Job)
  const employmentType = mapEmploymentType(job.Job_Type)
  const postedAt = job.Date_Opened
    ? new Date(job.Date_Opened).toISOString()
    : undefined

  // Job_Description is plain text (already stripped from Zoho's rendering)
  const description = job.Job_Description?.trim() || undefined

  return {
    externalId: `zohorecruit:${id}`,
    title,
    applyUrl,
    description,
    location,
    workMode,
    employmentType,
    postedAt,
    contentHash: hashContent([
      title,
      applyUrl,
      location,
      workMode,
      employmentType,
      description?.slice(0, 2_000),
    ]),
  }
}

export const zohoRecruitAdapter: AtsAdapter = {
  name: "zohorecruit",
  concurrency: envConcurrency("zohorecruit", 4),

  detectFromUrl(url: string): { slug: string } | null {
    const m = url.match(/^https?:\/\/([a-z0-9-]+)\.zohorecruit\.com\//i)
    if (!m) return null
    return { slug: m[1].toLowerCase() }
  },

  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    const host = `${slug}.zohorecruit.com`
    const url = `https://${host}${CAREERS_PATH}`

    const doFetch = ctx.fetchImpl ?? harvesterFetch
    let html: string
    let latencyMs = 0

    try {
      const t0 = Date.now()
      const resp = await doFetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,*/*",
          "accept-language": "en-US,en;q=0.9",
        },
      })
      latencyMs = Date.now() - t0
      if (!resp.ok) {
        const err = new Error(`zohorecruit: HTTP ${resp.status} for ${slug}`)
        ;(err as Error & { status?: number | null }).status = resp.status
        throw err
      }
      html = await resp.text()
    } catch (error) {
      if ((error as Error).message?.startsWith("zohorecruit:")) throw error
      const err = new Error(`zohorecruit: fetch failed for ${slug}: ${(error as Error).message}`)
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    const rawJobs = extractJobsFromHtml(html)
    if (!rawJobs) {
      const err = new Error(`zohorecruit: could not extract job data for ${slug}`)
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    const jobs: HarvestedJob[] = []
    for (const raw of rawJobs) {
      const job = mapJob(raw, host)
      if (job) jobs.push(job)
    }

    return {
      jobs,
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "zohorecruit",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(latencyMs, Date.now() - startedAt),
    }
  },
}

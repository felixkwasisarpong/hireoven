import {
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Oracle Cloud HCM (the modern successor to Taleo / Oracle Recruiting Cloud).
 * Public Candidate Experience URLs:
 *   https://{pod}.oraclecloud.com/hcmUI/CandidateExperience/{locale}/sites/{site}
 *   https://{pod}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/
 *
 * The Candidate Experience surface is backed by an unauthenticated REST API
 * at `/hcmRestApi/resources/latest/recruitingCEJobRequisitions` that takes a
 * `siteNumber` finder and returns paginated JSON. We use it directly — much
 * faster and richer than scraping the React app's bundle.
 *
 * Slug format: `{pod}:{site}` (e.g. `eeho.fa.us2`-padded host : site code).
 * The pod identifier is everything left of `.oraclecloud.com`.
 */

const PAGE_LIMIT = 50
const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_ORACLECLOUD_MAX_PAGES ?? "20", 10)
)

// `recruitingCEJobRequisitions` accepts the "expand" parameter to inline
// related entities. We pull workLocation + secondaryLocations + responsibility
// + qualification + flexFields — enough to satisfy the JSON-LD-equivalent
// fields the rest of the pipeline expects.
const EXPAND_PARAM = [
  "requisitionList.workLocation",
  "requisitionList.secondaryLocations",
  "requisitionList.requisitionFlexFields",
].join(",")

type OracleLocation = {
  GeographyId?: string | number
  Name?: string
  CountryName?: string
  CountryCode?: string
  StateProvince?: string
}

type OracleFlexField = {
  Prompt?: string
  Value?: string
}

type OracleRequisition = {
  Id?: string | number
  Title?: string
  PostedDate?: string
  PostingStartDate?: string
  ExternalDescriptionStr?: string
  ExternalResponsibilitiesStr?: string
  ExternalQualificationsStr?: string
  HotJobFlag?: boolean
  // Compensation / pay range — Oracle inlines this only for some customers.
  HourlyMinSalary?: number
  HourlyMaxSalary?: number
  OtherCompensation?: string
  PrimaryLocation?: string
  PrimaryLocationCountry?: string
  WorkplaceTypeCode?: string
  RequisitionNumber?: string
  // Apply URL is constructed; the JSON sometimes provides ExternalURL.
  ExternalURL?: string
  workLocation?: OracleLocation
  secondaryLocations?: OracleLocation[]
  requisitionFlexFields?: OracleFlexField[]
}

type OracleRequisitionsResponse = {
  items?: Array<{ requisitionList?: OracleRequisition[]; TotalJobsCount?: number }>
  hasMore?: boolean
  count?: number
}

const POD_HOST_RE = /^([a-z0-9][a-z0-9._-]*)\.oraclecloud\.com$/i
const SITE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function parsePod(host: string): string | null {
  const m = host.toLowerCase().match(POD_HOST_RE)
  if (!m) return null
  const pod = m[1]
  // Marketing / corporate subdomains live on `oraclecloud.com` too.
  if (pod === "www" || pod === "docs" || pod === "support" || pod === "blogs") return null
  return pod
}

function cleanSite(value: string | undefined | null): string | null {
  if (!value) return null
  const v = value.trim()
  return SITE_RE.test(v) ? v : null
}

function encodeSlug(pod: string, site: string): string {
  return `${pod}:${site}`
}

function decodeSlug(slug: string): { pod: string; site: string } | null {
  const idx = slug.lastIndexOf(":")
  if (idx <= 0) return null
  const pod = slug.slice(0, idx)
  const site = slug.slice(idx + 1)
  if (!parsePod(`${pod}.oraclecloud.com`)) return null
  const cleanedSite = cleanSite(site)
  if (!cleanedSite) return null
  return { pod, site: cleanedSite }
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const pod = parsePod(parsed.hostname)
  if (!pod) return null
  // Path looks like /hcmUI/CandidateExperience/{locale}/sites/{site}[/...]
  const parts = parsed.pathname.split("/").filter(Boolean)
  const sitesIdx = parts.findIndex((p) => p.toLowerCase() === "sites")
  if (sitesIdx === -1) return null
  const site = cleanSite(parts[sitesIdx + 1])
  if (!site) return null
  return { slug: encodeSlug(pod, site) }
}

function originFor(pod: string): string {
  return `https://${pod}.oraclecloud.com`
}

function requisitionsUrl(pod: string, site: string, offset: number): string {
  const params = new URLSearchParams({
    onlyData: "true",
    expand: EXPAND_PARAM,
    finder: `findReqs;siteNumber=${site},facetsList=LOCATIONS;TITLES;CATEGORIES,limit=${PAGE_LIMIT},offset=${offset},sortBy=POSTING_DATES_DESC`,
  })
  return `${originFor(pod)}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?${params.toString()}`
}

function applyUrl(pod: string, site: string, requisitionId: string): string {
  return `${originFor(pod)}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(site)}/job/${encodeURIComponent(requisitionId)}`
}

function stripHtml(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const text = value
    .replace(/<\/(p|div|li|br|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
  return text || undefined
}

function flattenLocation(req: OracleRequisition): string | undefined {
  // Prefer the requisition's structured PrimaryLocation string; fall back to
  // the workLocation entity, then the first secondary location.
  if (req.PrimaryLocation?.trim()) return req.PrimaryLocation.trim()
  const wl = req.workLocation
  if (wl?.Name?.trim()) return wl.Name.trim()
  const parts = [wl?.Name, wl?.StateProvince, wl?.CountryName]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
  if (parts.length) return parts.join(", ")
  const sec = req.secondaryLocations?.[0]
  if (sec?.Name?.trim()) return sec.Name.trim()
  return undefined
}

function mapWorkMode(code: string | undefined | null): string | undefined {
  if (!code) return undefined
  const v = code.toUpperCase()
  if (v.includes("REMOTE") || v === "FULL_TIME_REMOTE") return "remote"
  if (v.includes("HYBRID")) return "hybrid"
  return undefined
}

function pickDescription(req: OracleRequisition): string | undefined {
  const parts = [
    req.ExternalDescriptionStr,
    req.ExternalResponsibilitiesStr,
    req.ExternalQualificationsStr,
  ]
    .map((p) => stripHtml(p))
    .filter((p): p is string => Boolean(p))
  if (parts.length === 0) return undefined
  return parts.join("\n\n")
}

function mapRequisitionToJob(req: OracleRequisition, pod: string, site: string): HarvestedJob | null {
  const id =
    typeof req.Id === "string" ? req.Id : typeof req.Id === "number" ? String(req.Id) : req.RequisitionNumber
  if (!id) return null
  const title = req.Title?.trim()
  if (!title) return null
  const url = req.ExternalURL?.trim() || applyUrl(pod, site, id)
  const description = pickDescription(req)
  const location = flattenLocation(req)
  const postedAt =
    typeof req.PostedDate === "string"
      ? new Date(req.PostedDate).toISOString()
      : typeof req.PostingStartDate === "string"
        ? new Date(req.PostingStartDate).toISOString()
        : undefined
  const workMode = mapWorkMode(req.WorkplaceTypeCode)
  return {
    externalId: `oraclecloud:${pod}:${site}:${id}`,
    title,
    applyUrl: url,
    description,
    location,
    postedAt,
    workMode,
    contentHash: hashContent([
      title,
      url,
      location,
      postedAt,
      workMode,
      description?.slice(0, 4_000),
    ]),
  }
}

export function mapResponseToJobs(
  response: OracleRequisitionsResponse,
  pod: string,
  site: string
): HarvestedJob[] {
  // Oracle CE wraps the page in a singleton outer item that holds
  // `requisitionList`. Older pods return a flat array — accept both.
  const jobs: HarvestedJob[] = []
  const items = Array.isArray(response.items) ? response.items : []
  for (const item of items) {
    const list = Array.isArray(item.requisitionList) ? item.requisitionList : []
    for (const req of list) {
      const job = mapRequisitionToJob(req, pod, site)
      if (job) jobs.push(job)
    }
  }
  return jobs
}

export const oraclecloudAdapter: AtsAdapter = {
  name: "oraclecloud",
  // The Oracle CE REST API is fast and per-pod-scoped. Many distinct customer
  // sites share a single pod, so cap to keep one noisy customer from starving
  // others on the same host.
  concurrency: 4,
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    const decoded = decodeSlug(slug)
    if (!decoded) throw new Error(`oraclecloud malformed slug: ${slug}`)
    const { pod, site } = decoded

    const all = new Map<string, HarvestedJob>()
    let latencyMs = 0
    let etag: string | null = null
    let lastModified: string | null = null
    let pagesFetched = 0

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_LIMIT
      const url = requisitionsUrl(pod, site, offset)
      const result = await conditionalFetchJson<OracleRequisitionsResponse>(url, {
        ...ctx,
        etag: null,
        lastModified: null,
      })
      if (result.kind === "error") {
        if (page === 0) {
          const err = new Error(`oraclecloud fetch failed: ${result.reason}`)
          ;(err as Error & { status?: number | null }).status = result.status
          throw err
        }
        break
      }
      if (result.kind === "not_modified") {
        // Defensive: we send no validators above, but if a proxy still returns
        // 304 just exit cleanly with whatever we have.
        if (page === 0) {
          return {
            jobs: [],
            notModified: true,
            etag: result.etag,
            lastModified: result.lastModified,
            sourceAts: "oraclecloud",
            sourceAtsSlug: slug,
            fetchedAt,
            upstreamLatencyMs: result.upstreamLatencyMs,
          }
        }
        break
      }
      pagesFetched += 1
      latencyMs += result.upstreamLatencyMs
      etag ??= result.etag
      lastModified ??= result.lastModified

      const pageJobs = mapResponseToJobs(result.data, pod, site)
      let added = 0
      for (const job of pageJobs) {
        if (all.has(job.externalId)) continue
        all.set(job.externalId, job)
        added += 1
      }
      // Trust the API's `hasMore` flag when present. Some older pods omit it;
      // fall back to "page came back short of the limit" only in that case.
      const hasMoreField = result.data.hasMore
      const hasMore =
        typeof hasMoreField === "boolean" ? hasMoreField : pageJobs.length >= PAGE_LIMIT
      if (!hasMore || added === 0) break
    }

    if (pagesFetched === 0) {
      const err = new Error("oraclecloud fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(all.values()),
      notModified: false,
      etag,
      lastModified,
      sourceAts: "oraclecloud",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Math.max(latencyMs, Date.now() - startedAt),
    }
  },
}

export { decodeSlug, encodeSlug, parsePod, mapRequisitionToJob }

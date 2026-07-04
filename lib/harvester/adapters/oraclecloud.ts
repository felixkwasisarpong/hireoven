import {
  envConcurrency,
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { fetchHtmlConditional } from "@/lib/harvester/adapters/_json-ld"
import pLimit from "p-limit"

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

// Oracle CE honours page sizes up to 200 (values above are clamped to 200
// server-side), so request the max to cut round-trips 4× vs the old 50. With
// MAX_PAGES=60 the ceiling is 200×60 = 12,000 jobs — enough for the largest
// tenants we harvest (JPMorgan ~7,100). Pagination self-stops at
// `TotalJobsCount`, so MAX_PAGES is only a runaway safety cap.
const PAGE_LIMIT = 200
const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_ORACLECLOUD_MAX_PAGES ?? "60", 10)
)
const DETAIL_MAX_JOBS = Math.max(
  0,
  Number.parseInt(process.env.HARVESTER_ORACLECLOUD_DETAIL_MAX_JOBS ?? "100", 10)
)
const DETAIL_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.HARVESTER_ORACLECLOUD_DETAIL_CONCURRENCY ?? "4", 10)
)
const MIN_USEFUL_DESCRIPTION = 200

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
  ShortDescriptionStr?: string
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
// Prefix for slugs backed by a custom (non-oraclecloud.com) hostname.
const CUSTOM_HOST_PREFIX = "custom:"

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

/** Encodes a custom-domain Oracle board into a slug (e.g. careers.autozone.com + jobsearch). */
function encodeCustomSlug(host: string, site: string): string {
  return `${CUSTOM_HOST_PREFIX}${host}:${site}`
}

type DecodedSlug = { identifier: string; site: string; origin: string }

function decodeSlug(slug: string): DecodedSlug | null {
  // Custom-domain slug: "custom:{host}:{site}"
  if (slug.startsWith(CUSTOM_HOST_PREFIX)) {
    const rest = slug.slice(CUSTOM_HOST_PREFIX.length)
    const idx = rest.lastIndexOf(":")
    if (idx <= 0) return null
    const host = rest.slice(0, idx).trim()
    const site = cleanSite(rest.slice(idx + 1))
    if (!site || !host || !host.includes(".")) return null
    return { identifier: host, site, origin: `https://${host}` }
  }
  // Standard pod slug: "{pod}:{site}"
  const idx = slug.lastIndexOf(":")
  if (idx <= 0) return null
  const pod = slug.slice(0, idx)
  const site = slug.slice(idx + 1)
  if (!parsePod(`${pod}.oraclecloud.com`)) return null
  const cleanedSite = cleanSite(site)
  if (!cleanedSite) return null
  return { identifier: pod, site: cleanedSite, origin: `https://${pod}.oraclecloud.com` }
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // Path looks like /hcmUI/CandidateExperience/{locale}/sites/{site}[/...]
  // or the shorter /en/sites/{site}/job/{id} form used on both *.oraclecloud.com
  // and custom-branded Oracle CE portals.
  const parts = parsed.pathname.split("/").filter(Boolean)
  const sitesIdx = parts.findIndex((p) => p.toLowerCase() === "sites")
  if (sitesIdx === -1) return null
  const site = cleanSite(parts[sitesIdx + 1])
  if (!site) return null
  const pod = parsePod(parsed.hostname)
  if (pod) return { slug: encodeSlug(pod, site) }
  // Reject other *.oraclecloud.com subdomains that aren't valid pods (docs, www, etc.)
  if (parsed.hostname.toLowerCase().endsWith(".oraclecloud.com")) return null
  // Custom-branded Oracle portal — require an unambiguous Oracle CE marker so
  // we don't pick up unrelated `/sites/{slug}` paths (e.g. forbes.com/sites/{author}).
  // Valid Oracle CE URLs always carry one of:
  //   - /hcmUI/CandidateExperience/... in the path
  //   - a Candidate-Experience locale segment before /sites/{site}
  //   - a /job/{requisitionId} segment after /sites/{site}
  const lowerPath = parsed.pathname.toLowerCase()
  const hasHcmUi = lowerPath.includes("/hcmui/candidateexperience/")
  const localeBeforeSites =
    sitesIdx > 0 && /^[a-z]{2}(?:[-_][a-z]{2})?$/i.test(parts[sitesIdx - 1])
  const hasJobAfter =
    parts[sitesIdx + 2]?.toLowerCase() === "job" && Boolean(parts[sitesIdx + 3])
  if (!hasHcmUi && !localeBeforeSites && !hasJobAfter) return null
  return { slug: encodeCustomSlug(parsed.hostname, site) }
}

function requisitionsUrl(origin: string, site: string, offset: number): string {
  const params = new URLSearchParams({
    onlyData: "true",
    expand: EXPAND_PARAM,
    finder: `findReqs;siteNumber=${site},facetsList=LOCATIONS;TITLES;CATEGORIES,limit=${PAGE_LIMIT},offset=${offset},sortBy=POSTING_DATES_DESC`,
  })
  return `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?${params.toString()}`
}

function applyUrl(origin: string, site: string, requisitionId: string): string {
  return `${origin}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(site)}/job/${encodeURIComponent(requisitionId)}`
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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;?/gi, "&")
    .replace(/&lt;?/gi, "<")
    .replace(/&gt;?/gi, ">")
    .replace(/&quot;?/gi, '"')
    .replace(/&#39;?/gi, "'")
    .replace(/&apos;?/gi, "'")
    .replace(/&rsquo;?/gi, "'")
    .replace(/&lsquo;?/gi, "'")
    .replace(/&rdquo;?/gi, '"')
    .replace(/&ldquo;?/gi, '"')
    .replace(/&ndash;?/gi, "-")
    .replace(/&mdash;?/gi, "-")
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);?/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10))
    )
}

function readMetaAttribute(tag: string, attr: string): string | undefined {
  const match = tag.match(new RegExp(`${attr}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))
  return match?.[2]
}

export function extractOracleDetailDescriptionFromHtml(html: string): string | undefined {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of metaTags) {
    const key = (readMetaAttribute(tag, "property") ?? readMetaAttribute(tag, "name") ?? "")
      .trim()
      .toLowerCase()
    if (key !== "og:description" && key !== "description") continue
    const content = readMetaAttribute(tag, "content")
    const cleaned = decodeHtmlEntities(content ?? "").replace(/\s+/g, " ").trim()
    if (cleaned.length >= MIN_USEFUL_DESCRIPTION) return cleaned.slice(0, 8_000)
  }
  return undefined
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
  if (parts.length > 0) return parts.join("\n\n")
  // Fall back to ShortDescriptionStr when the full description fields are absent.
  // Many Oracle CE tenants only populate this shorter summary field.
  return stripHtml(req.ShortDescriptionStr)
}

function mapRequisitionToJob(
  req: OracleRequisition,
  identifier: string,
  site: string,
  origin: string
): HarvestedJob | null {
  const id =
    typeof req.Id === "string" ? req.Id : typeof req.Id === "number" ? String(req.Id) : req.RequisitionNumber
  if (!id) return null
  const title = req.Title?.trim()
  if (!title) return null
  const url = req.ExternalURL?.trim() || applyUrl(origin, site, id)
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
    externalId: `oraclecloud:${identifier}:${site}:${id}`,
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
  identifier: string,
  site: string,
  origin: string
): HarvestedJob[] {
  // Oracle CE wraps the page in a singleton outer item that holds
  // `requisitionList`. Older pods return a flat array — accept both.
  const jobs: HarvestedJob[] = []
  const items = Array.isArray(response.items) ? response.items : []
  for (const item of items) {
    const list = Array.isArray(item.requisitionList) ? item.requisitionList : []
    for (const req of list) {
      const job = mapRequisitionToJob(req, identifier, site, origin)
      if (job) jobs.push(job)
    }
  }
  return jobs
}

/**
 * The authoritative job count for the whole board, nested inside the singleton
 * wrapper item (`items[0].TotalJobsCount`). This — NOT the response's top-level
 * `hasMore` (which describes the 1-element outer envelope and is always false) —
 * is what pagination must be driven by. Absent on some older pods.
 */
function totalJobsCount(response: OracleRequisitionsResponse): number | null {
  const items = Array.isArray(response.items) ? response.items : []
  for (const item of items) {
    if (typeof item.TotalJobsCount === "number") return item.TotalJobsCount
  }
  return null
}

async function enrichMissingDescriptions(
  jobs: HarvestedJob[],
  ctx: HarvestCtx
): Promise<void> {
  if (DETAIL_MAX_JOBS === 0) return
  const alreadyDescribed = ctx.alreadyDescribedIds
  const targets = jobs
    .filter((job) => (job.description?.length ?? 0) < MIN_USEFUL_DESCRIPTION)
    .filter((job) => !alreadyDescribed?.has(job.externalId))
    .slice(0, DETAIL_MAX_JOBS)
  if (targets.length === 0) return

  const limiter = pLimit(DETAIL_CONCURRENCY)
  await Promise.all(
    targets.map((job) =>
      limiter(async () => {
        const result = await fetchHtmlConditional(
          job.applyUrl,
          { ...ctx, etag: null, lastModified: null },
          { maxAttempts: 2 }
        )
        if (result.kind !== "ok") return
        const description = extractOracleDetailDescriptionFromHtml(result.html)
        if (!description || description.length <= (job.description?.length ?? 0)) return
        job.description = description
        job.contentHash = hashContent([
          job.title,
          job.applyUrl,
          job.location,
          job.postedAt,
          job.workMode,
          description.slice(0, 4_000),
        ])
      })
    )
  )
}

export const oraclecloudAdapter: AtsAdapter = {
  name: "oraclecloud",
  // The Oracle CE REST API is fast and per-pod-scoped. Many distinct customer
  // sites share a single pod, so cap to keep one noisy customer from starving
  // others on the same host.
  concurrency: envConcurrency("oraclecloud", 4),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    const decoded = decodeSlug(slug)
    if (!decoded) throw new Error(`oraclecloud malformed slug: ${slug}`)
    const { identifier, site, origin } = decoded

    const all = new Map<string, HarvestedJob>()
    let latencyMs = 0
    let etag: string | null = null
    let lastModified: string | null = null
    let pagesFetched = 0

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_LIMIT
      const url = requisitionsUrl(origin, site, offset)
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

      const pageJobs = mapResponseToJobs(result.data, identifier, site, origin)
      let added = 0
      for (const job of pageJobs) {
        if (all.has(job.externalId)) continue
        all.set(job.externalId, job)
        added += 1
      }
      // Paginate by the board's real job count (`items[0].TotalJobsCount`).
      // The response's top-level `hasMore` refers to the singleton OUTER
      // envelope (always false), so trusting it truncated every multi-page
      // tenant to the first 50. Fall back to "page came back full" only when
      // the count is absent (older pods).
      const totalJobs = totalJobsCount(result.data)
      const hasMore =
        totalJobs != null ? all.size < totalJobs : pageJobs.length >= PAGE_LIMIT
      if (!hasMore || added === 0) break
    }

    if (pagesFetched === 0) {
      const err = new Error("oraclecloud fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    const jobs = Array.from(all.values())
    await enrichMissingDescriptions(jobs, ctx)

    return {
      jobs,
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

export { CUSTOM_HOST_PREFIX, decodeSlug, encodeSlug, encodeCustomSlug, parsePod, mapRequisitionToJob }

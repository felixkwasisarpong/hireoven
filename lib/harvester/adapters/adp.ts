import pLimit from "p-limit"
import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { harvesterFetch } from "@/lib/harvester/http-agent"

/**
 * ADP WorkforceNow public career center adapter.
 *
 * ADP WFN career sites expose a public, unauthenticated staffing API:
 *   GET .../careercenter/public/events/staffing/v1/job-requisitions
 *         ?cid={cid}&locale=en_US&$top=N&$skip=M
 * returns { jobRequisitions: [...], meta: { totalNumber, links: [...] } }.
 *
 * Per-job description lives behind a detail call:
 *   GET .../job-requisitions/{itemID}?cid={cid}&locale=en_US
 * which adds `requisitionDescription` (HTML).
 *
 * Locations are NOT inline on the list rows — they arrive in `meta.links` as a
 * LOCATION schema mapping itemID -> human-readable location string.
 *
 * Apply URL is the canonical WFN recruitment deep-link:
 *   .../mdf/recruitment/recruitment.html?cid={cid}&ccId={ccId}&jobId={ExternalJobID}&lang=en_US
 *
 * ats_identifier (slug) round-trips both ids: `{cid}:{ccId}`. ccId is optional
 * (defaults to ADP's near-universal "19000101_000001") so `{cid}` alone works.
 */

const API_ROOT =
  "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1"
const RECRUITMENT_URL =
  "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html"
const DEFAULT_CCID = "19000101_000001"
const PAGE_SIZE = 50

function intEnv(name: string, dflt: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

const MAX_PAGES = intEnv("HARVESTER_ADP_MAX_PAGES", 40)
const DETAIL_MAX_JOBS = intEnv("HARVESTER_ADP_DETAIL_MAX_JOBS", 100)
const DETAIL_CONCURRENCY = intEnv("HARVESTER_ADP_DETAIL_CONCURRENCY", 4)

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

type AdpNameCode = { codeValue?: string; shortName?: string }
type AdpStringField = { stringValue?: string; nameCode?: AdpNameCode }
type AdpRequisitionLocation = {
  address?: {
    cityName?: string
    countrySubdivisionLevel1?: { codeValue?: string }
    countryCode?: string
    postalCode?: string
  }
  nameCode?: AdpNameCode
}
type AdpRequisition = {
  itemID?: string
  requisitionTitle?: string
  postDate?: string
  clientRequisitionID?: string
  workLevelCode?: { shortName?: string }
  requisitionDescription?: string
  requisitionLocations?: AdpRequisitionLocation[]
  customFieldGroup?: { stringFields?: AdpStringField[] }
}
type AdpLink = {
  schema?: string
  payLoadArguments?: Array<{ argumentPath?: string; argumentValue?: string }>
}
type AdpListResponse = {
  jobRequisitions?: AdpRequisition[]
  meta?: { totalNumber?: number; links?: AdpLink[] }
}
type AdpDetailResponse = AdpRequisition

type ParsedSlug = { cid: string; ccId: string }

function parseSlug(slug: string): ParsedSlug | null {
  const [cid, ccId] = slug.split(":")
  if (!cid || !/^[a-f0-9-]{8,}$/i.test(cid)) return null
  return { cid, ccId: ccId && ccId.trim() ? ccId.trim() : DEFAULT_CCID }
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!/(^|\.)workforcenow\.adp\.com$/i.test(parsed.hostname)) return null
  const cid = parsed.searchParams.get("cid")
  if (!cid || !/^[a-f0-9-]{8,}$/i.test(cid)) return null
  const ccId = parsed.searchParams.get("ccId")
  return { slug: ccId ? `${cid}:${ccId}` : cid }
}

function listUrl(cid: string, skip: number): string {
  return (
    `${API_ROOT}/job-requisitions` +
    `?cid=${encodeURIComponent(cid)}&timeZoneId=America/New_York&locale=en_US` +
    `&$top=${PAGE_SIZE}&$skip=${skip}`
  )
}

function detailUrl(cid: string, itemID: string): string {
  return `${API_ROOT}/job-requisitions/${encodeURIComponent(itemID)}?cid=${encodeURIComponent(cid)}&locale=en_US`
}

function stringField(req: AdpRequisition, code: string): string | undefined {
  const f = req.customFieldGroup?.stringFields?.find(
    (s) => s.nameCode?.codeValue === code
  )
  return f?.stringValue?.trim() || undefined
}

/** itemID -> location string, harvested from the list payload's meta.links. */
function buildLocationMap(links: AdpLink[] | undefined): Map<string, string> {
  const map = new Map<string, string>()
  for (const link of links ?? []) {
    if (link.schema !== "LOCATION") continue
    for (const arg of link.payLoadArguments ?? []) {
      if (arg.argumentPath && arg.argumentValue?.trim()) {
        map.set(arg.argumentPath, arg.argumentValue.trim())
      }
    }
  }
  return map
}

function locationFromRequisition(req: AdpRequisition): string | undefined {
  const loc = req.requisitionLocations?.[0]?.address
  if (!loc) return undefined
  const parts = [
    loc.cityName?.trim(),
    loc.countrySubdivisionLevel1?.codeValue?.trim(),
    loc.countryCode?.trim(),
  ].filter((p): p is string => Boolean(p))
  return parts.length > 0 ? parts.join(", ") : undefined
}

function mapEmploymentType(shortName: string | undefined): string | undefined {
  if (!shortName) return undefined
  const v = shortName.toLowerCase()
  if (v.includes("intern")) return "internship"
  if (v.includes("full")) return "full-time"
  if (v.includes("part")) return "part-time"
  if (v.includes("contract") || v.includes("temp")) return "contract"
  return shortName
}

function stripHtml(html: string | undefined | null): string | undefined {
  if (!html) return undefined
  return (
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|br|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || undefined
  )
}

function buildApplyUrl(parsed: ParsedSlug, externalJobId: string | undefined): string {
  const base = `${RECRUITMENT_URL}?cid=${encodeURIComponent(parsed.cid)}&ccId=${encodeURIComponent(parsed.ccId)}&lang=en_US`
  return externalJobId ? `${base}&jobId=${encodeURIComponent(externalJobId)}` : base
}

async function fetchJson<T>(url: string, ctx: HarvestCtx): Promise<T | null> {
  const doFetch = ctx.fetchImpl ?? harvesterFetch
  try {
    const resp = await doFetch(url, {
      headers: { "user-agent": BROWSER_UA, accept: "application/json" },
    })
    if (!resp.ok) return null
    return (await resp.json()) as T
  } catch {
    return null
  }
}

function mapRequisition(
  req: AdpRequisition,
  parsed: ParsedSlug,
  locationMap: Map<string, string>
): HarvestedJob | null {
  const itemID = req.itemID?.trim()
  const title = req.requisitionTitle?.trim().replace(/-\s*$/, "").trim()
  if (!itemID || !title) return null

  const externalJobId = stringField(req, "ExternalJobID") ?? req.clientRequisitionID
  const applyUrl = buildApplyUrl(parsed, externalJobId)
  const location = locationMap.get(itemID) ?? locationFromRequisition(req)
  const employmentType = mapEmploymentType(req.workLevelCode?.shortName)
  const postedAt = req.postDate ? new Date(req.postDate).toISOString() : undefined

  return {
    // cid scopes the id so two ADP tenants can't collide on itemID.
    externalId: `adp:${parsed.cid}:${itemID}`,
    title,
    applyUrl,
    location,
    employmentType,
    postedAt,
    contentHash: hashContent([title, applyUrl, location, employmentType, postedAt]),
  }
}

export const adpAdapter: AtsAdapter = {
  name: "adp",
  concurrency: envConcurrency("adp", 3),
  detectFromUrl,

  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const startedAt = Date.now()
    const parsed = parseSlug(slug)
    if (!parsed) throw new Error(`adp: invalid slug "${slug}"`)

    const byId = new Map<string, HarvestedJob>()
    const itemIdByExternalId = new Map<string, string>()
    let total = Infinity

    for (let page = 0; page < MAX_PAGES; page++) {
      const skip = page * PAGE_SIZE
      if (skip >= total) break
      const data = await fetchJson<AdpListResponse>(listUrl(parsed.cid, skip), ctx)
      if (!data) {
        if (page === 0) {
          const err = new Error(`adp: list page 0 unreachable for ${parsed.cid}`)
          ;(err as Error & { status?: number | null }).status = null
          throw err
        }
        break
      }
      total = data.meta?.totalNumber ?? total
      const locationMap = buildLocationMap(data.meta?.links)
      const reqs = data.jobRequisitions ?? []
      if (reqs.length === 0) break
      for (const req of reqs) {
        const job = mapRequisition(req, parsed, locationMap)
        if (job && !byId.has(job.externalId)) {
          byId.set(job.externalId, job)
          if (req.itemID) itemIdByExternalId.set(job.externalId, req.itemID)
        }
      }
    }

    const allJobs = Array.from(byId.values())

    // Enrich with full descriptions (bounded per cycle).
    const needDetail = ctx.alreadyDescribedIds
      ? allJobs.filter((j) => !ctx.alreadyDescribedIds!.has(j.externalId))
      : allJobs

    if (DETAIL_MAX_JOBS > 0 && needDetail.length > 0) {
      const limiter = pLimit(DETAIL_CONCURRENCY)
      await Promise.all(
        needDetail.slice(0, DETAIL_MAX_JOBS).map((job) =>
          limiter(async () => {
            const itemID = itemIdByExternalId.get(job.externalId)
            if (!itemID) return
            const detail = await fetchJson<AdpDetailResponse>(
              detailUrl(parsed.cid, itemID),
              ctx
            )
            const description = stripHtml(detail?.requisitionDescription)
            // Some tenants only expose structured locations on the detail row.
            const location = job.location ?? (detail ? locationFromRequisition(detail) : undefined)
            if (description || location !== job.location) {
              byId.set(job.externalId, {
                ...job,
                description: description ?? job.description,
                location,
                contentHash: hashContent([
                  job.title,
                  job.applyUrl,
                  location,
                  job.employmentType,
                  job.postedAt,
                  (description ?? job.description)?.slice(0, 2_000),
                ]),
              })
            }
          })
        )
      )
    }

    return {
      jobs: Array.from(byId.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "adp",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: Date.now() - startedAt,
    }
  },
}

export { detectFromUrl, parseSlug }

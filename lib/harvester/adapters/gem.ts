import {
  envConcurrency,
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Gem public GraphQL job board.
 *
 *   POST https://jobs.gem.com/api/public/graphql/batch
 *
 * Gem boards live at `https://jobs.gem.com/{slug}` where `{slug}` is the
 * board id (kebab-case). Unlike most ATSes the board is PATH-based, not a
 * subdomain — every board shares the same `jobs.gem.com` host.
 *
 * The endpoint is a GraphQL *batch* endpoint: the request body is a JSON
 * array of operations, and the response is a JSON array of results in the
 * same order. We send a single `JobBoardList` operation and read the first
 * (only) result. The list query returns id/extId/title/locations/department/
 * employmentType — enough for a v1 listing harvest.
 *
 * Descriptions + posted-date live on a separate `ExternalJobPostingQuery`
 * detail op (see tools/jobhive-ts/ref/gem.py). Like workday we defer that to
 * a background enrichment pass and emit listing-only jobs here.
 */

const BASE_URL = "https://jobs.gem.com"
const GRAPHQL_URL = `${BASE_URL}/api/public/graphql/batch`

// Copied verbatim from tools/jobhive-ts/ref/gem.py (JOB_BOARD_LIST_QUERY).
const JOB_BOARD_LIST_QUERY = `
query JobBoardList($boardId: String!) {
  oatsExternalJobPostings(boardId: $boardId) {
    jobPostings {
      id
      extId
      title
      locations { id name city isoCountry isRemote extId __typename }
      job {
        id
        department { id name extId __typename }
        locationType
        employmentType
        __typename
      }
      __typename
    }
    __typename
  }
}
`

type GemLocation = {
  id?: string
  extId?: string
  name?: string
  city?: string
  isoCountry?: string
  isRemote?: boolean
}

type GemJobInner = {
  id?: string
  locationType?: string
  employmentType?: string
  department?: { id?: string; name?: string; extId?: string } | null
}

type GemPosting = {
  id?: string
  extId?: string
  title?: string
  locations?: GemLocation[] | null
  job?: GemJobInner | null
}

type GemBatchResult = {
  data?: {
    oatsExternalJobPostings?: {
      jobPostings?: GemPosting[] | null
    } | null
  } | null
  errors?: Array<{ message?: string }> | null
}

// Gem's batch endpoint returns an array of results, one per operation sent.
type GemBatchResponse = GemBatchResult[]

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  FULL_TIME: "FULL_TIME",
  FULLTIME: "FULL_TIME",
  PART_TIME: "PART_TIME",
  PARTTIME: "PART_TIME",
  CONTRACT: "CONTRACT",
  CONTRACTOR: "CONTRACT",
  TEMPORARY: "TEMPORARY",
  TEMP: "TEMPORARY",
  INTERN: "INTERN",
  INTERNSHIP: "INTERN",
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // Gem is path-based: https://jobs.gem.com/{slug}
  if (parsed.hostname.toLowerCase() !== "jobs.gem.com") return null
  const first = parsed.pathname
    .split("/")
    .map((p) => decodeURIComponent(p).trim())
    .filter(Boolean)[0]
  if (!first) return null
  // Reserved first-path segments that are not board slugs.
  if (first === "api") return null
  return { slug: first }
}

function batchPayload(slug: string): string {
  return JSON.stringify([
    {
      operationName: "JobBoardList",
      variables: { boardId: slug },
      query: JOB_BOARD_LIST_QUERY,
    },
  ])
}

function pickLocation(locations: GemLocation[] | null | undefined): string | undefined {
  if (!locations || locations.length === 0) return undefined
  const first = locations[0]
  const parts = [first.city, first.isoCountry].map((p) => p?.trim()).filter(Boolean)
  if (parts.length) return parts.join(", ")
  return first.name?.trim() || undefined
}

function pickWorkMode(locations: GemLocation[] | null | undefined): string | undefined {
  if (!locations || locations.length === 0) return undefined
  for (const loc of locations) {
    if (loc?.isRemote === true) return "remote"
  }
  return undefined
}

function mapEmploymentType(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  return EMPLOYMENT_TYPE_MAP[value.toUpperCase()] ?? undefined
}

function mapRawJob(slug: string, raw: GemPosting): HarvestedJob | null {
  const extId = raw.extId ?? raw.id
  const title = raw.title?.trim()
  if (!extId || !title) return null

  const applyUrl = `${BASE_URL}/${slug}/${extId}`
  const location = pickLocation(raw.locations)
  const workMode = pickWorkMode(raw.locations)
  const employmentType = mapEmploymentType(raw.job?.employmentType)

  const contentHash = hashContent([
    title,
    applyUrl,
    location,
    workMode,
    employmentType,
    raw.job?.department?.name,
  ])

  return {
    externalId: `gem:${extId}`,
    title,
    applyUrl,
    location,
    workMode,
    employmentType,
    contentHash,
  }
}

export const gemAdapter: AtsAdapter = {
  name: "gem",
  concurrency: envConcurrency("gem", 6),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const result = await conditionalFetchJson<GemBatchResponse>(GRAPHQL_URL, ctx, {
      method: "POST",
      body: batchPayload(slug),
    })

    if (result.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: result.etag,
        lastModified: result.lastModified,
        sourceAts: "gem",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }
    if (result.kind === "error") {
      const err = new Error(`gem fetch failed: ${result.reason}`)
      ;(err as Error & { status?: number | null }).status = result.status
      throw err
    }

    // Batch endpoint → array of results, one per op sent. We sent one op.
    const batch = Array.isArray(result.data) ? result.data : []
    const first = batch[0] ?? {}
    if (first.errors && first.errors.length > 0) {
      const err = new Error(
        `gem board not found for "${slug}": ${first.errors[0]?.message ?? "graphql error"}`
      )
      ;(err as Error & { status?: number | null }).status = 404
      throw err
    }

    const postings = first.data?.oatsExternalJobPostings?.jobPostings ?? []
    const jobs: HarvestedJob[] = []
    for (const raw of postings) {
      if (!raw || typeof raw !== "object") continue
      const mapped = mapRawJob(slug, raw)
      if (mapped) jobs.push(mapped)
    }

    return {
      jobs,
      notModified: false,
      // GraphQL POST doesn't honor If-None-Match; don't persist conditional headers.
      etag: null,
      lastModified: null,
      sourceAts: "gem",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}

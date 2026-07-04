import {
  conditionalFetchJson,
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * IBM (careers.ibm.com) HTTP adapter.
 *
 * IBM runs a custom, JS-rendered careers site, but it's backed by a clean,
 * unauthenticated Elasticsearch endpoint:
 *   POST https://www-api.ibm.com/search/api/v2
 *   { appId:"careers", scopes:["careers2"], query:{bool:{must:[]}},
 *     _source:[…required fields…], size:100, from:N, sort:[{_score:"desc"}] }
 *   → { hits:{ total:{value}, hits:[ {_id,_source:{title,url,description,…}} ] } }
 *
 * The `_source` field list is REQUIRED — omit it and ES returns empty sources.
 * Paginate via `from`; the whole index is ~900 jobs (9 pages). Verified live
 * with just content-type (no auth).
 *
 * Tunables:
 *   HARVESTER_IBM_MAX_PAGES     (default 60 → 6000 jobs)
 *   HARVESTER_IBM_PAGE_DELAY_MS (default 150)
 */

const IBM_HOST_RE = /^https?:\/\/(?:(?:www\.)?ibm\.com\/careers|careers\.ibm\.com)/i
const ENDPOINT = "https://www-api.ibm.com/search/api/v2"
const PAGE_SIZE = 100
// field_keyword_17 = work style (Remote/Hybrid/On-site), _19 = location.
const SOURCE_FIELDS = ["_id", "title", "url", "description", "field_keyword_17", "field_keyword_18", "field_keyword_19"]

function intEnv(name: string, dflt: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(n) && n >= min ? n : dflt
}
const MAX_PAGES = intEnv("HARVESTER_IBM_MAX_PAGES", 60, 1)
const PAGE_DELAY_MS = intEnv("HARVESTER_IBM_PAGE_DELAY_MS", 150, 0)

type IbmSource = {
  title?: string
  url?: string
  description?: string
  field_keyword_17?: string
  field_keyword_18?: string
  field_keyword_19?: string
}
type IbmHit = { _id?: string; _source?: IbmSource }
type IbmResponse = { hits?: { total?: { value?: number }; hits?: IbmHit[] } }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildBody(from: number): string {
  return JSON.stringify({
    appId: "careers",
    scopes: ["careers2"],
    query: { bool: { must: [] } },
    _source: SOURCE_FIELDS,
    size: PAGE_SIZE,
    from,
    // Match the payload the careers site sends (lang:"zz" = all languages; `sm`
    // is the site's search-metadata echo). Coverage is identical to the minimal
    // form (~900 jobs) but this stays in lockstep with the official request.
    sort: [{ _score: "desc" }, { pageviews: "desc" }],
    lang: "zz",
    sm: { query: "", lang: "zz" },
  })
}

function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined
  const out = s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
  return out || undefined
}

export function mapHit(hit: IbmHit): HarvestedJob | null {
  const s = hit._source
  if (!s) return null
  const title = (s.title ?? "").trim()
  const url = (s.url ?? "").trim()
  if (!title || !url) return null
  const jobId = url.match(/[?&]jobId=(\d+)/)?.[1] || hit._id || url
  const location = s.field_keyword_19?.trim() || undefined
  const description = stripHtml(s.description)
  const ws = s.field_keyword_17?.trim()
  const workMode = ws && /^(remote|hybrid|on-?site)$/i.test(ws) ? ws : undefined
  return {
    externalId: `ibm:${jobId}`,
    title,
    applyUrl: url,
    location,
    description,
    workMode,
    contentHash: hashContent([title, url, location, workMode, description?.slice(0, 4_000)]),
  }
}

export const ibmAdapter: AtsAdapter = {
  name: "ibm",
  concurrency: envConcurrency("ibm", 1),
  detectFromUrl(url) {
    if (!IBM_HOST_RE.test(url)) return null
    return { slug: "ibm" }
  },
  async fetchJobs({ ctx }): Promise<HarvestResult> {
    const startedAt = Date.now()
    const jobs = new Map<string, HarvestedJob>()
    let upstreamLatencyMs = 0
    let anyOk = false

    const reqCtx: HarvestCtx = {
      ...ctx,
      etag: null,
      lastModified: null,
      timeoutMs: Math.max(ctx.timeoutMs ?? 0, 15_000),
    }

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE
      if (page > 0 && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)

      const res = await conditionalFetchJson<IbmResponse>(ENDPOINT, reqCtx, {
        method: "POST",
        body: buildBody(from),
        maxAttempts: 3,
      })
      if (res.kind !== "ok") {
        if (page === 0) {
          const err = new Error(`ibm fetch failed: ${res.kind === "error" ? res.reason : res.kind}`)
          ;(err as Error & { status?: number | null }).status = res.kind === "error" ? res.status : null
          throw err
        }
        break
      }
      anyOk = true
      upstreamLatencyMs += res.upstreamLatencyMs

      const total = res.data.hits?.total?.value ?? 0
      const batch = res.data.hits?.hits ?? []
      if (batch.length === 0) break

      let added = 0
      for (const hit of batch) {
        const job = mapHit(hit)
        if (!job || jobs.has(job.externalId)) continue
        jobs.set(job.externalId, job)
        added += 1
      }
      if (added === 0) break
      if (from + PAGE_SIZE >= total) break
    }

    if (!anyOk) {
      const err = new Error("ibm fetch failed: no pages fetched")
      ;(err as Error & { status?: number | null }).status = null
      throw err
    }

    return {
      jobs: Array.from(jobs.values()),
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "ibm",
      sourceAtsSlug: "ibm",
      fetchedAt: new Date(),
      upstreamLatencyMs: upstreamLatencyMs || Date.now() - startedAt,
    }
  },
}

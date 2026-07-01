import {
  envConcurrency,
  conditionalFetchJson,
  hashContent,
  type AtsAdapter,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Teamtailor public jobs JSON.
 *   https://{slug}.teamtailor.com/jobs.json
 *
 * Subdomain-based. Some installations also use vanity domains via CNAME — we
 * can only discover those via custom-domain crawling, not crt.sh. JSON-LD
 * scraping of the public career page is the official fallback for
 * installations that disable /jobs.json; deferred until profiling shows we
 * need it.
 */

/**
 * `/jobs.json` is a JSON Feed 1.1 document — jobs are under `items`, each with a
 * schema.org `_jobposting` extension carrying structured location / date /
 * employment-type. (The older `{ jobs: [...] }` shape this adapter used to parse
 * never actually existed on this endpoint, so it returned zero jobs on every
 * board.)
 */
type SchemaPlace = {
  address?: {
    addressLocality?: string
    addressRegion?: string
    addressCountry?: string
  }
}
type SchemaJobPosting = {
  employmentType?: string | string[]
  datePosted?: string
  jobLocationType?: string
  jobLocation?: SchemaPlace | SchemaPlace[]
}
type TeamtailorItem = {
  id?: string | number
  title?: string
  url?: string
  content_html?: string
  content_text?: string
  date_published?: string
  date_modified?: string
  _jobposting?: SchemaJobPosting
}

type TeamtailorResponse = {
  items?: TeamtailorItem[]
}

function endpointFor(slug: string): string {
  return `https://${encodeURIComponent(slug)}.teamtailor.com/jobs.json`
}

// Teamtailor's own platform/infrastructure subdomains are not customer career
// boards. Cert enumeration of teamtailor.com surfaces dozens of these (assets,
// eu-render, tt-parser-ecs, auth-tests, …); they return no jobs and only waste
// harvest cycles. Reject them so discovery can't re-ingest them as companies.
const RESERVED_TEAMTAILOR_SUBDOMAINS = new Set([
  "www", "app", "api", "assets", "static", "cdn", "dashboard", "docs", "get",
  "hello", "web", "partner", "trust", "discover", "highlights", "updates",
  "refer", "resources", "shipit", "talentnote", "errors", "errors-wl",
  "finance-integrations", "extssl", "eu", "eu2", "na", "au", "ext", "career2",
])

function isReservedTeamtailorSubdomain(slug: string): boolean {
  if (RESERVED_TEAMTAILOR_SUBDOMAINS.has(slug)) return true
  // Region / environment / internal-service families.
  if (/^(analytics|insights|eu|ext|na|staging|auth)(-|$)/.test(slug)) return true
  if (/^tt-/.test(slug)) return true
  if (/-(test|tests|staging|aws|ro|wo|ecs|assets)$/.test(slug)) return true
  return false
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const m = host.match(/^([a-z0-9-]+)\.teamtailor\.com$/)
  if (!m) return null
  const slug = m[1]
  if (isReservedTeamtailorSubdomain(slug)) return null
  return { slug }
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

function pickLocation(raw: TeamtailorItem): string | undefined {
  const jl = raw._jobposting?.jobLocation
  const first = Array.isArray(jl) ? jl[0] : jl
  const addr = first?.address
  if (!addr) return undefined
  const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
  // De-dupe (locality and region are frequently identical, e.g. "Malmö, Malmö").
  const seen = new Set<string>()
  const deduped = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
  return deduped.length ? deduped.join(", ") : undefined
}

function pickWorkMode(raw: TeamtailorItem): string | undefined {
  const type = raw._jobposting?.jobLocationType?.toUpperCase()
  if (type === "TELECOMMUTE") return "remote"
  return undefined
}

// schema.org employmentType → our convention (already close: FULL_TIME / PART_TIME
// / CONTRACTOR / INTERN / TEMPORARY / OTHER). Normalize CONTRACTOR → CONTRACT.
function pickEmploymentType(raw: TeamtailorItem): string | undefined {
  const et = raw._jobposting?.employmentType
  const value = (Array.isArray(et) ? et[0] : et)?.trim().toUpperCase()
  if (!value) return undefined
  if (value === "CONTRACTOR") return "CONTRACT"
  return value
}

function mapRawJob(slug: string, raw: TeamtailorItem): HarvestedJob | null {
  if (!raw.id || !raw.title) return null

  const description = stripHtml(raw.content_html) ?? stripHtml(raw.content_text)
  const applyUrl =
    raw.url?.trim() || `https://${slug}.teamtailor.com/jobs/${raw.id}`
  const location = pickLocation(raw)
  const postedAt = raw.date_published ?? raw._jobposting?.datePosted ?? undefined
  const workMode = pickWorkMode(raw)
  const employmentType = pickEmploymentType(raw)

  const contentHash = hashContent([
    raw.title,
    applyUrl,
    location,
    postedAt,
    workMode,
    employmentType,
    description?.slice(0, 4_000),
  ])

  return {
    externalId: `teamtailor:${raw.id}`,
    title: raw.title.trim(),
    applyUrl,
    description,
    location,
    postedAt,
    workMode,
    employmentType,
    contentHash,
  }
}

export const teamtailorAdapter: AtsAdapter = {
  name: "teamtailor",
  concurrency: envConcurrency("teamtailor", 8),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const result = await conditionalFetchJson<TeamtailorResponse>(endpointFor(slug), ctx)

    if (result.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: result.etag,
        lastModified: result.lastModified,
        sourceAts: "teamtailor",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }
    if (result.kind === "error") {
      const err = new Error(`teamtailor fetch failed: ${result.reason}`)
      ;(err as Error & { status?: number | null }).status = result.status
      throw err
    }

    const rawItems = result.data?.items ?? []
    const jobs: HarvestedJob[] = []
    for (const raw of rawItems) {
      const mapped = mapRawJob(slug, raw)
      if (mapped) jobs.push(mapped)
    }

    return {
      jobs,
      notModified: false,
      etag: result.etag,
      lastModified: result.lastModified,
      sourceAts: "teamtailor",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}

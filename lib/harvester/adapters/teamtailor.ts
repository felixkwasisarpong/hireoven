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

type TeamtailorJob = {
  id?: string | number
  title?: string
  pitch?: string
  body?: string
  apply_url?: string
  full_url?: string
  url?: string
  location?: { name?: string; city?: string; country?: string; remote_status?: string }
  remote_status?: string
  department?: { name?: string }
  role?: { name?: string }
  employment_type?: string
  language?: string
  created_at?: string
  published_at?: string
  status?: string
}

type TeamtailorResponse = {
  jobs?: TeamtailorJob[]
}

function endpointFor(slug: string): string {
  return `https://${encodeURIComponent(slug)}.teamtailor.com/jobs.json`
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
  if (slug === "www" || slug === "app" || slug === "api") return null
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

function pickLocation(raw: TeamtailorJob): string | undefined {
  const loc = raw.location
  if (!loc) return undefined
  if (loc.name?.trim()) return loc.name.trim()
  const parts = [loc.city, loc.country].map((p) => p?.trim()).filter(Boolean)
  return parts.length ? parts.join(", ") : undefined
}

function pickWorkMode(raw: TeamtailorJob): string | undefined {
  const status = (raw.remote_status ?? raw.location?.remote_status ?? "").toLowerCase()
  if (!status) return undefined
  if (status.includes("remote")) return "remote"
  if (status.includes("hybrid")) return "hybrid"
  return undefined
}

function mapRawJob(slug: string, raw: TeamtailorJob): HarvestedJob | null {
  if (!raw.id || !raw.title) return null
  if (raw.status && raw.status.toLowerCase() !== "published") return null

  const description = [stripHtml(raw.pitch), stripHtml(raw.body)]
    .filter((s): s is string => Boolean(s))
    .join("\n\n") || undefined
  const applyUrl =
    raw.apply_url?.trim() ||
    raw.full_url?.trim() ||
    raw.url?.trim() ||
    `https://${slug}.teamtailor.com/jobs/${raw.id}`
  const location = pickLocation(raw)
  const postedAt = raw.published_at ?? raw.created_at ?? undefined
  const workMode = pickWorkMode(raw)

  const contentHash = hashContent([
    raw.title,
    applyUrl,
    location,
    postedAt,
    workMode,
    raw.employment_type,
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
    employmentType: raw.employment_type ?? undefined,
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

    const rawJobs = result.data?.jobs ?? []
    const jobs: HarvestedJob[] = []
    for (const raw of rawJobs) {
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

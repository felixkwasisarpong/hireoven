import {
  envConcurrency,
  hashContent,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"

/**
 * Personio public XML feed.
 *   https://{slug}.jobs.personio.com/xml
 *
 * Returns a `<workzag-jobs>` (or `<positions>`) root with `<position>` blocks.
 * Each position has id, name, schedule, office, department, employmentType,
 * createdAt, and 1+ `<jobDescription>` segments with `<name>` and `<value>`.
 *
 * No deps for XML — Personio's shape is stable enough for a regex pass over
 * the fields we need. Schedule is the only tag with nested CDATA; everything
 * else is plain text or HTML inside CDATA.
 */

const DEFAULT_USER_AGENT = "hireoven-harvester/1.0 (+bot@hireoven.com)"
const DEFAULT_TIMEOUT_MS = 15_000

function endpointFor(slug: string): string {
  return `https://${encodeURIComponent(slug)}.jobs.personio.com/xml`
}

function detectFromUrl(url: string): { slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const m = host.match(/^([a-z0-9-]+)\.jobs\.personio\.(com|de)$/)
  if (!m) return null
  const slug = m[1]
  if (slug === "www") return null
  return { slug }
}

function unCdata(value: string): string {
  return value
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim()
}

function extractTag(block: string, tag: string): string | null {
  // Tolerate optional whitespace and CDATA wrapping.
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i")
  const match = block.match(re)
  if (!match) return null
  return unCdata(match[1]).trim() || null
}

function extractAllTags(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi")
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) {
    const value = unCdata(m[1]).trim()
    if (value) out.push(value)
  }
  return out
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

function buildDescriptionFromBlock(block: string): string | undefined {
  // Personio nests <jobDescription> entries with <name> + <value>; concatenate them.
  const descriptionRe = /<jobDescription>([\s\S]*?)<\/jobDescription>/gi
  const segments: string[] = []
  let m: RegExpExecArray | null
  while ((m = descriptionRe.exec(block)) !== null) {
    const inner = m[1]
    const name = extractTag(inner, "name")
    const value = stripHtml(extractTag(inner, "value"))
    if (name && value) segments.push(`${name}\n${value}`)
    else if (value) segments.push(value)
  }
  const combined = segments.join("\n\n").trim()
  return combined || undefined
}

function extractPositions(xml: string): string[] {
  // Each <position>...</position> block; preserve their inner content.
  const re = /<position>([\s\S]*?)<\/position>/gi
  const blocks: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    blocks.push(m[1])
  }
  return blocks
}

function mapPosition(slug: string, block: string): HarvestedJob | null {
  const id = extractTag(block, "id")
  const title = extractTag(block, "name")
  if (!id || !title) return null

  const offices = extractAllTags(block, "office")
  const location = offices.join(", ") || extractTag(block, "office") || undefined
  const postedAt = extractTag(block, "createdAt") ?? undefined
  const employmentType = extractTag(block, "employmentType") ?? undefined
  const schedule = extractTag(block, "schedule") ?? undefined
  const description = buildDescriptionFromBlock(block)

  const applyUrl = `https://${slug}.jobs.personio.com/job/${encodeURIComponent(id)}`

  const contentHash = hashContent([
    title,
    applyUrl,
    location,
    postedAt,
    employmentType,
    schedule,
    description?.slice(0, 4_000),
  ])

  return {
    externalId: `personio:${id}`,
    title,
    applyUrl,
    description,
    location,
    postedAt,
    workMode: schedule?.toLowerCase().includes("remote") ? "remote" : undefined,
    employmentType,
    contentHash,
  }
}

async function fetchXml(url: string, ctx: HarvestCtx): Promise<{ kind: "ok"; text: string; etag: string | null; lastModified: string | null; upstreamLatencyMs: number } | { kind: "not_modified"; etag: string | null; lastModified: string | null; upstreamLatencyMs: number } | { kind: "error"; status: number | null; reason: string; upstreamLatencyMs: number }> {
  const doFetch = ctx.fetchImpl ?? fetch
  const timeoutMs = Math.max(1_000, ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const userAgent = ctx.userAgent ?? DEFAULT_USER_AGENT
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  const headers: Record<string, string> = {
    "user-agent": userAgent,
    accept: "application/xml, text/xml",
  }
  if (ctx.etag) headers["if-none-match"] = ctx.etag
  if (ctx.lastModified) headers["if-modified-since"] = ctx.lastModified

  try {
    const response = await doFetch(url, { method: "GET", headers, signal: controller.signal })
    const upstreamLatencyMs = Date.now() - startedAt
    const etag = response.headers.get("etag")
    const lastModified = response.headers.get("last-modified")
    if (response.status === 304) {
      return { kind: "not_modified", etag: etag ?? ctx.etag, lastModified: lastModified ?? ctx.lastModified, upstreamLatencyMs }
    }
    if (response.ok) {
      const text = await response.text()
      return { kind: "ok", text, etag, lastModified, upstreamLatencyMs }
    }
    return { kind: "error", status: response.status, reason: `http_${response.status}`, upstreamLatencyMs }
  } catch (error) {
    return {
      kind: "error",
      status: null,
      reason: error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_error",
      upstreamLatencyMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timer)
  }
}

export const personioAdapter: AtsAdapter = {
  name: "personio",
  // XML feed is ~1s; lower cap reflects parse cost.
  concurrency: envConcurrency("personio", 6),
  detectFromUrl,
  async fetchJobs({ slug, ctx }): Promise<HarvestResult> {
    const fetchedAt = new Date()
    const result = await fetchXml(endpointFor(slug), ctx)

    if (result.kind === "not_modified") {
      return {
        jobs: [],
        notModified: true,
        etag: result.etag,
        lastModified: result.lastModified,
        sourceAts: "personio",
        sourceAtsSlug: slug,
        fetchedAt,
        upstreamLatencyMs: result.upstreamLatencyMs,
      }
    }
    if (result.kind === "error") {
      const err = new Error(`personio fetch failed: ${result.reason}`)
      ;(err as Error & { status?: number | null }).status = result.status
      throw err
    }

    const blocks = extractPositions(result.text)
    const jobs: HarvestedJob[] = []
    for (const block of blocks) {
      const mapped = mapPosition(slug, block)
      if (mapped) jobs.push(mapped)
    }

    return {
      jobs,
      notModified: false,
      etag: result.etag,
      lastModified: result.lastModified,
      sourceAts: "personio",
      sourceAtsSlug: slug,
      fetchedAt,
      upstreamLatencyMs: result.upstreamLatencyMs,
    }
  },
}

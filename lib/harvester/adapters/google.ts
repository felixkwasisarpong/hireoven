import {
  envConcurrency,
  hashContent,
  BROWSER_USER_AGENT,
  type AtsAdapter,
  type HarvestCtx,
  type HarvestResult,
  type HarvestedJob,
} from "@/lib/harvester/adapters/_base"
import { harvesterFetch } from "@/lib/harvester/http-agent"

/**
 * Google careers adapter.
 * Results page: https://www.google.com/about/careers/applications/jobs/results/
 *
 * Google runs its own careers platform (no public JSON API — the old
 * careers.google.com/api/v3 returns 404). The results page server-renders job
 * cards, so we scrape them. Two stable hooks survive Google's obfuscated CSS:
 *   • each card's "Learn more" anchor:
 *       href="jobs/results/{id}-{slug}..." aria-label="Learn more about {title}"
 *   • the card heading text: "{title} corporate_fare Google place {location}"
 *
 * We request the US + Canada location facets (?location=United States&…=Canada)
 * so each harvest only pulls US/CA roles (~1,900 currently), paginate ?page=N
 * (20/page) until a short/empty page, and dedup by job id across pages.
 *
 * Descriptions are NOT scraped — the detail page embeds them in Google's WIZ
 * `AF_initData` arrays (positional, unstable). Title + location + apply URL is a
 * complete listing; JD backfill can come later. Single global tenant → slug
 * is always "google".
 */

const RESULTS_URL = "https://www.google.com/about/careers/applications/jobs/results/"
const PAGE_SIZE = 20
// ~1,900 US/CA jobs / 20 per page ≈ 95 pages; cap generously.
const MAX_PAGES = Math.max(1, Number.parseInt(process.env.HARVESTER_GOOGLE_MAX_PAGES ?? "140", 10))
// Polite delay between page fetches (Google throttles bursts of the results page).
const PAGE_DELAY_MS = Math.max(0, Number.parseInt(process.env.HARVESTER_GOOGLE_PAGE_DELAY_MS ?? "200", 10))

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function detectFromUrl(url: string): { slug: string } | null {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const path = u.pathname.toLowerCase()
    if (
      (host === "www.google.com" || host === "google.com" || host === "careers.google.com") &&
      path.includes("/careers/applications")
    ) {
      return { slug: "google" }
    }
    if (host === "careers.google.com") return { slug: "google" }
  } catch {
    // fall through
  }
  return null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim()
}

/** Normalized title key for pairing an anchor with its heading location. */
function titleKey(title: string): string {
  return decodeEntities(title).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)
}

export type RawCard = { id: string; slug: string; title: string }

/** Parse the "Learn more" anchors → id + slug + full title. */
export function parseAnchors(html: string): RawCard[] {
  const re = /href="jobs\/results\/(\d+)-([^"?&]+)[^"]*"\s+aria-label="Learn more about ([^"]+)"/g
  const out: RawCard[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    out.push({ id: m[1], slug: m[2], title: decodeEntities(m[3]) })
  }
  return out
}

/** Build a title→location map from the card headings. */
export function parseLocations(html: string): Map<string, string> {
  // Replace tags with a delimiter, then collapse runs of delimiters + the
  // whitespace between adjacent tags into a single "|" (robust to minified or
  // pretty-printed markup).
  const text = html.replace(/<[^>]+>/g, "|").replace(/[|\s]*\|[|\s]*/g, "|")
  // Trailing delimiter is a LOOKAHEAD so it isn't consumed — otherwise it would
  // eat the leading "|" the next adjacent card's heading needs to match.
  const re = /\|([^|]{3,160}?)\|corporate_fare\|Google\|place\|([^|]{3,120}?)(?=\|)/g
  const map = new Map<string, string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const key = titleKey(m[1])
    // Take the first location when several are listed ("A, USA; B, USA").
    const loc = decodeEntities(m[2].split(";")[0])
    if (key && loc && !map.has(key)) map.set(key, loc)
  }
  return map
}

function mapCard(card: RawCard, locMap: Map<string, string>): HarvestedJob | null {
  if (!card.id || !card.title) return null
  // Every card came from the US/CA-filtered results, so default to a US label
  // when the heading location couldn't be paired (keeps it past the US/CA gate).
  const location = locMap.get(titleKey(card.title)) ?? "United States"
  const applyUrl = `${RESULTS_URL}${card.id}-${card.slug}`
  const contentHash = hashContent([card.title, location])
  return {
    externalId: `google:${card.id}`,
    title: card.title,
    applyUrl,
    location,
    contentHash,
  }
}

async function fetchPage(page: number, ctx: HarvestCtx): Promise<string> {
  const url = `${RESULTS_URL}?location=United%20States&location=Canada&page=${page}`
  const res = await harvesterFetch(url, {
    headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "text/html" },
    signal: ctx.signal,
  })
  if (!res.ok) {
    const err = new Error(`google careers error: ${res.status}`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return res.text()
}

export const googleAdapter: AtsAdapter = {
  name: "google",
  concurrency: envConcurrency("google", 1),
  detectFromUrl,

  async fetchJobs({ ctx }): Promise<HarvestResult> {  // slug unused — single global site
    const fetchedAt = new Date()
    const jobs: HarvestedJob[] = []
    const seen = new Set<string>()

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      if (page > 1 && PAGE_DELAY_MS > 0) await sleep(PAGE_DELAY_MS)
      const html = await fetchPage(page, ctx)
      const anchors = parseAnchors(html)
      if (anchors.length === 0) break
      const locMap = parseLocations(html)

      let added = 0
      for (const card of anchors) {
        if (seen.has(card.id)) continue
        seen.add(card.id)
        const job = mapCard(card, locMap)
        if (job) {
          jobs.push(job)
          added += 1
        }
      }
      // Last page (short) or a page that produced nothing new → stop.
      if (anchors.length < PAGE_SIZE || added === 0) break
    }

    return {
      jobs,
      notModified: false,
      etag: null,
      lastModified: null,
      sourceAts: "google",
      sourceAtsSlug: "google",
      fetchedAt,
      upstreamLatencyMs: 0,
    }
  },
}

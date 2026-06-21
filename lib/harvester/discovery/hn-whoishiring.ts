/**
 * Hacker News "Ask HN: Who is hiring?" discovery.
 *
 * The @whoishiring account posts one hiring thread per month; each top-level
 * comment is a single company's post, conventionally formatted as
 *   COMPANY | ROLE | LOCATION | ... | apply: <url>
 * A large share of those posts link directly to an ATS board (Greenhouse,
 * Lever, Ashby, Workday, …) that our adapter registry already recognises.
 *
 * This module is the pure/IO-thin layer: it locates the latest hiring story
 * via the HN Algolia API, pulls its comment tree, and turns each comment into
 * an `{ companyName, applyUrls }` post. The script
 * (scripts/discover-hn-whoishiring.ts) feeds each apply URL through
 * enrollFromApplyUrl(), reusing the same direct-enrollment path as the
 * aggregator sources.
 *
 * Nothing here writes to the DB — easy to unit-test with a mock fetch.
 */

import { detectAdapter } from "@/lib/harvester/adapters"

const ALGOLIA_BASE = "https://hn.algolia.com/api/v1"
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_USER_AGENT =
  "hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)"

const URL_REGEX = /https?:\/\/[^\s\[\]()<>"',{}|\\^`]+/g

export type HnHiringPost = {
  /** Best-effort company name (text before the first `|` separator). */
  companyName: string
  /** Distinct apply URLs in the comment that an adapter recognises. */
  applyUrls: string[]
  /** HN comment object id, for telemetry / dedup. */
  commentId: number | null
}

export type FetchHnOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  userAgent?: string
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&#x2F;": "/",
  "&nbsp;": " ",
}

export function htmlUnescape(input: string): string {
  return input.replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39|#x2F);/g, (m) => HTML_ENTITIES[m] ?? m)
}

export function stripTags(html: string): string {
  return htmlUnescape(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
}

function trimTrailing(url: string): string {
  return url.replace(/[.,;:!?)\]}>'"]+$/, "")
}

/**
 * Pull every URL out of an HN comment (both `href="…"` attributes and bare
 * URLs in the text), unescape HTML entities, and keep only those an adapter
 * recognises. De-duplicated, order-preserving.
 */
export function extractApplyUrls(commentHtml: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const url = trimTrailing(htmlUnescape(raw))
    if (seen.has(url)) return
    if (!detectAdapter(url)) return
    seen.add(url)
    out.push(url)
  }

  for (const m of commentHtml.matchAll(/href="([^"]+)"/g)) push(m[1]!)
  const text = htmlUnescape(commentHtml)
  for (const m of text.match(URL_REGEX) ?? []) push(m)

  return out
}

/**
 * Company name = the text before the first `|` in the comment. HN posters use
 * `Company | Role | Location | …`; falls back to the first sentence/line,
 * capped so a malformed post doesn't yield a paragraph-long "name".
 */
export function parseCompanyName(commentHtml: string): string {
  const text = stripTags(commentHtml)
  const beforePipe = text.split("|")[0]!.trim()
  const candidate = beforePipe || text
  const firstLine = candidate.split(/[.\n]/)[0]!.trim()
  return firstLine.slice(0, 80).trim()
}

export function commentToPost(comment: {
  id?: number | null
  text?: string | null
}): HnHiringPost | null {
  const html = comment.text ?? ""
  if (!html.trim()) return null
  const applyUrls = extractApplyUrls(html)
  if (applyUrls.length === 0) return null
  const companyName = parseCompanyName(html)
  if (!companyName) return null
  return { companyName, applyUrls, commentId: comment.id ?? null }
}

// ---- HN Algolia API --------------------------------------------------------

type AlgoliaSearchHit = { objectID: string; title?: string; created_at?: string }
type AlgoliaSearchResponse = { hits?: AlgoliaSearchHit[] }

type AlgoliaItem = {
  id?: number
  text?: string | null
  children?: AlgoliaItem[]
}

async function fetchJson<T>(url: string, options: FetchHnOptions): Promise<T | null> {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await doFetch(url, {
      headers: { "user-agent": options.userAgent ?? DEFAULT_USER_AGENT, accept: "application/json" },
      signal: controller.signal,
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Pick the newest story whose title matches "Ask HN: Who is hiring?". */
export function pickLatestHiringStoryId(search: AlgoliaSearchResponse): string | null {
  const hits = search.hits ?? []
  const match = hits.find((h) => /who\s+is\s+hiring/i.test(h.title ?? ""))
  return match?.objectID ?? hits[0]?.objectID ?? null
}

/** Flatten the (potentially nested) comment tree to top-level + descendants. */
export function flattenComments(item: AlgoliaItem): AlgoliaItem[] {
  const out: AlgoliaItem[] = []
  const walk = (node: AlgoliaItem) => {
    for (const child of node.children ?? []) {
      out.push(child)
      walk(child)
    }
  }
  walk(item)
  return out
}

export async function fetchWhoIsHiringPosts(
  options: FetchHnOptions & { storyId?: string } = {}
): Promise<{ storyId: string | null; posts: HnHiringPost[] }> {
  let storyId = options.storyId ?? null
  if (!storyId) {
    const search = await fetchJson<AlgoliaSearchResponse>(
      `${ALGOLIA_BASE}/search_by_date?query=${encodeURIComponent(
        "Ask HN: Who is hiring?"
      )}&tags=story,author_whoishiring&hitsPerPage=5`,
      options
    )
    storyId = search ? pickLatestHiringStoryId(search) : null
  }
  if (!storyId) return { storyId: null, posts: [] }

  const item = await fetchJson<AlgoliaItem>(`${ALGOLIA_BASE}/items/${storyId}`, options)
  if (!item) return { storyId, posts: [] }

  const posts: HnHiringPost[] = []
  const seenComment = new Set<number>()
  for (const comment of flattenComments(item)) {
    const post = commentToPost(comment)
    if (!post) continue
    if (post.commentId != null) {
      if (seenComment.has(post.commentId)) continue
      seenComment.add(post.commentId)
    }
    posts.push(post)
  }
  return { storyId, posts }
}

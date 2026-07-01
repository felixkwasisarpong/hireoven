/**
 * Teamtailor — TS port of jobhive.scrapers.teamtailor.
 *
 * The authenticated API (api.teamtailor.com) 406s without a key, but every
 * public careers site exposes a free RSS feed with all the structured fields:
 *
 *     GET https://{slug}.teamtailor.com/jobs.rss
 *
 * Single request — the feed includes every open job, no pagination. Each
 * <item> carries title, link, pubDate, guid, a `tt:` location block
 * (city / country / name), tt:department, remoteStatus, and an HTML
 * description. We fetch raw XML and parse it dependency-free with regex.
 */

import { BaseScraper, register } from "../base.js"
import { fetchText, cleanHtml, parseIso } from "../http.js"
import { CompanyNotFoundError, ScraperError, type ReplicaJob } from "../types.js"

// `https://{slug}.teamtailor.com/jobs/{numeric_id}-{slug-title}`
const URL_ID_RE = /\/jobs\/(\d+)/

class TeamtailorScraper extends BaseScraper {
  readonly ats = "teamtailor"

  async fetch(slug: string): Promise<ReplicaJob[]> {
    const url = `https://${encodeURIComponent(slug)}.teamtailor.com/jobs.rss`
    const xml = await fetchText(url, {
      timeoutMs: 30_000,
      headers: { accept: "application/rss+xml, text/xml" },
    })
    // fetchText returns null on 404 *and* on any other non-2xx / network error.
    // We can't distinguish a not-found tenant from a transient failure here, so
    // probe once more to classify: a body that's clearly not an RSS feed → not
    // found; otherwise a generic scraper error.
    if (xml == null) {
      throw new ScraperError(`Teamtailor fetch failed for ${slug}`)
    }
    if (!/<rss[\s>]/i.test(xml) && !/<channel[\s>]/i.test(xml)) {
      // An HTML error page (unknown tenant) parses as XML but isn't a feed.
      throw new CompanyNotFoundError(`Teamtailor tenant not found: ${slug}`)
    }
    return this.parseRss(xml, slug)
  }

  private parseRss(xml: string, slug: string): ReplicaJob[] {
    const jobs: ReplicaJob[] = []
    const seen = new Set<string>()
    for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
      const job = this.parseItem(item[1], slug)
      if (!job || seen.has(job.externalId)) continue
      seen.add(job.externalId)
      jobs.push(job)
    }
    return jobs
  }

  private parseItem(item: string, slug: string): ReplicaJob | null {
    const link = text(tag(item, "link"))
    if (!link) return null

    // Prefer the stable numeric ID from the URL; fall back to the GUID.
    let id = URL_ID_RE.exec(link)?.[1] ?? ""
    if (!id) id = text(tag(item, "guid"))
    if (!id) return null

    return {
      externalId: `teamtailor:${id}`,
      title: text(tag(item, "title")) || "Untitled",
      applyUrl: link,
      description: cleanHtml(tag(item, "description")),
      location: formatLocation(item),
      postedAt: parseIso(text(tag(item, "pubDate"))),
      workMode: extractRemote(item),
    }
  }
}

/** Extract the inner text of the first <name>...</name>, CDATA-aware. */
function tag(xml: string, name: string): string | undefined {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i")
  const m = re.exec(xml)
  if (!m) return undefined
  const inner = m[1]
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(inner)
  return cdata ? cdata[1] : inner
}

/** Collapse whitespace and trim; RSS text nodes are often padded. */
function text(v: string | undefined): string {
  return v ? v.replace(/\s+/g, " ").trim() : ""
}

/** Compose 'City, Country' from the first <tt:location>, else its <tt:name>. */
function formatLocation(item: string): string | undefined {
  const loc = tag(item, "tt:location")
  if (!loc) return undefined
  const parts: string[] = []
  for (const t of ["city", "country"]) {
    const value = text(tag(loc, `tt:${t}`))
    if (value) parts.push(value)
  }
  if (parts.length) return parts.join(", ")
  return text(tag(loc, "tt:name")) || undefined
}

/**
 * <remoteStatus> is one of 'fully' | 'temporary' | 'hybrid' | 'none'.
 * Map only the unambiguous extremes onto workMode; leave the rest unknown.
 */
function extractRemote(item: string): string | undefined {
  const status = text(tag(item, "remoteStatus")).toLowerCase()
  if (status === "fully") return "remote"
  if (status === "none") return "onsite"
  return undefined
}

register(new TeamtailorScraper())

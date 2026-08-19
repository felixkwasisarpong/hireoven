/**
 * Picking the real ATS board out of a branded career site.
 *
 * The Career Site Scout accepts any careers URL. When the URL itself isn't a
 * recognised ATS board (e.g. careers.frostbank.com), the scout scrapes the page
 * for links and looks for one that IS. The catch: modern career sites are built
 * on a vendor front-end whose static assets are served from that same vendor's
 * domain. A Phenom-fronted site loads CSS/JS from cdn.phenompeople.com, which
 * detectAtsFromUrl reports as ATS "phenom" — so a naive first-match scan locks
 * onto a CDN root in <head> and scans it, finding zero jobs, while the actual
 * board (frostbank.wd5.myworkdayjobs.com, linked further down) is never tried.
 *
 * So candidates are filtered (no static assets) and ranked by how board-like
 * they look, rather than taken in document order.
 */

import { detectAtsFromUrl, type AtsDetection } from "@/lib/companies/detect-ats"
import { detectAdapter } from "@/lib/harvester/adapters"

export function safeUrl(raw: string | null | undefined): URL | null {
  if (!raw?.trim()) return null
  try {
    const parsed = new URL(raw.trim())
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    parsed.hash = ""
    return parsed
  } catch {
    return null
  }
}

const ASSET_EXT_RE =
  /\.(?:css|js|mjs|cjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|map|mp4|webm|pdf)(?:$|\?)/i
const ASSET_HOST_RE = /^(?:cdn|cdn-[\w-]+|assets?|static|media|img|images?|fonts?|scripts?|js|css)\./i

/** A vendor-domain URL that serves assets rather than job listings. */
export function isAssetUrl(url: URL): boolean {
  return ASSET_HOST_RE.test(url.hostname) || ASSET_EXT_RE.test(url.pathname)
}

/**
 * How board-like a candidate URL looks. Document order is a poor signal because
 * vendor assets load in <head>, long before the board link in the page body.
 */
export function boardScore(url: URL): number {
  const path = url.pathname.toLowerCase()
  let score = 0
  if (/\/job[/-]|\/jobs\b|\/search\b|\/careers?\b|\/vacanc/.test(path)) score += 3
  if (url.pathname.split("/").filter(Boolean).length > 0) score += 1
  return score
}

/**
 * Canonical board identifier for a detected ATS URL.
 *
 * Prefers the adapter's own parser, which produces the slug the harvester later
 * expects (Workday's `tenant:wd5:Site`). The host/path heuristics below only
 * yield a bare fragment like "frostbank" — not a valid board identifier, and it
 * would be persisted onto the company row and the ats_tenants registry.
 */
export function atsIdentifierFor(url: string, detection: AtsDetection | null): string | null {
  if (detection?.atsIdentifier) return detection.atsIdentifier
  const parsed = safeUrl(url)
  if (!parsed || !detection) return null
  const fromAdapter = detectAdapter(url)
  if (fromAdapter?.slug) return fromAdapter.slug
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
  const parts = parsed.pathname.split("/").filter(Boolean)
  if (detection.atsType === "workday") return host.split(".")[0] || null
  if (detection.atsType === "icims") return host.split(".")[0]?.replace(/^careers?-?/i, "") || null
  if (parts[0]) return parts[0]
  return host.split(".")[0] || null
}

export function extractUrlsFromHtml(html: string, baseUrl: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const re = /\b(?:href|src)=["']([^"']{1,1500})["']/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const raw = match[1]
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue
    try {
      const url = new URL(raw, baseUrl)
      if (url.protocol !== "http:" && url.protocol !== "https:") continue
      url.hash = ""
      const normalized = url.toString()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      urls.push(normalized)
    } catch {
      // ignore malformed links
    }
  }
  return urls
}

export type AtsCandidate = {
  url: string
  detection: AtsDetection
  identifier: string | null
}

export function findAtsCandidate(urls: string[]): AtsCandidate | null {
  const candidates: Array<{ url: string; detection: AtsDetection; score: number; order: number }> = []
  urls.forEach((url, order) => {
    const detection = detectAtsFromUrl(url)
    if (!detection) return
    const parsed = safeUrl(url)
    if (!parsed || isAssetUrl(parsed)) return
    candidates.push({ url, detection, score: boardScore(parsed), order })
  })
  if (candidates.length === 0) return null
  // Highest board-likeness wins; ties keep document order so behaviour stays
  // deterministic and matches the previous first-match semantics.
  candidates.sort((a, b) => b.score - a.score || a.order - b.order)
  const best = candidates[0]
  return { url: best.url, detection: best.detection, identifier: atsIdentifierFor(best.url, best.detection) }
}

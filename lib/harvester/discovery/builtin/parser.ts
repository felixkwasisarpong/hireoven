/**
 * Parser for Built In company-listing pages (builtin.com/companies?page=N).
 *
 * Built In server-renders the company grid, so a plain fetch returns usable
 * HTML — no browser needed. Each company card exposes an overlay anchor that
 * carries BOTH the slug and the display name:
 *
 *   <a href="/company/halter" ... aria-label="View Halter company profile">
 *
 * We pull (slug, name) from that anchor. This is a company-name-only discovery
 * surface — no jobs, reviews, or gated content — and the path is permitted by
 * Built In's robots.txt.
 */

import { decodeHtmlEntities } from "@/lib/harvester/discovery/glassdoor/name-normalization"

export type BuiltinParsedCompany = {
  slug: string
  name: string
}

// The overlay anchor reliably pairs the /company/{slug} href with the human
// name in its aria-label. href and aria-label always appear in this order on
// the overlay link.
const COMPANY_ANCHOR_RE =
  /href="\/company\/([a-z0-9][a-z0-9-]*)"[^>]*aria-label="View (.+?) company profile"/gi

export function parseBuiltinCompanies(html: string): BuiltinParsedCompany[] {
  const out: BuiltinParsedCompany[] = []
  const seen = new Set<string>()
  if (!html) return out

  for (const match of html.matchAll(COMPANY_ANCHOR_RE)) {
    const slug = match[1]?.trim().toLowerCase()
    const name = decodeHtmlEntities(match[2] ?? "").trim()
    if (!slug || !name) continue
    if (seen.has(slug)) continue
    // Guard against obviously-broken captures.
    if (name.length < 2 || name.length > 140) continue
    seen.add(slug)
    out.push({ slug, name })
  }

  return out
}

/** True when a Built In listing page returned real company cards. Used by the
 *  worker to detect end-of-pagination (an empty page = no more companies). */
export function builtinPageHasCompanies(html: string): boolean {
  return /href="\/company\/[a-z0-9]/i.test(html)
}

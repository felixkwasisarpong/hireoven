/**
 * BuiltWith / Wappalyzer domain → ATS feeder.
 *
 * BuiltWith and Wappalyzer both expose "every domain running technology X".
 * Pointed at the ATS technologies we already harvest (Greenhouse, Lever,
 * Ashby, Workday, …) that becomes a high-coverage list of companies whose
 * careers pages we can claim — we already own the detection
 * (lib/companies/detect-ats + ats-signatures) and the slug resolution; the
 * only missing input is the domain list.
 *
 * This module is the pure/IO-thin layer:
 *   - parseDomainList(): read a flat domain list (file / stdin).
 *   - fetchBuiltWithDomains(): pull a per-technology list from the BuiltWith
 *     Lists API (endpoint + key from env; parsed defensively).
 *   - resolveDomainAts(): for one domain, find its careers page and decide
 *     whether we can enroll a concrete ATS URL or only insert a typed
 *     placeholder for a later tenant-resolution pass.
 *
 * The driving script (scripts/discover-builtwith.ts) wires this to
 * enrollFromApplyUrl() + the companies table. No DB access here, so the
 * resolution logic is unit-tested with an injected probe.
 */

import { detectAdapter } from "@/lib/harvester/adapters"
import { detectAtsFromUrl, type AtsType } from "@/lib/companies/detect-ats"
import { detectAtsFromHtml } from "@/lib/companies/ats-signatures"
import {
  discoverCareersUrl,
  type DiscoveryProbe,
} from "@/lib/companies/careers-url-discovery"

const URL_REGEX = /https?:\/\/[^\s\[\]()<>"',{}|\\^`]+/g

/** Normalize a raw host/URL into a bare registrable-ish domain. */
export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed || trimmed.startsWith("#")) return null
  const host = trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!
    .trim()
  if (!host.includes(".") || /\s/.test(host)) return null
  return host
}

/** Parse a flat domain list: one domain per line, `#` comments, optional CSV. */
export function parseDomainList(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    // Take the first comma-separated field so plain CSV exports work too.
    const first = line.split(",")[0] ?? ""
    const domain = normalizeDomain(first)
    if (!domain || seen.has(domain)) continue
    seen.add(domain)
    out.push(domain)
  }
  return out
}

function trimTrailing(url: string): string {
  return url.replace(/[.,;:!?)\]}>'"]+$/, "")
}

/** ATS URLs embedded in a careers page that an adapter recognises. */
export function extractAtsUrls(html: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const url = trimTrailing(raw.replace(/&amp;/g, "&"))
    if (seen.has(url) || !detectAdapter(url)) return
    seen.add(url)
    out.push(url)
  }
  for (const m of html.matchAll(/href="([^"]+)"/g)) push(m[1]!)
  for (const m of html.match(URL_REGEX) ?? []) push(m)
  return out
}

export type DomainAtsResolution =
  | { kind: "enroll"; applyUrl: string; careersUrl: string }
  | { kind: "placeholder"; atsType: AtsType; careersUrl: string }
  | { kind: "none"; reason: string }

/**
 * Resolve a single domain to an ATS outcome:
 *   - "enroll":      a concrete adapter-matched URL (careers page IS an ATS
 *                    host, or links to one) — ready for enrollFromApplyUrl().
 *   - "placeholder": a branded careers page whose HTML signature reveals the
 *                    ATS type but no tenant slug — insert typed, resolve later.
 *   - "none":        no careers page or no ATS evidence.
 */
export async function resolveDomainAts(input: {
  domain: string
  probe: DiscoveryProbe
  signal?: AbortSignal
}): Promise<DomainAtsResolution> {
  const careers = await discoverCareersUrl({
    domain: input.domain,
    probe: input.probe,
    signal: input.signal,
  })
  if (!careers.url || careers.confidence === "none") {
    return { kind: "none", reason: careers.reason }
  }

  // 1) Careers URL is itself an ATS host (redirect/canonical) → enroll.
  if (detectAdapter(careers.url)) {
    return { kind: "enroll", applyUrl: careers.url, careersUrl: careers.url }
  }

  // 2) Re-fetch the chosen page; look for an embedded ATS link, else fall back
  //    to HTML-signature detection of the ATS type.
  const page = await input.probe({ url: careers.url, signal: input.signal })
  if (page.ok && page.html) {
    const embedded = extractAtsUrls(page.html)
    if (embedded[0]) {
      return { kind: "enroll", applyUrl: embedded[0], careersUrl: careers.url }
    }
    const fromUrl = detectAtsFromUrl(careers.url)
    const fromHtml = detectAtsFromHtml({ url: careers.url, html: page.html })
    const atsType = fromUrl?.atsType ?? fromHtml?.atsType
    if (atsType) {
      return { kind: "placeholder", atsType, careersUrl: careers.url }
    }
  }

  return { kind: "none", reason: "careers_found_no_ats_signal" }
}

// ---- BuiltWith Lists API ---------------------------------------------------

const DEFAULT_LISTS_ENDPOINT = "https://api.builtwith.com/lists12/api.json"

type BuiltWithRow = { Domain?: string; D?: string; domain?: string }
type BuiltWithResponse = {
  Results?: BuiltWithRow[]
  results?: BuiltWithRow[]
  Domains?: string[]
  NextOffset?: string | null
  Errors?: unknown
}

/**
 * Pull a single technology's domain list from the BuiltWith Lists API.
 * Endpoint + key are env-driven (BUILTWITH_LISTS_ENDPOINT, BUILTWITH_API_KEY)
 * since the exact list product/version varies per account; response parsing is
 * defensive across the common envelope shapes.
 */
export async function fetchBuiltWithDomains(input: {
  tech: string
  apiKey: string
  endpoint?: string
  offset?: string
  fetchImpl?: typeof fetch
}): Promise<{ domains: string[]; nextOffset: string | null }> {
  const endpoint = input.endpoint ?? process.env.BUILTWITH_LISTS_ENDPOINT ?? DEFAULT_LISTS_ENDPOINT
  const doFetch = input.fetchImpl ?? fetch
  const params = new URLSearchParams({ KEY: input.apiKey, TECH: input.tech })
  if (input.offset) params.set("OFFSET", input.offset)

  const res = await doFetch(`${endpoint}?${params.toString()}`, {
    headers: { accept: "application/json" },
  })
  if (!res.ok) return { domains: [], nextOffset: null }
  const data = (await res.json()) as BuiltWithResponse

  const rows = data.Results ?? data.results ?? []
  const domains = new Set<string>()
  for (const r of rows) {
    const d = normalizeDomain(r.Domain ?? r.D ?? r.domain ?? "")
    if (d) domains.add(d)
  }
  for (const d of data.Domains ?? []) {
    const n = normalizeDomain(d)
    if (n) domains.add(n)
  }
  return { domains: [...domains], nextOffset: data.NextOffset ?? null }
}

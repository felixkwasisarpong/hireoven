/**
 * Recruitee — TS port of jobhive.scrapers.recruitee.
 *
 * Recruitee exposes a clean public JSON API per tenant (no auth, no pagination):
 * GET https://{slug}.recruitee.com/api/offers → {offers:[...]} with every active
 * offer, full description + requirements inline. `slug` may be a bare tenant name
 * (`monzo`) or a full custom-domain URL (`https://careers.acme.com`).
 */

import { BaseScraper, register } from "../base.js"
import { fetchJson, cleanHtml, parseIso } from "../http.js"
import { CompanyNotFoundError, ScraperError, type EmploymentType, type ReplicaJob } from "../types.js"

type RtLocation = { lat?: unknown; lng?: unknown }
type RtSalary = { min?: unknown; max?: unknown; currency?: string }

type RtOffer = {
  id?: number | string
  slug?: string
  title?: string
  position?: string
  careers_url?: string
  careers_apply_url?: string
  description?: string
  requirements?: string
  location?: string | RtLocation
  city?: string
  state_code?: string
  country_code?: string
  remote?: boolean
  employment_type_code?: string
  employment_type?: string
  salary?: RtSalary
  created_at?: string
  published_at?: string
}

const EMPLOYMENT_MAP: Record<string, EmploymentType> = {
  permanent: "FULL_TIME",
  fulltime: "FULL_TIME",
  fulltime_permanent: "FULL_TIME",
  full_time: "FULL_TIME",
  permanent_fulltime: "FULL_TIME",
  permanent_full_time: "FULL_TIME",
  fixed_term: "CONTRACT",
  temporary: "TEMPORARY",
  contract: "CONTRACT",
  freelance: "CONTRACT",
  internship: "INTERN",
  intern: "INTERN",
  trainee: "INTERN",
  apprentice: "INTERN",
  part_time: "PART_TIME",
  parttime: "PART_TIME",
  parttime_permanent: "PART_TIME",
  permanent_parttime: "PART_TIME",
  permanent_part_time: "PART_TIME",
  casual: "TEMPORARY",
  seasonal: "TEMPORARY",
}

class RecruiteeScraper extends BaseScraper {
  readonly ats = "recruitee"

  async fetch(slug: string): Promise<ReplicaJob[]> {
    const url = this.resolveApiUrl(slug)
    const res = await fetchJson<{ offers?: RtOffer[] }>(url, { timeoutMs: 30_000 })
    if (!res.ok) {
      if (res.status === 404) throw new CompanyNotFoundError(`Recruitee company not found: ${slug}`)
      throw new ScraperError(`Recruitee ${slug} → ${res.reason}`)
    }
    return (res.data.offers ?? [])
      .filter((o): o is RtOffer => o != null && typeof o === "object")
      .map((o) => this.parse(o, slug))
  }

  private resolveApiUrl(slug: string): string {
    const s = slug.trim().replace(/\/+$/, "")
    if (s.startsWith("http://") || s.startsWith("https://")) {
      return s.endsWith("/api/offers") ? s : `${s}/api/offers`
    }
    return `https://${s}.recruitee.com/api/offers`
  }

  private parse(offer: RtOffer, slug: string): ReplicaJob {
    const url = offer.careers_url || offer.careers_apply_url || this.fallbackUrl(slug, offer)

    const salary = isObject(offer.salary) ? offer.salary : undefined
    const salaryMin = salary ? toNumber(salary.min) : undefined
    const salaryMax = salary ? toNumber(salary.max) : undefined
    const salaryCurrency = salary && typeof salary.currency === "string" ? salary.currency : undefined

    return {
      externalId: `recruitee:${offer.id ?? offer.slug ?? ""}`,
      title: offer.title || offer.position || "Untitled",
      applyUrl: url,
      description: composeDescription(offer),
      location: formatLocation(offer),
      postedAt: parseIso(offer.created_at) ?? parseIso(offer.published_at),
      workMode: typeof offer.remote === "boolean" ? (offer.remote ? "remote" : "onsite") : undefined,
      employmentType: mapEmploymentType(offer.employment_type_code ?? offer.employment_type),
      salaryMin,
      salaryMax,
      salaryCurrency,
    }
  }

  private fallbackUrl(slug: string, offer: RtOffer): string {
    const offerSlug = offer.slug || offer.id || ""
    const base = slug.trim().replace(/\/+$/, "")
    if (base.startsWith("http://") || base.startsWith("https://")) {
      return `${base}/o/${offerSlug}`
    }
    return `https://${base}.recruitee.com/o/${offerSlug}`
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v)
}

function toNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

function mapEmploymentType(value: unknown): EmploymentType | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const norm = value.toLowerCase().replace(/-/g, "_").trim()
  if (norm in EMPLOYMENT_MAP) return EMPLOYMENT_MAP[norm]
  for (const [needle, mapped] of Object.entries(EMPLOYMENT_MAP)) {
    if (norm.includes(needle)) return mapped
  }
  return undefined
}

function formatLocation(offer: RtOffer): string | undefined {
  if (typeof offer.location === "string" && offer.location.trim()) return offer.location.trim()
  const parts = [offer.city, offer.state_code, offer.country_code].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  )
  return parts.length ? parts.join(", ") : undefined
}

function composeDescription(offer: RtOffer): string | undefined {
  const parts: string[] = []
  for (const key of ["description", "requirements"] as const) {
    const cleaned = cleanHtml(offer[key])
    if (cleaned) parts.push(cleaned)
  }
  if (!parts.length) return undefined
  return parts.join("\n\n").slice(0, 25_000)
}

register(new RecruiteeScraper())

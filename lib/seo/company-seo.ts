/**
 * Slug-with-id URLs for the public, indexable company SEO pages.
 *
 * Companies have no `slug` column, and resolving a bare name-slug would need an
 * unindexed full-table scan (which OOMs the web box). So we embed the company's
 * UUID (hex, no dashes) at the end of the path: the leading slug is for SEO and
 * humans, the trailing hex resolves by primary key. e.g.
 *   /h1b-sponsors/stripe-7d2f50ba1eb44d0c8449eb616d685ca5
 */

export function companySlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "company"
  )
}

/** `{name-slug}-{uuidhex}` — the public URL segment for a company. */
export function companyParam(id: string, name: string): string {
  return `${companySlug(name)}-${id.replace(/-/g, "")}`
}

/** Reconstruct the UUID from a `companyParam` segment, or null if malformed. */
export function companyIdFromParam(param: string): string | null {
  const hex = param.slice(-32).toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) return null
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function h1bSponsorPath(id: string, name: string): string {
  return `/h1b-sponsors/${companyParam(id, name)}`
}

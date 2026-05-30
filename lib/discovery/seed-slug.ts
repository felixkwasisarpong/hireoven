/**
 * Best-effort human company name from a discovered `(atsType, slug)`.
 *
 * Lives in lib/ (not the discover-companies route) because Next.js route files
 * may only export route handlers + config — exporting a helper there breaks the
 * production build. The cron route and the tenant probe/mine scripts both
 * import this.
 */

// Generic Workday site segments that aren't a real company name on their own
// (e.g. /External, /Careers). When the site is generic we fall back to the
// tenant. When the site is descriptive we strip those words off it instead.
const WORKDAY_GENERIC_SITE_WORD =
  /(external_site|external|careers?|jobs?|search|global|portal|public|main|ext|site)/gi

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ")
}

/**
 * The harvest later overrides `name` from real job `raw_data.company`; this
 * just avoids storing literals like "ag:wd3:Airbus" in the meantime.
 *
 * Workday slugs are `tenant:wd:site`; everything else is a single segment.
 */
export function humanizeSeedSlug(atsType: string, slug: string): string {
  if (atsType === "workday") {
    const parts = slug.split(":")
    const tenant = (parts[0] ?? "").trim()
    const site = (parts[2] ?? "").trim()

    const fromSite = titleCase(
      site.replace(WORKDAY_GENERIC_SITE_WORD, " ").replace(/[_\-]+/g, " ").trim()
    )
    if (fromSite.length >= 2) return fromSite
    return titleCase(tenant.replace(/[_\-]+/g, " ")) || slug
  }
  return titleCase(slug.replace(/[_\-]+/g, " ")) || slug
}

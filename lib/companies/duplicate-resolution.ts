/**
 * Resolving companies that are the same employer recorded more than once.
 *
 * Every discovery subsystem mints its own synthetic domain for a company whose
 * real one it does not know — `metropolis.greenhouse-discovered` from the board
 * probe, `.greenhouse-tenant` from the jobhive dataset, `.greenhouse-scout` from
 * the Career Site Scout, `.ats-placeholder` elsewhere. Because every company
 * upsert conflicts on `domain`, those four keys never collide, so one employer
 * accumulates one row per subsystem that found it — each carrying an identical
 * `ats_type`/`ats_identifier`, which is the employer's real identity.
 *
 * The pair is therefore the natural key, and this module decides which row of a
 * colliding group survives and what it should inherit.
 */

/**
 * Domains invented by a discovery subsystem rather than observed in the world.
 *
 * Grounded in what is actually in the table: `<ats>-discovered`, `<ats>-tenant`,
 * `<ats>-scout`, `ats-placeholder`, and the bare `discovered` / `sourced` /
 * `local` forms. Everything else — com, ai, io, co, net, edu — is a real domain.
 */
const SYNTHETIC_DOMAIN = /\.(?:[a-z0-9]+-)?(?:discovered|tenant|scout|placeholder|sourced|local|invalid|merged)$/i

export function isSyntheticDomain(domain: string | null | undefined): boolean {
  const value = domain?.trim().toLowerCase()
  if (!value) return true
  return SYNTHETIC_DOMAIN.test(value)
}

export type DuplicateCandidate = {
  id: string
  domain: string | null
  isActive: boolean
  jobCount: number
  createdAt: string
  /** Display name, when known. Used only to promote a real one onto the survivor. */
  name?: string | null
}

/**
 * A "name" that is really a board coordinate or a scraped page fragment.
 *
 * The Career Site Scout derived company names from the ATS identifier and the
 * page <title>, which put live employers called `Conocophillips:Wd1:External`,
 * `Global Payments  |` and `Make your next move matter` in the feed. When such a
 * row wins a merge on job count, the group's real name should move onto it — the
 * same way a real domain does.
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const value = name?.trim()
  if (!value) return true
  // Board coordinates: tenant:wd1:Site, tenant/Site.
  if (/[:/]/.test(value)) return true
  // Leftover title separators, e.g. "Global Payments  |".
  if (/[|·—–-]\s*$/.test(value)) return true
  // Taglines rather than names.
  if (value.split(/\s+/).length > 5) return true
  if (/\b(your|our|we|us|you|make|join|find|build|welcome|search)\b/i.test(value)) return true
  return false
}

export type DuplicateResolution =
  | {
      status: "merge"
      survivor: DuplicateCandidate
      losers: DuplicateCandidate[]
      /** Real domain that could be promoted onto the survivor, or null. */
      promoteDomain: string | null
      /** Real name that could be promoted onto the survivor, or null. */
      promoteName: string | null
      reason: string
    }
  | { status: "ambiguous"; reason: string; realDomains: string[] }

/**
 * Domains belonging to the ATS vendor rather than the employer.
 *
 * A record whose domain is `bamboohr.com` or `myworkdayjobs.com` is not telling
 * us who the employer is — it is telling us who hosts their board, which every
 * member of the group shares by definition. Treating those as identity held
 * `workday/ZOLLMedicalCorp` apart on `myworkdayjobs.com` vs `zoll.com`, which is
 * one company. Grounded in what actually appears inside the held groups:
 * bamboohr.com (505 records), icims.com (75), myworkdayjobs.com (30),
 * oraclecloud.com (4), plus the other vendors we crawl.
 */
const ATS_VENDOR_DOMAINS = new Set([
  "bamboohr.com", "icims.com", "myworkdayjobs.com", "oraclecloud.com",
  "greenhouse.io", "lever.co", "ashbyhq.com", "smartrecruiters.com",
  "workable.com", "teamtailor.com", "breezy.hr", "recruitee.com",
  "jobvite.com", "taleo.net", "successfactors.com", "applytojob.com",
  "paycomonline.com", "paylocity.com", "ultipro.com", "adp.com",
  "dayforcehcm.com", "clearcompany.com", "catsone.com", "pinpointhq.com",
  "rippling.com", "eightfold.ai", "avature.net", "phenompeople.com",
  "brassring.com", "jazz.co", "workdayjobs.com",
])

/**
 * The registrable domain, when it actually identifies the employer.
 *
 * Null for anything that does not: a subsystem-minted placeholder, or an ATS
 * vendor host that says nothing about who the employer is.
 *
 * Approximates registrable as the last two labels, which is wrong for
 * multi-part suffixes like `.co.uk`. That error is in the safe direction: it can
 * only make two domains look *different*, which holds a group for review rather
 * than merging it.
 */
export function registrableDomain(domain: string | null | undefined): string | null {
  if (isSyntheticDomain(domain)) return null
  const parts = domain!.trim().toLowerCase().split(".").filter(Boolean)
  if (parts.length < 2) return null
  const registrable = parts.slice(-2).join(".")
  if (ATS_VENDOR_DOMAINS.has(registrable)) return null
  return registrable
}

/**
 * Pick the row that survives a merge.
 *
 * Ranked by job count first: those rows are the user-visible content and the
 * bulk of what a merge has to move, so keeping the fullest one moves the least.
 * A real domain, then still being active, then age break ties.
 *
 * Note this deliberately does NOT rank a real domain first. The previous merge
 * pass did, and picked rows that had the nicer domain but no working board —
 * which is how live records ended up stranded behind a dead one. Domain is a
 * field the survivor can simply inherit, so it should not decide identity.
 */
export function resolveDuplicates(candidates: DuplicateCandidate[]): DuplicateResolution | null {
  if (candidates.length < 2) return null

  // An ATS pair is only evidence of shared identity when the identifier was
  // observed. Some of it is inferred from a hostname or a name slug, and two
  // unrelated employers can land on the same guess — `ashby/column` is held by
  // both Column and Column Five Media, each with its own real domain and its own
  // careers page. Their direct_ats_url agrees too, because that field is derived
  // from the same guess, so it corroborates nothing.
  //
  // Two different real domains in one group therefore means identity is
  // ambiguous, and merging would fuse two companies into one. Hold it for a human.
  const realDomains = [...new Set(candidates.map((c) => registrableDomain(c.domain)).filter((d): d is string => Boolean(d)))]
  if (realDomains.length > 1) {
    return {
      status: "ambiguous",
      reason: `group holds ${realDomains.length} different real domains`,
      realDomains,
    }
  }

  const ranked = [...candidates].sort((a, b) => {
    if (b.jobCount !== a.jobCount) return b.jobCount - a.jobCount
    // A vendor host is no more identifying than a placeholder, so both rank below
    // a record carrying the employer's own domain.
    const aAnonymous = registrableDomain(a.domain) === null
    const bAnonymous = registrableDomain(b.domain) === null
    if (aAnonymous !== bAnonymous) return aAnonymous ? 1 : -1
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    return a.createdAt.localeCompare(b.createdAt)
  })

  const survivor = ranked[0]!
  const losers = ranked.slice(1)

  // The survivor keeps a real domain it already has. Otherwise the best real
  // domain in the group is promoted onto it, so merging never discards the one
  // fact that makes logos and enrichment work.
  const promoteDomain = registrableDomain(survivor.domain) === null
    ? (losers.find((c) => registrableDomain(c.domain) !== null)?.domain ?? null)
    : null

  // Same reasoning as the domain: a name is a field the survivor can inherit, so
  // it must not decide identity — but a merge should never leave a board
  // coordinate as the employer name shown in the feed.
  const promoteName = isPlaceholderName(survivor.name)
    ? (losers.find((c) => !isPlaceholderName(c.name))?.name?.trim() ?? null)
    : null

  const reason = [
    `${survivor.jobCount} jobs`,
    registrableDomain(survivor.domain) ? "real domain" : "no identifying domain",
    survivor.isActive ? "active" : "inactive",
  ].join(", ")

  return { status: "merge", survivor, losers, promoteDomain, promoteName, reason }
}

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
}

export type DuplicateResolution =
  | {
      status: "merge"
      survivor: DuplicateCandidate
      losers: DuplicateCandidate[]
      /** Real domain that could be promoted onto the survivor, or null. */
      promoteDomain: string | null
      reason: string
    }
  | { status: "ambiguous"; reason: string; realDomains: string[] }

/**
 * Approximate registrable domain — the last two labels.
 *
 * Wrong for multi-part suffixes like `.co.uk`, which it treats as registrable.
 * That error is in the safe direction here: it can only make two domains look
 * *different*, which holds a group back for review rather than merging it.
 */
export function registrableDomain(domain: string | null | undefined): string | null {
  if (isSyntheticDomain(domain)) return null
  const parts = domain!.trim().toLowerCase().split(".").filter(Boolean)
  if (parts.length < 2) return null
  return parts.slice(-2).join(".")
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
    const aSynthetic = isSyntheticDomain(a.domain)
    const bSynthetic = isSyntheticDomain(b.domain)
    if (aSynthetic !== bSynthetic) return aSynthetic ? 1 : -1
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    return a.createdAt.localeCompare(b.createdAt)
  })

  const survivor = ranked[0]!
  const losers = ranked.slice(1)

  // The survivor keeps a real domain it already has. Otherwise the best real
  // domain in the group is promoted onto it, so merging never discards the one
  // fact that makes logos and enrichment work.
  const promoteDomain = isSyntheticDomain(survivor.domain)
    ? (losers.find((c) => !isSyntheticDomain(c.domain))?.domain ?? null)
    : null

  const reason = [
    `${survivor.jobCount} jobs`,
    isSyntheticDomain(survivor.domain) ? "synthetic domain" : "real domain",
    survivor.isActive ? "active" : "inactive",
  ].join(", ")

  return { status: "merge", survivor, losers, promoteDomain, reason }
}

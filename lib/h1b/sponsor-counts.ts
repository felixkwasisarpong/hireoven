/**
 * Company sponsorship roll-up counts.
 *
 * `h1b_sponsor_count_1yr` and `h1b_sponsor_count_3yr` are rendered side by side
 * on the international leaderboard, the feed's H-1B intel block and the public
 * sponsor pages. They are therefore only meaningful if they come from the SAME
 * dataset over NESTED windows, so the three-year figure is a superset of the
 * one-year figure by construction.
 *
 * scripts/enrich-h1b.ts previously took the 1-year count from USCIS petition
 * approvals and the 3-year count from DOL LCA certifications. Those are
 * different datasets with different volumes and different employer-matching
 * coverage, so whenever LCA matching missed an employer the pair rendered as an
 * impossibility — AWS showed "2,901 this yr · 0 (3yr)". 37% of companies with
 * any sponsorship history (4,489 of 12,114) were in that state.
 */

export type YearlyApprovals = ReadonlyMap<number, { approved: number; denied?: number }>

export type SponsorCounts = {
  oneYear: number
  threeYear: number
}

const nonNegative = (value: number | null | undefined) =>
  Number.isFinite(value) && (value as number) > 0 ? Math.round(value as number) : 0

/**
 * Roll USCIS approvals into a nested 1-year / 3-year pair.
 *
 * @param byYear   approvals keyed by fiscal year
 * @param lcaThreeYear  DOL LCA certifications over three years, used only as a
 *                      floor so a company with richer LCA coverage is not
 *                      under-reported.
 *
 * The three-year total sums the three most recent years PRESENT in the data —
 * not `currentYear - 2` — so a company whose latest filing is older still gets a
 * real window rather than a zero.
 */
export function rollupSponsorCounts(
  byYear: YearlyApprovals,
  lcaThreeYear: number | null | undefined = 0,
): SponsorCounts {
  const years = Array.from(byYear.keys()).sort((a, b) => b - a)
  if (years.length === 0) {
    const floor = nonNegative(lcaThreeYear)
    return { oneYear: 0, threeYear: floor }
  }

  const latestYear = years[0]!
  const oneYear = nonNegative(byYear.get(latestYear)?.approved)

  const threeYearFromUscis = years
    .slice(0, 3)
    .reduce((total, year) => total + nonNegative(byYear.get(year)?.approved), 0)

  // The invariant the UI depends on: three-year can never be below one-year.
  // `oneYear` is included defensively — it is already inside the slice, but this
  // makes the guarantee independent of how the window is chosen.
  const threeYear = Math.max(threeYearFromUscis, nonNegative(lcaThreeYear), oneYear)

  return { oneYear, threeYear }
}

/**
 * Same invariant for the LCA-only path, where both figures already come from one
 * dataset. Cheap insurance against an upstream import writing an inconsistent
 * pair.
 */
export function reconcileLcaCounts(
  certOneYear: number | null | undefined,
  certThreeYear: number | null | undefined,
): SponsorCounts {
  const oneYear = nonNegative(certOneYear)
  return { oneYear, threeYear: Math.max(nonNegative(certThreeYear), oneYear) }
}

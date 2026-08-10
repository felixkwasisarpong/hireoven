/**
 * SQL predicate (no leading AND) selecting jobs at an employer that sponsors
 * work visas. This is the canonical HireOven "this job sponsors" rule, matching
 * the shape used across the app (collections' HAS_SPONSORSHIP, daily-report's
 * sponsor-company filter, market-intelligence's sponsorship density):
 *
 *   job says it sponsors, OR the company sponsors, OR the company has filed
 *   H1B petitions in the last year.
 *
 * The company clauses are only emitted when `companyAlias` is passed (i.e. the
 * caller joined `companies`). Without it the predicate falls back to the
 * job-level flag alone, so it's always safe to drop into a jobs-only query.
 */
export function sqlJobSponsors(jobAlias: string, opts: { companyAlias?: string } = {}): string {
  const j = jobAlias.trim() || "jobs"
  const c = opts.companyAlias?.trim() || ""
  const companyPart = c ? `\n  OR ${c}.sponsors_h1b = true\n  OR COALESCE(${c}.h1b_sponsor_count_1yr, 0) > 0` : ""
  return `(\n  ${j}.sponsors_h1b = true${companyPart}\n)`
}

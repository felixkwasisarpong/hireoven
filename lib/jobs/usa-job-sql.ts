/**
 * SQL predicate (no leading AND) keeping listings inside our supported region:
 * United States or Canada. The previous version short-circuited on
 * `is_remote = true` regardless of location, which let offshore remote jobs
 * (Bangalore, Bogotá, "Remote — Europe") and null-location remote jobs from
 * staffing firms silently pass.
 *
 * Rule:
 *   1. Reject any explicit foreign signal in the location string.
 *   2. Otherwise admit only if at least ONE of these is true:
 *      a. Location carries a positive US/CA marker (USA, Canada, US state /
 *         CA province abbreviation, full state/province name, major US/CA
 *         city, "Remote US" / "Remote, US" / "US-Remote" / "North America" /
 *         "AMER"), OR
 *      b. is_remote = true AND the location is null/empty/just "Remote" AND
 *         the company has US-side H1B sponsorship evidence — interpreted as
 *         "this is a real US employer's null-location remote posting"
 *         (requires `companyAlias` to be passed). Without the company alias
 *         the rescue path is FALSE and these rows are rejected.
 *
 * NOTE: the function is still named `sqlJobLocatedInUsa` for backwards
 * compatibility — it accepts US **or** Canada. Rename when the ~10 callsites
 * can be churned together.
 */
export function sqlJobLocatedInUsa(
  tableAlias: string,
  opts: { companyAlias?: string } = {},
): string {
  const a = tableAlias.trim() || "jobs"
  const c = opts.companyAlias?.trim() || ""

  // H1B rescue path — applied only when the caller joined `companies` and
  // passed the alias. Allows a remote job to pass when location is null /
  // empty / plain "Remote" AND the company has documented H1B sponsorship.
  const remoteWithCompanyEvidence = c
    ? `(
        ${a}.is_remote = true
        AND (
          ${a}.location IS NULL
          OR btrim(COALESCE(${a}.location, '')) = ''
          OR COALESCE(${a}.location, '') ~* '^\\s*remote\\s*$'
        )
        AND (
          COALESCE(${c}.h1b_sponsor_count_3yr, 0) > 0
          OR COALESCE(${c}.sponsors_h1b, false) = true
        )
      )`
    : `FALSE`

  // Use the generated `is_us_or_ca_strict` column populated by
  // job_location_is_us_ca_strict(location) — see
  // scripts/migrations/add-jobs-us-ca-fast-predicate.sql. This replaces the
  // per-row regex predicate (~7s seq scan over 330K rows) with an index lookup.
  // The strict-true rows are covered by idx_jobs_us_ca_active_freshest.
  return `(${a}.is_us_or_ca_strict = true OR ${remoteWithCompanyEvidence})`
}


/**
 * SQL predicate (no leading AND) so listings stay US-focused until we have a country column.
 * - Remote roles (typical US-market listings use is_remote without a foreign city).
 * - On-site / hybrid with ATS-style "City, ST" where ST is a US state or DC.
 */
export function sqlJobLocatedInUsa(tableAlias: string): string {
  const a = tableAlias.trim() || "jobs"
  const states =
    "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC"
  return `(
    ${a}.is_remote = true
    OR COALESCE(${a}.location, '') ILIKE '%United States%'
    OR COALESCE(${a}.location, '') ~* ',\\s*(${states})\\s*$'
  )`
}

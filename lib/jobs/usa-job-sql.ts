/**
 * SQL predicate (no leading AND) so listings stay US-focused until we have a country column.
 * Handles the following location formats seen across ATSes:
 *   - is_remote flag (no city needed)
 *   - "United States" or "USA" anywhere in the string
 *   - "City, ST"  — state abbreviation at end (Greenhouse, Lever, etc.)
 *   - "City, ST 12345" — state + zip (retail/warehouse ATSes)
 *   - "City, ST, USA" — state + country suffix
 *   - "US, ST, City"  — Amazon-style ISO prefix
 */
export function sqlJobLocatedInUsa(tableAlias: string): string {
  const a = tableAlias.trim() || "jobs"
  const states =
    "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC"
  return `(
    ${a}.is_remote = true
    OR COALESCE(${a}.location, '') ILIKE '%United States%'
    OR COALESCE(${a}.location, '') ~* ',\\s*(${states})\\s*$'
    OR COALESCE(${a}.location, '') ~* ',\\s*(${states})\\s+\\d{5}'
    OR COALESCE(${a}.location, '') ~* ',\\s*(${states})\\s*,'
    OR COALESCE(${a}.location, '') ILIKE '%, USA'
    OR COALESCE(${a}.location, '') ~* '^US,\\s*[A-Z]{2},'
  )`
}

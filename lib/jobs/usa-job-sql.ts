/**
 * SQL predicate (no leading AND) keeping listings inside our supported region:
 * United States or Canada. Remote jobs are included only when their location
 * carries no explicit foreign signal — otherwise an offshore "remote" listing
 * (e.g. Bangalore) silently passes the filter.
 *
 * Handles the following location formats seen across ATSes:
 *   - is_remote flag (no city needed) — *unless* location names a foreign place
 *   - "United States" / "USA" / ", USA" / "US, ST, City" (Amazon-style)
 *   - "Canada" / ", Canada" / "City, CA, Canada"
 *   - "City, ST" — US state abbreviation at end (Greenhouse, Lever, etc.)
 *   - "City, ST 12345" — state + zip (retail/warehouse ATSes)
 *   - "City, ST, USA" — state + country suffix
 *   - "City, PR" — Canadian province abbreviation at end
 *   - Full province / state names embedded in the string
 *
 * NOTE: this is named `sqlJobLocatedInUsa` for historical reasons — it now
 * accepts US **or** Canada. Rename when callsite churn is acceptable.
 */
export function sqlJobLocatedInUsa(tableAlias: string): string {
  const a = tableAlias.trim() || "jobs"

  const states =
    "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC"
  const provinces = "AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT"
  const regions = `${states}|${provinces}`

  // Full state / province names — used so locations like "Ontario" or "Texas"
  // (no abbreviation, no country suffix) still pass.
  const fullNames = [
    // US states
    "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware",
    "florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky",
    "louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi",
    "missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico",
    "new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania",
    "rhode island","south carolina","south dakota","tennessee","texas","utah","vermont",
    "virginia","washington","west virginia","wisconsin","wyoming","district of columbia",
    // Canadian provinces / territories
    "alberta","british columbia","manitoba","new brunswick","newfoundland and labrador",
    "northwest territories","nova scotia","nunavut","ontario","prince edward island",
    "quebec","saskatchewan","yukon",
  ].join("|")

  // Definitive non-US / non-Canada signals. Kept in sync with
  // lib/jobs/location-filter.ts → FOREIGN_COUNTRY_RE / FOREIGN_CITY_RE.
  // Indian-specific cities are listed exhaustively because offshore remote
  // jobs are the most common leak path.
  const foreign = [
    // Anglo
    "united kingdom","u\\.?k\\.?","britain","england","scotland","wales",
    "northern ireland","republic of ireland","ireland",
    // Europe
    "germany","france","spain","italy","netherlands","holland","belgium","luxembourg",
    "switzerland","austria","portugal","sweden","norway","denmark","finland","iceland",
    "poland","czech republic","czechia","slovakia","hungary","romania","bulgaria",
    "greece","croatia","slovenia","estonia","latvia","lithuania","ukraine","russia",
    // Asia / Oceania
    "india","china","japan","south korea","korea","taiwan","hong kong","singapore",
    "malaysia","thailand","indonesia","philippines","vietnam","pakistan","bangladesh",
    "sri lanka","australia","new zealand","nepal",
    // Middle East / Africa
    "israel","turkey","egypt","morocco","south africa","nigeria","kenya",
    "u\\.?a\\.?e\\.?","united arab emirates","saudi arabia","qatar","bahrain","oman",
    "lebanon","jordan",
    // Latin America
    "brazil","mexico","argentina","chile","colombia","peru","uruguay","venezuela",
    "ecuador","costa rica","panama",
    // Unambiguous foreign cities (no US/Canadian collision)
    "bangalore","bengaluru","mumbai","new delhi","chennai","hyderabad","kolkata",
    "ahmedabad","gurgaon","gurugram","noida","pune","kochi","jaipur","mohali",
    "indore","coimbatore","trivandrum","thiruvananthapuram","visakhapatnam",
    "beijing","shanghai","shenzhen","guangzhou","chongqing",
    "tokyo","osaka","kyoto","yokohama","nagoya","fukuoka",
    "krakow","gdansk","wroclaw","stockholm","copenhagen","helsinki","brussels",
    "munich","frankfurt","barcelona","milan","prague","bucharest","budapest","sofia",
    "reykjavik","zurich","amsterdam",
    "kuala lumpur","bangkok","jakarta","manila","hanoi","ho chi minh","seoul","taipei",
    "sao paulo","rio de janeiro","buenos aires","guadalajara","mexico city",
    "tel aviv","dubai","abu dhabi","riyadh","lagos","nairobi","cape town","johannesburg",
  ].join("|")

  return `(
    NOT COALESCE(${a}.location, '') ~* '\\m(${foreign})\\M'
    AND (
      ${a}.is_remote = true
      OR COALESCE(${a}.location, '') ILIKE '%United States%'
      OR COALESCE(${a}.location, '') ILIKE '%Canada%'
      OR COALESCE(${a}.location, '') ILIKE '%, USA'
      OR COALESCE(${a}.location, '') ILIKE '%, U.S.A.%'
      OR COALESCE(${a}.location, '') ~* ',\\s*(${regions})\\s*$'
      OR COALESCE(${a}.location, '') ~* ',\\s*(${regions})\\s+\\d{5}'
      OR COALESCE(${a}.location, '') ~* ',\\s*(${regions})\\s*,'
      OR COALESCE(${a}.location, '') ~* '^US,\\s*[A-Z]{2},'
      OR COALESCE(${a}.location, '') ~* '\\m(${fullNames})\\M'
    )
  )`
}

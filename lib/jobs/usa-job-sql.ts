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

  const states =
    "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC"
  const provinces = "AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT"
  const regions = `${states}|${provinces}`

  // Full state / province names embedded in the location string.
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

  // Major US/CA cities recognised as positive signal even without a state
  // qualifier. Kept in sync with lib/jobs/location-filter.ts.
  const majorCities = [
    "san francisco","san francisco bay area","new york","new york city","los angeles",
    "san diego","san jose","santa clara","mountain view","palo alto","menlo park",
    "redwood city","sunnyvale","seattle","bellevue","redmond","austin","boston",
    "cambridge","chicago","atlanta","dallas","houston","denver","raleigh","durham",
    "phoenix","tempe","irvine","santa monica","sacramento","portland","miami","tampa",
    "orlando","philadelphia","pittsburgh","minneapolis","madison","ann arbor",
    "indianapolis","columbus","charlotte","jacksonville","las vegas","oklahoma city",
    "salt lake city","kansas city","st louis","st. louis","milwaukee","cleveland",
    "cincinnati","detroit","baltimore","fort worth","el paso","memphis","nashville",
    "louisville","new orleans","baton rouge","lafayette",
    // Canada
    "toronto","vancouver","montreal","waterloo","ottawa","calgary","edmonton",
    "mississauga","kitchener","winnipeg","hamilton","quebec city","halifax","victoria",
    "regina","saskatoon",
  ].join("|")

  // Explicit foreign signals — country names, distinctive cities, and regions.
  // Kept in sync with lib/jobs/location-filter.ts. We deliberately omit
  // "London", "Lebanon", "Jordan", "Panama" etc. because of US/CA homonyms;
  // strict mode below catches those by *requiring* a positive signal.
  const foreign = [
    // Anglo
    "united kingdom","u\\.?k\\.?","britain","england","scotland","wales",
    "northern ireland","republic of ireland","ireland",
    // Europe (continent + countries)
    "europe","european union","emea","cee","nordics",
    "germany","france","spain","italy","netherlands","holland","belgium","luxembourg",
    "switzerland","austria","portugal","sweden","norway","denmark","finland","iceland",
    "poland","czech republic","czechia","slovakia","hungary","romania","bulgaria",
    "greece","croatia","slovenia","estonia","latvia","lithuania","ukraine","russia",
    // Asia / Oceania
    "apac","asia","asia pacific","anz","oceania",
    "india","china","japan","south korea","korea","taiwan","hong kong","singapore",
    "malaysia","thailand","indonesia","philippines","vietnam","pakistan","bangladesh",
    "sri lanka","australia","new zealand","nepal",
    // Middle East / Africa
    "mena","middle east","africa","sub-saharan",
    "israel","turkey","egypt","morocco","south africa","nigeria","kenya",
    "u\\.?a\\.?e\\.?","united arab emirates","saudi arabia","qatar","bahrain","oman",
    "lebanon","jordan",
    // Latin America (continent + countries)
    "latam","latin america","south america",
    "brazil","mexico","argentina","chile","colombia","peru","uruguay","venezuela",
    "ecuador","costa rica","panama","paraguay","bolivia",
    // Generic "anywhere" markers that we treat as foreign for a strictly
    // US/CA feed.
    "worldwide","anywhere","global","globally","international",
    // Unambiguous foreign cities (no US/CA collision)
    "bangalore","bengaluru","mumbai","new delhi","chennai","hyderabad","kolkata",
    "ahmedabad","gurgaon","gurugram","noida","pune","kochi","jaipur","mohali",
    "indore","coimbatore","trivandrum","thiruvananthapuram","visakhapatnam",
    "beijing","shanghai","shenzhen","guangzhou","chongqing",
    "tokyo","osaka","kyoto","yokohama","nagoya","fukuoka",
    "krakow","gdansk","wroclaw","stockholm","copenhagen","helsinki","brussels",
    "munich","frankfurt","barcelona","milan","prague","bucharest","budapest","sofia",
    "reykjavik","zurich","amsterdam","dublin","lisbon","madrid","vienna","warsaw",
    "kuala lumpur","bangkok","jakarta","manila","hanoi","ho chi minh","seoul","taipei",
    "sao paulo","rio de janeiro","buenos aires","guadalajara","mexico city",
    "bogota","bogotá","medellin","medellín","cali","cartagena","lima","santiago",
    "quito","caracas","asuncion","montevideo","la paz",
    "tel aviv","dubai","abu dhabi","riyadh","lagos","nairobi","cape town","johannesburg",
  ].join("|")

  // Positive US/CA marker present anywhere in the location string.
  const positiveUsCaMarker = `(
    COALESCE(${a}.location, '') ~* '\\m(usa?|u\\.s\\.?a?\\.?|united states(?:\\s+of\\s+america)?|canada|north america|americas|amer)\\M'
    OR COALESCE(${a}.location, '') ILIKE '%, USA'
    OR COALESCE(${a}.location, '') ILIKE '%, U.S.A.%'
    OR COALESCE(${a}.location, '') ~* ',\\s*(${regions})\\s*([,\\.]|$)'
    OR COALESCE(${a}.location, '') ~* ',\\s*(${regions})\\s+\\d{5}'
    OR COALESCE(${a}.location, '') ~* '^US[\\-,]\\s*[A-Z]{2}[\\-,]'
    OR COALESCE(${a}.location, '') ~* '\\m(${fullNames})\\M'
    OR COALESCE(${a}.location, '') ~* '\\m(${majorCities})\\M'
  )`

  // H1B rescue path — applied only when the caller joined `companies` and
  // passed the alias. Allows a remote job to pass when location is null /
  // empty / plain "Remote" AND the company has documented H1B sponsorship
  // (i.e., a real US employer with offshore-ineligible green-card/visa
  // posting infrastructure).
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

  return `(
    NOT COALESCE(${a}.location, '') ~* '\\m(${foreign})\\M'
    AND (${positiveUsCaMarker} OR ${remoteWithCompanyEvidence})
  )`
}

/**
 * Cost-of-living index for the 30 largest US metro areas.
 * Index: US average = 100. Source: MIT Living Wage / Numbeo composite 2024.
 */

const COL_INDEX: Record<string, number> = {
  "san francisco":    177,
  "san jose":         172,
  "new york":         187,
  "nyc":              187,
  "manhattan":        196,
  "brooklyn":         176,
  "seattle":          151,
  "boston":           162,
  "washington":       152,
  "dc":               152,
  "washington dc":    152,
  "los angeles":      165,
  "la":               165,
  "san diego":        157,
  "denver":           128,
  "austin":           121,
  "miami":            118,
  "chicago":          107,
  "dallas":           103,
  "houston":          99,
  "phoenix":          108,
  "minneapolis":      112,
  "portland":         130,
  "atlanta":          106,
  "charlotte":        109,
  "philadelphia":     118,
  "baltimore":        120,
  "nashville":        116,
  "las vegas":        108,
  "detroit":          93,
  "columbus":         97,
  "indianapolis":     96,
  "jacksonville":     103,
  "san antonio":      98,
  "memphis":          89,
  "louisville":       93,
  "richmond":         108,
  "new orleans":      99,
  "pittsburgh":       104,
  "salt lake city":   118,
  "raleigh":          112,
  "tucson":           102,
  "omaha":            94,
  "albuquerque":      102,
  "fresno":           111,
  "sacramento":       140,
}

const US_AVERAGE = 100

function normalize(city: string): string {
  return city
    .toLowerCase()
    .replace(/,.*$/, "")     // strip ", CA" suffix
    .replace(/\s+/g, " ")
    .trim()
}

function getColIndex(city: string): number {
  const key = normalize(city)
  return COL_INDEX[key] ?? US_AVERAGE
}

/**
 * Returns the equivalent salary in `toCity` that has the same purchasing power
 * as `salary` in `fromCity`.
 *
 * Example: $200k in San Francisco (177) ≈ $136k in Austin (121)
 */
export function adjustSalaryForCOL(salary: number, fromCity: string, toCity: string): number {
  const from = getColIndex(fromCity)
  const to   = getColIndex(toCity)
  if (from === to) return salary
  return Math.round((salary / from) * to)
}

/**
 * Returns the COL index for a city (100 = US average).
 */
export function getColIndexForCity(city: string): number {
  return getColIndex(city)
}

/**
 * Returns true if we have a known COL index for the city.
 */
export function hasColData(city: string): boolean {
  return normalize(city) in COL_INDEX
}

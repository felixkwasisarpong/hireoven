/**
 * Exact DOL prevailing-wage level thresholds for a job.
 *
 * This is the precise version of lib/stay/wage-level-query.ts. That module *infers* Level II/III/IV
 * cutoffs from the p05 of certified LCA filings at SOC x STATE grain; this one reads the thresholds
 * DOL actually publishes, at SOC x OEWS-AREA grain, from `oflc_wage_levels`.
 *
 * It matters because the H-1B lottery is wage-weighted (eff. 27 Feb 2026): the level sets the
 * registrant's entry count (I = 1 ... IV = 4), so "what salary reaches Level III" is a number a
 * candidate negotiates against. An approximation is not good enough to put in someone's mouth.
 *
 * Resolution is deliberately tiered and reports how it got there, so the UI can be honest:
 *   county  -> a county name in the location matched Geography.csv        (most precise)
 *   city    -> a principal city of an OEWS metro matched                  (good)
 *   (none)  -> caller falls back to getPrevailingWageBands()'s state-level model, or shows nothing
 *
 * Web-box safe: every query is a point lookup on a primary key or a covering index.
 */

import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { bareSocCode, normalizeJobTitle, titlePhrases } from "@/lib/salaries/soc-classifier"

export type AreaMatch = "county" | "city"

/**
 * name_rank used by scripts/import-census-places.ts for crosswalk-derived suburbs. Rows at or
 * above this rank are gap-fill: they never outrank a metro's principal cities, and they are
 * excluded from the state-less lookup where their sheer number would create false ambiguity.
 */
const CENSUS_PLACE_RANK = 50

export interface ResolvedArea {
  area: string
  areaName: string
  stateAbbr: string
  matchedOn: AreaMatch
}

export interface ExactWageLevels {
  /** Annual USD thresholds. levels[0] = Level I ... levels[3] = Level IV. */
  levels: readonly [number, number, number, number]
  average: number | null
  socCode: string
  /** Official occupation title, e.g. 'Software Developers'. */
  socLabel: string | null
  area: string
  areaName: string
  wageYear: string
}

// ---------------------------------------------------------------------------
// Location parsing (pure)
// ---------------------------------------------------------------------------

const STATE_ABBRS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY",
  "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND",
  "OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
  "PR","VI","GU",
])

const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama:"AL", alaska:"AK", arizona:"AZ", arkansas:"AR", california:"CA", colorado:"CO",
  connecticut:"CT", delaware:"DE", florida:"FL", georgia:"GA", hawaii:"HI", idaho:"ID",
  illinois:"IL", indiana:"IN", iowa:"IA", kansas:"KS", kentucky:"KY", louisiana:"LA",
  maine:"ME", maryland:"MD", massachusetts:"MA", michigan:"MI", minnesota:"MN",
  mississippi:"MS", missouri:"MO", montana:"MT", nebraska:"NE", nevada:"NV",
  "new hampshire":"NH", "new jersey":"NJ", "new mexico":"NM", "new york":"NY",
  "north carolina":"NC", "north dakota":"ND", ohio:"OH", oklahoma:"OK", oregon:"OR",
  pennsylvania:"PA", "rhode island":"RI", "south carolina":"SC", "south dakota":"SD",
  tennessee:"TN", texas:"TX", utah:"UT", vermont:"VT", virginia:"VA", washington:"WA",
  "west virginia":"WV", wisconsin:"WI", wyoming:"WY",
  "district of columbia":"DC", "puerto rico":"PR",
}

/** Segments that are country noise, not places. */
const COUNTRY_NOISE = new Set(["usa", "us", "u s", "united states", "united states of america", "america"])

/**
 * Canadian markers. These exist because several Canadian province names collide with US city
 * names: "Toronto, Ontario" would otherwise match Ontario, CA — a principal city of the
 * Riverside-San Bernardino-Ontario metro — and hand a Canadian req a US prevailing wage.
 * A US state abbreviation elsewhere in the string overrides this ("Ontario, CA" is California).
 */
const CANADA_MARKERS = new Set([
  "canada", "can", "ontario", "quebec", "alberta", "british columbia", "manitoba",
  "saskatchewan", "nova scotia", "new brunswick", "newfoundland and labrador",
  "prince edward island", "yukon", "nunavut", "northwest territories",
])

/**
 * Marketing wrappers around a metro name: "Greater Seattle Area" -> "seattle",
 * "North Louisiana Region" -> "north louisiana". Applied to city candidates only.
 */
function stripMetroWrapper(city: string): string {
  return city
    .replace(/^(greater|the)\s+/, "")
    .replace(/\s+(area|region|metro|metropolitan area|metro area)$/, "")
    .trim()
}

/**
 * City spellings to try, in order. "New York City" must also be tried as "New York" because the
 * OEWS metro name is "New York-Newark-Jersey City"; likewise "Oklahoma City" must NOT lose its
 * "City", so we try the original first and the stripped form only as a fallback.
 */
function cityVariants(city: string): string[] {
  const out = [city]
  const wrapped = stripMetroWrapper(city)
  if (wrapped && wrapped !== city) out.push(wrapped)
  for (const base of [...out]) {
    if (base.endsWith(" city")) {
      const trimmed = base.slice(0, -" city".length).trim()
      if (trimmed) out.push(trimmed)
    }
  }
  return [...new Set(out.filter(Boolean))]
}

function normSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export interface ParsedLocation {
  stateAbbr: string | null
  /** County name with its administrative suffix stripped ('mecklenburg'), if the string named one. */
  county: string | null
  /** Candidate city names, most specific first. */
  cities: string[]
  /** The string names a non-US country (currently Canada). No US wage area should be assigned. */
  foreign: boolean
}

/**
 * Parse a free-text job location into the pieces the OEWS-area lookup needs.
 *
 * Handles the shapes our feed actually produces: "Reston, VA", "Seattle, Washington, USA",
 * "Charlotte, Mecklenburg County" (some ATS feeds emit the county outright, which is the most
 * precise input we can get), and bare "New York".
 */
export function parseUsLocation(location: string | null | undefined): ParsedLocation {
  const raw = (location ?? "").trim()
  if (!raw) return { stateAbbr: null, county: null, cities: [], foreign: false }

  // Feeds separate parts with commas, pipes, or a spaced dash ("Princeton - NJ - US").
  const segments = raw
    .split(/[,|]|\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  // An explicit 2-letter abbreviation outranks a state *name*, because several of the largest
  // cities in the country ARE state names: "New York, NY" and "Washington, DC" must keep
  // "new york"/"washington" as city candidates or the two biggest markets resolve to nothing.
  let stateFromAbbr: string | null = null
  let stateFromName: string | null = null
  let county: string | null = null
  let foreign = false
  const cities: string[] = []

  for (const seg of segments) {
    const norm = normSegment(seg)
    if (!norm || COUNTRY_NOISE.has(norm)) continue

    if (CANADA_MARKERS.has(norm)) {
      foreign = true
      // Still a city candidate: "Ontario, CA" is California, and the `foreign` flag (which a US
      // state abbreviation cancels) is what decides whether these candidates are ever used.
      cities.push(norm)
      continue
    }

    const upper = seg.trim().toUpperCase()
    if (upper.length === 2 && STATE_ABBRS.has(upper)) {
      stateFromAbbr = upper
      continue
    }

    // "Mecklenburg County" / "Orleans Parish" / "King County"
    if (/\b(county|parish|borough|census area|municipality)\b/.test(norm)) {
      const stripped = norm
        .replace(/\b(county|parish|borough|census area|city and borough|municipality)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
      if (stripped) county = stripped
      continue
    }

    // A state name is recorded as the state AND kept as a city candidate.
    const asState = STATE_NAME_TO_ABBR[norm]
    if (asState) {
      stateFromName ??= asState
      cities.push(norm)
      continue
    }

    // A state name glued onto the end of a segment ("Seattle Washington").
    let matchedGlued = false
    for (const [name, abbr] of Object.entries(STATE_NAME_TO_ABBR)) {
      if (norm.endsWith(` ${name}`)) {
        stateFromName ??= abbr
        const head = norm.slice(0, norm.length - name.length).trim()
        if (head) cities.push(head)
        matchedGlued = true
        break
      }
    }
    if (matchedGlued) continue

    cities.push(norm)
  }

  const expanded = [...new Set(cities.flatMap(cityVariants))]
  // An explicit US state abbreviation wins: "Ontario, CA" is California, not Canada.
  return {
    stateAbbr: stateFromAbbr ?? stateFromName,
    county,
    cities: expanded,
    foreign: foreign && !stateFromAbbr,
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

let cachedWageYear: { value: string | null; at: number } | null = null
const WAGE_YEAR_TTL_MS = 10 * 60 * 1000

/** Newest loaded wage year. Cached — it changes once a year, on 1 July. */
export async function getCurrentWageYear(): Promise<string | null> {
  if (cachedWageYear && Date.now() - cachedWageYear.at < WAGE_YEAR_TTL_MS) return cachedWageYear.value
  if (!hasPostgresEnv()) return null
  try {
    const { rows } = await getPostgresPool().query<{ wage_year: string }>(
      `SELECT wage_year FROM oflc_wage_levels ORDER BY wage_year DESC LIMIT 1`
    )
    const value = rows[0]?.wage_year ?? null
    cachedWageYear = { value, at: Date.now() }
    return value
  } catch {
    return null
  }
}

/**
 * Free-text location -> OEWS area. County match wins over city match: counties are what
 * Geography.csv is actually keyed on, while our city index is parsed out of metro names.
 */
export async function resolveOflcArea(location: string | null | undefined): Promise<ResolvedArea | null> {
  if (!hasPostgresEnv()) return null
  const parsed = parseUsLocation(location)
  if (parsed.foreign) return null
  const wageYear = await getCurrentWageYear()
  if (!wageYear) return null

  try {
    const pool = getPostgresPool()

    // Some ATS feeds emit "City, County" with no state ("Charlotte, Mecklenburg County",
    // "Seattle, King County"). Intersecting the two pins the state exactly — Mecklenburg alone
    // is ambiguous (NC and VA), but Charlotte + Mecklenburg is not.
    if (!parsed.stateAbbr && parsed.county && parsed.cities.length) {
      const { rows } = await pool.query<{ area: string; area_name: string; state_ab: string }>(
        `SELECT DISTINCT c.area, c.area_name, c.state_ab
           FROM oflc_area_counties c
           JOIN oflc_area_cities ct
             ON ct.wage_year = c.wage_year AND ct.area = c.area
          WHERE c.wage_year = $1 AND c.county_norm = $2 AND ct.city_norm = ANY($3::text[])
          LIMIT 2`,
        [wageYear, parsed.county, parsed.cities]
      )
      if (rows.length === 1) {
        return {
          area: rows[0].area,
          areaName: rows[0].area_name,
          stateAbbr: rows[0].state_ab,
          matchedOn: "county",
        }
      }
    }

    // County with no state and no usable city. Accept only when the county name is unique
    // nationally, so an ambiguous "Orange County" never silently picks a random state's metro.
    if (!parsed.stateAbbr && parsed.county) {
      const { rows } = await pool.query<{ area: string; area_name: string; state_ab: string }>(
        `SELECT DISTINCT area, area_name, state_ab
           FROM oflc_area_counties
          WHERE wage_year = $1 AND county_norm = $2
          LIMIT 2`,
        [wageYear, parsed.county]
      )
      if (rows.length === 1) {
        return {
          area: rows[0].area,
          areaName: rows[0].area_name,
          stateAbbr: rows[0].state_ab,
          matchedOn: "county",
        }
      }
    }

    // City with no state ("San Francisco", "Chicago"). Accept only if the name maps to exactly
    // one metro nationally — "Springfield" and "Columbus" must stay unresolved rather than guess.
    if (!parsed.stateAbbr) {
      for (const city of parsed.cities) {
        // Uniqueness is per AREA, not per (area, state): a metro spanning several states
        // ("New York-Newark-Jersey City, NY-NJ") has one area but multiple state rows, and
        // counting those as ambiguous would reject the largest markets in the country.
        // Restricted to principal cities (name_rank < CENSUS_PLACE_RANK). With no state to
        // disambiguate, only a metro's own headline name is safe: including the ~20k Census
        // suburbs here would make "San Francisco" and "Chicago" look ambiguous and resolve
        // nothing, trading a correct answer for silence.
        const { rows } = await pool.query<{ area: string; area_name: string; state_ab: string }>(
          `SELECT area, min(area_name) AS area_name, min(state_ab) AS state_ab
             FROM oflc_area_cities
            WHERE wage_year = $1 AND city_norm = $2 AND name_rank < ${CENSUS_PLACE_RANK}
            GROUP BY area
            LIMIT 2`,
          [wageYear, city]
        )
        if (rows.length === 1) {
          return {
            area: rows[0].area,
            areaName: rows[0].area_name,
            stateAbbr: rows[0].state_ab,
            matchedOn: "city",
          }
        }
      }
      return null
    }

    if (parsed.county) {
      const { rows } = await pool.query<{ area: string; area_name: string }>(
        `SELECT area, area_name FROM oflc_area_counties
          WHERE wage_year = $1 AND state_ab = $2 AND county_norm = $3
          LIMIT 1`,
        [wageYear, parsed.stateAbbr, parsed.county]
      )
      if (rows[0]) {
        return {
          area: rows[0].area,
          areaName: rows[0].area_name,
          stateAbbr: parsed.stateAbbr,
          matchedOn: "county",
        }
      }
    }

    for (const city of parsed.cities) {
      const { rows } = await pool.query<{ area: string; area_name: string }>(
        `SELECT area, area_name FROM oflc_area_cities
          WHERE wage_year = $1 AND state_ab = $2 AND city_norm = $3
          ORDER BY name_rank ASC
          LIMIT 1`,
        [wageYear, parsed.stateAbbr, city]
      )
      if (rows[0]) {
        return {
          area: rows[0].area,
          areaName: rows[0].area_name,
          stateAbbr: parsed.stateAbbr,
          matchedOn: "city",
        }
      }
    }

    return null
  } catch {
    return null
  }
}

/** Job title -> SOC, via the longest token phrase present in `soc_title_lexicon`. */
export async function classifyTitleToSoc(
  title: string | null | undefined
): Promise<{ socCode: string; matchedPhrase: string; support: number } | null> {
  if (!hasPostgresEnv()) return null
  const norm = normalizeJobTitle(title)
  const phrases = titlePhrases(norm)
  if (!phrases.length) return null

  try {
    // One round trip: ask for every candidate phrase, then prefer the longest, breaking ties on
    // support. Ordering in SQL avoids shipping the whole lexicon to the app.
    const { rows } = await getPostgresPool().query<{
      soc_code: string
      title_norm: string
      support: number
    }>(
      `SELECT soc_code, title_norm, support
         FROM soc_title_lexicon
        WHERE title_norm = ANY($1::text[])
        ORDER BY token_count DESC, support DESC
        LIMIT 1`,
      [phrases]
    )
    const hit = rows[0]
    return hit ? { socCode: hit.soc_code, matchedPhrase: hit.title_norm, support: hit.support } : null
  } catch {
    return null
  }
}

/** Published Level I-IV thresholds for one (area, SOC). */
export async function getExactWageLevels(input: {
  area: string
  socCode: string
}): Promise<ExactWageLevels | null> {
  if (!hasPostgresEnv()) return null
  const soc = bareSocCode(input.socCode)
  if (!soc || !input.area) return null

  const wageYear = await getCurrentWageYear()
  if (!wageYear) return null

  try {
    const { rows } = await getPostgresPool().query<{
      level1: number; level2: number; level3: number; level4: number
      average: number | null; area_name: string | null; soc_label: string | null
    }>(
      `SELECT w.level1, w.level2, w.level3, w.level4, w.average,
              (SELECT area_name FROM oflc_area_counties c
                WHERE c.wage_year = w.wage_year AND c.area = w.area LIMIT 1) AS area_name,
              (SELECT title FROM oflc_soc_titles t
                WHERE t.soc_code = w.soc_code AND t.source = 'oes' LIMIT 1) AS soc_label
         FROM oflc_wage_levels w
        WHERE w.wage_year = $1 AND w.area = $2 AND w.soc_code = $3
        LIMIT 1`,
      [wageYear, input.area, soc]
    )
    const r = rows[0]
    if (!r) return null

    return {
      levels: [r.level1, r.level2, r.level3, r.level4] as const,
      average: r.average,
      socCode: soc,
      socLabel: r.soc_label,
      area: input.area,
      areaName: r.area_name ?? "",
      wageYear,
    }
  } catch {
    return null
  }
}

export interface JobWageLevelContext {
  levels: ExactWageLevels
  area: ResolvedArea
  soc: { socCode: string; matchedPhrase: string; support: number }
}

/**
 * Everything the Level Gap card needs for one req, or null if we cannot ground it.
 *
 * Returns null rather than guessing: no resolvable area, no confident SOC, or no published row
 * for that (area, SOC) pair all mean we say nothing. Callers should fall back to the state-level
 * model in wage-level-query.ts only if they want a softer, clearly-labelled estimate.
 */
export async function getJobWageLevelContext(input: {
  title: string | null | undefined
  location: string | null | undefined
}): Promise<JobWageLevelContext | null> {
  const [area, soc] = await Promise.all([
    resolveOflcArea(input.location),
    classifyTitleToSoc(input.title),
  ])
  if (!area || !soc) return null

  const levels = await getExactWageLevels({ area: area.area, socCode: soc.socCode })
  if (!levels) return null

  return { levels, area, soc }
}

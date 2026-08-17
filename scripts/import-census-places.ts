/**
 * Widen city -> OEWS area coverage using the Census place-to-county crosswalk.
 *
 * Source: https://www2.census.gov/geo/docs/reference/codes2020/national_place_by_county2020.txt
 * (~33.6k rows, pipe-delimited, US Government public domain). Static 2020 vintage — place and
 * county boundaries move rarely, so this is effectively a one-time load.
 *
 * WHY: oflc_area_cities is otherwise parsed out of OEWS *metro names*, which only name a metro's
 * principal cities ("Washington-Arlington-Alexandria"). Suburbs are invisible to it — "Reston, VA",
 * "McLean, VA", "Costa Mesa, CA" and "Redmond, WA" all failed to resolve, and those are exactly
 * where the jobs are. This file supplies place -> county, and Geography.csv already gives us
 * county -> area, so the chain completes: Reston CDP -> Fairfax County -> area 47900.
 *
 * Rows land in oflc_area_cities at name_rank = 50, BELOW every principal city (rank 0..n), so a
 * principal-city match always wins and this only fills gaps. Requires the OFLC import to have run
 * first (it reads oflc_area_counties).
 *
 * Dry run by default; pass --apply to write.
 *
 *   npx tsx scripts/import-census-places.ts
 *   npx tsx scripts/import-census-places.ts --apply
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import path from "node:path"
import { getPostgresPool } from "@/lib/postgres/server"

const APPLY = process.argv.includes("--apply")

function flagStr(name: string, fallback: string): string {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : fallback
}

const SRC_URL = flagStr(
  "url",
  "https://www2.census.gov/geo/docs/reference/codes2020/national_place_by_county2020.txt"
)
const LOCAL = flagStr("file", "")
const CACHE_DIR = path.join(process.cwd(), ".cache")

/** Rank for crosswalk-derived cities. Must stay above every principal-city rank. */
const CENSUS_PLACE_RANK = 50

/**
 * Census appends the legal type to the name: 'Reston CDP', 'El Segundo city',
 * 'Oklahoma City city'. Strip only the FINAL type token, so 'Oklahoma City' keeps its "City".
 */
const TYPE_SUFFIX =
  /\s+(cdp|city|town|village|borough|municipality|township|comunidad|zona urbana|consolidated government|metro government|metropolitan government|unified government|government)$/i

export function stripPlaceType(placeName: string): string {
  let s = placeName.trim()
  // Some names carry a parenthetical qualifier: "Boise City city" / "Athens-Clarke County unified government".
  for (let i = 0; i < 3; i++) {
    const next = s.replace(TYPE_SUFFIX, "").trim()
    if (next === s) break
    s = next
  }
  return s
}

function normPlace(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function normCounty(value: string): string {
  return normPlace(value)
    .replace(/\b(county|parish|borough|census area|city and borough|municipality|municipio|city)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

async function loadSource(): Promise<string> {
  if (LOCAL) return fs.readFileSync(LOCAL, "utf8")
  const cached = path.join(CACHE_DIR, "national_place_by_county2020.txt")
  if (fs.existsSync(cached)) {
    console.log(`Reading cached ${cached}`)
    return fs.readFileSync(cached, "utf8")
  }
  console.log(`Downloading ${SRC_URL} ...`)
  const res = await fetch(SRC_URL)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const text = await res.text()
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(cached, text)
  return text
}

async function main(): Promise<void> {
  const text = await loadSource()
  const lines = text.split(/\r?\n/).filter(Boolean)
  const header = lines.shift()
  if (!header || !header.startsWith("STATE|")) throw new Error("Unexpected header — Census changed the layout")

  const cols = header.split("|")
  const iState = cols.indexOf("STATE")
  const iCounty = cols.indexOf("COUNTYNAME")
  const iPlace = cols.indexOf("PLACENAME")
  if (iState < 0 || iCounty < 0 || iPlace < 0) throw new Error("Missing expected columns")

  // (state, city) -> set of counties
  const placeCounties = new Map<string, Set<string>>()
  for (const line of lines) {
    const f = line.split("|")
    const state = (f[iState] ?? "").trim().toUpperCase()
    const county = normCounty(f[iCounty] ?? "")
    const city = normPlace(stripPlaceType(f[iPlace] ?? ""))
    if (!state || !county || !city) continue
    const key = `${state}|${city}`
    let set = placeCounties.get(key)
    if (!set) {
      set = new Set()
      placeCounties.set(key, set)
    }
    set.add(county)
  }
  console.log(`Parsed ${lines.length.toLocaleString()} rows -> ${placeCounties.size.toLocaleString()} distinct (state, place)`)

  const pool = getPostgresPool()
  const client = await pool.connect()
  try {
    await client.query("SET statement_timeout = 0")

    const { rows: wy } = await client.query<{ wage_year: string }>(
      `SELECT wage_year FROM oflc_wage_levels ORDER BY wage_year DESC LIMIT 1`
    )
    const wageYear = wy[0]?.wage_year
    if (!wageYear) throw new Error("No OFLC wage year loaded — run scripts/import-oflc-wages.ts first")

    // county -> area, for the current wage year.
    const { rows: countyRows } = await client.query<{
      state_ab: string; county_norm: string; area: string; area_name: string
    }>(
      `SELECT state_ab, county_norm, area, area_name FROM oflc_area_counties WHERE wage_year = $1`,
      [wageYear]
    )
    const countyToArea = new Map<string, { area: string; areaName: string }>()
    for (const r of countyRows) {
      countyToArea.set(`${r.state_ab}|${r.county_norm}`, { area: r.area, areaName: r.area_name })
    }
    console.log(`Loaded ${countyToArea.size.toLocaleString()} county->area mappings (wage year ${wageYear})`)

    // Existing principal cities — never overwrite or duplicate those.
    const { rows: existing } = await client.query<{ state_ab: string; city_norm: string }>(
      `SELECT DISTINCT state_ab, city_norm FROM oflc_area_cities WHERE wage_year = $1 AND name_rank < $2`,
      [wageYear, CENSUS_PLACE_RANK]
    )
    const principal = new Set(existing.map((r) => `${r.state_ab}|${r.city_norm}`))

    const inserts: unknown[][] = []
    let skipAmbiguous = 0
    let skipNoArea = 0
    let skipExisting = 0

    for (const [key, counties] of placeCounties) {
      if (principal.has(key)) {
        skipExisting++
        continue
      }
      const [state, city] = key.split("|")
      const areas = new Map<string, string>()
      for (const c of counties) {
        const hit = countyToArea.get(`${state}|${c}`)
        if (hit) areas.set(hit.area, hit.areaName)
      }
      if (areas.size === 0) {
        skipNoArea++
        continue
      }
      // A place spanning two OEWS areas cannot be resolved from the name alone — skip rather
      // than pick one. Precision matters more than coverage for a negotiation number.
      if (areas.size > 1) {
        skipAmbiguous++
        continue
      }
      const [area, areaName] = [...areas.entries()][0]
      inserts.push([wageYear, state, city, area, areaName, CENSUS_PLACE_RANK])
    }

    console.log(`\nResolvable new city->area rows: ${inserts.length.toLocaleString()}`)
    console.log(`  skipped: ${skipExisting.toLocaleString()} already a principal city, ` +
      `${skipNoArea.toLocaleString()} county not in OEWS geography, ${skipAmbiguous.toLocaleString()} spans multiple areas`)

    if (!APPLY) {
      console.log("\nDry run — nothing written. Re-run with --apply.")
      return
    }

    await client.query("BEGIN")
    await client.query(`DELETE FROM oflc_area_cities WHERE wage_year = $1 AND name_rank = $2`, [
      wageYear,
      CENSUS_PLACE_RANK,
    ])

    const BATCH = 1000
    for (let i = 0; i < inserts.length; i += BATCH) {
      const chunk = inserts.slice(i, i + BATCH)
      const values: unknown[] = []
      const tuples = chunk.map((row) => {
        const ph = row.map((v) => {
          values.push(v)
          return `$${values.length}`
        })
        return `(${ph.join(",")})`
      })
      await client.query(
        `INSERT INTO oflc_area_cities (wage_year, state_ab, city_norm, area, area_name, name_rank)
         VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`,
        values
      )
    }
    await client.query("COMMIT")
    console.log(`\nDone — ${inserts.length.toLocaleString()} rows loaded.`)
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

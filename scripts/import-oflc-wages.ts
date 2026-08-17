/**
 * Import the official OFLC prevailing-wage level tables.
 *
 * Source: https://flag.dol.gov/sites/default/files/wages/OFLC_Wages_2026-27.zip (~12.6 MB),
 * republished once a year on 1 July. Fills oflc_wage_levels / oflc_area_counties /
 * oflc_area_cities / oflc_soc_titles (see scripts/migrations/add-oflc-wage-levels.sql).
 *
 * These are the numbers that set an H-1B registrant's lottery entry count under the
 * wage-weighted rule (Level I = 1 entry ... Level IV = 4), so the import VALIDATES the file
 * rather than trusting it: it asserts the published Level2/Level3 interpolation identity and
 * refuses to load if DOL's format drifts. A silently mis-parsed threshold would show a
 * candidate the wrong salary target, so failing loudly is the correct behaviour.
 *
 * Dry run by default; pass --apply to write.
 *
 *   npx tsx scripts/import-oflc-wages.ts                       # download + validate, no writes
 *   npx tsx scripts/import-oflc-wages.ts --apply
 *   npx tsx scripts/import-oflc-wages.ts --file=./OFLC_Wages_2026-27.zip --apply
 *   npx tsx scripts/import-oflc-wages.ts --wage-year=2027-28 --apply
 *
 * Reference data only (~450k small rows, no churn on the jobs table), so it is safe to run
 * against prod directly. It replaces the given wage_year wholesale inside one transaction.
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { parse as parseCSV } from "csv-parse/sync"
import { getPostgresPool } from "@/lib/postgres/server"

const APPLY = process.argv.includes("--apply")

function flagStr(name: string, fallback: string): string {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : fallback
}

const WAGE_YEAR = flagStr("wage-year", "2026-27")
const ZIP_URL = flagStr(
  "url",
  `https://flag.dol.gov/sites/default/files/wages/OFLC_Wages_${WAGE_YEAR}.zip`
)
const LOCAL_ZIP = flagStr("file", "")
const CACHE_DIR = path.join(process.cwd(), ".cache")

/** DOL annualizes hourly wages at exactly 2,080 hours (40h x 52wk). */
const HOURS_PER_YEAR = 2080

/** Rows whose Label is one of these carry blank levels by design and are skipped. */
const UNLEVELED_LABELS = new Set(["High Wage", "No Leveled Wage"])

// ---------------------------------------------------------------------------
// Minimal ZIP reader (stored + deflate). Avoids adding an archive dependency or
// shelling out to `unzip`, which is absent from some slim container images.
// ---------------------------------------------------------------------------

function readZipEntries(buf: Buffer): Map<string, Buffer> {
  // Locate the End Of Central Directory record by scanning back for its signature.
  const EOCD_SIG = 0x06054b50
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive: no end-of-central-directory record")

  const entryCount = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16) // central directory offset

  const out = new Map<string, Buffer>()
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error("Corrupt ZIP central directory")
    const method = buf.readUInt16LE(ptr + 10)
    const compressedSize = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOffset = buf.readUInt32LE(ptr + 42)
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen)

    // The local header repeats the name/extra with its own lengths -- the data starts after them.
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + compressedSize)

    if (method === 0) out.set(name, Buffer.from(raw))
    else if (method === 8) out.set(name, zlib.inflateRawSync(raw))
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`)

    ptr += 46 + nameLen + extraLen + commentLen
  }
  return out
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Lowercase, strip accents/punctuation, collapse whitespace. */
export function normPlace(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // drop combining marks left by NFKD (José -> Jose)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * 'Fairfax County' -> 'fairfax'; 'St. Louis city' -> 'st louis'; 'Prince of Wales-Hyder
 * Census Area' -> 'prince of wales hyder'. Strips the administrative suffix so a job location
 * that says "Fairfax" or "Fairfax County" both reach the same area.
 */
export function normCounty(value: string): string {
  let s = normPlace(value)
  s = s.replace(
    /\b(county|parish|borough|census area|city and borough|municipality|municipio|city)\b/g,
    " "
  )
  return s.replace(/\s+/g, " ").trim()
}

/**
 * Split an OEWS area name into its principal cities and the states it spans.
 * 'Washington-Arlington-Alexandria, DC-VA-MD-WV' -> cities [washington, arlington, alexandria],
 * states [DC, VA, MD, WV]. Nonmetropolitan names have no comma and yield no cities.
 */
export function parseAreaName(areaName: string): { cities: string[]; states: string[] } {
  const comma = areaName.lastIndexOf(",")
  if (comma < 0) return { cities: [], states: [] }

  const cityPart = areaName.slice(0, comma)
  const statePart = areaName.slice(comma + 1)

  const states = statePart
    .split(/[-\/]/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s))

  // Individual hyphen-separated cities, plus the full joined string so a genuinely
  // hyphenated city ("Winston-Salem") is still reachable as one token.
  const parts = cityPart.split(/[-\/]/).map((c) => normPlace(c)).filter(Boolean)
  const whole = normPlace(cityPart)
  const cities = parts.length > 1 && whole ? [...parts, whole] : parts

  return { cities: [...new Set(cities)], states }
}

// ---------------------------------------------------------------------------
// Fetch + parse
// ---------------------------------------------------------------------------

async function loadZip(): Promise<Buffer> {
  if (LOCAL_ZIP) {
    console.log(`Reading ${LOCAL_ZIP}`)
    return fs.readFileSync(LOCAL_ZIP)
  }
  const cached = path.join(CACHE_DIR, `OFLC_Wages_${WAGE_YEAR}.zip`)
  if (fs.existsSync(cached)) {
    console.log(`Reading cached ${cached}`)
    return fs.readFileSync(cached)
  }
  console.log(`Downloading ${ZIP_URL} ...`)
  const res = await fetch(ZIP_URL)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(cached, buf)
  console.log(`  cached -> ${cached} (${(buf.length / 1e6).toFixed(1)} MB)`)
  return buf
}

function csvRows(buf: Buffer): Record<string, string>[] {
  return parseCSV(buf, { columns: true, skip_empty_lines: true, bom: true, trim: false })
}

type WageLevelRow = {
  area: string
  soc: string
  geoLvl: number | null
  l1: number
  l2: number
  l3: number
  l4: number
  avg: number | null
  unit: "hourly" | "annual"
}

function num(v: string | undefined): number | null {
  const s = (v ?? "").trim()
  if (!s || s === "*") return null
  const n = Number.parseFloat(s.replace(/[$,]/g, ""))
  return Number.isFinite(n) ? n : null
}

function parseWageLevels(rows: Record<string, string>[]): {
  parsed: WageLevelRow[]
  skippedUnleveled: number
  skippedOther: number
  maxDeviation: number
} {
  const parsed: WageLevelRow[] = []
  const seen = new Set<string>()
  let skippedUnleveled = 0
  let skippedOther = 0
  let maxDeviation = 0

  for (const r of rows) {
    const area = (r.Area ?? "").trim()
    const soc = (r.SocCode ?? "").trim()
    if (!area || !soc) {
      skippedOther++
      continue
    }

    const label = (r.Label ?? "").trim()
    const l1 = num(r.Level1)
    const l2 = num(r.Level2)
    const l3 = num(r.Level3)
    const l4 = num(r.Level4)

    if (l1 === null || l2 === null || l3 === null || l4 === null) {
      if (UNLEVELED_LABELS.has(label)) skippedUnleveled++
      else skippedOther++
      continue
    }

    // Track how far the file drifts from DOL's own interpolation rule. Checked below.
    maxDeviation = Math.max(
      maxDeviation,
      Math.abs(l2 - (l1 + (l4 - l1) / 3)),
      Math.abs(l3 - (l1 + (2 * (l4 - l1)) / 3))
    )

    const key = `${area} ${soc}`
    if (seen.has(key)) {
      skippedOther++
      continue
    }
    seen.add(key)

    // A blank Label means the row is published hourly; 'Annual Wage' means it already is.
    const isAnnual = label === "Annual Wage"
    const mult = isAnnual ? 1 : HOURS_PER_YEAR
    const avg = num(r.Average)
    const geo = num(r.GeoLvl)

    parsed.push({
      area,
      soc,
      geoLvl: geo === null ? null : Math.round(geo),
      l1: Math.round(l1 * mult),
      l2: Math.round(l2 * mult),
      l3: Math.round(l3 * mult),
      l4: Math.round(l4 * mult),
      avg: avg === null ? null : Math.round(avg * mult),
      unit: isAnnual ? "annual" : "hourly",
    })
  }

  return { parsed, skippedUnleveled, skippedOther, maxDeviation }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

async function insertBatched(
  client: { query: (q: string, v?: unknown[]) => Promise<unknown> },
  table: string,
  columns: string[],
  rows: unknown[][],
  batchSize = 1000
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize)
    const values: unknown[] = []
    const tuples = chunk.map((row) => {
      const placeholders = row.map((v) => {
        values.push(v)
        return `$${values.length}`
      })
      return `(${placeholders.join(",")})`
    })
    await client.query(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`,
      values
    )
  }
}

async function main(): Promise<void> {
  const zip = await loadZip()
  const files = readZipEntries(zip)
  console.log(`ZIP entries: ${[...files.keys()].join(", ")}\n`)

  const need = ["ALC_Export.csv", "Geography.csv", "oes_soc_occs.csv", "xwalk_plus.csv"]
  for (const f of need) {
    if (!files.has(f)) throw new Error(`Expected ${f} inside the archive; DOL changed the layout`)
  }

  // --- wage levels -------------------------------------------------------
  const alcRows = csvRows(files.get("ALC_Export.csv")!)
  const { parsed, skippedUnleveled, skippedOther, maxDeviation } = parseWageLevels(alcRows)
  const areas = new Set(parsed.map((r) => r.area))
  const socs = new Set(parsed.map((r) => r.soc))

  console.log("ALC_Export.csv")
  console.log(`  rows in file        ${alcRows.length.toLocaleString()}`)
  console.log(`  usable (4 levels)   ${parsed.length.toLocaleString()}`)
  console.log(`  skipped unleveled   ${skippedUnleveled.toLocaleString()} (High Wage / No Leveled Wage)`)
  console.log(`  skipped other       ${skippedOther.toLocaleString()}`)
  console.log(`  distinct areas      ${areas.size} | distinct SOC ${socs.size}`)
  console.log(`  max interpolation deviation $${maxDeviation.toFixed(2)}`)

  // Guard rails. These are cheap and they are the difference between "we shipped a wrong
  // salary target to a visa candidate" and "the import refused to run".
  if (parsed.length < 100_000) throw new Error(`Only ${parsed.length} usable rows — file looks truncated`)
  if (maxDeviation > 1) {
    throw new Error(
      `Level2/Level3 deviate from DOL's interpolation rule by $${maxDeviation.toFixed(2)} (expected <= $1). ` +
        `The published wage-level construction changed — re-verify before importing.`
    )
  }
  if (skippedOther > parsed.length * 0.01) {
    throw new Error(`${skippedOther} rows failed to parse for unexpected reasons — investigate before importing`)
  }

  // --- geography ---------------------------------------------------------
  const geoRows = csvRows(files.get("Geography.csv")!)
  const countyRows: unknown[][] = []
  const cityKeys = new Set<string>()
  const cityRows: unknown[][] = []

  for (const g of geoRows) {
    const area = (g.Area ?? "").trim()
    const stateAb = (g.StateAb ?? "").trim().toUpperCase()
    const areaName = (g.AreaName ?? "").trim()
    const county = (g.CountyTownName ?? "").trim()
    if (!area || !stateAb || !areaName) continue

    if (county) {
      countyRows.push([WAGE_YEAR, area, stateAb, county, normCounty(county), areaName])
    }

    const { cities, states } = parseAreaName(areaName)
    // Pair each principal city with every state the metro spans, so "Arlington, VA" and
    // "Washington, DC" both land on area 47900.
    for (const st of states.length ? states : [stateAb]) {
      cities.forEach((city, idx) => {
        const key = `${st} ${city} ${area}`
        if (cityKeys.has(key)) return
        cityKeys.add(key)
        cityRows.push([WAGE_YEAR, st, city, area, areaName, idx])
      })
    }
  }

  console.log("\nGeography.csv")
  console.log(`  rows                ${geoRows.length.toLocaleString()}`)
  console.log(`  county -> area      ${countyRows.length.toLocaleString()}`)
  console.log(`  city -> area        ${cityRows.length.toLocaleString()}`)

  // --- SOC titles --------------------------------------------------------
  const titleKeys = new Set<string>()
  const titleRows: unknown[][] = []
  const addTitle = (soc: string, title: string, source: string) => {
    const s = soc.trim()
    const t = title.trim()
    if (!s || !t) return
    const tn = normPlace(t)
    if (!tn) return
    const key = `${s} ${tn}`
    if (titleKeys.has(key)) return
    titleKeys.add(key)
    titleRows.push([s, t, tn, source])
  }

  for (const r of csvRows(files.get("oes_soc_occs.csv")!)) addTitle(r.soccode, r.Title, "oes")
  for (const r of csvRows(files.get("xwalk_plus.csv")!)) {
    addTitle(r.OES_SOCCODE, r.OES_SOCTITLE, "oes")
    addTitle(r.OES_SOCCODE, r.ONetTitle, "onet")
  }

  console.log("\nSOC titles")
  console.log(`  distinct (soc,title) ${titleRows.length.toLocaleString()}`)

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply.")
    return
  }

  // --- load --------------------------------------------------------------
  const pool = getPostgresPool()
  const client = await pool.connect()
  try {
    // Bulk reference load: the 5-minute statement_timeout guardrail on prod would kill this.
    await client.query("SET statement_timeout = 0")
    await client.query("BEGIN")

    // Replace this wage year wholesale so a re-run is idempotent and a mid-import failure
    // rolls back to the previous year's table rather than leaving a half-loaded one.
    await client.query("DELETE FROM oflc_wage_levels   WHERE wage_year = $1", [WAGE_YEAR])
    await client.query("DELETE FROM oflc_area_counties WHERE wage_year = $1", [WAGE_YEAR])
    await client.query("DELETE FROM oflc_area_cities   WHERE wage_year = $1", [WAGE_YEAR])

    console.log(`\nLoading ${parsed.length.toLocaleString()} wage-level rows ...`)
    await insertBatched(
      client,
      "oflc_wage_levels",
      ["wage_year", "area", "soc_code", "geo_lvl", "level1", "level2", "level3", "level4", "average", "source_unit"],
      parsed.map((r) => [WAGE_YEAR, r.area, r.soc, r.geoLvl, r.l1, r.l2, r.l3, r.l4, r.avg, r.unit])
    )

    console.log(`Loading ${countyRows.length.toLocaleString()} county rows ...`)
    await insertBatched(
      client,
      "oflc_area_counties",
      ["wage_year", "area", "state_ab", "county_town_name", "county_norm", "area_name"],
      countyRows
    )

    console.log(`Loading ${cityRows.length.toLocaleString()} city rows ...`)
    await insertBatched(
      client,
      "oflc_area_cities",
      ["wage_year", "state_ab", "city_norm", "area", "area_name", "name_rank"],
      cityRows
    )

    console.log(`Loading ${titleRows.length.toLocaleString()} SOC titles ...`)
    // Not wage-year scoped (SOC titles are stable across vintages) — upsert instead of replace.
    await insertBatched(client, "oflc_soc_titles", ["soc_code", "title", "title_norm", "source"], titleRows)

    await client.query("COMMIT")
    console.log("\nDone.")
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

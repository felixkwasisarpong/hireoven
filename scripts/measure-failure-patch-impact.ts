import fs from "node:fs"
import path from "node:path"
import { parse } from "csv-parse/sync"

type AuditRow = {
  id: string
  name: string
  domain: string
  ats_type: string
  careers_url: string
  outcome_status: string
  outcome_reason: string
  http_status: string
}

type PatchRow = {
  id: string
  name: string
  outcome_status: string
  careers_url: string
  new_careers_url: string
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

function readCsv<T>(filePath: string): T[] {
  return parse(fs.readFileSync(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as T[]
}

function dayStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function countBy<T>(rows: T[], fn: (row: T) => string) {
  const map = new Map<string, number>()
  for (const row of rows) {
    const key = fn(row)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return map
}

function sortedEntries(map: Map<string, number>) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

function main() {
  const beforePath = path.resolve("scripts/output/zero-job-http-audit-2026-04-30.csv")
  const afterPath = path.resolve(
    "scripts/output/zero-job-http-audit-after-failure-patch-2026-04-30.csv"
  )
  const patchedPath = path.resolve("/Users/Apple/Downloads/careers_failures_patched.csv")
  const verifiedPath = path.resolve(
    "scripts/output/careers-cleaned-verified-crawl-ready-2026-04-30.csv"
  )
  const probePath = path.resolve(
    "scripts/output/careers-cleaned-probe-results-2026-04-30.csv"
  )

  const before = readCsv<AuditRow>(beforePath)
  const after = readCsv<AuditRow>(afterPath)
  const patched = readCsv<PatchRow>(patchedPath)
  const verified = readCsv<{ name: string; careers_url: string }>(verifiedPath)
  const probe = readCsv<{ name: string; recommendation: string }>(probePath)

  const patchedBadUrlRows = patched.filter(
    (row) =>
      String(row.outcome_status).trim() === "bad_url" &&
      String(row.new_careers_url ?? "").trim() &&
      String(row.new_careers_url).trim() !== String(row.careers_url ?? "").trim()
  )
  const patchedIds = new Set(patchedBadUrlRows.map((row) => String(row.id).trim()))

  const beforeById = new Map(before.map((row) => [row.id, row]))
  const afterById = new Map(after.map((row) => [row.id, row]))

  const patchedAfterRows = patchedBadUrlRows.map((row) => {
    const prev = beforeById.get(row.id)
    const next = afterById.get(row.id)
    return {
      id: row.id,
      name: row.name,
      before_url: prev?.careers_url ?? row.careers_url,
      after_url: next?.careers_url ?? row.new_careers_url,
      before_status: prev?.outcome_status ?? "",
      before_reason: prev?.outcome_reason ?? "",
      after_status: next?.outcome_status ?? "",
      after_reason: next?.outcome_reason ?? "",
      after_http_status: next?.http_status ?? "",
      improved:
        prev?.outcome_status === "bad_url" && next?.outcome_status !== "bad_url"
          ? "true"
          : "false",
    }
  })

  const beforeBadUrlCount = patchedAfterRows.filter(
    (row) => row.before_status === "bad_url"
  ).length
  const afterBadUrlCount = patchedAfterRows.filter(
    (row) => row.after_status === "bad_url"
  ).length
  const improvedCount = patchedAfterRows.filter((row) => row.improved === "true").length

  const afterPatchedByStatus = countBy(patchedAfterRows, (row) => row.after_status)

  const cleanedNames = new Set<string>()
  for (const row of verified) {
    if (String(row.careers_url ?? "").trim()) cleanedNames.add(String(row.name).trim())
  }
  for (const row of probe) {
    if (String(row.recommendation).trim() === "keep_and_crawl") {
      cleanedNames.add(String(row.name).trim())
    }
  }

  const cleanedAfterMatched = after.filter((row) => cleanedNames.has(String(row.name).trim()))
  const cleanedAfterFaulty = cleanedAfterMatched.filter(
    (row) => row.outcome_status !== "unchanged"
  )

  const statusMap = countBy(cleanedAfterFaulty, (row) => row.outcome_status)
  const reasonMap = countBy(cleanedAfterFaulty, (row) => row.outcome_reason)

  const stamp = dayStamp()
  const outDir = path.resolve("scripts/output")
  fs.mkdirSync(outDir, { recursive: true })

  const patchedAfterCsv = path.join(
    outDir,
    `careers-failure-patched-rows-after-audit-${stamp}.csv`
  )
  const cleanedFaultyCsv = path.join(
    outDir,
    `careers-cleaned-faulty-after-failure-patch-${stamp}.csv`
  )
  const summaryPath = path.join(outDir, `careers-failure-patch-impact-${stamp}.txt`)

  const patchedHeader = [
    "id",
    "name",
    "before_url",
    "after_url",
    "before_status",
    "before_reason",
    "after_status",
    "after_reason",
    "after_http_status",
    "improved",
  ]
  const patchedCsv = [patchedHeader.map(csvEscape).join(",")]
    .concat(
      patchedAfterRows.map((row) =>
        [
          row.id,
          row.name,
          row.before_url,
          row.after_url,
          row.before_status,
          row.before_reason,
          row.after_status,
          row.after_reason,
          row.after_http_status,
          row.improved,
        ]
          .map(csvEscape)
          .join(",")
      )
    )
    .join("\n")
  fs.writeFileSync(patchedAfterCsv, patchedCsv)

  const cleanedHeader = [
    "id",
    "name",
    "domain",
    "ats_type",
    "careers_url",
    "outcome_status",
    "outcome_reason",
    "http_status",
  ]
  const cleanedCsv = [cleanedHeader.map(csvEscape).join(",")]
    .concat(
      cleanedAfterFaulty.map((row) =>
        [
          row.id,
          row.name,
          row.domain,
          row.ats_type,
          row.careers_url,
          row.outcome_status,
          row.outcome_reason,
          row.http_status,
        ]
          .map(csvEscape)
          .join(",")
      )
    )
    .join("\n")
  fs.writeFileSync(cleanedFaultyCsv, cleanedCsv)

  const summary = [
    `patched_bad_url_rows=${patchedBadUrlRows.length}`,
    `patched_rows_before_bad_url=${beforeBadUrlCount}`,
    `patched_rows_after_bad_url=${afterBadUrlCount}`,
    `patched_rows_improved=${improvedCount}`,
    "",
    "patched_after_status:",
    ...sortedEntries(afterPatchedByStatus).map(([k, v]) => `${k}=${v}`),
    "",
    `cleaned_after_matched=${cleanedAfterMatched.length}`,
    `cleaned_after_faulty=${cleanedAfterFaulty.length}`,
    "",
    "cleaned_after_faulty_by_status:",
    ...sortedEntries(statusMap).map(([k, v]) => `${k}=${v}`),
    "",
    "cleaned_after_top_reasons:",
    ...sortedEntries(reasonMap)
      .slice(0, 20)
      .map(([k, v]) => `${k}=${v}`),
    "",
    `patched_after_csv=${patchedAfterCsv}`,
    `cleaned_faulty_csv=${cleanedFaultyCsv}`,
  ].join("\n")
  fs.writeFileSync(summaryPath, summary)

  console.log(
    JSON.stringify(
      {
        patchedBadUrlRows: patchedBadUrlRows.length,
        patchedBeforeBadUrl: beforeBadUrlCount,
        patchedAfterBadUrl: afterBadUrlCount,
        patchedImproved: improvedCount,
        cleanedAfterMatched: cleanedAfterMatched.length,
        cleanedAfterFaulty: cleanedAfterFaulty.length,
        patchedAfterCsv,
        cleanedFaultyCsv,
        summaryPath,
      },
      null,
      2
    )
  )
}

main()


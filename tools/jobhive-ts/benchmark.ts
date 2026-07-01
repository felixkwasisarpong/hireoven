/**
 * Head-to-head benchmark: jobhive-ts replica  vs  the hireoven harvester.
 *
 * For each sampled (ats, slug) it runs BOTH crawlers against the same live ATS
 * board and diffs the result: job count, unique-externalId overlap, description
 * coverage, latency, and errors. Emits a markdown + JSON report.
 *
 * Run:
 *   npx tsx tools/jobhive-ts/benchmark.ts                # default sample
 *   npx tsx tools/jobhive-ts/benchmark.ts --per-ats 4    # 4 slugs per ATS
 *   npx tsx tools/jobhive-ts/benchmark.ts --ats greenhouse,workday
 *   HARVESTER_PROXY_URL=... npx tsx tools/jobhive-ts/benchmark.ts   # fair Workday
 *
 * Read-only against the network; writes only the report files under
 * tools/jobhive-ts/out/.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici"

import { getScraper, registeredAts } from "./src/index.js"
import type { ReplicaJob } from "./src/types.js"
import { useTransport } from "./src/http.js"
import {
  getAdapter,
  type AtsName,
  type HarvestedJob,
} from "@/lib/harvester/adapters"
import { harvesterFetch, hostMatchesProxy, proxyHostSuffixes } from "@/lib/harvester/http-agent"

// One representative upstream host per ATS — used only to report which adapters
// this run will route through the proxy (matches the harvester's own logic).
const REP_HOST: Record<string, string> = {
  greenhouse: "boards-api.greenhouse.io",
  lever: "api.lever.co",
  ashby: "api.ashbyhq.com",
  workable: "apply.workable.com",
  smartrecruiters: "api.smartrecruiters.com",
  personio: "acme.jobs.personio.com",
  recruitee: "acme.recruitee.com",
  teamtailor: "acme.teamtailor.com",
  bamboohr: "acme.bamboohr.com",
  workday: "acme.wd1.myworkdayjobs.com",
  oraclecloud: "acme.fa.us2.oraclecloud.com",
}

async function egressIp(dispatcher?: Dispatcher): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await undiciFetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    })
    const j = (await res.json()) as { ip?: string }
    return j.ip ?? "?"
  } catch (e) {
    return `err:${(e as Error).message.slice(0, 40)}`
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Report proxy state before the run so proxy-routed comparisons are trustworthy:
 * confirms HARVESTER_PROXY_URL egresses through a different IP than direct, and
 * lists which ATS this run routes through it (same rule the harvester uses).
 */
async function proxyPreflight(targets: string[], shared: boolean): Promise<void> {
  const proxyUrl = process.env.HARVESTER_PROXY_URL
  const transport = shared ? "shared (harvesterFetch — both sides identical)" : "replica-own undici (reads same env)"
  if (!proxyUrl) {
    console.log("Proxy: OFF (HARVESTER_PROXY_URL unset) — proxy-routed adapters run on the direct IP.")
    console.log(`Transport: ${transport}\n`)
    return
  }
  const suffixes = proxyHostSuffixes()
  const [direct, proxied] = await Promise.all([egressIp(), egressIp(new ProxyAgent(proxyUrl))])
  const proxiedAts = targets.filter((a) => REP_HOST[a] && hostMatchesProxy(REP_HOST[a], suffixes))
  console.log(`Proxy: ON  hosts=[${suffixes.join(", ")}]`)
  console.log(`  egress: direct=${direct}  proxy=${proxied}  ${direct !== proxied ? "✓ distinct" : "⚠ SAME IP — proxy not taking effect"}`)
  console.log(`  proxied ATS this run: ${proxiedAts.length ? proxiedAts.join(", ") : "(none of the sampled ATS match the suffixes)"}`)
  console.log(`Transport: ${transport}\n`)
}

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, "data")
const OUT = join(HERE, "out")

type Args = {
  perAts: number
  only: string[] | null
  timeoutMs: number
  company: string | null
  sharedTransport: boolean
  gate: boolean
}
function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    perAts: Number.parseInt(get("--per-ats") ?? "3", 10),
    only: get("--ats")?.split(",").map((s) => s.trim()) ?? null,
    timeoutMs: Number.parseInt(get("--timeout") ?? "90000", 10),
    // Restrict to CSV rows whose company name matches this substring (case-insensitive).
    company: get("--company")?.toLowerCase() ?? null,
    // Route the replica through the harvester's own transport (harvesterFetch)
    // so proxy-routed adapters egress identically — only parsing differs.
    sharedTransport: argv.includes("--shared-transport"),
    // Regression-gate mode: exit non-zero if an ATS shows a systemic divergence
    // (harvester silently returning ~0 vs a live replica). For CI.
    gate: argv.includes("--gate"),
  }
}

// The replica ATS name doesn't always match jobhive's CSV filename.
const CSV_ALIAS: Record<string, string> = { oraclecloud: "oracle" }

type CsvRow = { name: string; slug: string; url: string }
function readCsv(ats: string): CsvRow[] {
  const path = join(DATA, `${CSV_ALIAS[ats] ?? ats}.csv`)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
  const rows: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    // naive CSV: name may contain commas but slug/url don't → split from the right
    const parts = lines[i].split(",")
    if (parts.length < 2) continue
    const url = parts.length >= 3 ? parts[parts.length - 1] : ""
    const slug = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1]
    const name = parts.slice(0, parts.length - (parts.length >= 3 ? 2 : 1)).join(",")
    rows.push({ name: name.replace(/^"|"$/g, ""), slug: slug.trim(), url: url.trim() })
  }
  return rows
}

/** Deterministic sample: evenly spaced picks so we don't just test the A's. */
function sample<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows
  const step = Math.floor(rows.length / n)
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(rows[i * step])
  return out
}

const descCoverage = (jobs: Array<{ description?: string }>): number =>
  jobs.length === 0 ? 0 : jobs.filter((j) => (j.description?.length ?? 0) > 40).length / jobs.length

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()

type SideResult = {
  count: number
  descPct: number
  latencyMs: number
  error?: string
  ids: Set<string>
  titles: Set<string>
}

function summarize(jobs: Array<ReplicaJob | HarvestedJob>, latencyMs: number, error?: string): SideResult {
  return {
    count: jobs.length,
    descPct: descCoverage(jobs),
    latencyMs,
    error,
    ids: new Set(jobs.map((j) => j.externalId)),
    titles: new Set(jobs.map((j) => norm(j.title))),
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(t!)
  }
}

async function runReplica(ats: string, slug: string, timeoutMs: number): Promise<SideResult> {
  const scraper = getScraper(ats)
  if (!scraper) return summarize([], 0, "no replica scraper")
  const start = Date.now()
  try {
    const res = await withTimeout(scraper.run(slug), timeoutMs, "replica")
    return summarize(res.jobs, res.latencyMs, res.error)
  } catch (e) {
    return summarize([], Date.now() - start, (e as Error).message)
  }
}

async function runHarvester(ats: string, slug: string, timeoutMs: number): Promise<SideResult> {
  const adapter = getAdapter(ats as AtsName)
  if (!adapter) return summarize([], 0, "no harvester adapter")
  const start = Date.now()
  try {
    const res = await withTimeout(
      adapter.fetchJobs({ slug, ctx: { etag: null, lastModified: null, timeoutMs } }),
      timeoutMs,
      "harvester",
    )
    return summarize(res.jobs, res.upstreamLatencyMs || Date.now() - start, undefined)
  } catch (e) {
    return summarize([], Date.now() - start, (e as Error).message)
  }
}

// ATS whose stored slug is the full careers URL — the replica takes the URL,
// the harvester takes whatever its own detectFromUrl() derives from it.
const URL_KEYED = new Set(["workday", "oraclecloud"])

/** Map a CSV row to the slug each side expects. */
function slugsFor(ats: string, row: CsvRow): { replica: string; harvester: string } {
  if (URL_KEYED.has(ats)) {
    const url = row.url || row.slug
    const detected = getAdapter(ats as AtsName)?.detectFromUrl(url)?.slug
    return { replica: url, harvester: detected ?? url }
  }
  return { replica: row.slug, harvester: row.slug }
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const replicaAts = registeredAts()
  const targets = (args.only ?? replicaAts).filter((a) => replicaAts.includes(a))

  mkdirSync(OUT, { recursive: true })
  const rows: Array<Record<string, unknown>> = []

  // Route the replica through the harvester's transport when requested, so the
  // proxy-routed adapters egress via the same IP as the real harvester.
  if (args.sharedTransport) useTransport(harvesterFetch as unknown as typeof undiciFetch)
  await proxyPreflight(targets, args.sharedTransport)

  console.log(`Benchmarking ${targets.length} ATS × ${args.perAts} slugs each\n`)

  for (const ats of targets) {
    const csv = readCsv(ats)
    if (!csv.length) {
      console.log(`  ${ats}: no CSV, skipping`)
      continue
    }
    const filtered = args.company
      ? csv.filter((r) => r.name.toLowerCase().includes(args.company!))
      : csv
    const picks = args.company ? filtered.slice(0, args.perAts) : sample(filtered, args.perAts)
    for (const row of picks) {
      const { replica: rSlug, harvester: hSlug } = slugsFor(ats, row)
      // Run sequentially per company so the two sides don't contend for the
      // same host connection pool and skew each other's latency.
      const replica = await runReplica(ats, rSlug, args.timeoutMs)
      const harvester = await runHarvester(ats, hSlug, args.timeoutMs)

      const idOverlap = overlap(replica.ids, harvester.ids)
      const titleOverlap = overlap(replica.titles, harvester.titles)
      const rec = {
        ats,
        company: row.name,
        slug: row.slug,
        replicaCount: replica.count,
        harvesterCount: harvester.count,
        idOverlap,
        titleOverlap,
        replicaOnly: replica.count - idOverlap,
        harvesterOnly: harvester.count - idOverlap,
        replicaDescPct: +(replica.descPct * 100).toFixed(0),
        harvesterDescPct: +(harvester.descPct * 100).toFixed(0),
        replicaMs: replica.latencyMs,
        harvesterMs: harvester.latencyMs,
        replicaErr: replica.error ?? "",
        harvesterErr: harvester.error ?? "",
      }
      rows.push(rec)
      console.log(
        `  ${ats.padEnd(16)} ${row.name.slice(0, 24).padEnd(25)} ` +
          `replica=${String(rec.replicaCount).padStart(5)} ` +
          `harvester=${String(rec.harvesterCount).padStart(5)} ` +
          `idOv=${String(idOverlap).padStart(5)} titleOv=${String(titleOverlap).padStart(5)}` +
          (rec.replicaErr ? ` R!=${rec.replicaErr}` : "") +
          (rec.harvesterErr ? ` H!=${rec.harvesterErr}` : ""),
      )
    }
  }

  writeFileSync(join(OUT, "benchmark.json"), JSON.stringify(rows, null, 2))
  writeFileSync(join(OUT, "benchmark.md"), renderMarkdown(rows))
  console.log(`\nWrote ${join(OUT, "benchmark.md")} and benchmark.json`)

  if (args.gate) runGate(rows)
}

/**
 * Regression gate. Flags an ATS only for the *systemic* failure modes the
 * replica was built to catch — not normal count drift between two sequential
 * live fetches. Two failure classes, both grounded in real bugs we found:
 *
 *   - "silent zero"  — the harvester returns 0 on ALL of an ATS's live boards
 *     while the replica finds jobs (the teamtailor `items`-key bug).
 *   - "systemic cap" — enough volume to judge, yet the harvester collects a
 *     small fraction of the replica (the workday 2k-cap / oracle 50-cap bugs).
 *
 * An ATS whose sample has no live boards (replica found 0 everywhere — dead
 * sample or a network blip) is skipped, not failed, so CI doesn't flap.
 */
function runGate(rows: Array<Record<string, unknown>>): void {
  const byAts = new Map<string, Array<Record<string, unknown>>>()
  for (const r of rows) {
    const k = r.ats as string
    if (!byAts.has(k)) byAts.set(k, [])
    byAts.get(k)!.push(r)
  }

  let failed = false
  console.log("\n=== Regression gate ===")
  for (const [ats, rs] of byAts) {
    const live = rs.filter((r) => Number(r.replicaCount) > 0)
    const replicaJobs = live.reduce((a, r) => a + Number(r.replicaCount), 0)
    const harvesterJobs = live.reduce((a, r) => a + Number(r.harvesterCount), 0)
    const ratio = replicaJobs > 0 ? harvesterJobs / replicaJobs : 1
    const pct = `${Math.round(ratio * 100)}%`

    if (live.length === 0) {
      console.log(`  –  ${ats.padEnd(16)} skip: no live boards in sample`)
      continue
    }
    if (live.length >= 2 && live.every((r) => Number(r.harvesterCount) === 0)) {
      failed = true
      console.log(`  ✗  ${ats.padEnd(16)} FAIL: harvester=0 on all ${live.length} live boards (replica ${replicaJobs}) — adapter likely broken`)
      continue
    }
    if (replicaJobs >= 100 && ratio < 0.4) {
      failed = true
      console.log(`  ✗  ${ats.padEnd(16)} FAIL: coverage ${pct} (${harvesterJobs}/${replicaJobs}) — likely a pagination cap`)
      continue
    }
    console.log(`  ✓  ${ats.padEnd(16)} ok: ${pct} coverage (${harvesterJobs}/${replicaJobs}) over ${live.length} boards`)
  }

  if (failed) {
    console.log("\nGATE FAILED — a harvester adapter is systematically under-returning vs the replica.")
    process.exitCode = 1
  } else {
    console.log("\nGATE PASSED — no systemic divergence.")
  }
}

function renderMarkdown(rows: Array<Record<string, unknown>>): string {
  const byAts = new Map<string, Array<Record<string, unknown>>>()
  for (const r of rows) {
    const k = r.ats as string
    if (!byAts.has(k)) byAts.set(k, [])
    byAts.get(k)!.push(r)
  }
  const lines: string[] = ["# jobhive-ts replica vs hireoven harvester\n"]

  // per-ATS rollup
  lines.push("## Per-ATS totals\n")
  lines.push("| ATS | boards | replica jobs | harvester jobs | id-overlap | replica-only | harvester-only | replica desc% | harvester desc% |")
  lines.push("|---|--:|--:|--:|--:|--:|--:|--:|--:|")
  let tR = 0, tH = 0
  for (const [ats, rs] of byAts) {
    const sum = (k: string) => rs.reduce((a, r) => a + (Number(r[k]) || 0), 0)
    const avg = (k: string) => (rs.length ? Math.round(sum(k) / rs.length) : 0)
    tR += sum("replicaCount"); tH += sum("harvesterCount")
    lines.push(
      `| ${ats} | ${rs.length} | ${sum("replicaCount")} | ${sum("harvesterCount")} | ${sum("idOverlap")} | ${sum("replicaOnly")} | ${sum("harvesterOnly")} | ${avg("replicaDescPct")}% | ${avg("harvesterDescPct")}% |`,
    )
  }
  lines.push(`| **TOTAL** | ${rows.length} | **${tR}** | **${tH}** | | | | | |\n`)

  // detail
  lines.push("## Per-board detail\n")
  lines.push("| ATS | company | replica | harvester | idOv | titleOv | R desc% | H desc% | R ms | H ms | notes |")
  lines.push("|---|---|--:|--:|--:|--:|--:|--:|--:|--:|---|")
  for (const r of rows) {
    const notes = [r.replicaErr && `R:${r.replicaErr}`, r.harvesterErr && `H:${r.harvesterErr}`]
      .filter(Boolean)
      .join("; ")
    lines.push(
      `| ${r.ats} | ${r.company} | ${r.replicaCount} | ${r.harvesterCount} | ${r.idOverlap} | ${r.titleOverlap} | ${r.replicaDescPct}% | ${r.harvesterDescPct}% | ${r.replicaMs} | ${r.harvesterMs} | ${notes} |`,
    )
  }
  return lines.join("\n") + "\n"
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * Continuous all-sector company capture pipeline.
 *
 * This orchestrates seeding, discovery, crawl, and maintenance in one run so
 * we keep adding/capturing employers across industries instead of relying on
 * one-off scripts.
 *
 * Usage:
 *   npx tsx scripts/capture-companies-continuous.ts
 *   npx tsx scripts/capture-companies-continuous.ts --execute
 *   npx tsx scripts/capture-companies-continuous.ts --execute --states=TX,CA,NY,FL,WA,IL --states-per-run=3
 *   npx tsx scripts/capture-companies-continuous.ts --execute --skip-startup-discovery --exclude-technology
 */

import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

type StepStatus = "ok" | "failed" | "skipped"

type StepResult = {
  name: string
  command: string
  status: StepStatus
  exitCode: number | null
  durationMs: number
  startedAt: string
  finishedAt: string
  error: string | null
}

const args = process.argv.slice(2)

const DEFAULT_STATES = ["TX", "CA", "NY", "FL", "WA", "IL", "GA", "NC", "VA", "MA", "PA", "OH"]
const DEFAULT_STARTUP_CITIES = [
  "san-francisco",
  "new-york-city",
  "austin",
  "seattle",
  "chicago",
]
const DEFAULT_MAINTAIN_ONLY = "tiers,status,resurrect,company-dedup,dedup"

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = args.find((value) => value.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const index = args.indexOf(`--${name}`)
  if (index !== -1) return args[index + 1]
  return undefined
}

function intFlag(name: string, fallback: number, min = 0): number {
  const raw = Number.parseInt(flag(name) ?? "", 10)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, raw)
}

function csvFlag(name: string, fallback: readonly string[]): string[] {
  const raw = flag(name)
  if (!raw) return [...fallback]
  const out = new Set<string>()
  for (const part of raw.split(",")) {
    const value = part.trim()
    if (value) out.add(value)
  }
  return out.size > 0 ? [...out] : [...fallback]
}

function parseStates(rawStates: readonly string[]): string[] {
  const out = new Set<string>()
  for (const state of rawStates) {
    const normalized = state.trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(normalized)) out.add(normalized)
  }
  return [...out]
}

function pickRotatingStates(allStates: string[], perRun: number, runIndex: number): string[] {
  if (allStates.length === 0) return []
  if (perRun >= allStates.length) return [...allStates]

  const selected: string[] = []
  const start = ((runIndex * perRun) % allStates.length + allStates.length) % allStates.length
  for (let i = 0; i < perRun; i += 1) {
    selected.push(allStates[(start + i) % allStates.length]!)
  }
  return selected
}

function shellEscape(part: string): string {
  if (part.length === 0) return '""'
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(part)) return part
  return `"${part.replace(/(["\\$`])/g, "\\$1")}"`
}

function formatCommand(command: string, argsList: string[]): string {
  return [command, ...argsList].map(shellEscape).join(" ")
}

function resolveRunner(): { command: string; prefix: string[] } {
  const tsxBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx"
  )
  if (fs.existsSync(tsxBin)) {
    return { command: tsxBin, prefix: [] }
  }
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    prefix: ["tsx"],
  }
}

async function runCommand(command: string, argsList: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argsList, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    })

    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? 1))
  })
}

type TsxStepSpec = {
  name: string
  scriptPath: string
  scriptArgs: string[]
  skip: boolean
}

async function main() {
  const execute = args.includes("--execute")
  const failFast = args.includes("--fail-fast")
  const allowFailures = args.includes("--allow-failures")

  const skipSeeding = args.includes("--skip-seeding")
  const skipDiscovery = args.includes("--skip-discovery")
  const skipCrawl = args.includes("--skip-state-crawl")
  const skipMaintenance = args.includes("--skip-maintenance")

  const skipSeedExpansion = args.includes("--skip-seed-expansion")
  const skipSeedEnterprise = args.includes("--skip-seed-enterprise")
  const skipGitHubDiscovery = args.includes("--skip-github-discovery")
  const skipCrtshDiscovery = args.includes("--skip-crtsh-discovery")
  const skipStartupDiscovery = args.includes("--skip-startup-discovery")
  const skipWorkdayRecovery = args.includes("--skip-workday-recovery")

  const includeTechnology = !args.includes("--exclude-technology")
  const includeFuzzyDedup = args.includes("--include-fuzzy-dedup")

  const states = parseStates(csvFlag("states", DEFAULT_STATES))
  if (states.length === 0) {
    throw new Error("No valid states after parsing --states (expected 2-letter state codes).")
  }

  const statesPerRun = intFlag("states-per-run", Number.parseInt(process.env.CAPTURE_STATES_PER_RUN ?? "3", 10), 1)
  const runIndex = intFlag(
    "run-index",
    Math.floor(Date.now() / 86_400_000),
    0
  )
  const selectedStates = pickRotatingStates(states, statesPerRun, runIndex)

  const stateLimit = intFlag("state-limit", 36, 1)
  const stateConcurrency = intFlag("state-concurrency", 6, 1)
  const statePerIndustryCap = intFlag("state-per-industry-cap", 8, 1)
  const minStateCertified = intFlag("state-min-certified", 8, 1)

  const startupLimit = intFlag("startup-limit", 250, 1)
  const startupCities = csvFlag("startup-cities", DEFAULT_STARTUP_CITIES)
    .map((city) => city.toLowerCase())
    .filter(Boolean)
  const startupSources = csvFlag("startup-sources", ["yc", "builtin"])
    .map((source) => source.toLowerCase())
    .filter(Boolean)

  const maintainOnly = flag("maintain-only")?.trim() || DEFAULT_MAINTAIN_ONLY
  const maintainOnlyEffective = includeFuzzyDedup
    ? `${maintainOnly},fuzzy-dedup`
    : maintainOnly

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-")
  const reportPath =
    flag("report") ||
    path.join(
      process.cwd(),
      "scripts",
      "output",
      `capture-companies-continuous-${runStamp}-${execute ? "execute" : "dry-run"}.json`
    )

  const runner = resolveRunner()
  const startedAt = new Date()
  const stepResults: StepResult[] = []

  const stepSpecs: TsxStepSpec[] = [
    {
      name: "seed-companies-expansion",
      scriptPath: "scripts/seed-companies-expansion.ts",
      scriptArgs: execute ? [] : ["--dry-run"],
      skip: skipSeeding || skipSeedExpansion,
    },
    {
      name: "seed-enterprise-ats",
      scriptPath: "scripts/seed-enterprise-ats.ts",
      scriptArgs: execute ? ["--execute"] : [],
      skip: skipSeeding || skipSeedEnterprise,
    },
    {
      name: "discover-github-seeds",
      scriptPath: "scripts/discover-github-seeds.ts",
      scriptArgs: execute ? ["--execute"] : [],
      skip: skipDiscovery || skipGitHubDiscovery,
    },
    {
      name: "discover-crtsh",
      scriptPath: "scripts/discover-crtsh.ts",
      scriptArgs: execute ? ["--execute"] : [],
      skip: skipDiscovery || skipCrtshDiscovery,
    },
    {
      name: "discover-startup-directories",
      scriptPath: "scripts/discover-startup-directories.ts",
      scriptArgs: [
        ...(execute ? ["--execute"] : []),
        `--sources=${startupSources.join(",")}`,
        `--builtin-cities=${startupCities.join(",")}`,
        `--limit=${startupLimit}`,
      ],
      skip: skipDiscovery || skipStartupDiscovery,
    },
    {
      name: "discover-workday-stuck-companies",
      scriptPath: "scripts/discover-workday-for-stuck-companies.ts",
      scriptArgs: [
        ...(execute ? ["--execute"] : []),
        "--limit=200",
      ],
      skip: skipDiscovery || skipWorkdayRecovery,
    },
  ]

  if (!skipCrawl) {
    for (const state of selectedStates) {
      stepSpecs.push({
        name: `crawl-state-${state}`,
        scriptPath: "scripts/crawl-texas-multi-industry.ts",
        scriptArgs: [
          ...(execute ? ["--execute"] : []),
          `--state=${state}`,
          `--limit=${stateLimit}`,
          `--concurrency=${stateConcurrency}`,
          `--per-industry-cap=${statePerIndustryCap}`,
          `--min-state-certified=${minStateCertified}`,
          ...(includeTechnology ? [] : ["--exclude-technology"]),
        ],
        skip: false,
      })
    }
  }

  stepSpecs.push({
    name: "maintain-companies",
    scriptPath: "scripts/maintain-companies.ts",
    scriptArgs: [
      ...(execute ? ["--execute"] : []),
      `--only=${maintainOnlyEffective}`,
    ],
    skip: skipMaintenance,
  })

  console.log(
    [
      "",
      "=== capture-companies-continuous ===",
      `mode:                ${execute ? "EXECUTE" : "dry-run"}`,
      `runner:              ${runner.command}`,
      `fail_fast:           ${failFast}`,
      `allow_failures:      ${allowFailures}`,
      `states_pool:         ${states.join(",")}`,
      `states_per_run:      ${statesPerRun}`,
      `run_index:           ${runIndex}`,
      `states_this_run:     ${selectedStates.join(",")}`,
      `state_limit:         ${stateLimit}`,
      `state_concurrency:   ${stateConcurrency}`,
      `state_per_industry:  ${statePerIndustryCap}`,
      `state_min_certified: ${minStateCertified}`,
      `startup_sources:     ${startupSources.join(",")}`,
      `startup_cities:      ${startupCities.join(",")}`,
      `startup_limit:       ${startupLimit}`,
      `maintenance_only:    ${maintainOnlyEffective}`,
      `report:              ${reportPath}`,
      "====================================",
      "",
    ].join("\n")
  )

  for (const step of stepSpecs) {
    const started = new Date()
    const scriptAbsolutePath = path.join(process.cwd(), step.scriptPath)
    const scriptExists = fs.existsSync(scriptAbsolutePath)
    const stepCommand = formatCommand(
      runner.command,
      [...runner.prefix, step.scriptPath, ...step.scriptArgs]
    )

    if (step.skip || !scriptExists) {
      const reason = step.skip ? "skip flag" : "missing script"
      stepResults.push({
        name: step.name,
        command: stepCommand,
        status: "skipped",
        exitCode: 0,
        durationMs: 0,
        startedAt: started.toISOString(),
        finishedAt: started.toISOString(),
        error: step.skip ? null : `missing_script:${step.scriptPath}`,
      })
      console.log(`[capture] skip ${step.name} (${reason})`)
      continue
    }

    console.log(`[capture] start ${step.name}`)
    console.log(`          ${stepCommand}`)
    const tick = Date.now()

    try {
      const exitCode = await runCommand(runner.command, [
        ...runner.prefix,
        step.scriptPath,
        ...step.scriptArgs,
      ])
      const finished = new Date()
      if (exitCode !== 0) {
        const failedResult: StepResult = {
          name: step.name,
          command: stepCommand,
          status: "failed",
          exitCode,
          durationMs: Date.now() - tick,
          startedAt: started.toISOString(),
          finishedAt: finished.toISOString(),
          error: `exit_${exitCode}`,
        }
        stepResults.push(failedResult)
        console.error(`[capture] failed ${step.name} (exit ${exitCode})`)
        if (failFast) break
        continue
      }

      stepResults.push({
        name: step.name,
        command: stepCommand,
        status: "ok",
        exitCode,
        durationMs: Date.now() - tick,
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        error: null,
      })
      console.log(`[capture] done ${step.name} (${Date.now() - tick}ms)`)
    } catch (error) {
      const finished = new Date()
      const message = error instanceof Error ? error.message : String(error)
      stepResults.push({
        name: step.name,
        command: stepCommand,
        status: "failed",
        exitCode: null,
        durationMs: Date.now() - tick,
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        error: message,
      })
      console.error(`[capture] failed ${step.name}: ${message}`)
      if (failFast) break
    }
  }

  const finishedAt = new Date()
  const okCount = stepResults.filter((step) => step.status === "ok").length
  const failedCount = stepResults.filter((step) => step.status === "failed").length
  const skippedCount = stepResults.filter((step) => step.status === "skipped").length

  const report = {
    mode: execute ? "execute" : "dry-run",
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    config: {
      states_pool: states,
      states_per_run: statesPerRun,
      run_index: runIndex,
      states_this_run: selectedStates,
      state_limit: stateLimit,
      state_concurrency: stateConcurrency,
      state_per_industry_cap: statePerIndustryCap,
      state_min_certified: minStateCertified,
      startup_sources: startupSources,
      startup_cities: startupCities,
      startup_limit: startupLimit,
      maintenance_only: maintainOnlyEffective,
      include_technology: includeTechnology,
      include_fuzzy_dedup: includeFuzzyDedup,
      fail_fast: failFast,
      allow_failures: allowFailures,
    },
    summary: {
      total_steps: stepResults.length,
      ok: okCount,
      failed: failedCount,
      skipped: skippedCount,
    },
    steps: stepResults,
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`[capture] report: ${reportPath}`)
  console.log(
    `[capture] summary total=${stepResults.length} ok=${okCount} failed=${failedCount} skipped=${skippedCount}`
  )

  if (failedCount > 0 && !allowFailures) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("[capture] fatal:", error)
  process.exit(1)
})

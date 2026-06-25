/**
 * Harvester-box entrypoint for the Spec 08 email jobs. Runs the work (DB reads +
 * Resend sends) on the 8GB harvester, keeping it off the memory-constrained web box.
 * Env is loaded before lib/email/jobs is imported (the Resend client reads
 * RESEND_API_KEY at module load), hence the dynamic import.
 *
 *   npx tsx scripts/email-cron.ts <weekly|snapshot|layoffs|milestones|opt|health>
 *
 * Wired as npm scripts (email:weekly:execute, …) and scheduled on the harvester.
 */
import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

const job = process.argv[2]

async function main() {
  const jobs = await import("@/lib/email/jobs")
  const map: Record<string, () => Promise<unknown>> = {
    weekly: jobs.runWeeklyDigests,
    snapshot: jobs.runLeaderboardSnapshot,
    layoffs: jobs.runLayoffAlerts,
    milestones: jobs.runScorecardMilestones,
    opt: jobs.runOptReminders,
    health: jobs.runEmailQueueHealth,
  }
  const fn = map[job ?? ""]
  if (!fn) {
    console.error("usage: tsx scripts/email-cron.ts <weekly|snapshot|layoffs|milestones|opt|health>")
    process.exit(1)
  }
  const result = await fn()
  console.log(`[${new Date().toISOString()}] email:${job} ${JSON.stringify(result)}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })

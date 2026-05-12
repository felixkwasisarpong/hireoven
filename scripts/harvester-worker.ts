import { getPostgresPool } from "@/lib/postgres/server"
import { loadWorkerConfig, startWorkerLoop } from "@/lib/harvester/worker"

async function main() {
  const config = loadWorkerConfig()
  const pool = getPostgresPool()
  const handle = startWorkerLoop(pool, config)

  let signaled = false
  const onSignal = (sig: NodeJS.Signals) => {
    if (signaled) return
    signaled = true
    console.log(`[harvester] ${sig} received, finishing current tick before exit`)
    handle.stop()
  }
  process.on("SIGINT", () => onSignal("SIGINT"))
  process.on("SIGTERM", () => onSignal("SIGTERM"))

  await handle.done
  await pool.end()
  console.log("[harvester] exited cleanly")
}

main().catch((error) => {
  console.error("[harvester] fatal:", error)
  process.exit(1)
})

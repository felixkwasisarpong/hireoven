import http from "node:http"
import { getPostgresPool } from "@/lib/postgres/server"
import { loadWorkerConfig, startWorkerLoop } from "@/lib/harvester/worker"

/**
 * Tiny HTTP liveness server. Container platforms (Coolify, k8s, etc.)
 * typically TCP-connect or GET / for liveness/readiness; the worker has no
 * real HTTP surface so we expose a minimal stub. Port is configurable via
 * HARVESTER_HEALTH_PORT (default 3000 — matches Coolify's "Ports Exposes").
 */
function startHealthServer(): http.Server {
  const port = Number.parseInt(process.env.HARVESTER_HEALTH_PORT ?? "3000", 10)
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: true, role: "harvester-worker", uptime: process.uptime() }))
  })
  server.listen(port, () => {
    console.log(`[harvester] health server listening on :${port}`)
  })
  return server
}

async function main() {
  const config = loadWorkerConfig()
  const pool = getPostgresPool()
  const healthServer = startHealthServer()
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
  await new Promise<void>((resolve) => healthServer.close(() => resolve()))
  console.log("[harvester] exited cleanly")
}

main().catch((error) => {
  console.error("[harvester] fatal:", error)
  process.exit(1)
})

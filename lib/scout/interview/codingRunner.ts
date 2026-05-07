/**
 * Client-side coding execution wrapper.
 * Manages a Web Worker that runs either Pyodide (Python) or a JS sandbox.
 *
 * Security note: hidden tests are loaded from the server and held in component
 * state. A user can read them via React devtools. This is intentional — it's a
 * practice tool. The worker receives tests at run-time and cannot be inspected
 * from the Pyodide/JS context (they're never written into user code scope).
 */

export interface TestRunResult {
  passed: number
  failed: number
  totalWeight: number
  passedCount: number
  failedCount: number
  errors: Array<{ testIdx: number; error: string; expected: unknown; got: unknown }>
  runtimeMs: number
}

export type CodingLanguage = "python" | "javascript" | "typescript"

const WORKER_PATHS: Record<CodingLanguage, string> = {
  python: "/workers/pyodide-worker.js",
  javascript: "/workers/js-runner-worker.js",
  typescript: "/workers/js-runner-worker.js",
}

export type RunnerStatus = "initializing" | "ready" | "running" | "error"

type PendingRun = {
  resolve: (result: TestRunResult) => void
  reject: (err: Error) => void
}

export class CodingRunner {
  private worker: Worker
  private ready = false
  private pending = new Map<string, PendingRun>()
  private runCounter = 0
  public status: RunnerStatus = "initializing"
  private onStatusChange?: (s: RunnerStatus) => void

  private constructor(language: CodingLanguage, onStatusChange?: (s: RunnerStatus) => void) {
    this.onStatusChange = onStatusChange
    const workerPath = WORKER_PATHS[language]
    this.worker = new Worker(workerPath)
    this.worker.onmessage = this.handleMessage.bind(this)
    this.worker.onerror = (e) => {
      this.setStatus("error")
      // Reject all pending
      for (const [, p] of this.pending) p.reject(new Error(e.message))
      this.pending.clear()
    }
    // Send init message
    this.worker.postMessage({ type: "init" })
  }

  private setStatus(s: RunnerStatus) {
    this.status = s
    this.onStatusChange?.(s)
  }

  private handleMessage(e: MessageEvent) {
    const { type, id, result, message } = e.data as {
      type: string
      id?: string
      result?: TestRunResult
      message?: string
    }

    if (type === "ready") {
      this.ready = true
      this.setStatus("ready")
      return
    }

    if (type === "error" && id) {
      const p = this.pending.get(id)
      if (p) {
        p.reject(new Error(message ?? "Worker error"))
        this.pending.delete(id)
      }
      this.setStatus("ready")
      return
    }

    if (type === "result" && id && result) {
      const p = this.pending.get(id)
      if (p) {
        p.resolve(result)
        this.pending.delete(id)
      }
      this.setStatus("ready")
    }
  }

  static async init(
    language: CodingLanguage,
    onStatusChange?: (s: RunnerStatus) => void
  ): Promise<CodingRunner> {
    return new Promise((resolve, reject) => {
      const runner = new CodingRunner(language, onStatusChange)
      // Wait for ready
      runner.worker.onmessage = (e) => {
        if (e.data.type === "ready") {
          runner.ready = true
          runner.setStatus("ready")
          runner.worker.onmessage = runner.handleMessage.bind(runner)
          resolve(runner)
        } else if (e.data.type === "error") {
          reject(new Error(e.data.message ?? "Worker init failed"))
        }
      }
      // Timeout after 60s for Pyodide load
      setTimeout(() => reject(new Error("Worker init timeout")), 60_000)
    })
  }

  async run(
    code: string,
    fnName: string,
    tests: Array<{ input: unknown[]; expected: unknown; weight: number }>,
    slug?: string
  ): Promise<TestRunResult> {
    if (!this.ready) throw new Error("Runner not ready")

    this.setStatus("running")
    const id = String(++this.runCounter)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ type: "run", id, code, fnName, tests, slug })

      // Overall 30-second run timeout
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          this.setStatus("ready")
          reject(new Error("Run timed out after 30 seconds"))
        }
      }, 30_000)
    })
  }

  terminate() {
    this.worker.terminate()
    this.pending.clear()
  }
}

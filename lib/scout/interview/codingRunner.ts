/**
 * Client-side coding execution wrapper.
 *
 * Python  → Pyodide Web Worker (browser)
 * JavaScript → JS sandbox Web Worker (browser)
 * TypeScript / Go / Java → Piston API via /api/interview/coding/execute (server)
 *
 * Security note: hidden tests are sent to the client for browser-executed
 * languages. A user can read them via React devtools. This is intentional —
 * it's a practice tool. For server-side languages, tests go to the server.
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

export type CodingLanguage = "python" | "javascript" | "typescript" | "go" | "java"

const WORKER_PATHS: Partial<Record<CodingLanguage, string>> = {
  python:     "/workers/pyodide-worker.js",
  javascript: "/workers/js-runner-worker.js",
}

export function isServerSideLanguage(lang: CodingLanguage): boolean {
  return lang === "typescript" || lang === "go" || lang === "java"
}

export type RunnerStatus = "initializing" | "ready" | "running" | "error"

type PendingRun = {
  resolve: (result: TestRunResult) => void
  reject: (err: Error) => void
}

export class CodingRunner {
  private worker: Worker | null = null
  private ready = false
  private pending = new Map<string, PendingRun>()
  private runCounter = 0
  public status: RunnerStatus = "initializing"
  private onStatusChange?: (s: RunnerStatus) => void
  private language: CodingLanguage

  private constructor(language: CodingLanguage, onStatusChange?: (s: RunnerStatus) => void) {
    this.language = language
    this.onStatusChange = onStatusChange

    if (isServerSideLanguage(language)) {
      // No worker needed — execution is server-side
      this.ready = true
      this.setStatus("ready")
      return
    }

    const workerPath = WORKER_PATHS[language]
    if (!workerPath) throw new Error(`No worker path for language: ${language}`)
    this.worker = new Worker(workerPath)
    this.worker.onmessage = this.handleMessage.bind(this)
    this.worker.onerror = (e) => {
      this.setStatus("error")
      for (const [, p] of this.pending) p.reject(new Error(e.message))
      this.pending.clear()
    }
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
      if (p) { p.reject(new Error(message ?? "Worker error")); this.pending.delete(id) }
      this.setStatus("ready")
      return
    }

    if (type === "result" && id && result) {
      const p = this.pending.get(id)
      if (p) { p.resolve(result); this.pending.delete(id) }
      this.setStatus("ready")
    }
  }

  static async init(
    language: CodingLanguage,
    onStatusChange?: (s: RunnerStatus) => void
  ): Promise<CodingRunner> {
    if (isServerSideLanguage(language)) {
      const runner = new CodingRunner(language, onStatusChange)
      return runner
    }

    return new Promise((resolve, reject) => {
      const runner = new CodingRunner(language, onStatusChange)
      runner.worker!.onmessage = (e) => {
        if (e.data.type === "ready") {
          runner.ready = true
          runner.setStatus("ready")
          runner.worker!.onmessage = runner.handleMessage.bind(runner)
          resolve(runner)
        } else if (e.data.type === "error") {
          reject(new Error(e.data.message ?? "Worker init failed"))
        }
      }
      setTimeout(() => reject(new Error("Worker init timeout")), 60_000)
    })
  }

  // Browser-side run (Python / JS)
  async run(
    code: string,
    fnName: string,
    tests: Array<{ input: unknown[]; expected: unknown; weight: number }>,
    slug?: string
  ): Promise<TestRunResult> {
    if (!this.ready) throw new Error("Runner not ready")
    if (isServerSideLanguage(this.language)) {
      throw new Error("Use runServerSide() for TypeScript/Go/Java")
    }

    this.setStatus("running")
    const id = String(++this.runCounter)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ type: "run", id, code, fnName, tests, slug })

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          this.setStatus("ready")
          reject(new Error("Run timed out after 30 seconds"))
        }
      }, 30_000)
    })
  }

  // Server-side run (TypeScript / Go / Java)
  async runServerSide(opts: {
    code: string
    fnName: string
    tests: Array<{ input: unknown[]; expected: unknown; weight: number }>
    pythonSignature: string
    sessionId: string
  }): Promise<TestRunResult> {
    if (!this.ready) throw new Error("Runner not ready")
    this.setStatus("running")

    try {
      const res = await fetch("/api/interview/coding/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: opts.code,
          language: this.language,
          fnName: opts.fnName,
          tests: opts.tests,
          pythonSignature: opts.pythonSignature,
        }),
        signal: AbortSignal.timeout(35_000),
      })

      const data = await res.json() as { result?: TestRunResult; error?: string; stderr?: string }
      if (!res.ok || !data.result) {
        throw new Error(data.error ?? "Server execution failed")
      }
      return data.result
    } finally {
      this.setStatus("ready")
    }
  }

  terminate() {
    this.worker?.terminate()
    this.pending.clear()
  }
}

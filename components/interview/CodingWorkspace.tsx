"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import dynamic from "next/dynamic"
import CodingTopBar from "@/components/interview/CodingTopBar"
import ProblemStatement from "@/components/interview/ProblemStatement"
import LanguageToggle from "@/components/interview/LanguageToggle"
import TestConsole from "@/components/interview/TestConsole"
import CodingInterviewerPanel from "@/components/interview/CodingInterviewerPanel"
import { CodingRunner, isServerSideLanguage, type TestRunResult, type CodingLanguage, type RunnerStatus } from "@/lib/scout/interview/codingRunner"
import { parsePythonSignature, generateGoStarter, generateJavaStarter } from "@/lib/scout/interview/languageUtils"

// Monaco must be client-only and lazy
const MonacoEditor = dynamic(() => import("@/components/interview/MonacoEditor"), { ssr: false })

// ── Types ─────────────────────────────────────────────────────────────────────

type PublicProblem = {
  id: string
  slug: string
  title: string
  difficulty: string
  prompt: string
  functionSignature: { python?: string; javascript?: string }
  hintsCount: number
  targetMinutes: number
  tags: string[]
}

type SessionMeta = {
  persona: string
  questionSet: string
  status: string
  durationTargetMin: number
  jobId: string | null
  startedAt: string | null
}

type AgentMessage = {
  id: string
  role: "interviewer" | "candidate"
  content: string
  isHint?: boolean
  ts: number
}

type HiddenTest = { input: unknown[]; expected: unknown; weight: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeRemaining(startedAt: string | null, targetMin: number): number {
  if (!startedAt) return targetMin * 60
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  return Math.max(0, targetMin * 60 - elapsed)
}

function extractFnName(sig: string, language: CodingLanguage): string {
  if (language === "python") {
    const m = sig.match(/def (\w+)\s*\(/)
    return m?.[1] ?? "solution"
  }
  const m = sig.match(/function\s+(\w+)\s*\(/) ?? sig.match(/class\s+(\w+)\s*{/)
  return m?.[1] ?? "solution"
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CodingWorkspace({ sessionId }: { sessionId: string }) {
  const router = useRouter()

  // Core state
  const [session, setSession] = useState<SessionMeta | null>(null)
  const [problem, setProblem] = useState<PublicProblem | null>(null)
  const [jobInfo, setJobInfo] = useState<{ title: string; company: string | null } | null>(null)
  const [code, setCode] = useState("")
  const [language, setLanguage] = useState<CodingLanguage>("python")
  const [sessionStatus, setSessionStatus] = useState("setup")
  const [isInitializing, setIsInitializing] = useState(true)

  // Runner
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus>("initializing")
  const runnerRef = useRef<CodingRunner | null>(null)

  // Tests
  const [hiddenTests, setHiddenTests] = useState<HiddenTest[]>([])
  const [fnNames, setFnNames] = useState({ python: "solution", javascript: "solution" })
  const [pythonSignature, setPythonSignature] = useState("")
  const [slug, setSlug] = useState("")
  const [testResult, setTestResult] = useState<TestRunResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  // Hints
  const [hintsUsed, setHintsUsed] = useState(0)
  const hintsTotal = problem?.hintsCount ?? 3

  // Agent messages
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([])
  const [agentLoading, setAgentLoading] = useState(false)

  // Timer
  const [remainingSec, setRemainingSec] = useState(0)
  const targetSec = (session?.durationTargetMin ?? problem?.targetMinutes ?? 30) * 60

  // Flags
  const autoEndFiredRef = useRef(false)
  const timeWarningSentRef = useRef(false)
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const failedRunDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastSnapshotCodeRef = useRef("")
  const lastEditTsRef = useRef(Date.now())

  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // ── Init runner ────────────────────────────────────────────────────────────
  const initRunner = useCallback(async (lang: CodingLanguage) => {
    if (runnerRef.current) { runnerRef.current.terminate(); runnerRef.current = null }
    setRunnerStatus("initializing")
    try {
      const r = await CodingRunner.init(lang, setRunnerStatus)
      runnerRef.current = r
    } catch { setRunnerStatus("error") }
  }, [])

  // ── Load session on mount ──────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(`/api/interview/sessions/${sessionId}/coding/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferredLanguage: "python" }),
        })
        const data = await res.json()
        if (!res.ok) { setIsInitializing(false); return }

        const { attempt, problem: p, openingMessage, timeRemainingSec } = data
        setProblem(p)
        setSlug(p.slug)
        setHintsUsed(attempt.hintsUsed ?? 0)
        setRemainingSec(timeRemainingSec)

        // Detect language from saved attempt
        const VALID_LANGS: CodingLanguage[] = ["python", "javascript", "typescript", "go", "java"]
        const langRaw = (attempt.languageUsed as string) ?? "python"
        const lang: CodingLanguage = VALID_LANGS.includes(langRaw as CodingLanguage)
          ? (langRaw as CodingLanguage) : "python"
        setLanguage(lang)

        // Restore code from finalCode or latest snapshot
        const savedCode = attempt.finalCode ??
          (attempt.codeSnapshots?.length > 0
            ? attempt.codeSnapshots[attempt.codeSnapshots.length - 1].code
            : null) ??
          p.functionSignature?.[lang as "python" | "javascript"] ?? ""
        setCode(savedCode)
        lastSnapshotCodeRef.current = savedCode

        // Fetch session metadata
        const sessRes = await fetch(`/api/interview/sessions/${sessionId}`)
        if (sessRes.ok) {
          const sessData = await sessRes.json()
          setSession(sessData.session)
          setSessionStatus(sessData.session.status)
          if (sessData.session.jobTitle) {
            setJobInfo({ title: sessData.session.jobTitle, company: sessData.session.jobCompany })
          }
        }

        // Add opening message to panel
        if (openingMessage) {
          setAgentMessages([{ id: "opening", role: "interviewer", content: openingMessage, ts: Date.now() }])
        }

        // Fetch hidden tests
        const testsRes = await fetch(`/api/interview/sessions/${sessionId}/coding/tests`, { method: "POST" })
        if (testsRes.ok) {
          const testsData = await testsRes.json()
          setHiddenTests(testsData.tests ?? [])
          setFnNames({ python: testsData.pythonFnName, javascript: testsData.jsFnName })
          setPythonSignature(testsData.pythonSignature ?? "")
          if (testsData.slug) setSlug(testsData.slug)
        }

        // Init runner
        void initRunner(lang)
      } finally {
        setIsInitializing(false)
      }
    }
    void init()
    return () => {
      runnerRef.current?.terminate()
      if (snapshotIntervalRef.current) clearInterval(snapshotIntervalRef.current)
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current)
      if (failedRunDebounceRef.current) clearTimeout(failedRunDebounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.startedAt || sessionStatus === "completed" || sessionStatus === "abandoned") return
    const tick = () => setRemainingSec(computeRemaining(session.startedAt, session.durationTargetMin))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [session?.startedAt, session?.durationTargetMin, sessionStatus])

  // Auto-end at 0
  useEffect(() => {
    if (remainingSec === 0 && sessionStatus === "active" && !autoEndFiredRef.current && !isSubmitting) {
      autoEndFiredRef.current = true
      void handleSubmit(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec, sessionStatus, isSubmitting])

  // 80% time warning
  useEffect(() => {
    if (!timeWarningSentRef.current && remainingSec > 0 && targetSec > 0 &&
        remainingSec / targetSec <= 0.2 && sessionStatus === "active") {
      timeWarningSentRef.current = true
      void fireAgentTurn("time_warning")
    }
  }, [remainingSec, targetSec, sessionStatus])

  // ── Snapshot interval ──────────────────────────────────────────────────────
  useEffect(() => {
    if (sessionStatus !== "active") return
    snapshotIntervalRef.current = setInterval(() => {
      if (code !== lastSnapshotCodeRef.current) {
        lastSnapshotCodeRef.current = code
        void fetch(`/api/interview/sessions/${sessionId}/coding/snapshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })
      }
    }, 5000)
    return () => { if (snapshotIntervalRef.current) clearInterval(snapshotIntervalRef.current) }
  }, [code, sessionStatus, sessionId])

  // ── Idle timeout ───────────────────────────────────────────────────────────
  function resetIdleTimeout() {
    lastEditTsRef.current = Date.now()
    if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current)
    if (sessionStatus !== "active") return
    idleTimeoutRef.current = setTimeout(() => {
      void fireAgentTurn("idle_timeout")
      resetIdleTimeout() // reschedule after firing
    }, 120_000)
  }

  function handleCodeChange(newCode: string) {
    setCode(newCode)
    resetIdleTimeout()
  }

  // ── Agent turn ─────────────────────────────────────────────────────────────
  const fireAgentTurn = useCallback(async (
    trigger: string,
    content?: string,
    testResults?: unknown
  ) => {
    setAgentLoading(true)
    if (content) {
      setAgentMessages((prev) => [
        ...prev,
        { id: `c-${Date.now()}`, role: "candidate", content, ts: Date.now() },
      ])
    }
    try {
      const res = await fetch(`/api/interview/sessions/${sessionId}/coding/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger, content, testResults }),
      })
      const data = await res.json()
      if (res.ok) {
        const isHint = trigger === "hint_request"
        setAgentMessages((prev) => [
          ...prev,
          { id: `i-${Date.now()}`, role: "interviewer", content: data.message, isHint, ts: Date.now() },
        ])
        if (trigger === "hint_request") setHintsUsed(data.hintsUsedSoFar)
      }
    } finally {
      setAgentLoading(false)
    }
  }, [sessionId])

  // ── Run tests ──────────────────────────────────────────────────────────────
  async function runTests(allTests: boolean) {
    if (!runnerRef.current || runnerStatus !== "ready" || !problem) return
    setIsRunning(true)
    try {
      const tests = allTests ? hiddenTests : hiddenTests.slice(0, 3)
      const fnName = language === "python" ? fnNames.python : fnNames.javascript
      const result = isServerSideLanguage(language)
        ? await runnerRef.current.runServerSide({ code, fnName, tests, pythonSignature, sessionId })
        : await runnerRef.current.run(code, fnName, tests, slug)
      setTestResult(result)

      // Log to server
      void fetch(`/api/interview/sessions/${sessionId}/coding/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testResults: result, isSubmit: false }),
      })

      // Debounced failed-run trigger
      if (result.failed > 0 && sessionStatus === "active") {
        if (failedRunDebounceRef.current) clearTimeout(failedRunDebounceRef.current)
        failedRunDebounceRef.current = setTimeout(() => {
          void fireAgentTurn("failed_run", undefined, { passed: result.passed, failed: result.failed })
        }, 30_000)
      }

      return result
    } finally {
      setIsRunning(false)
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(forced = false) {
    if (!forced) setShowSubmitConfirm(false)
    setIsSubmitting(true)
    try {
      // Run all hidden tests
      let result: TestRunResult | undefined
      if (runnerRef.current && runnerStatus === "ready") {
        const fnName = language === "python" ? fnNames.python : fnNames.javascript
        result = isServerSideLanguage(language)
          ? await runnerRef.current.runServerSide({ code, fnName, tests: hiddenTests, pythonSignature, sessionId })
          : await runnerRef.current.run(code, fnName, hiddenTests, slug)
        setTestResult(result)
      }

      const res = await fetch(`/api/interview/sessions/${sessionId}/coding/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalCode: code, testResults: result ?? {}, languageUsed: language }),
      })
      const data = await res.json()
      if (res.ok) {
        setSessionStatus("completed")
        // Fire walkthrough trigger (don't await — let UI update first)
        void fireAgentTurn("submit_walkthrough", undefined, result)
        setTimeout(() => router.push(data.debriefUrl), 3000)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Language toggle ────────────────────────────────────────────────────────
  async function handleLanguageChange(newLang: CodingLanguage) {
    if (newLang === language) return
    const hasCode = code.trim() !== ""
    if (hasCode) {
      if (!confirm("Switching language clears your current code. Continue?")) return
    }
    setLanguage(newLang)

    // Generate starter code for the new language
    const sig = pythonSignature ? parsePythonSignature(pythonSignature) : null
    let starter = ""
    if (newLang === "python") {
      starter = problem?.functionSignature?.python ?? ""
    } else if (newLang === "javascript" || newLang === "typescript") {
      starter = problem?.functionSignature?.javascript ?? ""
    } else if (newLang === "go" && sig) {
      starter = generateGoStarter(sig)
    } else if (newLang === "java" && sig) {
      starter = generateJavaStarter(sig)
    }
    setCode(starter)
    lastSnapshotCodeRef.current = ""

    void fetch(`/api/interview/sessions/${sessionId}/coding/attempt`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ languageUsed: newLang }),
    })
    void initRunner(newLang)
  }

  // ── Force end ──────────────────────────────────────────────────────────────
  async function handleForceEnd() {
    setShowEndConfirm(false)
    const res = await fetch(`/api/interview/sessions/${sessionId}/end`, { method: "POST" })
    const data = await res.json()
    if (res.ok) { setSessionStatus("completed"); router.push(data.debriefUrl) }
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isInitializing) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3 w-64">
          {[0,1,2].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}
        </div>
      </div>
    )
  }

  const isCompleted = sessionStatus === "completed" || sessionStatus === "abandoned"
  const targetSec_ = (problem?.targetMinutes ?? 30) * 60

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <CodingTopBar
        persona={session?.persona ?? ""}
        jobTitle={jobInfo?.title ?? "Generic interview"}
        jobCompany={jobInfo?.company ?? null}
        remainingSec={remainingSec}
        targetSec={targetSec_}
        hintsUsed={hintsUsed}
        hintsTotal={hintsTotal}
        onEnd={() => setShowEndConfirm(true)}
        sessionCompleted={isCompleted}
      />

      {/* Completed banner */}
      {isCompleted && (
        <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2.5 text-center">
          <p className="text-[13px] font-semibold text-emerald-700">
            Submission complete.{" "}
            <Link href={`/dashboard/interview/${sessionId}/debrief`} className="underline hover:text-emerald-800">
              View debrief →
            </Link>
          </p>
        </div>
      )}

      {/* Pyodide loading indicator */}
      {runnerStatus === "initializing" && language === "python" && (
        <div className="border-b border-blue-100 bg-blue-50 px-4 py-2 text-center">
          <p className="text-[12px] text-blue-700">
            Loading Python runtime in your browser. This is a one-time download (~10MB)…
          </p>
        </div>
      )}
      {runnerStatus === "error" && !isServerSideLanguage(language) && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-center">
          <p className="text-[12px] text-red-600">
            Runtime failed to load. Try refreshing or switch to JavaScript.
          </p>
        </div>
      )}

      {/* Body: left panel + right agent panel */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: problem + editor + console */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Problem statement (scrollable, capped height) */}
          <div className="max-h-[40%] overflow-y-auto border-b border-slate-200 bg-white px-4 py-4">
            {problem && <ProblemStatement problem={problem} />}
          </div>

          {/* Language toggle */}
          <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
            <LanguageToggle value={language} onChange={handleLanguageChange} disabled={isCompleted} />
          </div>

          {/* Monaco editor */}
          <div className="min-h-0 flex-1">
            <MonacoEditor
              language={language}
              value={code}
              onChange={handleCodeChange}
              readOnly={isCompleted}
            />
          </div>

          {/* Test console */}
          <div className="border-t border-slate-200 bg-white px-4 py-3">
            <TestConsole
              result={testResult}
              isRunning={isRunning}
              onRun={() => void runTests(false)}
              onSubmit={() => setShowSubmitConfirm(true)}
              sessionCompleted={isCompleted}
            />
          </div>
        </div>

        {/* Right: interviewer panel */}
        <div className="hidden w-64 shrink-0 border-l border-slate-200 xl:flex xl:flex-col">
          <CodingInterviewerPanel
            messages={agentMessages}
            onSendMessage={(content) => void fireAgentTurn("candidate_message", content)}
            onHint={() => void fireAgentTurn("hint_request")}
            hintsUsed={hintsUsed}
            hintsTotal={hintsTotal}
            isLoading={agentLoading}
            sessionCompleted={isCompleted}
          />
        </div>
      </div>

      {/* End confirm */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-[15px] font-semibold text-slate-900">End the session now?</h3>
            <p className="mt-1.5 text-[13px] text-slate-500">Your progress will be saved.</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowEndConfirm(false)}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
                Keep going
              </button>
              <button type="button" onClick={() => void handleForceEnd()}
                className="flex-1 rounded-lg bg-red-500 py-2.5 text-[13px] font-semibold text-white hover:bg-red-600">
                End
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit confirm */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-[15px] font-semibold text-slate-900">Submit your final solution?</h3>
            <p className="mt-1.5 text-[13px] text-slate-500">You can&apos;t edit after this.</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowSubmitConfirm(false)}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
                Keep editing
              </button>
              <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}
                className="flex-1 rounded-lg bg-orange-500 py-2.5 text-[13px] font-semibold text-white hover:bg-orange-600 disabled:opacity-60">
                {isSubmitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import dynamic from "next/dynamic"
import { Mic, MicOff, PhoneOff } from "lucide-react"
import CodingTopBar from "@/components/interview/CodingTopBar"
import ProblemStatement from "@/components/interview/ProblemStatement"
import LanguageToggle from "@/components/interview/LanguageToggle"
import TestConsole from "@/components/interview/TestConsole"
import LiveCaptions, { type CaptionItem } from "@/components/interview/LiveCaptions"
import SessionTimer from "@/components/interview/SessionTimer"
import PermissionGate from "@/components/interview/PermissionGate"
import { RealtimeClient } from "@/lib/scout/interview/RealtimeClient"
import {
  CodingRunner,
  type TestRunResult,
  type CodingLanguage,
  type RunnerStatus,
} from "@/lib/scout/interview/codingRunner"
import { cn } from "@/lib/utils"

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

export type SessionMeta = {
  persona: string
  questionSet: string
  status: string
  durationTargetMin: number
  jobId: string | null
  startedAt: string | null
  metadata?: { practice_focus?: { observation: string } | null }
}

export type JobInfo = { title: string; company: string | null }

export type LiveCodingWorkspaceProps = {
  sessionId: string
  initialLoaded?: boolean
  initialSession?: SessionMeta | null
  initialJobInfo?: JobInfo | null
}

type Phase = "permission" | "loading" | "connecting" | "live" | "ended"
const MAX_AUTO_RECONNECTS = 3
const RECONNECT_DELAY_MS = 3000

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeRemaining(startedAt: string | null, targetMin: number): number {
  if (!startedAt) return targetMin * 60
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  return Math.max(0, targetMin * 60 - elapsed)
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LiveCodingWorkspace({
  sessionId,
  initialLoaded = false,
  initialSession = null,
  initialJobInfo = null,
}: LiveCodingWorkspaceProps) {
  const router = useRouter()

  // Phase
  const [phase, setPhase] = useState<Phase>("permission")
  const [connectError, setConnectError] = useState<string | null>(null)
  const [reconnectCountdownSec, setReconnectCountdownSec] = useState<number | null>(null)
  const [reconnectAttemptUi, setReconnectAttemptUi] = useState(0)

  // Voice
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false)
  const [captions, setCaptions] = useState<CaptionItem[]>([])
  const clientRef = useRef<RealtimeClient | null>(null)
  const partialAgentIdRef = useRef<string | null>(null)
  const recoveryKeyRef = useRef(`interview-recovery-${sessionId}`)
  const reconnectAttemptsRef = useRef(0)
  const reconnectInFlightRef = useRef(false)
  const sessionEndingRef = useRef(false)
  const reconnectDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Coding state
  const [session, setSession] = useState<SessionMeta | null>(initialSession)
  const [problem, setProblem] = useState<PublicProblem | null>(null)
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(initialJobInfo)
  const [code, setCode] = useState("")
  const [language, setLanguage] = useState<"python" | "javascript">("python")
  const [sessionStatus, setSessionStatus] = useState(initialSession?.status ?? "setup")
  const sessionStatusRef = useRef(initialSession?.status ?? "setup")
  const [hiddenTests, setHiddenTests] = useState<{ input: unknown[]; expected: unknown; weight: number }[]>([])
  const [fnNames, setFnNames] = useState({ python: "solution", javascript: "solution" })
  const [slug, setSlug] = useState("")
  const [testResult, setTestResult] = useState<TestRunResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [hintsUsed, setHintsUsed] = useState(0)
  const hintsTotal = problem?.hintsCount ?? 3

  // Runner
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus>("initializing")
  const runnerRef = useRef<CodingRunner | null>(null)

  // Timer
  const [remainingSec, setRemainingSec] = useState(
    initialSession ? computeRemaining(initialSession.startedAt, initialSession.durationTargetMin) : 0
  )

  // Flags
  const autoEndFiredRef = useRef(false)
  const timeWarningSentRef = useRef(false)
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const codeVoiceSyncRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastSnapshotCodeRef = useRef("")
  const lastVoiceCodeRef = useRef("")

  // UI
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)

  const clearReconnectTimers = useCallback(() => {
    if (reconnectDelayTimerRef.current) {
      clearTimeout(reconnectDelayTimerRef.current)
      reconnectDelayTimerRef.current = null
    }
    if (reconnectCountdownTimerRef.current) {
      clearInterval(reconnectCountdownTimerRef.current)
      reconnectCountdownTimerRef.current = null
    }
  }, [])

  // ── Init runner ────────────────────────────────────────────────────────────
  const initRunner = useCallback(async (lang: CodingLanguage) => {
    if (runnerRef.current) { runnerRef.current.terminate(); runnerRef.current = null }
    setRunnerStatus("initializing")
    try {
      const r = await CodingRunner.init(lang, setRunnerStatus)
      runnerRef.current = r
    } catch { setRunnerStatus("error") }
  }, [])

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      runnerRef.current?.terminate()
      if (snapshotIntervalRef.current) clearInterval(snapshotIntervalRef.current)
      if (codeVoiceSyncRef.current) clearInterval(codeVoiceSyncRef.current)
      clearReconnectTimers()
    }
  }, [clearReconnectTimers])

  useEffect(() => {
    sessionStatusRef.current = sessionStatus
  }, [sessionStatus])

  useEffect(() => {
    isSubmittingRef.current = isSubmitting
  }, [isSubmitting])

  // ── Load session metadata (fallback when server preload is unavailable) ───
  useEffect(() => {
    if (initialLoaded) return

    async function loadSession() {
      const res = await fetch(`/api/interview/sessions/${sessionId}`)
      if (!res.ok) return
      const data = await res.json()
      if (!data.session) return

      const s = data.session as SessionMeta
      setSession(s)
      setSessionStatus(s.status)
      if (data.session?.jobTitle) {
        setJobInfo({ title: data.session.jobTitle, company: data.session.jobCompany })
      }
    }

    void loadSession()
  }, [initialLoaded, sessionId])

  const fetchRealtimeToken = useCallback(async (): Promise<{ token: string | null; error: string | null }> => {
    const tokenRes = await fetch(`/api/interview/sessions/${sessionId}/realtime-token`, { method: "POST" })
    const tokenRaw = await tokenRes.text()
    let tokenData: { ephemeralToken?: string; error?: string } = {}
    try {
      tokenData = JSON.parse(tokenRaw) as { ephemeralToken?: string; error?: string }
    } catch {
      tokenData = { error: tokenRaw }
    }
    if (!tokenRes.ok) return { token: null, error: tokenData.error ?? "Voice connection failed" }
    if (!tokenData.ephemeralToken) return { token: null, error: "Voice token missing." }
    return { token: tokenData.ephemeralToken, error: null }
  }, [sessionId])

  const connectVoiceClient = useCallback(async (
    stream: MediaStream,
    opts?: { reconnect?: boolean }
  ): Promise<void> => {
    const reconnect = opts?.reconnect === true
    if (reconnect && reconnectInFlightRef.current) return
    if (reconnect) {
      reconnectInFlightRef.current = true
      setConnectError("Voice disconnected. Reconnecting…")
      setPhase("connecting")
    } else {
      clearReconnectTimers()
      reconnectAttemptsRef.current = 0
      reconnectInFlightRef.current = false
      setReconnectAttemptUi(0)
      setReconnectCountdownSec(null)
    }
    const queueReconnect = (reason: string): boolean => {
      if (sessionEndingRef.current || isSubmittingRef.current) return false
      const status = sessionStatusRef.current
      if (status === "completed" || status === "abandoned") return false
      if (reconnectAttemptsRef.current >= MAX_AUTO_RECONNECTS || reconnectInFlightRef.current) return false
      reconnectAttemptsRef.current += 1
      setReconnectAttemptUi(reconnectAttemptsRef.current)
      setReconnectCountdownSec(Math.ceil(RECONNECT_DELAY_MS / 1000))
      setConnectError(reason)
      clearReconnectTimers()
      reconnectCountdownTimerRef.current = setInterval(() => {
        setReconnectCountdownSec((prev) => {
          if (prev === null) return null
          return prev > 1 ? prev - 1 : 1
        })
      }, 1000)
      reconnectDelayTimerRef.current = setTimeout(() => {
        clearReconnectTimers()
        setReconnectCountdownSec(null)
        void connectVoiceClient(stream, { reconnect: true })
      }, RECONNECT_DELAY_MS)
      return true
    }

    const token = await fetchRealtimeToken()
    if (!token.token) {
      reconnectInFlightRef.current = false
      clearReconnectTimers()
      setReconnectCountdownSec(null)
      if (reconnect && queueReconnect(`Voice reconnect failed: ${token.error ?? "Unknown error"}. Retrying…`)) {
        return
      }
      setConnectError(
        reconnect
          ? `Voice reconnect failed: ${token.error ?? "Unknown error"}. Continuing without voice.`
          : token.error ?? "Voice connection failed — coding without voice"
      )
      setPhase("live")
      return
    }

    const client = new RealtimeClient({ ephemeralToken: token.token })
    clientRef.current = client
    const isCurrentClient = () => clientRef.current === client

    client.addEventListener("agent.speaking.start", () => {
      if (!isCurrentClient()) return
      setIsAgentSpeaking(true)
    })
    client.addEventListener("agent.speaking.end", () => {
      if (!isCurrentClient()) return
      setIsAgentSpeaking(false)
    })

    client.addEventListener("agent.transcript.delta", (e) => {
      if (!isCurrentClient()) return
      const { text } = (e as CustomEvent<{ text: string }>).detail
      setCaptions((prev) => {
        const pid = partialAgentIdRef.current
        if (pid) return prev.map((c) => c.id === pid ? { ...c, content: c.content + text } : c)
        const newId = `agent-${Date.now()}`
        partialAgentIdRef.current = newId
        return [...prev, { id: newId, role: "interviewer", content: text, partial: true }]
      })
    })

    client.addEventListener("agent.transcript.completed", (e) => {
      if (!isCurrentClient()) return
      const { text } = (e as CustomEvent<{ text: string; startMs: number; endMs: number }>).detail
      const pid = partialAgentIdRef.current
      setCaptions((prev) => {
        if (pid) {
          partialAgentIdRef.current = null
          return prev.map((c) => c.id === pid ? { ...c, content: text, partial: false } : c)
        }
        return [...prev, { id: `agent-${Date.now()}`, role: "interviewer", content: text }]
      })
    })

    client.addEventListener("user.transcript.completed", (e) => {
      if (!isCurrentClient()) return
      const { text } = (e as CustomEvent<{ text: string }>).detail
      setCaptions((prev) => [...prev, { id: `user-${Date.now()}`, role: "candidate", content: text }])
    })

    client.addEventListener("connection.ready", () => {
      if (!isCurrentClient()) return
      reconnectInFlightRef.current = false
      clearReconnectTimers()
      setReconnectCountdownSec(null)
      setConnectError(null)
      setPhase("live")
      if (!reconnect) {
        void client.sendSystemNote("BEGIN_CODING_INTERVIEW")
      }
    })

    client.addEventListener("connection.error", (e) => {
      if (!isCurrentClient()) return
      const { error } = (e as CustomEvent<{ error: string }>).detail
      setConnectError(error)
    })

    client.addEventListener("connection.closed", () => {
      if (!isCurrentClient()) return
      if (sessionEndingRef.current || isSubmittingRef.current) return
      const status = sessionStatusRef.current
      if (status === "completed" || status === "abandoned") return
      if (queueReconnect("Voice disconnected. Attempting to reconnect…")) return
      reconnectInFlightRef.current = false
      clearReconnectTimers()
      setReconnectCountdownSec(null)
      setConnectError("Voice disconnected and couldn't recover. You can continue coding and submit normally.")
    })

    try {
      await client.connect(stream)
    } catch (e) {
      reconnectInFlightRef.current = false
      clearReconnectTimers()
      setReconnectCountdownSec(null)
      const msg = e instanceof Error ? e.message : String(e)
      if (reconnect && queueReconnect(`Voice reconnect failed: ${msg}. Retrying…`)) {
        return
      }
      setConnectError(
        reconnect
          ? `Voice reconnect failed: ${msg}. Continuing without voice.`
          : `${msg}. Continuing coding without voice.`
      )
      setPhase("live")
    }
  }, [clearReconnectTimers, fetchRealtimeToken])

  // ── Start session (called after mic granted) ───────────────────────────────
  const startSession = useCallback(async (stream: MediaStream) => {
    setLocalStream(stream)
    clearReconnectTimers()
    sessionEndingRef.current = false
    setReconnectAttemptUi(0)
    setReconnectCountdownSec(null)
    setPhase("loading")
    setConnectError(null)

    try {
      // 1. Init coding session
      const startRes = await fetch(`/api/interview/sessions/${sessionId}/coding/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredLanguage: "python" }),
      })
      const startData = await startRes.json()
      if (!startRes.ok) {
        setConnectError(startData.error ?? "Failed to start session")
        stream.getTracks().forEach((track) => track.stop())
        setLocalStream(null)
        setPhase("permission")
        return
      }

      const { attempt, problem: p, timeRemainingSec } = startData
      setProblem(p)
      setSlug(p.slug)
      setHintsUsed(attempt.hintsUsed ?? 0)
      setRemainingSec(timeRemainingSec)
      setSessionStatus("active")

      // Keep session timer aligned without an extra metadata fetch.
      setSession((prev) => {
        if (!prev) return prev
        const totalSec = prev.durationTargetMin * 60
        const elapsedSec = Math.max(0, totalSec - Number(timeRemainingSec ?? totalSec))
        const derivedStartedAt = new Date(Date.now() - elapsedSec * 1000).toISOString()
        return {
          ...prev,
          status: "active",
          startedAt: prev.startedAt ?? derivedStartedAt,
        }
      })

      const langRaw = (attempt.languageUsed as string) ?? "python"
      const lang: "python" | "javascript" = langRaw === "javascript" ? "javascript" : "python"
      setLanguage(lang)

      const savedCode =
        attempt.finalCode ??
        (attempt.codeSnapshots?.length > 0
          ? attempt.codeSnapshots[attempt.codeSnapshots.length - 1].code
          : null) ??
        p.functionSignature?.[lang] ?? ""
      setCode(savedCode)
      lastSnapshotCodeRef.current = savedCode
      lastVoiceCodeRef.current = savedCode

      // Fallback metadata fetch when not preloaded yet.
      if (!session) {
        const sessRes = await fetch(`/api/interview/sessions/${sessionId}`)
        if (sessRes.ok) {
          const sessData = await sessRes.json()
          setSession(sessData.session)
          if (sessData.session?.jobTitle) {
            setJobInfo({ title: sessData.session.jobTitle, company: sessData.session.jobCompany })
          }
        }
      }

      // Hidden tests
      const testsRes = await fetch(`/api/interview/sessions/${sessionId}/coding/tests`, { method: "POST" })
      if (testsRes.ok) {
        const testsData = await testsRes.json()
        setHiddenTests(testsData.tests ?? [])
        setFnNames({ python: testsData.pythonFnName, javascript: testsData.jsFnName })
        if (testsData.slug) setSlug(testsData.slug)
      }

      void initRunner(lang)

      // 2. Connect to Realtime API
      setPhase("connecting")
      await connectVoiceClient(stream)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setConnectError(msg)
      stream.getTracks().forEach((track) => track.stop())
      setLocalStream(null)
      setPhase("permission")
    }
  }, [clearReconnectTimers, connectVoiceClient, initRunner, session, sessionId])

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.startedAt || phase !== "live" || sessionStatus === "completed" || sessionStatus === "abandoned") return
    const tick = () => setRemainingSec(computeRemaining(session.startedAt, session.durationTargetMin))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [session?.startedAt, session?.durationTargetMin, sessionStatus, phase])

  const targetSec = (session?.durationTargetMin ?? problem?.targetMinutes ?? 30) * 60

  // Auto-end at 0
  useEffect(() => {
    if (remainingSec === 0 && sessionStatus === "active" && phase === "live" && !autoEndFiredRef.current && !isSubmitting) {
      autoEndFiredRef.current = true
      void clientRef.current?.sendSystemNote("TIME_UP")
      void handleSubmit(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec, sessionStatus, phase, isSubmitting])

  // Time warning
  useEffect(() => {
    if (!timeWarningSentRef.current && remainingSec > 0 && targetSec > 0 &&
        remainingSec / targetSec <= 0.2 && sessionStatus === "active" && phase === "live") {
      timeWarningSentRef.current = true
      void clientRef.current?.sendSystemNote("TIME_REMAINING_2_MIN")
    }
  }, [remainingSec, targetSec, sessionStatus, phase])

  // ── Code snapshot ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "live" || sessionStatus !== "active") return
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
  }, [code, phase, sessionStatus, sessionId])

  // ── Voice code sync ────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "live" || sessionStatus !== "active") return
    codeVoiceSyncRef.current = setInterval(() => {
      const client = clientRef.current
      if (code !== lastVoiceCodeRef.current && client) {
        lastVoiceCodeRef.current = code
        void client.sendSystemNote(`CURRENT_CODE:\n\`\`\`\n${code.slice(0, 1500)}\n\`\`\``)
      }
    }, 30_000)
    return () => { if (codeVoiceSyncRef.current) clearInterval(codeVoiceSyncRef.current) }
  }, [code, phase, sessionStatus])

  // ── beforeunload recovery ──────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "live") return
    const handler = () => {
      const client = clientRef.current
      if (!client || client.events.length === 0) return
      const payload = JSON.stringify({ events: client.events, voiceTimings: client.getVoiceTimings() })
      localStorage.setItem(recoveryKeyRef.current, payload)
      navigator.sendBeacon(
        `/api/interview/sessions/${sessionId}/transcript`,
        new Blob([payload], { type: "application/json" })
      )
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [phase, sessionId])

  // ── Run tests ──────────────────────────────────────────────────────────────
  async function runTests() {
    if (!runnerRef.current || runnerStatus !== "ready" || !problem) return
    setIsRunning(true)
    try {
      const fnName = language === "python" ? fnNames.python : fnNames.javascript
      const result = await runnerRef.current.run(code, fnName, hiddenTests.slice(0, 3), slug)
      setTestResult(result)
      void fetch(`/api/interview/sessions/${sessionId}/coding/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testResults: result, isSubmit: false }),
      })
      if (result.failed > 0 && sessionStatus === "active") {
        void clientRef.current?.sendSystemNote(`FAILED_RUN: ${result.passed} passed, ${result.failed} failed`)
      }
    } finally {
      setIsRunning(false)
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(forced = false) {
    if (!forced) setShowSubmitConfirm(false)
    setIsSubmitting(true)
    try {
      // Run all hidden tests first
      let result: TestRunResult | undefined
      if (runnerRef.current && runnerStatus === "ready" && problem) {
        const fnName = language === "python" ? fnNames.python : fnNames.javascript
        result = await runnerRef.current.run(code, fnName, hiddenTests, slug)
        setTestResult(result)
      }

      // Save code submission (marks session completed)
      const res = await fetch(`/api/interview/sessions/${sessionId}/coding/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalCode: code, testResults: result ?? {}, languageUsed: language }),
      })
      const data = await res.json()

      if (res.ok) {
        sessionEndingRef.current = true
        clearReconnectTimers()
        setReconnectCountdownSec(null)
        setSessionStatus("completed")

        // Notify AI of submission, give a moment for walkthrough
        void clientRef.current?.sendSystemNote("SUBMIT_WALKTHROUGH")
        void fetch(`/api/interview/sessions/${sessionId}/coding/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger: "submit_walkthrough", testResults: result }),
        }).catch(() => {})

        // Save transcript after a short delay (let AI start speaking first)
        setTimeout(async () => {
          const client = clientRef.current
          if (client) {
            const events = client.events
            const voiceTimings = client.getVoiceTimings()
            await client.disconnect()
            localStorage.removeItem(recoveryKeyRef.current)
            await fetch(`/api/interview/sessions/${sessionId}/transcript`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ events, voiceTimings }),
            }).catch(() => {})
          }
          router.push(data.debriefUrl)
        }, 4000)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Force end ──────────────────────────────────────────────────────────────
  async function handleForceEnd() {
    setShowEndConfirm(false)
    sessionEndingRef.current = true
    clearReconnectTimers()
    setReconnectCountdownSec(null)
    const client = clientRef.current

    if (client) {
      const events = client.events
      const voiceTimings = client.getVoiceTimings()
      localStream?.getTracks().forEach((t) => t.stop())
      await client.disconnect()
      localStorage.removeItem(recoveryKeyRef.current)

      try {
        const res = await fetch(`/api/interview/sessions/${sessionId}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events, voiceTimings }),
        })
        const d = await res.json()
        if (res.ok) { router.push(d.debriefUrl); return }
      } catch { /* fallback */ }
    }

    // Fallback
    const res = await fetch(`/api/interview/sessions/${sessionId}/end`, { method: "POST" })
    const d = await res.json()
    if (res.ok) router.push(d.debriefUrl)
  }

  // ── Language toggle ────────────────────────────────────────────────────────
  async function handleLanguageChange(newLang: import("@/lib/scout/interview/codingRunner").CodingLanguage) {
    if (newLang !== "python" && newLang !== "javascript") return
    if (newLang === language) return
    const hasCode = code.trim() !== "" && code !== (problem?.functionSignature?.[language] ?? "")
    if (hasCode && !confirm("Switching language clears your current code. Continue?")) return
    setLanguage(newLang)
    setCode(problem?.functionSignature?.[newLang] ?? "")
    lastSnapshotCodeRef.current = ""
    lastVoiceCodeRef.current = ""
    void fetch(`/api/interview/sessions/${sessionId}/coding/attempt`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ languageUsed: newLang }),
    })
    void initRunner(newLang)
  }

  // ── Phase renders ──────────────────────────────────────────────────────────

  if (phase === "permission") {
    return (
      <PermissionGate
        mode="coding"
        error={connectError}
        fallbackHref="/dashboard/interview/setup?type=coding"
        fallbackLabel="Back to setup"
        onReady={(stream) => void startSession(stream)}
      />
    )
  }

  if (phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-64 space-y-3 text-center">
          <p className="text-[13px] text-slate-500">Setting up your coding session…</p>
          {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}
        </div>
      </div>
    )
  }

  if (phase === "connecting") {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mb-4 flex justify-center gap-2">
            {[0, 160, 320].map((d) => (
              <span key={d} className="h-2 w-2 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
          <p className="text-[14px] font-medium text-white">
            {reconnectAttemptUi > 0 ? `Reconnecting voice (attempt ${reconnectAttemptUi}/${MAX_AUTO_RECONNECTS})…` : "Connecting your interviewer…"}
          </p>
        </div>
      </div>
    )
  }

  const isCompleted = sessionStatus === "completed" || sessionStatus === "abandoned"

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <CodingTopBar
        persona={session?.persona ?? ""}
        jobTitle={jobInfo?.title ?? "Generic interview"}
        jobCompany={jobInfo?.company ?? null}
        remainingSec={remainingSec}
        targetSec={(problem?.targetMinutes ?? 30) * 60}
        hintsUsed={hintsUsed}
        hintsTotal={hintsTotal}
        onEnd={() => setShowEndConfirm(true)}
        sessionCompleted={isCompleted}
      />
      {reconnectCountdownSec !== null && (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-center">
          <p className="text-[12px] font-semibold text-amber-700">
            Voice reconnecting in {reconnectCountdownSec}s…
          </p>
        </div>
      )}

      {/* Completed banner */}
      {isCompleted && (
        <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2.5 text-center">
          <p className="text-[13px] font-semibold text-emerald-700">
            Submission complete — generating debrief…{" "}
            <Link href={`/dashboard/interview/${sessionId}/debrief`} className="underline hover:text-emerald-800">
              View debrief →
            </Link>
          </p>
        </div>
      )}

      {/* Python runtime loading */}
      {runnerStatus === "initializing" && language === "python" && (
        <div className="border-b border-blue-100 bg-blue-50 px-4 py-2 text-center">
          <p className="text-[12px] text-blue-700">
            Loading Python runtime in your browser. One-time download (~10MB)…
          </p>
        </div>
      )}
      {runnerStatus === "error" && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-center">
          <p className="text-[12px] text-red-600">
            Runtime failed to load. Try refreshing or switch to JavaScript.
          </p>
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Main coding layout: question + coding side-by-side */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <div className="min-h-[180px] overflow-y-auto border-b border-slate-200 bg-white px-4 py-4 md:min-h-0 md:w-[40%] md:border-b-0 md:border-r">
            {problem && <ProblemStatement problem={problem} />}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
              <LanguageToggle value={language} onChange={handleLanguageChange} disabled={isCompleted} />
            </div>
            <div className="min-h-0 flex-1">
              <MonacoEditor
                language={language}
                value={code}
                onChange={setCode}
                readOnly={isCompleted}
              />
            </div>
            <div className="border-t border-slate-200 bg-white px-4 py-3">
              <TestConsole
                result={testResult}
                isRunning={isRunning}
                onRun={() => void runTests()}
                onSubmit={() => setShowSubmitConfirm(true)}
                sessionCompleted={isCompleted}
              />
            </div>
          </div>
        </div>

        {/* Live voice captions panel (bottom, not side-by-side) */}
        <div className="border-t border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <span
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                isAgentSpeaking ? "bg-orange-500 animate-pulse" : clientRef.current ? "bg-emerald-400" : "bg-slate-300"
              )}
            />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              {isAgentSpeaking ? "Interviewer speaking…" : "Live voice"}
            </span>
          </div>
          <div className="max-h-40 overflow-y-auto p-3">
            <LiveCaptions captions={captions} />
          </div>
        </div>
      </div>

      {/* Voice controls bar */}
      <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-6 py-3">
        <SessionTimer remainingSec={remainingSec} tone="dark" />

        <div className="flex items-center gap-3">
          <button
            type="button"
            title={isMuted ? "Unmute" : "Mute"}
            onClick={() => {
              const next = !isMuted
              setIsMuted(next)
              clientRef.current?.setMuted(next)
            }}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full transition",
              isMuted
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600"
            )}
          >
            {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          <button
            type="button"
            title="End session"
            onClick={() => setShowEndConfirm(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white transition hover:bg-red-600"
          >
            <PhoneOff className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
          <span className="text-[11px] font-medium text-slate-400">LIVE</span>
        </div>
      </div>

      {/* End confirm */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-[15px] font-semibold text-slate-900">End the session now?</h3>
            <p className="mt-1.5 text-[13px] text-slate-500">
              Your code and voice session will be saved and a debrief generated.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Keep going
              </button>
              <button
                type="button"
                onClick={() => void handleForceEnd()}
                className="flex-1 rounded-lg bg-red-500 py-2.5 text-[13px] font-semibold text-white hover:bg-red-600"
              >
                End &amp; get debrief
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit confirm */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-[15px] font-semibold text-slate-900">Submit your final solution?</h3>
            <p className="mt-1.5 text-[13px] text-slate-500">
              You can&apos;t edit after this. Your interviewer will ask you to walk through your solution.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(false)}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting}
                className="flex-1 rounded-lg bg-orange-500 py-2.5 text-[13px] font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
              >
                {isSubmitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import PermissionGate from "@/components/interview/PermissionGate"
import WebcamPreview from "@/components/interview/WebcamPreview"
import InterviewerWaveform from "@/components/interview/InterviewerWaveform"
import LiveCaptions, { type CaptionItem } from "@/components/interview/LiveCaptions"
import LiveControlsBar from "@/components/interview/LiveControlsBar"
import SkillCoverageRail from "@/components/interview/SkillCoverageRail"
import { RealtimeClient } from "@/lib/apex/interview/RealtimeClient"

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionMeta = {
  persona: string
  questionSet: string
  status: string
  durationTargetMin: number
  jobId: string | null
  startedAt: string | null
  skillList?: string[]
  metadata?: { practice_focus?: { observation: string } | null }
}

export type JobInfo = {
  title: string
  company: string | null
}

export type LiveInterviewRoomProps = {
  sessionId: string
  initialLoaded?: boolean
  initialSession?: SessionMeta | null
  initialJobInfo?: JobInfo | null
  initialSkillsCovered?: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeRemaining(startedAt: string | null, durationMin: number): number {
  if (!startedAt) return durationMin * 60
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  return Math.max(0, durationMin * 60 - elapsed)
}

const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Recruiter",
  skeptical_hm: "Skeptical HM",
  senior_staff: "Senior Peer",
  founder: "Founder",
  panel: "Panel",
}
const MAX_AUTO_RECONNECTS = 3
const RECONNECT_DELAY_MS = 3000

// ── Main component ────────────────────────────────────────────────────────────

export default function LiveInterviewRoom({
  sessionId,
  initialLoaded = false,
  initialSession = null,
  initialJobInfo = null,
  initialSkillsCovered = [],
}: LiveInterviewRoomProps) {
  const router = useRouter()

  // Phases
  const [phase, setPhase] = useState<"permission" | "connecting" | "live" | "ended">(
    initialSession?.status === "completed" || initialSession?.status === "abandoned"
      ? "ended"
      : "permission"
  )
  const [connectError, setConnectError] = useState<string | null>(null)
  const [reconnectCountdownSec, setReconnectCountdownSec] = useState<number | null>(null)
  const [reconnectAttemptUi, setReconnectAttemptUi] = useState(0)

  // Session
  const [session, setSession] = useState<SessionMeta | null>(initialSession)
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(initialJobInfo)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [agentStream, setAgentStream] = useState<MediaStream | null>(null)

  // Controls
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOn, setIsCameraOn] = useState(true)

  // Timer
  const [remainingSec, setRemainingSec] = useState(
    initialSession ? computeRemaining(initialSession.startedAt, initialSession.durationTargetMin) : 0
  )
  const timeWarningSentRef = useRef(false)
  const autoEndFiredRef = useRef(false)

  // Captions + skills
  const [captions, setCaptions] = useState<CaptionItem[]>([])
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false)
  const [skillsCovered, setSkillsCovered] = useState<string[]>(initialSkillsCovered)

  // Confirm dialog
  const [showEndConfirm, setShowEndConfirm] = useState(false)

  // Refs
  const clientRef = useRef<RealtimeClient | null>(null)
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const partialAgentIdRef = useRef<string | null>(null)
  const recoveryKeyRef = useRef(`interview-recovery-${sessionId}`)
  const reconnectAttemptsRef = useRef(0)
  const reconnectInFlightRef = useRef(false)
  const sessionEndingRef = useRef(false)
  const reconnectDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  useEffect(() => {
    return () => clearReconnectTimers()
  }, [clearReconnectTimers])

  const fetchRealtimeToken = useCallback(async (): Promise<{ token: string | null; error: string | null }> => {
    const tokenRes = await fetch(`/api/interview/sessions/${sessionId}/realtime-token`, { method: "POST" })
    const tokenRaw = await tokenRes.text()
    let tokenData: { ephemeralToken?: string; error?: string } = {}
    try {
      tokenData = JSON.parse(tokenRaw) as { ephemeralToken?: string; error?: string }
    } catch {
      tokenData = { error: tokenRaw }
    }
    if (!tokenRes.ok) return { token: null, error: tokenData.error ?? "Failed to get token" }
    if (!tokenData.ephemeralToken) return { token: null, error: "Token response was missing an ephemeral token." }
    return { token: tokenData.ephemeralToken, error: null }
  }, [sessionId])

  // ── Load session metadata ──────────────────────────────────────────────────
  useEffect(() => {
    if (initialLoaded) return

    async function loadSession() {
      const res = await fetch(`/api/interview/sessions/${sessionId}`)
      if (!res.ok) return
      const data = await res.json()
      setSession(data.session)
      if (data.session?.jobTitle) {
        setJobInfo({ title: data.session.jobTitle, company: data.session.jobCompany })
      }
      // If already completed, show interrupted state
      if (data.session?.status === "completed" || data.session?.status === "abandoned") {
        setPhase("ended")
      }
    }
    void loadSession()
  }, [initialLoaded, sessionId])

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "live" || !session?.startedAt) return
    const tick = () => setRemainingSec(computeRemaining(session.startedAt, session.durationTargetMin))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [phase, session?.startedAt, session?.durationTargetMin])

  // Time warning + auto-end
  useEffect(() => {
    if (phase !== "live" || !clientRef.current) return

    if (remainingSec <= 300 && !timeWarningSentRef.current) {
      timeWarningSentRef.current = true
      void clientRef.current.sendSystemNote("TIME_REMAINING_5_MIN")
    }

    if (remainingSec === 0 && !autoEndFiredRef.current) {
      autoEndFiredRef.current = true
      void clientRef.current.sendSystemNote("TIME_UP")
      // Wait up to 8s for agent to wrap, then finalize
      setTimeout(() => void finalizeSession(), 8_000)
    }
  }, [remainingSec, phase])

  // ── Connect to Realtime ────────────────────────────────────────────────────
  const startLive = useCallback(async (
    stream: MediaStream,
    opts?: { reconnect?: boolean }
  ) => {
    const reconnect = opts?.reconnect === true
    if (reconnect && reconnectInFlightRef.current) return

    if (!reconnect) {
      clearReconnectTimers()
      reconnectAttemptsRef.current = 0
      sessionEndingRef.current = false
      setReconnectAttemptUi(0)
      setReconnectCountdownSec(null)
      setLocalStream(stream)
    } else {
      reconnectInFlightRef.current = true
    }

    setPhase("connecting")
    setConnectError(reconnect ? "Connection dropped. Reconnecting…" : null)
    const queueReconnect = (reason: string): boolean => {
      if (sessionEndingRef.current || autoEndFiredRef.current) return false
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
        void startLive(stream, { reconnect: true })
      }, RECONNECT_DELAY_MS)
      return true
    }

    const token = await fetchRealtimeToken()
    if (!token.token) {
      reconnectInFlightRef.current = false
      clearReconnectTimers()
      setReconnectCountdownSec(null)
      if (reconnect) {
        const reason = token.error ?? "Reconnect failed."
        if (queueReconnect(`Reconnect failed: ${reason}`)) return
        setConnectError(reason)
        setPhase((prev) => (prev === "ended" ? prev : "ended"))
        return
      }
      setConnectError(token.error ?? "Failed to get token")
      stream.getTracks().forEach((track) => track.stop())
      setLocalStream(null)
      setPhase("permission")
      return
    }

    const client = new RealtimeClient({ ephemeralToken: token.token })
    clientRef.current = client
    const isCurrentClient = () => clientRef.current === client

    // Wire events
    client.addEventListener("agent.audio.stream", (e) => {
      if (!isCurrentClient()) return
      setAgentStream((e as CustomEvent<{ stream: MediaStream }>).detail.stream)
    })
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
        const partialId = partialAgentIdRef.current
        if (partialId) {
          return prev.map((c) => c.id === partialId ? { ...c, content: c.content + text } : c)
        }
        const newId = `agent-${Date.now()}`
        partialAgentIdRef.current = newId
        return [...prev, { id: newId, role: "interviewer", content: text, partial: true }]
      })
    })

    client.addEventListener("agent.transcript.completed", (e) => {
      if (!isCurrentClient()) return
      const { text } = (e as CustomEvent<{ text: string; startMs: number; endMs: number }>).detail
      const partialId = partialAgentIdRef.current
      setCaptions((prev) => {
        if (partialId) {
          partialAgentIdRef.current = null
          return prev.map((c) => c.id === partialId ? { ...c, content: text, partial: false } : c)
        }
        return [...prev, { id: `agent-${Date.now()}`, role: "interviewer", content: text }]
      })
      // Tag the turn in background for live skill rail
      void fetch(`/api/interview/sessions/${sessionId}/tag-turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      }).then(r => r.json()).then(d => {
        if (d.skill_tag) {
          setSkillsCovered(prev => prev.includes(d.skill_tag) ? prev : [...prev, d.skill_tag])
        }
      }).catch(() => {})
    })

    client.addEventListener("user.transcript.completed", (e) => {
      if (!isCurrentClient()) return
      const { text } = (e as CustomEvent<{ text: string; startMs: number; endMs: number }>).detail
      setCaptions((prev) => [...prev, { id: `user-${Date.now()}`, role: "candidate", content: text }])
    })

    client.addEventListener("connection.ready", () => {
      if (!isCurrentClient()) return
      reconnectInFlightRef.current = false
      clearReconnectTimers()
      setReconnectCountdownSec(null)
      setPhase("live")
      setConnectError(null)
      // Update started_at if not already set
      if (session && !session.startedAt) {
        setSession(s => s ? { ...s, startedAt: new Date().toISOString() } : s)
      }
      // Send trigger once at session start; reconnects should preserve flow.
      if (!reconnect) {
        void client.sendSystemNote("BEGIN_INTERVIEW")
      }
    })

    client.addEventListener("connection.error", (e) => {
      if (!isCurrentClient()) return
      const { error } = (e as CustomEvent<{ error: string }>).detail
      setConnectError(error)
    })

    client.addEventListener("connection.closed", () => {
      if (!isCurrentClient()) return
      if (sessionEndingRef.current || autoEndFiredRef.current) {
        setPhase((prev) => (prev === "ended" ? prev : "ended"))
        return
      }
      if (queueReconnect("Connection dropped. Attempting to reconnect…")) return
      reconnectInFlightRef.current = false
      clearReconnectTimers()
      setReconnectCountdownSec(null)
      setConnectError("Connection dropped and couldn't recover. End the session to generate your debrief.")
      setPhase((prev) => (prev === "ended" ? prev : "ended"))
    })

    try {
      await client.connect(stream)
    } catch (e) {
      reconnectInFlightRef.current = false
      clearReconnectTimers()
      setReconnectCountdownSec(null)
      const msg = e instanceof Error ? e.message : String(e)
      if (reconnect) {
        if (queueReconnect(`Reconnect failed: ${msg}`)) return
        setConnectError(`Reconnect failed: ${msg}`)
        setPhase((prev) => (prev === "ended" ? prev : "ended"))
      } else {
        setConnectError(msg)
        stream.getTracks().forEach((track) => track.stop())
        setLocalStream(null)
        setPhase("permission")
      }
    }
  }, [clearReconnectTimers, fetchRealtimeToken, session, sessionId])

  // ── Webcam snapshots ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "live" || !localStream || !isCameraOn) return

    const videoTrack = localStream.getVideoTracks()[0]
    if (!videoTrack) return

    snapshotIntervalRef.current = setInterval(async () => {
      if (document.visibilityState === "hidden" || !isCameraOn) return

      try {
        const canvas = document.createElement("canvas")
        canvas.width = 240
        canvas.height = 180
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        // ImageCapture API or fallback
        if ("ImageCapture" in window) {
          const capture = new (window as unknown as { ImageCapture: new (t: MediaStreamTrack) => { grabFrame: () => Promise<ImageBitmap> } }).ImageCapture(videoTrack)
          const bitmap = await capture.grabFrame()
          ctx.drawImage(bitmap, 0, 0, 240, 180)
          bitmap.close()
        } else {
          // Fallback: draw from a temporary video element
          const tmp = document.createElement("video")
          tmp.srcObject = localStream
          tmp.muted = true
          await tmp.play()
          ctx.drawImage(tmp, 0, 0, 240, 180)
          tmp.srcObject = null
          tmp.remove()
        }

        canvas.toBlob(async (blob) => {
          if (!blob) return
          const form = new FormData()
          form.append("image", blob, "snapshot.jpg")
          await fetch(`/api/interview/sessions/${sessionId}/snapshot`, {
            method: "POST",
            body: form,
          }).catch(() => {}) // non-blocking
        }, "image/jpeg", 0.6)
      } catch { /* non-blocking — snapshot failure doesn't stop the call */ }
    }, 10_000)

    return () => { if (snapshotIntervalRef.current) clearInterval(snapshotIntervalRef.current) }
  }, [phase, localStream, isCameraOn, sessionId])

  // ── beforeunload recovery ──────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "live") return

    const handler = () => {
      const client = clientRef.current
      if (!client || client.events.length === 0) return
      const payload = JSON.stringify({
        events: client.events,
        voiceTimings: client.getVoiceTimings(),
      })
      localStorage.setItem(recoveryKeyRef.current, payload)
      navigator.sendBeacon(
        `/api/interview/sessions/${sessionId}/transcript`,
        new Blob([payload], { type: "application/json" })
      )
    }

    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [phase, sessionId])

  // ── Finalize session ───────────────────────────────────────────────────────
  const finalizeSession = useCallback(async () => {
    const client = clientRef.current
    if (!client) return

    sessionEndingRef.current = true
    clearReconnectTimers()
    setReconnectCountdownSec(null)
    setPhase("ended")
    setIsAgentSpeaking(false)

    if (snapshotIntervalRef.current) clearInterval(snapshotIntervalRef.current)

    // Stop all tracks
    localStream?.getTracks().forEach((t) => t.stop())

    const events = client.events
    const voiceTimings = client.getVoiceTimings()
    await client.disconnect()

    try {
      const res = await fetch(`/api/interview/sessions/${sessionId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events, voiceTimings }),
      })
      const data = await res.json()
      if (res.ok) {
        // Clear recovery data on success
        localStorage.removeItem(recoveryKeyRef.current)
        router.push(data.debriefUrl)
      } else {
        setConnectError(data.error ?? "Failed to save transcript")
      }
    } catch {
      // Save to localStorage for recovery
      localStorage.setItem(recoveryKeyRef.current, JSON.stringify({ events, voiceTimings }))
      setConnectError("Couldn't save your transcript right now. We've kept it locally — try refreshing.")
    }
  }, [clearReconnectTimers, sessionId, localStream, router])

  // ── Controls ───────────────────────────────────────────────────────────────
  function handleToggleMute() {
    const next = !isMuted
    setIsMuted(next)
    clientRef.current?.setMuted(next)
  }

  function handleToggleCamera() {
    const next = !isCameraOn
    setIsCameraOn(next)
    localStream?.getVideoTracks().forEach((t) => { t.enabled = next })
  }

  async function handleEnd() {
    setShowEndConfirm(false)
    await finalizeSession()
  }

  // ── Skill list for rail — prefer server-computed list (job-specific) ─────────
  const skillList: string[] = session?.skillList?.length
    ? session.skillList
    : session ? (
        session.questionSet === "recruiter_screen"
          ? ["career narrative", "motivation / why this role", "what they're looking for", "timeline & availability", "team & culture fit", "communication"]
          : session.questionSet === "behavioral"
            ? ["ownership", "conflict resolution", "ambiguity", "impact storytelling", "growth/feedback", "leadership/influence"]
            : session.questionSet === "system_design"
              ? ["scoping", "data modeling", "API design", "scaling", "tradeoffs", "reliability"]
              : session.questionSet === "technical_screen"
                ? ["role-specific craft", "problem-solving", "decision-making", "collaboration", "quality bar", "judgment under tradeoffs"]
                : ["ownership", "impact storytelling", "ambiguity", "problem-solving", "judgment", "collaboration"]
      ) : []

  // ── Render: interrupted session ────────────────────────────────────────────
  if (phase === "ended" && session?.status !== "active") {
    return (
      <div className="flex h-full items-center justify-center bg-[#040407] px-4 text-white">
        <div className="max-w-sm rounded-3xl border border-white/15 bg-white/[0.04] p-8 text-center shadow-[0_24px_60px_rgba(2,6,23,0.6)] backdrop-blur">
          <h2 className="text-[15px] font-semibold text-white">This live session was interrupted.</h2>
          <p className="mt-2 text-[13px] text-slate-300">
            End it to generate your debrief based on what was captured.
          </p>
          {connectError && <p className="mt-2 text-[12px] text-amber-300">{connectError}</p>}
          <div className="mt-5 flex gap-3">
            <Link
              href="/dashboard/interview"
              className="flex-1 rounded-lg border border-white/15 bg-white/5 py-2.5 text-center text-[13px] font-medium text-slate-100 hover:bg-white/10"
            >
              Back to hub
            </Link>
            <Link
              href={`/dashboard/interview/${sessionId}/debrief`}
              className="flex-1 rounded-lg bg-white py-2.5 text-center text-[13px] font-semibold text-slate-950 hover:bg-slate-200"
            >
              View debrief
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: permission gate ────────────────────────────────────────────────
  if (phase === "permission") {
    return (
      <div className="flex h-full flex-col bg-[#060609] text-white">
        <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.02] px-4 py-2.5 backdrop-blur">
          <Link href="/dashboard/interview" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-white/10">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <p className="text-[13px] font-semibold text-slate-100">
            {PERSONA_LABELS[session?.persona ?? ""] ?? "Live interview"} · Setup
          </p>
        </div>
        {connectError && (
          <div className="border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-center">
            <p className="text-[12px] text-red-200">{connectError}</p>
          </div>
        )}
        <div className="flex-1">
          <PermissionGate
            mode="live"
            onReady={startLive}
            error={connectError}
            fallbackHref={`/dashboard/interview/setup?type=text${session?.jobId ? `&jobId=${session.jobId}` : ""}`}
            fallbackLabel="Switch to text mode"
          />
        </div>
      </div>
    )
  }

  // ── Render: connecting ─────────────────────────────────────────────────────
  if (phase === "connecting") {
    return (
      <div className="flex h-full items-center justify-center bg-[#050507]">
        <div className="text-center">
          <div className="mb-4 flex justify-center gap-2">
            {[0, 160, 320].map((d) => (
              <span key={d} className="h-2 w-2 rounded-full bg-slate-200 animate-bounce" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
          <p className="text-[14px] font-medium text-slate-100">
            {reconnectAttemptUi > 0 ? `Reconnecting (attempt ${reconnectAttemptUi}/${MAX_AUTO_RECONNECTS})…` : "Connecting to interviewer…"}
          </p>
        </div>
      </div>
    )
  }

  // ── Render: live ───────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#040407] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_-6%,rgba(248,250,252,0.12),transparent_38%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_88%_0%,rgba(148,163,184,0.15),transparent_34%)]" />
      {/* Top bar */}
      <div className="relative z-[1] flex items-center gap-3 border-b border-white/10 bg-white/[0.02] px-4 py-2.5 backdrop-blur">
        <Link href="/dashboard/interview" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-white/10">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <p className="text-[13px] font-semibold text-slate-100">
          {PERSONA_LABELS[session?.persona ?? ""] ?? "Interviewer"}
          {jobInfo ? ` · ${jobInfo.title}${jobInfo.company ? ` @ ${jobInfo.company}` : ""}` : ""}
        </p>
        {reconnectCountdownSec !== null && (
          <div className="ml-auto rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-200">
            Reconnecting in {reconnectCountdownSec}s…
          </div>
        )}
      </div>

      {/* Body */}
      <div className="relative z-[1] flex min-h-0 flex-1 overflow-hidden p-4">
        {/* Center: waveform + webcam */}
        <div className="flex flex-1 flex-col gap-4 overflow-hidden xl:pr-3">
          <div className="flex-1">
            <InterviewerWaveform
              agentStream={agentStream}
              isAgentSpeaking={isAgentSpeaking}
              persona={session?.persona ?? ""}
            />
          </div>
          <WebcamPreview stream={localStream} cameraOn={isCameraOn} />
        </div>

        {/* Right: skill rail + captions */}
        <div className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur xl:flex">
          <SkillCoverageRail skillList={skillList} skillsCovered={skillsCovered} tone="dark" />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Live captions</p>
            <LiveCaptions captions={captions} tone="dark" />
          </div>
        </div>
      </div>

      {/* Controls */}
      <LiveControlsBar
        isMuted={isMuted}
        isCameraOn={isCameraOn}
        onToggleMute={handleToggleMute}
        onToggleCamera={handleToggleCamera}
        onEnd={() => setShowEndConfirm(true)}
        remainingSec={remainingSec}
      />

      {/* End confirm */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 w-full max-w-sm rounded-3xl border border-white/15 bg-[#0b0b0f] p-6 shadow-xl">
            <h3 className="text-[15px] font-semibold text-white">End the interview now?</h3>
            <p className="mt-1.5 text-[13px] text-slate-400">
              You&apos;ll get a debrief based on what we covered so far.
            </p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowEndConfirm(false)}
                className="flex-1 rounded-lg border border-white/15 bg-white/5 py-2.5 text-[13px] font-medium text-slate-100 hover:bg-white/10">
                Keep going
              </button>
              <button type="button" onClick={() => void handleEnd()}
                className="flex-1 rounded-lg bg-white py-2.5 text-[13px] font-semibold text-slate-950 hover:bg-slate-200">
                End &amp; get debrief
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

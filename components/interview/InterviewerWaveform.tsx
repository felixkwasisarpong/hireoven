"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

type Props = {
  agentStream: MediaStream | null
  isAgentSpeaking: boolean
  persona: string
}

const PERSONA_LABELS: Record<string, string> = {
  friendly_recruiter: "Recruiter",
  skeptical_hm: "Skeptical HM",
  senior_staff: "Senior Peer",
  founder: "Founder",
  panel: "Panel",
}

const PERSONA_COLORS: Record<string, string> = {
  friendly_recruiter: "#e2e8f0",
  skeptical_hm: "#94a3b8",
  senior_staff: "#cbd5e1",
  founder: "#f8fafc",
  panel: "#d4d4d8",
}

export default function InterviewerWaveform({ agentStream, isAgentSpeaking, persona }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!agentStream) return

    let audioCtx: AudioContext | null = null
    try {
      audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(agentStream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser
      setConnected(true)
    } catch {
      // Web Audio not available — fall back to CSS animation
    }

    return () => {
      cancelAnimationFrame(animRef.current)
      try { audioCtx?.close() } catch { /* ignore */ }
      analyserRef.current = null
      setConnected(false)
    }
  }, [agentStream])

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const color = PERSONA_COLORS[persona] ?? "#FF5C18"

    function draw() {
      animRef.current = requestAnimationFrame(draw)
      if (!canvas || !ctx) return

      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      if (analyserRef.current && isAgentSpeaking) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(data)
        const avg = data.reduce((s, v) => s + v, 0) / data.length
        const scale = 0.5 + (avg / 255) * 1.2

        const bars = 24
        const barW = (w - (bars - 1) * 2) / bars
        for (let i = 0; i < bars; i++) {
          const val = (data[Math.floor(i * data.length / bars)] ?? 0) / 255
          const bh = Math.max(4, val * h * scale)
          const x = i * (barW + 2)
          const y = (h - bh) / 2
          ctx.fillStyle = color
          ctx.globalAlpha = 0.7 + val * 0.3
          ctx.beginPath()
          ctx.roundRect(x, y, barW, bh, 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      } else {
        // Idle pulse: gentle breathing circle
        const t = Date.now() / 1000
        const pulse = 0.85 + Math.sin(t * Math.PI) * 0.1
        const radius = Math.min(w, h) * 0.18 * pulse
        const cx = w / 2, cy = h / 2
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.globalAlpha = 0.15
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.globalAlpha = 0.25
        ctx.fill()
        ctx.globalAlpha = 1
      }
    }

    draw()
    return () => cancelAnimationFrame(animRef.current)
  }, [isAgentSpeaking, persona])

  const label = PERSONA_LABELS[persona] ?? persona
  const color = PERSONA_COLORS[persona] ?? "#FF5C18"

  return (
    <div className="relative flex flex-col items-center gap-4 overflow-hidden rounded-3xl border border-white/10 bg-[#0b0b0f] p-6 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-30%,rgba(248,250,252,0.2),transparent_55%)]" />
      <canvas
        ref={canvasRef}
        width={240}
        height={100}
        className="relative w-full max-w-[240px]"
      />

      <div className="relative flex items-center gap-2">
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            isAgentSpeaking ? "animate-pulse" : "opacity-30"
          )}
          style={{ backgroundColor: color }}
        />
        <span className="text-[13px] font-semibold text-slate-100">{label}</span>
      </div>

      {!connected && (
        <p className="relative text-[11px] text-slate-500">Connecting audio…</p>
      )}
    </div>
  )
}

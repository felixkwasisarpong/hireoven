"use client"

import { Camera, CameraOff, Mic, MicOff, PhoneOff } from "lucide-react"
import { cn } from "@/lib/utils"
import SessionTimer from "@/components/interview/SessionTimer"

type Props = {
  isMuted: boolean
  isCameraOn: boolean
  onToggleMute: () => void
  onToggleCamera: () => void
  onEnd: () => void
  remainingSec: number
}

export default function LiveControlsBar({
  isMuted,
  isCameraOn,
  onToggleMute,
  onToggleCamera,
  onEnd,
  remainingSec,
}: Props) {
  return (
    <div className="relative flex items-center justify-center border-t border-white/[0.08] bg-[#050507]/95 px-4 py-3.5 backdrop-blur">
      {/* Left: live badge + timer */}
      <div className="absolute left-4 flex items-center gap-2 sm:left-6">
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[11px] font-semibold text-emerald-400">Live</span>
        </div>
        <SessionTimer remainingSec={remainingSec} tone="dark" />
      </div>

      {/* Center: controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleMute}
          title={isMuted ? "Unmute" : "Mute"}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full transition-all",
            isMuted
              ? "bg-red-500 text-white shadow-[0_0_14px_rgba(239,68,68,0.45)] hover:bg-red-600"
              : "border border-white/15 bg-white/[0.06] text-slate-200 hover:bg-white/10"
          )}
        >
          {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={onToggleCamera}
          title={isCameraOn ? "Turn camera off" : "Turn camera on"}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full transition-all",
            !isCameraOn
              ? "bg-red-500 text-white shadow-[0_0_14px_rgba(239,68,68,0.45)] hover:bg-red-600"
              : "border border-white/15 bg-white/[0.06] text-slate-200 hover:bg-white/10"
          )}
        >
          {isCameraOn ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
        </button>

        <div className="mx-1 h-6 w-px bg-white/10" />

        <button
          type="button"
          onClick={onEnd}
          title="End interview"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_0_16px_rgba(239,68,68,0.38)] transition-all hover:bg-red-600 hover:shadow-[0_0_22px_rgba(239,68,68,0.55)]"
        >
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>

      {/* Right spacer to keep controls visually centered */}
      <div className="absolute right-4 hidden sm:block sm:right-6">
        <span className="text-[11px] text-slate-600">Interview Room</span>
      </div>
    </div>
  )
}

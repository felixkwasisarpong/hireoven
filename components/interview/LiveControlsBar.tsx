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
    <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-6 py-3">
      <SessionTimer remainingSec={remainingSec} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleMute}
          title={isMuted ? "Unmute" : "Mute"}
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
          onClick={onToggleCamera}
          title={isCameraOn ? "Turn camera off" : "Turn camera on"}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full transition",
            !isCameraOn
              ? "bg-red-500 text-white hover:bg-red-600"
              : "bg-slate-700 text-slate-200 hover:bg-slate-600"
          )}
        >
          {isCameraOn ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={onEnd}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white transition hover:bg-red-600"
          title="End interview"
        >
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>

      <div className="w-16" /> {/* spacer to center controls */}
    </div>
  )
}

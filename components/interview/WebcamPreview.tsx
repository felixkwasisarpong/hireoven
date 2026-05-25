"use client"

import { useEffect, useRef } from "react"
import { VideoOff } from "lucide-react"

type Props = {
  stream: MediaStream | null
  cameraOn: boolean
}

export default function WebcamPreview({ stream, cameraOn }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#050507]" style={{ aspectRatio: "4/3" }}>
      {cameraOn && stream ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
      ) : (
        <div className="flex h-full items-center justify-center">
          <VideoOff className="h-8 w-8 text-slate-500" />
        </div>
      )}
    </div>
  )
}

"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AlertCircle, Camera, Mic, Monitor } from "lucide-react"

type Props = {
  mode: "live" | "coding"
  onReady: (stream: MediaStream) => void
  error?: string | null
  fallbackHref?: string
  fallbackLabel?: string
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

export default function PermissionGate({
  mode,
  onReady,
  error = null,
  fallbackHref = "/dashboard/interview",
  fallbackLabel = "Back to hub",
}: Props) {
  const [unsupported, setUnsupported] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [videoRef, setVideoRef] = useState<HTMLVideoElement | null>(null)
  const [requesting, setRequesting] = useState<"media" | "screen" | null>(null)
  const [screenReady, setScreenReady] = useState(false)
  const [mediaError, setMediaError] = useState("")
  const [screenError, setScreenError] = useState("")
  const handedOffRef = useRef(false)

  const hasMic = Boolean(stream?.getAudioTracks().length)
  const hasCamera = Boolean(stream?.getVideoTracks().length)
  const mediaReady = hasMic && hasCamera
  const allReady = mediaReady && screenReady

  useEffect(() => {
    if (
      typeof RTCPeerConnection === "undefined" ||
      typeof navigator.mediaDevices?.getUserMedia !== "function" ||
      typeof navigator.mediaDevices?.getDisplayMedia !== "function"
    ) {
      setUnsupported(true)
    }
  }, [])

  useEffect(() => {
    if (videoRef && stream) {
      videoRef.srcObject = stream
    }
  }, [videoRef, stream])

  useEffect(() => {
    return () => {
      if (!handedOffRef.current) {
        stopTracks(stream)
      }
    }
  }, [stream])

  async function requestMedia() {
    setRequesting("media")
    setMediaError("")
    try {
      stopTracks(stream)
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: 640, height: 480, facingMode: "user" },
      })
      setStream(ms)
      setScreenReady(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setMediaError(msg)
    } finally {
      setRequesting(null)
    }
  }

  async function requestScreenShare() {
    setRequesting("screen")
    setScreenError("")
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })
      stopTracks(displayStream)
      setScreenReady(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setScreenError(msg)
      setScreenReady(false)
    } finally {
      setRequesting(null)
    }
  }

  function handleContinue() {
    if (!stream || !allReady) return

    if (mode === "coding") {
      const audioTrack = stream.getAudioTracks()[0]
      if (!audioTrack) {
        setMediaError("Mic track missing. Please run checks again.")
        return
      }
      const audioOnlyStream = new MediaStream([audioTrack.clone()])
      stopTracks(stream)
      handedOffRef.current = true
      onReady(audioOnlyStream)
      return
    }

    handedOffRef.current = true
    onReady(stream)
  }

  if (unsupported) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="max-w-sm rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-4 h-10 w-10 text-red-400" />
          <h2 className="text-[15px] font-semibold text-slate-900">Browser not supported</h2>
          <p className="mt-2 text-[13px] text-slate-500">
            This interview needs mic, webcam, and screen-share support. Use latest Chrome, Edge, or Safari on desktop.
          </p>
          <Link
            href={fallbackHref}
            className="mt-4 inline-block text-[13px] font-medium text-orange-500 hover:text-orange-600"
          >
            ← {fallbackLabel}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h2 className="text-[16px] font-bold text-slate-900">
          {mode === "coding" ? "Live coding preflight" : "Live interview preflight"}
        </h2>
        <p className="mt-2 text-[13px] text-slate-500">
          Check mic, webcam, and screen share before joining.
        </p>

        <div className="mt-5 overflow-hidden rounded-xl bg-slate-900" style={{ aspectRatio: "4/3" }}>
          {stream ? (
            <video
              ref={setVideoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-[12px] text-slate-300">
              Webcam preview will appear here
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 text-left">
          <span className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold ${hasMic ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            <Mic className="h-3.5 w-3.5" /> {hasMic ? "Mic ready" : "Mic not ready"}
          </span>
          <span className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold ${hasCamera ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            <Camera className="h-3.5 w-3.5" /> {hasCamera ? "Webcam ready" : "Webcam not ready"}
          </span>
          <span className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold ${screenReady ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            <Monitor className="h-3.5 w-3.5" /> {screenReady ? "Screen share ready" : "Screen share not tested"}
          </span>
        </div>

        {error && <p className="mt-3 text-[12px] text-red-500">{error}</p>}
        {mediaError && <p className="mt-2 text-[12px] text-amber-600">Mic/Webcam: {mediaError}</p>}
        {screenError && <p className="mt-2 text-[12px] text-amber-600">Screen Share: {screenError}</p>}

        <div className="mt-5 flex flex-col gap-2">
          {!mediaReady && (
            <button
              type="button"
              onClick={() => void requestMedia()}
              disabled={requesting !== null}
              className="w-full rounded-lg bg-orange-500 py-3 text-[14px] font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
            >
              {requesting === "media" ? "Requesting mic & webcam…" : "Enable mic & webcam"}
            </button>
          )}

          {mediaReady && !screenReady && (
            <button
              type="button"
              onClick={() => void requestScreenShare()}
              disabled={requesting !== null}
              className="w-full rounded-lg bg-orange-500 py-3 text-[14px] font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
            >
              {requesting === "screen" ? "Testing screen share…" : "Test screen share"}
            </button>
          )}

          {allReady && (
            <button
              type="button"
              onClick={handleContinue}
              className="w-full rounded-lg bg-orange-500 py-3 text-[14px] font-semibold text-white transition hover:bg-orange-600"
            >
              {mode === "coding" ? "Start live coding test" : "Start live interview"}
            </button>
          )}

          <Link
            href={fallbackHref}
            className="text-[13px] font-medium text-slate-500 hover:text-slate-700"
          >
            ← {fallbackLabel}
          </Link>
        </div>

        <p className="mt-2 text-[11px] text-slate-400">
          Nothing is recorded during preflight. Screen-share stream is closed immediately after check.
        </p>
      </div>
    </div>
  )
}

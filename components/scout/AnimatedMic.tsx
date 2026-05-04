"use client"

import { Mic, MicOff } from "lucide-react"
import { cn } from "@/lib/utils"

type MicState = "idle" | "listening" | "processing" | "unsupported" | "error"

type Props = {
  state: MicState
  className?: string
  /** Icon size in px — defaults to 18. */
  iconSize?: number
}

/**
 * Premium animated microphone glyph.
 *
 *   idle        — gentle breathing ring, mic stem static
 *   listening   — 5 sound-wave bars next to the mic, slow tilt + ping
 *   processing  — small dot orbit (caller usually swaps for a spinner)
 *   unsupported — muted mic icon, no animation
 *   error       — muted mic icon with subtle nudge
 */
export function AnimatedMic({ state, className, iconSize = 18 }: Props) {
  const isMuted = state === "unsupported" || state === "error"
  const isListening = state === "listening"

  if (isMuted) {
    return (
      <MicOff
        className={cn("text-current", className)}
        style={{ width: iconSize, height: iconSize }}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: iconSize + 4, height: iconSize + 4 }}
    >
      {/* Idle breathing ring — only when not listening */}
      {!isListening && state !== "processing" && (
        <span
          className="pointer-events-none absolute inset-0 rounded-full bg-current opacity-30 motion-safe:animate-[scoutMicBreath_2.6s_ease-out_infinite]"
        />
      )}

      {/* Idle — tiny smile arc that draws under the mic every few seconds */}
      {!isListening && state !== "processing" && (
        <svg
          aria-hidden
          viewBox="0 0 12 6"
          className="pointer-events-none absolute -bottom-[3px] left-1/2 -translate-x-1/2 motion-safe:animate-[scoutMicArc_5s_ease-in-out_infinite]"
          style={{ width: iconSize * 0.6, height: iconSize * 0.3 }}
        >
          <path
            d="M1 1 Q 6 6 11 1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.7"
          />
        </svg>
      )}

      {/* Listening — sound bars on the right edge */}
      {isListening && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-2 top-1/2 flex -translate-y-1/2 items-end gap-[2px]"
          style={{ height: iconSize }}
        >
          {[0, 90, 180, 270, 120].map((delay, i) => (
            <span
              key={i}
              className="block w-[2px] origin-bottom rounded-full bg-current motion-safe:animate-[scoutMicBar_0.9s_ease-in-out_infinite]"
              style={{
                height: `${iconSize * 0.85}px`,
                animationDelay: `${delay}ms`,
                opacity: 0.85,
              }}
            />
          ))}
        </span>
      )}

      <Mic
        className={cn(
          "relative",
          isListening
            ? "motion-safe:animate-pulse"
            // Friendly nod every 5s while idle
            : state !== "processing" && "motion-safe:animate-[scoutMicSmile_5s_ease-in-out_infinite] origin-bottom"
        )}
        style={{ width: iconSize, height: iconSize }}
        strokeWidth={2}
      />
    </span>
  )
}

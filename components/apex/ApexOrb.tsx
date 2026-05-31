"use client"

import Image from "next/image"
import { cn } from "@/lib/utils"

type Props = {
  state?: "idle" | "thinking" | "done" | "speaking"
  size?: "sm" | "md" | "lg"
  className?: string
  useGif?: boolean
}

const SIZES = {
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-16 w-16",
} as const

// Ring delays staggered so heat waves feel continuous, not simultaneous
const RING_DELAYS = ["0s", "1s", "2s"]
const ORB_GIF_SRC = "/hireoven_loader_white_144.gif"

/**
 * Hireoven orb — soft cool-glow palette.
 * idle: slow warm breath · thinking: faster + heat rings pulse · done: pop
 */
export function ScoutOrb({ state = "idle", size = "md", className, useGif = false }: Props) {
  const isActive  = state === "thinking" || state === "speaking"
  const isDone    = state === "done"

  const ringDuration = isActive ? "1.6s" : "3s"

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full",
        SIZES[size],
        className
      )}
    >
      {/* Heat shimmer rings — three expanding waves, staggered */}
      {RING_DELAYS.map((delay, i) => (
        <span
          key={i}
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            border: `${i === 0 ? 1.5 : 1}px solid rgba(37,99,235,${isActive ? 0.42 - i * 0.1 : 0.24 - i * 0.07})`,
            animation: `ovenHeatRing ${ringDuration} ease-out ${delay} infinite`,
          }}
        />
      ))}

      {/* Core sphere */}
      {useGif ? (
        <span
          className={cn(
            "relative inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full",
            isDone
              ? "motion-safe:animate-[scoutOrbDone_0.4s_ease-out_both]"
              : isActive
                ? "motion-safe:animate-[ovenGlow_1.2s_ease-in-out_infinite]"
                : "motion-safe:animate-[ovenGlow_3.5s_ease-in-out_infinite]"
          )}
          style={{
            background: "radial-gradient(circle at 45% 35%, rgba(255,255,255,0.96) 0%, rgba(219,234,254,0.92) 50%, rgba(147,197,253,0.72) 100%)",
            boxShadow: isActive
              ? "0 0 0 1.5px rgba(37,99,235,0.22), 0 0 24px rgba(59,130,246,0.42), 0 0 42px rgba(96,165,250,0.25), inset 0 1px 0 rgba(255,255,255,0.22)"
              : "0 0 0 1px rgba(37,99,235,0.14), 0 0 14px rgba(59,130,246,0.25), 0 2px 8px rgba(15,23,42,0.14), inset 0 1px 0 rgba(255,255,255,0.18)",
          }}
        >
          <Image
            src={ORB_GIF_SRC}
            alt=""
            aria-hidden
            width={144}
            height={144}
            unoptimized
            className="h-full w-full scale-110 rounded-full object-contain"
          />
        </span>
      ) : (
        <span
          className={cn(
            "relative inline-flex h-full w-full items-center justify-center rounded-full",
            isDone
              ? "motion-safe:animate-[scoutOrbDone_0.4s_ease-out_both]"
              : isActive
                ? "motion-safe:animate-[ovenGlow_1.2s_ease-in-out_infinite]"
                : "motion-safe:animate-[ovenGlow_3.5s_ease-in-out_infinite]"
          )}
          style={{
            background: "radial-gradient(circle at 38% 32%, #DBEAFE 0%, #93C5FD 38%, #3B82F6 62%, #1D4ED8 100%)",
            boxShadow: isActive
              ? "0 0 0 1.5px rgba(37,99,235,0.24), 0 0 24px rgba(59,130,246,0.58), 0 0 48px rgba(96,165,250,0.28), inset 0 1px 0 rgba(191,219,254,0.42)"
              : "0 0 16px rgba(59,130,246,0.38), 0 2px 8px rgba(15,23,42,0.13), inset 0 1px 0 rgba(191,219,254,0.35)",
          }}
        >
          {/* Hot-centre highlight — fixed, simulates glowing coil centre */}
          <span
            className="pointer-events-none absolute rounded-full"
            style={{
              width: "38%",
              height: "32%",
              top: "14%",
              left: "18%",
              background: "radial-gradient(circle, rgba(219,234,254,0.90) 0%, rgba(147,197,253,0.42) 55%, transparent 100%)",
              filter: "blur(1.5px)",
            }}
          />

          {/* Ember flicker layer — visible only when active */}
          {isActive && (
            <span
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{
                background: "radial-gradient(circle at 52% 58%, rgba(96,165,250,0.30) 0%, transparent 60%)",
                animation: "ovenFlicker 0.9s ease-in-out infinite",
              }}
            />
          )}
        </span>
      )}
    </span>
  )
}

"use client"

import { cn } from "@/lib/utils"

type Props = {
  state?: "idle" | "thinking" | "done" | "speaking"
  size?: "sm" | "md" | "lg"
  className?: string
}

const SIZES = {
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-14 w-14",
} as const

// Ring delays staggered so heat waves feel continuous, not simultaneous
const RING_DELAYS = ["0s", "1s", "2s"]

/**
 * Hireoven orb — glowing oven heat, brand orange palette.
 * idle: slow warm breath · thinking: faster + heat rings pulse · done: pop
 */
export function ScoutOrb({ state = "idle", size = "md", className }: Props) {
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
            border: `${i === 0 ? 1.5 : 1}px solid rgba(255,92,24,${isActive ? 0.45 - i * 0.1 : 0.28 - i * 0.07})`,
            animation: `ovenHeatRing ${ringDuration} ease-out ${delay} infinite`,
          }}
        />
      ))}

      {/* Core sphere */}
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
          background: "radial-gradient(circle at 38% 32%, #FFCC70 0%, #FF7A20 38%, #FF5C18 62%, #D93800 100%)",
          boxShadow: isActive
            ? "0 0 0 1.5px rgba(255,92,24,0.25), 0 0 28px rgba(255,92,24,0.65), 0 0 56px rgba(255,140,0,0.35), inset 0 1px 0 rgba(255,220,120,0.4)"
            : "0 0 18px rgba(255,92,24,0.45), 0 2px 8px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,220,120,0.35)",
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
            background: "radial-gradient(circle, rgba(255,240,160,0.85) 0%, rgba(255,200,80,0.4) 55%, transparent 100%)",
            filter: "blur(1.5px)",
          }}
        />

        {/* Ember flicker layer — visible only when active */}
        {isActive && (
          <span
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background: "radial-gradient(circle at 52% 58%, rgba(255,180,50,0.35) 0%, transparent 60%)",
              animation: "ovenFlicker 0.9s ease-in-out infinite",
            }}
          />
        )}
      </span>
    </span>
  )
}

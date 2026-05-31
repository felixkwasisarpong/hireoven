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
export function ApexOrb({ state = "idle", size = "md", className, useGif = false }: Props) {
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
            border: `${i === 0 ? 1.5 : 1}px solid rgba(99,102,241,${isActive ? 0.48 - i * 0.12 : 0.28 - i * 0.08})`,
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
              ? "motion-safe:animate-[apexOrbDone_0.4s_ease-out_both]"
              : isActive
                ? "motion-safe:animate-[ovenGlow_1.2s_ease-in-out_infinite]"
                : "motion-safe:animate-[ovenGlow_3.5s_ease-in-out_infinite]"
          )}
          style={{
            background: "radial-gradient(circle at 45% 35%, rgba(255,255,255,0.96) 0%, rgba(237,233,254,0.92) 50%, rgba(165,180,252,0.72) 100%)",
            boxShadow: isActive
              ? "0 0 0 1.5px rgba(99,102,241,0.22), 0 0 24px rgba(99,102,241,0.42), 0 0 42px rgba(234,179,8,0.18), inset 0 1px 0 rgba(255,255,255,0.22)"
              : "0 0 0 1px rgba(99,102,241,0.14), 0 0 14px rgba(99,102,241,0.25), 0 2px 8px rgba(15,23,42,0.14), inset 0 1px 0 rgba(255,255,255,0.18)",
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
              ? "motion-safe:animate-[apexOrbDone_0.4s_ease-out_both]"
              : isActive
                ? "motion-safe:animate-[ovenGlow_1.2s_ease-in-out_infinite]"
                : "motion-safe:animate-[ovenGlow_3.5s_ease-in-out_infinite]"
          )}
          style={{
            background: "radial-gradient(circle at 38% 32%, #EDE9FE 0%, #A5B4FC 34%, #6366F1 60%, #3730A3 100%)",
            boxShadow: isActive
              ? "0 0 0 1.5px rgba(99,102,241,0.28), 0 0 28px rgba(99,102,241,0.65), 0 0 52px rgba(234,179,8,0.22), inset 0 1px 0 rgba(237,233,254,0.45)"
              : "0 0 18px rgba(99,102,241,0.42), 0 2px 8px rgba(15,23,42,0.14), inset 0 1px 0 rgba(237,233,254,0.38)",
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
              background: "radial-gradient(circle, rgba(253,230,138,0.92) 0%, rgba(237,233,254,0.50) 55%, transparent 100%)",
              filter: "blur(1.5px)",
            }}
          />

          {/* Ember flicker layer — visible only when active */}
          {isActive && (
            <span
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{
                background: "radial-gradient(circle at 52% 58%, rgba(234,179,8,0.28) 0%, rgba(99,102,241,0.14) 50%, transparent 70%)",
                animation: "ovenFlicker 0.9s ease-in-out infinite",
              }}
            />
          )}
        </span>
      )}
    </span>
  )
}

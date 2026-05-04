"use client"

import { cn } from "@/lib/utils"

type Props = {
  /** "idle" — gentle breath. "thinking" — extra aura ring. "speaking" — faster pulse. */
  state?: "idle" | "thinking" | "speaking"
  size?: "sm" | "md" | "lg"
  className?: string
}

const SIZES = {
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-14 w-14",
} as const

/**
 * Premium Scout brand orb — animated, dimensional, alive.
 *
 * Composition:
 *   - Outer aura ring (scales out, fades) — only visible when active
 *   - Slow conic-gradient sweep ring underneath
 *   - Core sphere with breathing scale + radial gradient
 *   - Inner specular highlight (top-left)
 *   - Pupil dot that contracts subtly while thinking
 */
export function ScoutOrb({ state = "idle", size = "md", className }: Props) {
  const isActive = state !== "idle"

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full",
        SIZES[size],
        className
      )}
    >
      {/* Outer aura — staggered ping rings (active states only) */}
      {isActive && (
        <>
          <span
            className="pointer-events-none absolute inset-0 rounded-full bg-[#FF5C18]/35 motion-safe:animate-[scoutOrbAura_1.8s_ease-out_infinite]"
          />
          <span
            className="pointer-events-none absolute inset-0 rounded-full bg-[#FF5C18]/25 motion-safe:animate-[scoutOrbAura_1.8s_ease-out_infinite]"
            style={{ animationDelay: "0.6s" }}
          />
        </>
      )}

      {/* Conic sweep ring — slow rotation, premium texture */}
      <span
        className={cn(
          "pointer-events-none absolute inset-0 rounded-full motion-safe:animate-[scoutOrbSweep_linear_infinite]",
          state === "speaking" ? "[animation-duration:3.5s]" : "[animation-duration:9s]"
        )}
        style={{
          background:
            "conic-gradient(from 90deg, rgba(255,92,24,0.0) 0%, rgba(255,92,24,0.55) 35%, rgba(255,179,138,0.95) 50%, rgba(255,92,24,0.55) 65%, rgba(255,92,24,0.0) 100%)",
          mask: "radial-gradient(circle, transparent 58%, black 60%)",
          WebkitMask: "radial-gradient(circle, transparent 58%, black 60%)",
        }}
      />

      {/* Core sphere — radial gradient + breathing */}
      <span
        className={cn(
          "relative inline-block rounded-full shadow-[0_4px_18px_-2px_rgba(255,92,24,0.55)] motion-safe:animate-[scoutOrbBreath_3.2s_ease-in-out_infinite]",
          size === "sm" ? "h-[68%] w-[68%]" : size === "md" ? "h-[72%] w-[72%]" : "h-[74%] w-[74%]",
          state === "speaking" && "[animation-duration:1.4s]"
        )}
        style={{
          background:
            "radial-gradient(circle at 32% 28%, #FFB48A 0%, #FF7A3D 38%, #E8480A 78%, #B83706 100%)",
        }}
      >
        {/* Specular highlight */}
        <span
          className="absolute left-[18%] top-[14%] h-[28%] w-[28%] rounded-full bg-white/55 blur-[1px]"
        />
        {/* Soft inner glow */}
        <span
          className="absolute inset-[16%] rounded-full"
          style={{
            background:
              "radial-gradient(circle at 50% 60%, rgba(255,255,255,0.18) 0%, transparent 65%)",
          }}
        />
        {/* Pupil dot — gives it presence, not literal eyes */}
        <span
          className={cn(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]",
            size === "sm" ? "h-[10%] w-[10%]" : "h-[8%] w-[8%]"
          )}
        />
      </span>
    </span>
  )
}

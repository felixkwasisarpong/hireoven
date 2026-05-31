"use client"

import { cn } from "@/lib/utils"

type Props = {
  size?: number
  className?: string
  /** Show the gold apex-point glow. Default true. */
  glow?: boolean
}

/**
 * Apex mark — geometric upward triangle (indigo) with electric-gold apex point.
 * Used in nav, workspace header, and the welcome scene.
 */
export function ApexIcon({ size = 32, className, glow = true }: Props) {
  const id = `apex-grad-${size}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="16" y1="2" x2="16" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="55%" stopColor="#4F46E5" />
          <stop offset="100%" stopColor="#3730A3" />
        </linearGradient>
        {glow && (
          <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>

      {/* Main triangle body */}
      <polygon
        points="16,3 29,27 3,27"
        fill={`url(#${id})`}
        stroke="rgba(99,102,241,0.35)"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />

      {/* Inner highlight — subtle bevel on left face */}
      <polygon
        points="16,5 27,26 16,26"
        fill="rgba(255,255,255,0.06)"
      />

      {/* Horizontal bar — Apex wordmark crossbar feel */}
      <line
        x1="9"
        y1="21"
        x2="23"
        y2="21"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1"
        strokeLinecap="round"
      />

      {/* Electric gold apex point */}
      <circle
        cx="16"
        cy="3"
        r={glow ? 2.4 : 2}
        fill="#EAB308"
        filter={glow ? `url(#${id}-glow)` : undefined}
      />
      <circle cx="16" cy="3" r="1" fill="#FEF08A" />
    </svg>
  )
}

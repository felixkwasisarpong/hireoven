import type { ScoreHue } from "@/types/h1b-scorecard"

// Shared color system for the personal scorecard surfaces so the hero, the score
// dial, and the component bars all coordinate to the grade's hue.
export interface HuePalette {
  ring: string // strong stroke / accent
  soft: string // tinted panel background
  softer: string // very light wash for gradients
  text: string // accessible text-on-white tailwind class
  bar: string // tailwind bg-* for progress fills
  // Dark-terminal surfaces — the personal-scorecard pages render on the near-black
  // data-desk canvas. `ring` and `bar` stay the same saturated hue (they read on
  // dark); only the tinted panel bg and text class are swapped so each grade hue
  // stays visually distinct while remaining legible on #0e1411.
  softDark: string // tinted panel background on dark bg (rgba of the hue)
  textDark: string // legible text-on-dark tailwind class
}

export const HUE_PALETTE: Record<ScoreHue, HuePalette> = {
  emerald: { ring: "#10b981", soft: "#ecfdf5", softer: "#f0fdfa", text: "text-emerald-700", bar: "bg-emerald-500", softDark: "rgba(16,185,129,0.14)", textDark: "text-emerald-300" },
  green: { ring: "#22c55e", soft: "#f0fdf4", softer: "#f7fee7", text: "text-green-700", bar: "bg-green-500", softDark: "rgba(34,197,94,0.14)", textDark: "text-green-300" },
  blue: { ring: "#3b82f6", soft: "#eff6ff", softer: "#f0f9ff", text: "text-blue-700", bar: "bg-blue-500", softDark: "rgba(59,130,246,0.14)", textDark: "text-blue-300" },
  amber: { ring: "#f59e0b", soft: "#fffbeb", softer: "#fefce8", text: "text-amber-700", bar: "bg-amber-500", softDark: "rgba(245,158,11,0.14)", textDark: "text-amber-300" },
  orange: { ring: "#f97316", soft: "#fff7ed", softer: "#fff7ed", text: "text-orange-700", bar: "bg-orange-500", softDark: "rgba(249,115,22,0.14)", textDark: "text-orange-300" },
  red: { ring: "#ef4444", soft: "#fef2f2", softer: "#fef2f2", text: "text-red-600", bar: "bg-red-500", softDark: "rgba(239,68,68,0.16)", textDark: "text-red-300" },
}

export function paletteFor(hue: ScoreHue): HuePalette {
  return HUE_PALETTE[hue] ?? HUE_PALETTE.blue
}

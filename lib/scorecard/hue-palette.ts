import type { ScoreHue } from "@/types/h1b-scorecard"

// Shared color system for the personal scorecard surfaces so the hero, the score
// dial, and the component bars all coordinate to the grade's hue.
export interface HuePalette {
  ring: string // strong stroke / accent
  soft: string // tinted panel background
  softer: string // very light wash for gradients
  text: string // accessible text-on-white tailwind class
  bar: string // tailwind bg-* for progress fills
}

export const HUE_PALETTE: Record<ScoreHue, HuePalette> = {
  emerald: { ring: "#10b981", soft: "#ecfdf5", softer: "#f0fdfa", text: "text-emerald-700", bar: "bg-emerald-500" },
  green: { ring: "#22c55e", soft: "#f0fdf4", softer: "#f7fee7", text: "text-green-700", bar: "bg-green-500" },
  blue: { ring: "#3b82f6", soft: "#eff6ff", softer: "#f0f9ff", text: "text-blue-700", bar: "bg-blue-500" },
  amber: { ring: "#f59e0b", soft: "#fffbeb", softer: "#fefce8", text: "text-amber-700", bar: "bg-amber-500" },
  orange: { ring: "#f97316", soft: "#fff7ed", softer: "#fff7ed", text: "text-orange-700", bar: "bg-orange-500" },
  red: { ring: "#ef4444", soft: "#fef2f2", softer: "#fef2f2", text: "text-red-600", bar: "bg-red-500" },
}

export function paletteFor(hue: ScoreHue): HuePalette {
  return HUE_PALETTE[hue] ?? HUE_PALETTE.blue
}

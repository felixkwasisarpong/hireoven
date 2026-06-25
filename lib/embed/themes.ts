// Theme tokens for embeddable widgets (Spec 07). Widgets are standalone iframes,
// so unlike in-app public pages they own their full color surface and support a
// caller-chosen light/dark theme. Server-rendered only — no client JS, no CSS vars
// that depend on a parent stylesheet.

export type EmbedTheme = "light" | "dark" | "auto"

export interface ThemeTokens {
  bg: string
  panel: string
  border: string
  text: string
  muted: string
  faint: string
  accent: string
  accentText: string
  link: string
}

const LIGHT: ThemeTokens = {
  bg: "#ffffff",
  panel: "#f8fafc",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#475569",
  faint: "#94a3b8",
  accent: "#059669",
  accentText: "#ffffff",
  link: "#0f766e",
}

const DARK: ThemeTokens = {
  bg: "#0b1220",
  panel: "#111c30",
  border: "rgba(148,163,184,0.18)",
  text: "#e6edf6",
  muted: "#9fb0c4",
  faint: "#64748b",
  accent: "#34d399",
  accentText: "#04121f",
  link: "#5eead4",
}

export function resolveTheme(raw: string | null | undefined): EmbedTheme {
  if (raw === "dark" || raw === "light" || raw === "auto") return raw
  return "light"
}

// For "auto" we render light tokens but emit a <style> media query that swaps the
// CSS custom properties — see widgetCssVars(). Components read var(--ho-*) so a
// single render covers both system schemes without client JS.
export function tokensFor(theme: EmbedTheme): ThemeTokens {
  return theme === "dark" ? DARK : LIGHT
}

// Grade hue → solid color (shared by personal + company score badges).
export const GRADE_HEX: Record<string, string> = {
  emerald: "#10b981",
  green: "#22c55e",
  blue: "#3b82f6",
  amber: "#f59e0b",
  orange: "#f97316",
  red: "#ef4444",
}

export function gradeColor(hue: string | null | undefined): string {
  return (hue && GRADE_HEX[hue]) || GRADE_HEX.blue
}

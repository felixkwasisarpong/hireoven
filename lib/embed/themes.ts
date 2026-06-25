// Theme tokens for embeddable widgets (Spec 07). Widgets are standalone iframes,
// so they own their full color surface and support a caller-chosen light/dark/auto
// theme. Server-rendered only — no client JS. `auto` works via a pure CSS
// prefers-color-scheme media query (no script), so colors track the visitor's
// system setting without a re-render.

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

// All tokens resolve to CSS custom properties scoped to `.ho-embed`; the values are
// injected per-theme by themeStyle() below. Components keep using inline styles
// (e.g. background: t.bg) — they just point at vars now, which is what lets `auto`
// switch with no JS.
const VAR_TOKENS: ThemeTokens = {
  bg: "var(--w-bg)",
  panel: "var(--w-panel)",
  border: "var(--w-border)",
  text: "var(--w-text)",
  muted: "var(--w-muted)",
  faint: "var(--w-faint)",
  accent: "var(--w-accent)",
  accentText: "var(--w-accent-text)",
  link: "var(--w-link)",
}

export function tokensFor(_theme?: EmbedTheme): ThemeTokens {
  return VAR_TOKENS
}

const LIGHT_VALS: Record<string, string> = {
  "--w-bg": "#ffffff",
  "--w-panel": "#f8fafc",
  "--w-border": "#e2e8f0",
  "--w-text": "#0f172a",
  "--w-muted": "#475569",
  "--w-faint": "#94a3b8",
  "--w-accent": "#059669",
  "--w-accent-text": "#ffffff",
  "--w-link": "#0f766e",
}

const DARK_VALS: Record<string, string> = {
  "--w-bg": "#0b1220",
  "--w-panel": "#111c30",
  "--w-border": "rgba(148,163,184,0.18)",
  "--w-text": "#e6edf6",
  "--w-muted": "#9fb0c4",
  "--w-faint": "#64748b",
  "--w-accent": "#34d399",
  "--w-accent-text": "#04121f",
  "--w-link": "#5eead4",
}

function block(vals: Record<string, string>, accent?: string | null): string {
  const entries = Object.entries(vals).map(([k, v]) => `${k}:${v}`)
  // A valid paid-tier accent overrides the default accent in every scheme.
  if (accent) entries.push(`--w-accent:${accent}`)
  return entries.join(";")
}

// CSS for a <style> tag scoped to `.ho-embed`. For `auto` we emit light values plus
// a dark override behind @media (prefers-color-scheme: dark) — no JS.
export function themeStyle(theme: EmbedTheme, accent?: string | null): string {
  if (theme === "dark") return `.ho-embed{${block(DARK_VALS, accent)}}`
  if (theme === "auto") {
    return `.ho-embed{${block(LIGHT_VALS, accent)}}@media (prefers-color-scheme:dark){.ho-embed{${block(DARK_VALS, accent)}}}`
  }
  return `.ho-embed{${block(LIGHT_VALS, accent)}}`
}

export function resolveTheme(raw: string | null | undefined): EmbedTheme {
  if (raw === "dark" || raw === "light" || raw === "auto") return raw
  return "auto"
}

// Validate a caller-supplied accent (#rrggbb or #rgb). Returns null if malformed —
// callers only apply it for paid-tier tokens (see resolveAccent in tokens.ts).
export function sanitizeAccent(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim()
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : null
}

// Grade hue → solid color (semantic; identical in light & dark). Used by score
// dials and component bars, independent of the chrome accent.
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

import * as React from "react"
import { tokensFor, themeStyle, type EmbedTheme } from "@/lib/embed/themes"

// Shared chrome for every embeddable widget. Server-rendered, inline styles only —
// the iframe document does NOT load the app stylesheet, so widgets must be fully
// self-contained. A scoped <style> injects the theme's CSS variables (which is what
// makes `auto` track prefers-color-scheme with no JS). The attribution footer is
// mandatory on the free tier and is rendered server-side here.

export function WidgetShell({
  theme,
  accent,
  href,
  showAttribution,
  baseUrl,
  widgetType,
  attributionKey,
  children,
}: {
  theme: EmbedTheme
  accent?: string | null
  href: string
  showAttribution: boolean
  baseUrl: string
  widgetType: string
  attributionKey?: string | null
  children: React.ReactNode
}) {
  const t = tokensFor(theme)
  const utm = `utm_source=embed&utm_medium=${widgetType}&utm_campaign=${attributionKey || "organic"}`
  const sep = href.includes("?") ? "&" : "?"
  const fullHref = `${baseUrl}${href}${sep}${utm}`
  return (
    <div
      className="ho-embed"
      style={{
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        background: t.bg,
        color: t.text,
        border: `1px solid ${t.border}`,
        borderRadius: 14,
        padding: 16,
        boxSizing: "border-box",
        width: "100%",
        maxWidth: 460,
        margin: "0 auto",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: themeStyle(theme, accent) }} />
      {children}
      {showAttribution ? (
        <a
          href={fullHref}
          target="_top"
          rel="noopener"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            marginTop: 14,
            paddingTop: 11,
            borderTop: `1px solid ${t.border}`,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.2,
            color: t.faint,
            textDecoration: "none",
          }}
        >
          <span style={{ display: "inline-flex", width: 8, height: 8, borderRadius: 8, background: t.accent }} />
          Powered by Hireoven
        </a>
      ) : null}
    </div>
  )
}

export function ScoreRing({ grade, hex, sub }: { grade: string; hex: string; sub?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 62,
          height: 62,
          borderRadius: 62,
          border: `3px solid ${hex}`,
          color: hex,
          fontSize: 24,
          fontWeight: 800,
        }}
      >
        {grade}
      </div>
      {sub ? <div style={{ marginTop: 5, fontSize: 11, fontWeight: 600, color: hex }}>{sub}</div> : null}
    </div>
  )
}

export function Bar({ value, max, color, track }: { value: number; max: number; color: string; track: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div style={{ display: "flex", width: "100%", height: 6, borderRadius: 6, background: track, overflow: "hidden" }}>
      <div style={{ display: "flex", width: `${pct}%`, background: color }} />
    </div>
  )
}

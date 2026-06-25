import * as React from "react"
import { tokensFor, type EmbedTheme } from "@/lib/embed/themes"

// Shared chrome for every embeddable widget. Server-rendered, inline styles only —
// the iframe document does NOT load the app stylesheet, so widgets must be fully
// self-contained. The attribution footer is mandatory on the free tier and is
// rendered server-side here (never toggled by client/query input).

export function WidgetShell({
  theme,
  href,
  showAttribution,
  baseUrl,
  children,
}: {
  theme: EmbedTheme
  href: string
  showAttribution: boolean
  baseUrl: string
  children: React.ReactNode
}) {
  const t = tokensFor(theme)
  return (
    <div
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
      {children}
      {showAttribution ? (
        <a
          href={`${baseUrl}${href}`}
          target="_blank"
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

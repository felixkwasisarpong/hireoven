import { ImageResponse } from "next/og"
import { getPublicPersonalScorecard } from "@/lib/scorecard/personal-scorecard"
import type { ScoreHue } from "@/types/h1b-scorecard"

export const runtime = "nodejs"

// Same palette + shell as the company scorecard OG (Spec 02) — the "franchise" look.
const HUE_TO_HEX: Record<ScoreHue, { bg: string; fg: string; accent: string }> = {
  emerald: { bg: "#022c22", fg: "#d1fae5", accent: "#34d399" },
  green: { bg: "#052e16", fg: "#dcfce7", accent: "#4ade80" },
  lime: { bg: "#1a2e05", fg: "#ecfccb", accent: "#a3e635" },
  amber: { bg: "#3a2208", fg: "#fef3c7", accent: "#fbbf24" },
  orange: { bg: "#3a1808", fg: "#ffedd5", accent: "#fb923c" },
  red: { bg: "#3a0808", fg: "#fee2e2", accent: "#f87171" },
}

function StatBlock({ label, value, colors }: { label: string; value: string; colors: { fg: string } }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 18, opacity: 0.6, textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 34, fontWeight: 700, color: colors.fg }}>{value}</div>
    </div>
  )
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  let card
  try {
    card = await getPublicPersonalScorecard(params.token)
  } catch {
    card = null
  }
  if (!card) return new Response("Not found", { status: 404 })

  const colors = HUE_TO_HEX[card.bucket.hue] ?? HUE_TO_HEX.amber
  const initials =
    (card.display_name || "C")
      .split(/\s+/)
      .map((s) => s[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "C"
  const name = card.display_name.length > 26 ? `${card.display_name.slice(0, 25)}…` : card.display_name

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(135deg, ${colors.bg} 0%, #000 100%)`,
          color: colors.fg,
          padding: "56px 72px",
          border: "1px solid rgba(52, 211, 153, 0.15)",
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 44 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: colors.accent,
                color: colors.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 32,
                fontWeight: 700,
              }}
            >
              {initials}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>{name}</div>
              <div style={{ fontSize: 22, opacity: 0.7 }}>H-1B Sponsorability Scorecard</div>
            </div>
          </div>
          <div style={{ fontSize: 24, opacity: 0.6 }}>hireoven.com</div>
        </div>

        {/* Grade block */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 32, marginBottom: 40 }}>
          <div style={{ fontSize: 200, fontWeight: 800, lineHeight: 1, color: colors.accent, letterSpacing: -8 }}>
            {card.bucket.grade}
          </div>
          <div style={{ display: "flex", flexDirection: "column", paddingBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "baseline", fontSize: 56, fontWeight: 700, color: colors.accent }}>
              {card.total_score}
              <span style={{ fontSize: 32, opacity: 0.6 }}>/100</span>
            </div>
            <div style={{ fontSize: 32, fontWeight: 600 }}>{card.bucket.label}</div>
          </div>
        </div>

        {/* 4-component stats row */}
        <div style={{ display: "flex", gap: 44, marginTop: "auto" }}>
          <StatBlock label="Skills Demand" value={`${card.components.demand}/25`} colors={colors} />
          <StatBlock label="Skills Rarity" value={`${card.components.rarity}/25`} colors={colors} />
          <StatBlock label="Experience Fit" value={`${card.components.experience}/25`} colors={colors} />
          <StatBlock label="Education" value={`${card.components.education}/25`} colors={colors} />
        </div>

        {/* Footer */}
        <div style={{ marginTop: 32, fontSize: 18, opacity: 0.5 }}>
          Get yours at hireoven.com · Sourced from DOL LCA + USCIS public data
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    }
  )
}

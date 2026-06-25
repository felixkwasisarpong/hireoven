import { WidgetShell, ScoreRing, Bar } from "./WidgetShell"
import { tokensFor, gradeColor, type EmbedTheme } from "@/lib/embed/themes"
import type { PublicPersonalScorecard } from "@/lib/scorecard/personal-scorecard"

// Consumer personal-scorecard widget. Reuses the public share payload (Spec 04) —
// reachable only via the user's own share_token, and only while still public
// (revocation is handled upstream by rendering the "unavailable" card instead).

const COMPONENTS: Array<{ key: keyof PublicPersonalScorecard["components"]; label: string }> = [
  { key: "demand", label: "Skills demand" },
  { key: "rarity", label: "Skills rarity" },
  { key: "experience", label: "Experience fit" },
  { key: "education", label: "Education" },
]

export function PersonalScorecardWidget({
  data,
  theme,
  accent,
  showAttribution,
  baseUrl,
  shareToken,
  attributionKey,
}: {
  data: PublicPersonalScorecard
  theme: EmbedTheme
  accent?: string | null
  showAttribution: boolean
  baseUrl: string
  shareToken: string
  attributionKey?: string | null
}) {
  const t = tokensFor(theme)
  const hex = gradeColor(data.bucket.hue)
  return (
    <WidgetShell
      theme={theme}
      accent={accent}
      href={`/scorecard/${shareToken}`}
      showAttribution={showAttribution}
      baseUrl={baseUrl}
      widgetType="personal-scorecard"
      attributionKey={attributionKey}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <ScoreRing grade={data.bucket.grade} hex={hex} sub={`${data.total_score}/100`} />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>{data.display_name}</div>
          <div style={{ marginTop: 2, fontSize: 12.5, color: t.muted }}>{data.bucket.label}</div>
          <div style={{ marginTop: 1, fontSize: 11.5, color: t.faint }}>H-1B sponsorability</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 14 }}>
        {COMPONENTS.map((c) => (
          <div key={c.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: t.muted }}>
              <span>{c.label}</span>
              <span style={{ color: t.text, fontWeight: 600 }}>{data.components[c.key]}/25</span>
            </div>
            <Bar value={data.components[c.key]} max={25} color={hex} track={t.panel} />
          </div>
        ))}
      </div>
    </WidgetShell>
  )
}

export function UnavailableWidget({ theme, baseUrl }: { theme: EmbedTheme; baseUrl: string }) {
  const t = tokensFor(theme)
  return (
    <WidgetShell theme={theme} href="/dashboard/scorecard" showAttribution baseUrl={baseUrl} widgetType="personal-scorecard">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 8px", textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Scorecard unavailable</div>
        <div style={{ fontSize: 12.5, color: t.muted, maxWidth: 280 }}>
          This personal scorecard is no longer shared publicly.
        </div>
      </div>
    </WidgetShell>
  )
}

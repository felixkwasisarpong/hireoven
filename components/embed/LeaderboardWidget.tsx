import { WidgetShell } from "./WidgetShell"
import { tokensFor, type EmbedTheme } from "@/lib/embed/themes"
import type { LeaderboardRow } from "@/lib/h1b/leaderboard"

// Public "Top H-1B sponsors" leaderboard widget. Compact ranked list built from the
// same MV-backed query (Spec 01) as the public leaderboard page.

export function LeaderboardWidget({
  rows,
  theme,
  showAttribution,
  baseUrl,
  title,
  href,
}: {
  rows: LeaderboardRow[]
  theme: EmbedTheme
  showAttribution: boolean
  baseUrl: string
  title: string
  href: string
}) {
  const t = tokensFor(theme)
  return (
    <WidgetShell theme={theme} href={href} showAttribution={showAttribution} baseUrl={baseUrl}>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: t.faint }}>By certified LCA filings · DOL data</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r, i) => {
          const logo = r.company.logo_url
            ? r.company.logo_url.startsWith("/")
              ? `${baseUrl}${r.company.logo_url}`
              : r.company.logo_url
            : null
          return (
            <div
              key={r.company.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 0",
                borderTop: i === 0 ? "none" : `1px solid ${t.border}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "center", width: 20, fontSize: 13, fontWeight: 700, color: t.faint }}>
                {r.rank}
              </div>
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" width={22} height={22} style={{ borderRadius: 5, background: "#fff", objectFit: "contain" }} />
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 5, background: t.panel, fontSize: 11, fontWeight: 700, color: t.muted }}>
                  {r.company.name[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <div style={{ display: "flex", flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.company.name}
              </div>
              <div style={{ display: "flex", fontSize: 12.5, fontWeight: 700, color: t.accent, fontVariantNumeric: "tabular-nums" }}>
                {r.metrics.certified.toLocaleString()}
              </div>
            </div>
          )
        })}
      </div>
    </WidgetShell>
  )
}

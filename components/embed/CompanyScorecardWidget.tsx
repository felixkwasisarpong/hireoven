import { WidgetShell, ScoreRing } from "./WidgetShell"
import { tokensFor, gradeColor, type EmbedTheme } from "@/lib/embed/themes"
import type { ScorecardPayload } from "@/types/h1b-scorecard"

// Public company H-1B sponsorability widget. Built from the same scorecard payload
// (Spec 02) the public scorecard page renders.

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.7 }}>{label}</div>
    </div>
  )
}

export function CompanyScorecardWidget({
  data,
  theme,
  showAttribution,
  baseUrl,
}: {
  data: ScorecardPayload
  theme: EmbedTheme
  showAttribution: boolean
  baseUrl: string
}) {
  const t = tokensFor(theme)
  const hex = gradeColor(data.bucket.hue)
  const certRate = data.metrics.cert_rate != null ? `${Math.round(data.metrics.cert_rate * 100)}%` : "—"
  const logo = data.company.logo_url
    ? data.company.logo_url.startsWith("/")
      ? `${baseUrl}${data.company.logo_url}`
      : data.company.logo_url
    : null

  return (
    <WidgetShell theme={theme} href={data.scorecard_url} showAttribution={showAttribution} baseUrl={baseUrl}>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <ScoreRing grade={data.bucket.grade} hex={hex} sub={`${data.score}/100`} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" width={34} height={34} style={{ borderRadius: 8, background: "#fff", objectFit: "contain" }} />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>{data.company.name}</div>
            <div style={{ marginTop: 2, fontSize: 12, color: t.muted }}>{data.bucket.label}</div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 14,
          padding: "11px 13px",
          borderRadius: 10,
          background: t.panel,
        }}
      >
        <Stat label={`Certified FY${data.metrics.latest_fy}`} value={data.metrics.certified_latest_fy.toLocaleString()} color={t.text} />
        <Stat label="Cert. rate" value={certRate} color={t.text} />
        <Stat label="Sponsor rank" value={data.rank.overall ? `#${data.rank.overall.toLocaleString()}` : "—"} color={hex} />
      </div>
    </WidgetShell>
  )
}

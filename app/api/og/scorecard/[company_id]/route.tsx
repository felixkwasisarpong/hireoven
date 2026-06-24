import { ImageResponse } from "next/og"
import { getCompanyScorecard } from "@/lib/h1b/scorecard-query"
import type { ScoreHue } from "@/types/h1b-scorecard"

// pg requires the Node runtime (not edge).
export const runtime = "nodejs"

const HUE_TO_HEX: Record<ScoreHue, { bg: string; fg: string; accent: string }> = {
  emerald: { bg: "#022c22", fg: "#d1fae5", accent: "#34d399" },
  green: { bg: "#052e16", fg: "#dcfce7", accent: "#4ade80" },
  blue: { bg: "#0c1e3a", fg: "#dbeafe", accent: "#60a5fa" },
  amber: { bg: "#3a2208", fg: "#fef3c7", accent: "#fbbf24" },
  orange: { bg: "#3a1808", fg: "#ffedd5", accent: "#fb923c" },
  red: { bg: "#3a0808", fg: "#fee2e2", accent: "#f87171" },
}

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

// Relative logo paths (/company-logos/...) don't resolve inside the OG renderer; absolutize.
function absoluteLogo(url: string | null): string | null {
  if (!url) return null
  return url.startsWith("/") ? `${BASE}${url}` : url
}

function StatBlock({
  label,
  value,
  colors,
}: {
  label: string
  value: string
  colors: { fg: string }
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 18, opacity: 0.6, textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 34, fontWeight: 700, color: colors.fg }}>{value}</div>
    </div>
  )
}

// Minimal USCIS approved-petitions sparkline — line + year labels, no axes.
function Sparkline({
  series,
  accent,
}: {
  series: Array<{ year: number; approved: number }>
  accent: string
}) {
  const W = 380
  const H = 120
  if (series.length < 2) {
    return (
      <div
        style={{
          display: "flex",
          width: W,
          height: H,
          alignItems: "flex-end",
          justifyContent: "flex-end",
          fontSize: 16,
          opacity: 0.35,
        }}
      >
        Not enough history
      </div>
    )
  }
  const max = Math.max(...series.map((s) => s.approved), 1)
  const padX = 10
  const padY = 14
  const innerW = W - padX * 2
  const innerH = H - padY * 2
  const n = series.length
  const pts = series.map((s, i) => ({
    x: padX + (i / (n - 1)) * innerW,
    y: padY + innerH - (s.approved / max) * innerH,
  }))
  const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")

  return (
    <div style={{ display: "flex", flexDirection: "column", width: W }}>
      <div style={{ fontSize: 18, opacity: 0.6, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
        Approved petitions
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <polyline
          points={poly}
          fill="none"
          stroke={accent}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 7 : 4} fill={accent} />
        ))}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          width: W,
          marginTop: 6,
          fontSize: 18,
          opacity: 0.55,
        }}
      >
        {series.map((s) => (
          <span key={s.year}>{`FY${String(s.year).slice(2)}`}</span>
        ))}
      </div>
    </div>
  )
}

export async function GET(
  _req: Request,
  { params }: { params: { company_id: string } }
) {
  let data
  try {
    data = await getCompanyScorecard(params.company_id)
  } catch {
    data = null
  }
  if (!data) return new Response("Not found", { status: 404 })

  const colors = HUE_TO_HEX[data.bucket.hue] ?? HUE_TO_HEX.blue
  const logo = absoluteLogo(data.company.logo_url)
  const certifiedValue =
    data.metrics.filed_latest_fy > 0
      ? `${data.metrics.certified_latest_fy.toLocaleString()} of ${data.metrics.filed_latest_fy.toLocaleString()}`
      : data.metrics.certified_latest_fy.toLocaleString()
  const updated = new Date(data.refreshed_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo}
                width={72}
                height={72}
                style={{ borderRadius: 16, background: "#fff", objectFit: "contain" }}
                alt=""
              />
            ) : (
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 16,
                  background: colors.accent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 36,
                  fontWeight: 700,
                  color: colors.bg,
                }}
              >
                {data.company.name[0]?.toUpperCase() ?? "H"}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>
                {data.company.name.length > 26
                  ? `${data.company.name.slice(0, 25)}…`
                  : data.company.name}
              </div>
              <div style={{ fontSize: 22, opacity: 0.7 }}>H-1B Sponsorability Scorecard</div>
            </div>
          </div>
          <div style={{ fontSize: 24, opacity: 0.6 }}>hireoven.com</div>
        </div>

        {/* Middle: score (left) + sparkline (right) */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 28 }}>
            <div
              style={{
                fontSize: 190,
                fontWeight: 800,
                lineHeight: 1,
                color: colors.accent,
                letterSpacing: -8,
              }}
            >
              {data.bucket.grade}
            </div>
            <div style={{ display: "flex", flexDirection: "column", paddingBottom: 20 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  fontSize: 52,
                  fontWeight: 700,
                  color: colors.accent,
                }}
              >
                {data.score}
                <span style={{ fontSize: 30, opacity: 0.6 }}>/100</span>
              </div>
              <div style={{ fontSize: 30, fontWeight: 600 }}>{data.bucket.label}</div>
            </div>
          </div>

          <Sparkline series={data.metrics.series} accent={colors.accent} />
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 48, marginTop: 8 }}>
          {data.metrics.latest_fy > 0 && (
            <StatBlock
              label={`FY${data.metrics.latest_fy} certified`}
              value={certifiedValue}
              colors={colors}
            />
          )}
          <StatBlock
            label="Cert rate"
            value={`${(data.metrics.cert_rate * 100).toFixed(0)}%`}
            colors={colors}
          />
          {data.rank.overall != null && (
            <StatBlock
              label="National rank"
              value={`#${data.rank.overall.toLocaleString()}`}
              colors={colors}
            />
          )}
          {data.rank.in_industry != null && data.rank.industry && (
            <StatBlock
              label={`In ${data.rank.industry}`}
              value={`#${data.rank.in_industry}`}
              colors={colors}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 28, fontSize: 18, opacity: 0.5 }}>
          {`Source: DOL LCA + USCIS · Updated ${updated}`}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  )
}

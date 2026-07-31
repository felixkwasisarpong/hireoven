import { ImageResponse } from "next/og"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { absoluteLogoUrl } from "@/lib/companies/logo-url"

export const runtime = "nodejs"

const teal = "#1D9E75"

type Props = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Props) {
  const { id } = await params

  let title = "Job Opening"
  let company = ""
  let location = ""
  let logoUrl: string | null = null
  let logoLetter = "H"

  if (hasPostgresEnv()) {
    try {
      const pool = getPostgresPool()
      const { rows } = await pool.query<{
        title: string
        location: string | null
        is_remote: boolean
        company_name: string | null
        logo_url: string | null
        domain: string | null
      }>(
        `SELECT j.title, j.location, j.is_remote,
                c.name AS company_name, c.logo_url, c.domain
         FROM jobs j
         LEFT JOIN companies c ON c.id = j.company_id
         WHERE j.id = $1::uuid LIMIT 1`,
        [id]
      )
      const row = rows[0]
      if (row) {
        title = row.title
        company = row.company_name ?? ""
        location = row.is_remote ? "Remote" : (row.location ?? "")
        logoUrl = absoluteLogoUrl(row.logo_url, req)
        logoLetter = (row.company_name ?? "H")[0].toUpperCase()
      }
    } catch {
      // Fall through to defaults
    }
  }

  // Truncate long titles for display
  const displayTitle = title.length > 60 ? `${title.slice(0, 57)}…` : title
  const displayCompany = company.length > 40 ? `${company.slice(0, 37)}…` : company

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 56,
          background: "linear-gradient(145deg, #F8FAFC 0%, #ffffff 50%, #E8F7F2 100%)",
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        {/* Top: company logo + name */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              width={64}
              height={64}
              style={{ borderRadius: 12, objectFit: "contain", border: "1px solid #e2e8f0", background: "#fff", padding: 4 }}
              alt=""
            />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 12,
                background: "#0f172a",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 700,
              }}
            >
              {logoLetter}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {displayCompany && (
              <div style={{ fontSize: 22, fontWeight: 700, color: "#0f172a" }}>
                {displayCompany}
              </div>
            )}
            {location && (
              <div style={{ fontSize: 16, color: "#64748b" }}>{location}</div>
            )}
          </div>
        </div>

        {/* Middle: job title */}
        <div
          style={{
            fontSize: displayTitle.length > 40 ? 40 : 48,
            fontWeight: 800,
            color: "#0f172a",
            letterSpacing: -1,
            lineHeight: 1.15,
            maxWidth: 900,
          }}
        >
          {displayTitle}
        </div>

        {/* Bottom: Hireoven brand */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: teal,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 18,
                fontWeight: 800,
              }}
            >
              H
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>Hireoven</div>
          </div>
          <div
            style={{
              fontSize: 15,
              color: teal,
              fontWeight: 600,
              background: "rgba(29,158,117,0.08)",
              padding: "6px 14px",
              borderRadius: 20,
              border: "1px solid rgba(29,158,117,0.2)",
            }}
          >
            Jobs served fresh
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "X-Robots-Tag": "noindex, nofollow" },
    }
  )
}

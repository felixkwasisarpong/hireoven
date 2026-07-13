import { ImageResponse } from "next/og"
import { getSocRoleBySlug } from "@/lib/salaries/soc-roles"
import { getWageForCompanyRole, type WageRollup } from "@/lib/salaries/wage-query"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { absoluteLogoUrl } from "@/lib/companies/logo-url"

export const runtime = "nodejs"

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`

async function co(id: string): Promise<{ name: string; logo: string | null } | null> {
  if (!hasPostgresEnv()) return null
  const { rows } = await getPostgresPool().query<{ name: string; logo_url: string | null }>(
    "SELECT name, logo_url FROM companies WHERE id = $1::uuid LIMIT 1",
    [id]
  )
  const r = rows[0]
  if (!r) return null
  return { name: r.name, logo: absoluteLogoUrl(r.logo_url) }
}

function Side({
  name,
  logo,
  w,
  accent,
}: {
  name: string
  logo: string | null
  w: WageRollup
  accent: string
}) {
  const a = w.aggregate
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} width={48} height={48} style={{ borderRadius: 10, background: "#fff" }} alt="" />
        ) : (
          <div style={{ width: 48, height: 48, borderRadius: 10, background: accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#04121f", fontSize: 24, fontWeight: 700 }}>
            {name[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        <div style={{ fontSize: 32, fontWeight: 700 }}>
          {name.length > 18 ? `${name.slice(0, 17)}…` : name}
        </div>
      </div>
      {a ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 800, color: accent, lineHeight: 1.1 }}>{usd(a.p50)}</div>
          <div style={{ fontSize: 22, opacity: 0.7, marginTop: 10 }}>{`median · n=${a.n.toLocaleString()}`}</div>
          <div style={{ fontSize: 20, opacity: 0.55, marginTop: 4 }}>
            {`${usd(a.p25)} – ${usd(a.p75)}`}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 26, opacity: 0.5 }}>Insufficient public data</div>
      )}
    </div>
  )
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const a = sp.get("a")
  const b = sp.get("b")
  const roleSlug = sp.get("role") ?? ""
  const state = sp.get("state") || undefined
  if (!a || !b) return new Response("bad request", { status: 400 })

  const role = await getSocRoleBySlug(roleSlug)
  if (!role) return new Response("not found", { status: 404 })
  const [ca, cb, wa, wb] = await Promise.all([
    co(a),
    co(b),
    getWageForCompanyRole(a, role.soc_group, state),
    getWageForCompanyRole(b, role.soc_group, state),
  ])
  if (!ca || !cb) return new Response("not found", { status: 404 })
  const accent = "#34d399"
  const sub = `${role.label}${state ? ` · ${state.toUpperCase()}` : ""} · H-1B median prevailing wage`

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #022c22 0%, #000 100%)",
          color: "#d1fae5",
          padding: "52px 44px",
          border: "1px solid rgba(52,211,153,0.15)",
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 28px" }}>
          <div style={{ fontSize: 22, opacity: 0.7 }}>{sub}</div>
          <div style={{ fontSize: 22, opacity: 0.6 }}>hireoven.com</div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
          <Side name={ca.name} logo={ca.logo} w={wa} accent={accent} />
          <div style={{ display: "flex", width: 2, height: 240, background: "rgba(255,255,255,0.12)" }} />
          <Side name={cb.name} logo={cb.logo} w={wb} accent={accent} />
        </div>
        <div style={{ fontSize: 18, opacity: 0.5, padding: "0 28px" }}>
          Filed prevailing wages from DOL LCA data. Sample sizes shown.
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  )
}

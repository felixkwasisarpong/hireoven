import { headers } from "next/headers"
import { getCompanyScorecard } from "@/lib/h1b/scorecard-query"
import { resolveEmbedToken } from "@/lib/embed/tokens"
import { logEmbedImpression } from "@/lib/embed/log"
import { resolveTheme, tokensFor } from "@/lib/embed/themes"
import { CompanyScorecardWidget } from "@/components/embed/CompanyScorecardWidget"
import { WidgetShell } from "@/components/embed/WidgetShell"

export const runtime = "nodejs"
// headers() (impression logging) forces dynamic rendering; the underlying scorecard
// query is a single indexed MV lookup, cheap enough per request on the web box.
export const dynamic = "force-dynamic"

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type SearchParams = Record<string, string | undefined>

export default async function CompanyScorecardEmbed({
  params,
  searchParams,
}: {
  params: Promise<{ company_id: string }>
  searchParams: SearchParams
}) {
  const { company_id } = await params
  const theme = resolveTheme(searchParams.theme)
  const token = await resolveEmbedToken(searchParams.token)
  const showAttribution = token ? token.showAttribution : true

  const h = headers()
  logEmbedImpression({
    widgetType: "company",
    subjectId: company_id,
    referer: h.get("referer"),
    userAgent: h.get("user-agent"),
    embedTokenId: token?.id ?? null,
  })

  const data = UUID_RE.test(company_id) ? await getCompanyScorecard(company_id) : null
  if (!data) {
    const t = tokensFor(theme)
    return (
      <WidgetShell theme={theme} href="/h1b-sponsors/leaderboard" showAttribution baseUrl={BASE}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 8px", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>No scorecard yet</div>
          <div style={{ fontSize: 12.5, color: t.muted, maxWidth: 280 }}>
            We do not have enough H-1B filing data for this company.
          </div>
        </div>
      </WidgetShell>
    )
  }

  return <CompanyScorecardWidget data={data} theme={theme} showAttribution={showAttribution} baseUrl={BASE} />
}

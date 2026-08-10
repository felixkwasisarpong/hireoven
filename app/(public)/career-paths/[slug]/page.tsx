import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, GitBranch, Users } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import {
  getPathDetail,
  listTopPaths,
  parsePathSlug,
  type PathDetail,
} from "@/lib/career/paths"
import { siteBaseUrl } from "@/lib/seo/site-url"

// ISR hourly; dynamicParams stays true so a pair that crosses the threshold
// between builds still renders on first request.
export const revalidate = 3600
export const dynamicParams = true

const BASE = siteBaseUrl()

type Props = { params: Promise<{ slug: string }> }

// Pre-render the currently-meaningful pairs; the rest render on demand.
export async function generateStaticParams() {
  if (!hasPostgresEnv()) return []
  try {
    const paths = await listTopPaths(getPostgresPool())
    return paths.map((p) => ({ slug: p.slug }))
  } catch {
    return []
  }
}

// Résumé titles are stored normalized (lower, trimmed) — title-case for display.
function titleize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

async function loadDetail(slug: string): Promise<PathDetail | null> {
  const parsed = parsePathSlug(slug)
  if (!parsed || !hasPostgresEnv()) return null
  try {
    return await getPathDetail(getPostgresPool(), parsed.fromField, parsed.toField)
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const detail = await loadDetail(slug)
  if (!detail) return { title: "Career paths — Hireoven" }

  const timing = detail.medianGapMonths !== null ? `, typically over about ${detail.medianGapMonths} months` : ""
  const title = `${detail.fromLabel} → ${detail.toLabel}: a real career path | Hireoven`
  const description = `${detail.people.toLocaleString("en-US")} people have moved from ${detail.fromLabel} to ${detail.toLabel}${timing} — the real roles that bridge the two, mapped from résumé work histories.`

  return {
    title,
    description,
    alternates: { canonical: `${BASE}/career-paths/${detail.slug}` },
    openGraph: { title: `${detail.fromLabel} → ${detail.toLabel}`, description, type: "website" },
    twitter: { card: "summary_large_image", title: `${detail.fromLabel} → ${detail.toLabel}`, description },
  }
}

export default async function CareerPathPage({ params }: Props) {
  const { slug } = await params
  const detail = await loadDetail(slug)
  if (!detail) notFound()

  // Sibling paths for internal linking — prefer ones sharing a field with this move.
  const all = hasPostgresEnv() ? await listTopPaths(getPostgresPool()).catch(() => []) : []
  const related = all
    .filter((p) => p.slug !== detail.slug)
    .sort((a, b) => {
      const aShares = a.fromField === detail.fromField || a.toField === detail.toField ? 0 : 1
      const bShares = b.fromField === detail.fromField || b.toField === detail.toField ? 0 : 1
      return aShares - bShares
    })
    .slice(0, 6)

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Career paths", item: `${BASE}/career-paths` },
      { "@type": "ListItem", position: 2, name: `${detail.fromLabel} → ${detail.toLabel}`, item: `${BASE}/career-paths/${detail.slug}` },
    ],
  }

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <nav className="text-[12.5px] text-[#ccd6cf]/45">
          <Link href="/career-paths" className="hover:text-[#38e08a]">
            Career paths
          </Link>{" "}
          / <span className="text-[#ccd6cf]/70">{detail.fromLabel} → {detail.toLabel}</span>
        </nav>

        <header className="mt-4 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-xs font-semibold text-[#ccd6cf]/80">
            <Users className="h-3.5 w-3.5 text-[#f5a623]" />{" "}
            <span className="tabular-nums text-[#38e08a]">{detail.people.toLocaleString("en-US")}</span> made this move
          </span>
          <h1 className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[1.9rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[2.3rem]">
            <span>{detail.fromLabel}</span>
            <GitBranch className="h-6 w-6 rotate-90 text-[#f5a623]" />
            <span>{detail.toLabel}</span>
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[#ccd6cf]/70">
            {detail.people.toLocaleString("en-US")} people we&apos;ve tracked have moved from {detail.fromLabel} to{" "}
            {detail.toLabel}
            {detail.medianGapMonths !== null ? (
              <> — typically over about <span className="font-semibold text-[#ccd6cf]">{detail.medianGapMonths} months</span></>
            ) : null}
            . Here are the real roles that bridge the two.
          </p>
        </header>

        {detail.topRoleMoves.length > 0 && (
          <section className="mt-10">
            <h2 className="term-label">{"// the moves people actually made"}</h2>
            <ul className="mt-3 space-y-2">
              {detail.topRoleMoves.map((m, i) => (
                <li
                  key={`${m.fromTitle}->${m.toTitle}-${i}`}
                  className="term-panel flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0 truncate text-[14px] text-[#ccd6cf]">
                    <span className="text-[#ccd6cf]/80">{titleize(m.fromTitle)}</span>{" "}
                    <ArrowRight className="inline h-3.5 w-3.5 text-[#f5a623]" />{" "}
                    <span className="font-semibold text-white">{titleize(m.toTitle)}</span>
                  </span>
                  <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-[#38e08a]">
                    {m.count.toLocaleString("en-US")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="term-panel mt-12 px-6 py-8 text-center">
          <p className="term-label">{"// your move"}</p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Could you make this move? See your own bridge.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-[#ccd6cf]/65">
            HireOven reads your résumé and maps your bridge to {detail.toLabel} — the skills that carry over, the gaps
            to close, and the live roles that already ask for both.
          </p>
          <Link href="/signup?next=%2Fdashboard%2Fpivot" className="term-btn term-btn-amber mt-5 inline-flex justify-center">
            Map my bridge to {detail.toLabel} <ArrowRight className="h-4 w-4" />
          </Link>
        </section>

        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="text-lg font-semibold text-white">More career paths</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {related.map((p) => (
                <Link
                  key={p.slug}
                  href={`/career-paths/${p.slug}`}
                  className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1.5 text-[12.5px] font-medium text-[#ccd6cf]/80 transition hover:border-[#38e08a] hover:text-[#38e08a]"
                >
                  {p.fromLabel} → {p.toLabel}
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-[#ccd6cf]/45">
          Mapped from résumé work histories in Hireoven&apos;s career graph. We only publish a path once enough people
          have really made the move, so every number here is observed — never estimated.
        </p>
      </main>
    </div>
  )
}

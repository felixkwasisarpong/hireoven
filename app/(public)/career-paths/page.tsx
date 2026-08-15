import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, GitBranch } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { listTopPaths, type PathSummary } from "@/lib/career/paths"
import { siteBaseUrl } from "@/lib/seo/site-url"

// ISR hourly — the ranking shifts as the transition graph grows, but not per
// request. No dynamic params here; this is a single hub page.
export const revalidate = 3600

const BASE = siteBaseUrl()

export const metadata: Metadata = {
  title: "Career paths — how people actually move between fields | Hireoven",
  description:
    "The real career moves people make between fields — mapped from thousands of résumé work histories. See how many made each move, how long it took, and the exact roles that bridge them.",
  alternates: { canonical: `${BASE}/career-paths` },
  openGraph: {
    title: "Career paths — how people actually move between fields",
    description:
      "Real field-to-field career moves, mapped from résumé work histories: how many made each move and how long it took.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Career paths — Hireoven",
    description: "The real moves people make between fields, mapped from résumé work histories.",
  },
}

async function getPaths(): Promise<PathSummary[]> {
  if (!hasPostgresEnv()) return []
  try {
    return await listTopPaths(getPostgresPool())
  } catch {
    return []
  }
}

export default async function CareerPathsHub() {
  const paths = await getPaths()

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <header className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-[12px] text-[#ccd6cf]/80">
            <GitBranch className="h-3.5 w-3.5 text-[#f5a623]" /> career paths
          </span>
          <h1 className="mt-4 text-[2rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[2.4rem]">
            How people actually <span className="text-[#f5a623]">move between fields</span>
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[#ccd6cf]/70">
            Every path below is mapped from real résumé work histories — the field someone worked in, and the field
            they moved to next. No theory: just the moves people have actually made, how many made each one, and how
            long it typically took.
          </p>
        </header>

        {paths.length === 0 ? (
          <section className="term-panel mt-10 px-6 py-10 text-center">
            <p className="term-label">{"Accumulating"}</p>
            <h2 className="mt-2 text-xl font-semibold text-white">The map is still filling in</h2>
            <p className="mx-auto mt-2 max-w-md text-[14px] text-[#ccd6cf]/65">
              We only publish a path once enough people have really made the move — so what shows here is always
              evidence, never a guess. Check back soon.
            </p>
          </section>
        ) : (
          <div className="mt-10 grid gap-2 sm:grid-cols-2">
            {paths.map((p) => (
              <Link
                key={p.slug}
                href={`/career-paths/${p.slug}`}
                className="term-panel term-panel-hover flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-[#ccd6cf]">
                    {p.fromLabel} <ArrowRight className="inline h-3.5 w-3.5 text-[#f5a623]" /> {p.toLabel}
                  </span>
                  {p.medianGapMonths !== null && (
                    <span className="mt-0.5 block text-[12px] text-[#ccd6cf]/45">
                      ~{p.medianGapMonths} mo typical
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-[#38e08a]">
                  {p.people.toLocaleString("en-US")}
                </span>
              </Link>
            ))}
          </div>
        )}

        <section className="term-panel mt-12 px-6 py-8 text-center">
          <p className="term-label">{"Your move"}</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Wondering how far your own pivot is?</h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-[#ccd6cf]/65">
            Upload your résumé and HireOven maps your bridge to any field — the skills that carry over, the gaps to
            close, and the roles that already ask for both.
          </p>
          <Link href="/signup?next=%2Fdashboard%2Fpivot" className="term-btn term-btn-amber mt-5 inline-flex justify-center">
            Map my career bridge
          </Link>
        </section>
      </main>
    </div>
  )
}

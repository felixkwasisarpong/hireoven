import type { Metadata } from "next"
import Link from "next/link"
import { Compass } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import {
  JOB_COLLECTIONS,
  KIND_LABELS,
  countAllCollections,
  type CollectionKind,
} from "@/lib/jobs/collections"
import { siteBaseUrl } from "@/lib/seo/site-url"

export const revalidate = 3600

const BASE = siteBaseUrl()

const KIND_ORDER: CollectionKind[] = ["role", "remote", "location", "ats", "visa"]

export const metadata: Metadata = {
  title: "Browse jobs — by role, location, visa & hiring platform | Hireoven",
  description:
    "Browse fresh jobs by role, location, remote, visa sponsorship, and hiring platform — all discovered directly from company career pages and refreshed continuously.",
  alternates: { canonical: `${BASE}/jobs/browse` },
  openGraph: {
    title: "Browse jobs — Hireoven",
    description: "Fresh jobs by role, location, visa, and hiring platform — straight from company career pages.",
    type: "website",
  },
}

async function getCounts(): Promise<Record<string, number>> {
  if (!hasPostgresEnv()) return {}
  try {
    return await countAllCollections(getPostgresPool())
  } catch {
    return {}
  }
}

export default async function BrowseJobsHub() {
  const counts = await getCounts()

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <header className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-[12px] text-[#ccd6cf]/80">
            <Compass className="h-3.5 w-3.5 text-[#f5a623]" /> browse jobs
          </span>
          <h1 className="mt-4 text-[2rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[2.4rem]">
            Find <span className="text-[#f5a623]">fresh jobs</span> by what matters to you
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[#ccd6cf]/70">
            Every collection below is built from jobs discovered directly from company career pages and refreshed
            continuously — role, location, remote, visa sponsorship, and the hiring platform behind the posting.
          </p>
        </header>

        <div className="mt-10 space-y-10">
          {KIND_ORDER.map((kind) => {
            const items = JOB_COLLECTIONS.filter((c) => c.kind === kind)
            if (items.length === 0) return null
            return (
              <section key={kind}>
                <h2 className="term-label">
                  {KIND_LABELS[kind]}
                </h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {items.map((c) => {
                    const n = counts[c.slug]
                    return (
                      <Link
                        key={c.slug}
                        href={`/jobs/browse/${c.slug}`}
                        className="term-panel term-panel-hover flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <span className="truncate text-[14px] font-semibold text-[#ccd6cf]">{c.label} jobs</span>
                        {typeof n === "number" && n > 0 && (
                          <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-[#38e08a]">
                            {n.toLocaleString("en-US")}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>

        <section className="term-panel mt-12 px-6 py-8 text-center">
          <p className="term-label">{"Unlock"}</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Want these in your inbox every morning?</h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-[#ccd6cf]/65">
            Track your titles and wake up to the roles posted overnight — with H-1B sponsorship intel built in.
          </p>
          <Link
            href="/signup?next=%2Fdashboard%2Fonboarding"
            className="term-btn term-btn-amber mt-5 inline-flex justify-center"
          >
            Start tracking free
          </Link>
        </section>
      </main>
    </div>
  )
}

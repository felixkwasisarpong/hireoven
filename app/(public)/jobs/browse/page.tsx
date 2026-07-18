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

export const revalidate = 3600

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

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
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <header className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
            <Compass className="h-3.5 w-3.5" /> Browse jobs
          </span>
          <h1 className="mt-3 text-[30px] font-bold leading-tight tracking-tight sm:text-[36px]">
            Find fresh jobs by what matters to you
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
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
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {KIND_LABELS[kind]}
                </h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {items.map((c) => {
                    const n = counts[c.slug]
                    return (
                      <Link
                        key={c.slug}
                        href={`/jobs/browse/${c.slug}`}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:border-sky-200 hover:shadow-sm"
                      >
                        <span className="truncate text-[14px] font-semibold text-slate-900">{c.label} jobs</span>
                        {typeof n === "number" && n > 0 && (
                          <span className="shrink-0 text-[12.5px] font-bold tabular-nums text-slate-400">
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

        <section className="mt-12 rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-6 py-8 text-center">
          <h2 className="text-xl font-bold text-slate-900">Want these in your inbox every morning?</h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-slate-600">
            Track your titles and wake up to the roles posted overnight — with H-1B sponsorship intel built in.
          </p>
          <Link
            href="/signup"
            className="mt-5 inline-flex items-center justify-center rounded-full bg-emerald-600 px-6 py-2.5 text-[14px] font-semibold text-white transition hover:bg-emerald-700"
          >
            Start tracking free
          </Link>
        </section>
      </main>
    </div>
  )
}

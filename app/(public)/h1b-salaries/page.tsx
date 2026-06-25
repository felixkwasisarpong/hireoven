import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import { getFeaturedSocRoles, getAllSocRoles } from "@/lib/salaries/soc-roles"

export const revalidate = 86400

export const metadata: Metadata = {
  title: "H-1B Salaries — Prevailing Wages by Role, Company, and State",
  description:
    "A searchable database of H-1B prevailing wages from DOL LCA filings. Median pay by role, company, and state. Compare any two employers.",
  alternates: { canonical: "/h1b-salaries" },
}

export default async function SalariesIndexPage() {
  const [featured, all] = await Promise.all([getFeaturedSocRoles(), getAllSocRoles()])

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "H-1B Prevailing Wages",
    description:
      "Median, p25, and p75 H-1B prevailing wages by role, company, and state, aggregated from U.S. DOL Labor Condition Application filings.",
    creator: { "@type": "Organization", name: "Hireoven" },
    isAccessibleForFree: true,
    license: "https://www.dol.gov/",
  }

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">H-1B Salaries</h1>
        <p className="mt-2 text-slate-600">
          Median prevailing wages from U.S. Department of Labor LCA filings — by role, company, and
          state. Every number shows its sample size and fiscal-year range. Prevailing wage is the
          wage an employer files, not necessarily what is paid.
        </p>

        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Popular roles
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {featured.map((r) => (
              <Link
                key={r.slug}
                href={`/h1b-salaries/by-role/${r.slug}`}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {r.label}
              </Link>
            ))}
          </div>
        </section>

        {all.length > featured.length && (
          <section className="mt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              All roles
            </h2>
            <div className="flex flex-wrap gap-2">
              {all
                .filter((r) => !featured.some((f) => f.slug === r.slug))
                .map((r) => (
                  <Link
                    key={r.slug}
                    href={`/h1b-salaries/by-role/${r.slug}`}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    {r.label}
                  </Link>
                ))}
            </div>
          </section>
        )}

        <p className="mt-8 text-xs text-slate-400">
          Sourced from DOL LCA disclosure data.{" "}
          <Link href="/h1b-sponsors/leaderboard/methodology#salaries" className="underline">
            Methodology
          </Link>
        </p>
      </main>
    </div>
  )
}

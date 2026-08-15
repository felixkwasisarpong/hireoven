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
    <div className="term-page min-h-dvh">
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="term-label">Prevailing wages</p>
        <h1 className="mt-4 text-[2.3rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[3.1rem]">
          H-1B <span className="text-[#f5a623]">Salaries</span>
        </h1>
        <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#ccd6cf]/70">
          Median prevailing wages from U.S. Department of Labor LCA filings — by role, company, and
          state. Every number shows its sample size and fiscal-year range. Prevailing wage is the
          wage an employer files, not necessarily what is paid.
        </p>

        <section className="mt-8">
          <h2 className="term-label mb-3">popular roles</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {featured.map((r) => (
              <Link
                key={r.slug}
                href={`/h1b-salaries/by-role/${r.slug}`}
                className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-2.5 text-[13px] font-medium text-[#ccd6cf]/80 transition hover:border-[#38e08a] hover:text-[#38e08a]"
              >
                {r.label}
              </Link>
            ))}
          </div>
        </section>

        {all.length > featured.length && (
          <section className="mt-8">
            <h2 className="term-label mb-3">all roles</h2>
            <div className="flex flex-wrap gap-2">
              {all
                .filter((r) => !featured.some((f) => f.slug === r.slug))
                .map((r) => (
                  <Link
                    key={r.slug}
                    href={`/h1b-salaries/by-role/${r.slug}`}
                    className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-[12px] text-[#ccd6cf]/70 transition hover:border-[#38e08a] hover:text-[#38e08a]"
                  >
                    {r.label}
                  </Link>
                ))}
            </div>
          </section>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-[#ccd6cf]/45">
          Sourced from DOL LCA disclosure data.{" "}
          <Link
            href="/h1b-sponsors/leaderboard/methodology#salaries"
            className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
          >
            Methodology
          </Link>
        </p>
      </main>
    </div>
  )
}

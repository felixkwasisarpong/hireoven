import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import Navbar from "@/components/layout/Navbar"
import { SalaryCard, fmtUsd } from "@/components/salaries/SalaryCard"
import { getSocRoleBySlug, getFeaturedSocRoles } from "@/lib/salaries/soc-roles"
import { getWageForRole, getTopPayingCompaniesForRole } from "@/lib/salaries/wage-query"
import { h1bSponsorPath } from "@/lib/seo/company-seo"

export const revalidate = 86400
export const dynamicParams = true

const TOP_STATES = ["CA", "TX", "NY", "WA", "NJ", "MA", "IL", "GA", "PA", "VA"]

export async function generateStaticParams() {
  try {
    const roles = await getFeaturedSocRoles()
    return roles.flatMap((r) => TOP_STATES.map((s) => ({ "role-slug": r.slug, state: s })))
  } catch {
    return []
  }
}

type Props = { params: Promise<{ "role-slug": string; state: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params
  const role = await getSocRoleBySlug(p["role-slug"])
  const state = p.state.toUpperCase()
  if (!role) return { title: "Salary not found — Hireoven" }
  return {
    title: `${role.label} H-1B Salary in ${state} (Median Prevailing Wage)`,
    description: `Median H-1B prevailing wage for ${role.label} in ${state}, with top-paying employers. Sourced from DOL LCA filings.`,
    alternates: { canonical: `/h1b-salaries/by-role/${role.slug}/by-state/${state}` },
  }
}

export default async function RoleStateSalaryPage({ params }: Props) {
  const p = await params
  const role = await getSocRoleBySlug(p["role-slug"])
  const state = p.state.toUpperCase()
  if (!role || !/^[A-Z]{2}$/.test(state)) notFound()

  const [slice, top] = await Promise.all([
    getWageForRole(role.soc_group, state),
    getTopPayingCompaniesForRole(role.soc_group, state, 15),
  ])

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <nav className="mb-5 text-[13px] text-[#ccd6cf]/45">
          <Link href="/h1b-salaries" className="hover:text-[#38e08a]">H-1B salaries</Link>
          <span className="mx-1.5 text-[#ccd6cf]/25">/</span>
          <Link href={`/h1b-salaries/by-role/${role.slug}`} className="hover:text-[#38e08a]">{role.label}</Link>
          <span className="mx-1.5 text-[#ccd6cf]/25">/</span>
          <span className="text-[#ccd6cf]/70">{state}</span>
        </nav>

        <SalaryCard
          subtitle={`H-1B median prevailing wage · ${state}`}
          title={`${role.label} salaries in ${state}`}
          aggregate={slice.aggregate}
          broaderHref={`/h1b-salaries/by-role/${role.slug}`}
          broaderLabel={`See ${role.label} nationwide →`}
        />

        {top.length > 0 && (
          <section className="mt-8">
            <h2 className="term-label mb-3">top-paying employers in {state}</h2>
            <ul className="divide-y divide-[rgba(120,200,160,0.12)] border border-[rgba(120,200,160,0.2)]">
              {top.map((t) => (
                <li
                  key={t.company.id}
                  className="flex items-center justify-between bg-[#0e1411] p-3 text-[13px] transition-colors hover:bg-[#111a15]"
                >
                  <Link href={h1bSponsorPath(t.company.id, t.company.name)} className="font-medium text-[#ccd6cf] hover:text-white hover:underline">
                    {t.company.name}
                  </Link>
                  <span className="tabular-nums text-[#ccd6cf]/70">
                    <span className="font-semibold text-[#38e08a]">{fmtUsd(t.p50)}</span>{" "}
                    <span className="text-[11px] text-[#ccd6cf]/40">n={t.n}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-[#ccd6cf]/45">
          Prevailing wage is what the employer files, not necessarily what is paid.{" "}
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

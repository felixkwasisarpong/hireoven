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
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <nav className="mb-5 text-[13px] text-slate-500">
          <Link href="/h1b-salaries" className="hover:text-slate-800">H-1B salaries</Link>
          <span className="mx-1.5 text-slate-300">/</span>
          <Link href={`/h1b-salaries/by-role/${role.slug}`} className="hover:text-slate-800">{role.label}</Link>
          <span className="mx-1.5 text-slate-300">/</span>
          <span className="text-slate-700">{state}</span>
        </nav>

        <SalaryCard
          subtitle={`H-1B median prevailing wage · ${state}`}
          title={`${role.label} salaries in ${state}`}
          aggregate={slice.aggregate}
          broaderHref={`/h1b-salaries/by-role/${role.slug}`}
          broaderLabel={`See ${role.label} nationwide →`}
        />

        {top.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Top-paying employers in {state}
            </h2>
            <ul className="space-y-2">
              {top.map((t) => (
                <li
                  key={t.company.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 text-sm"
                >
                  <Link href={h1bSponsorPath(t.company.id, t.company.name)} className="font-medium text-slate-900 hover:underline">
                    {t.company.name}
                  </Link>
                  <span className="tabular-nums text-slate-700">
                    {fmtUsd(t.p50)} <span className="text-xs text-slate-400">n={t.n}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-6 text-xs text-slate-400">
          Prevailing wage is what the employer files, not necessarily what is paid.{" "}
          <Link href="/h1b-sponsors/leaderboard/methodology#salaries" className="underline">Methodology</Link>
        </p>
      </main>
    </div>
  )
}

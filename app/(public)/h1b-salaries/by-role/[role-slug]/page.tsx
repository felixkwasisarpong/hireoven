import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import Navbar from "@/components/layout/Navbar"
import { SalaryCard, fmtUsd } from "@/components/salaries/SalaryCard"
import { getSocRoleBySlug, getFeaturedSocRoles } from "@/lib/salaries/soc-roles"
import {
  getWageForRole,
  getTopPayingCompaniesForRole,
  getRoleStateBreakdown,
} from "@/lib/salaries/wage-query"
import { h1bSponsorPath } from "@/lib/seo/company-seo"

export const revalidate = 86400
export const dynamicParams = true

export async function generateStaticParams() {
  try {
    const roles = await getFeaturedSocRoles()
    return roles.map((r) => ({ "role-slug": r.slug }))
  } catch {
    return []
  }
}

type Props = { params: Promise<{ "role-slug": string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const role = await getSocRoleBySlug((await params)["role-slug"])
  if (!role) return { title: "Salary not found — Hireoven" }
  return {
    title: `${role.label} H-1B Salary (Median Prevailing Wage)`,
    description: `Median H-1B prevailing wage for ${role.label}, by state and top-paying employer. Sourced from DOL LCA filings.`,
    alternates: { canonical: `/h1b-salaries/by-role/${role.slug}` },
  }
}

export default async function RoleSalaryPage({ params }: Props) {
  const slug = (await params)["role-slug"]
  const role = await getSocRoleBySlug(slug)
  if (!role) notFound()

  const [national, states, top] = await Promise.all([
    getWageForRole(role.soc_group),
    getRoleStateBreakdown(role.soc_group),
    getTopPayingCompaniesForRole(role.soc_group, undefined, 15),
  ])

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <nav className="mb-5 text-[13px] text-slate-500">
          <Link href="/h1b-salaries" className="hover:text-slate-800">H-1B salaries</Link>
          <span className="mx-1.5 text-slate-300">/</span>
          <span className="text-slate-700">{role.label}</span>
        </nav>

        <SalaryCard
          subtitle="H-1B median prevailing wage · nationwide"
          title={`${role.label} salaries`}
          aggregate={national.aggregate}
        />

        {states.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">By state</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {states.map((s) => (
                <Link
                  key={s.state}
                  href={`/h1b-salaries/by-role/${role.slug}/by-state/${s.state}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-700">{s.state}</span>
                  <span className="tabular-nums text-slate-900">{fmtUsd(s.p50)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {top.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Top-paying employers
            </h2>
            <ul className="space-y-2">
              {top.map((t) => (
                <li
                  key={t.company.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 text-sm"
                >
                  <Link
                    href={h1bSponsorPath(t.company.id, t.company.name)}
                    className="font-medium text-slate-900 hover:underline"
                  >
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
          Prevailing wage is the wage the employer files with the DOL, not necessarily what is paid.{" "}
          <Link href="/h1b-sponsors/leaderboard/methodology#salaries" className="underline">
            Methodology
          </Link>
        </p>
      </main>
    </div>
  )
}

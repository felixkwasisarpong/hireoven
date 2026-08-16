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
  ]).catch(() => [null, [], []] as const)
  if (!national) notFound()

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <nav className="mb-5 text-[13px] text-[#ccd6cf]/45">
          <Link href="/h1b-salaries" className="hover:text-[#38e08a]">H-1B salaries</Link>
          <span className="mx-1.5 text-[#ccd6cf]/25">/</span>
          <span className="text-[#ccd6cf]/70">{role.label}</span>
        </nav>

        <SalaryCard
          subtitle="H-1B median prevailing wage · nationwide"
          title={`${role.label} salaries`}
          aggregate={national.aggregate}
        />

        {states.length > 0 && (
          <section className="mt-8">
            <h2 className="term-label mb-3">by state</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {states.map((s) => (
                <Link
                  key={s.state}
                  href={`/h1b-salaries/by-role/${role.slug}/by-state/${s.state}`}
                  className="flex items-center justify-between border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-2 text-[13px] transition hover:border-[#38e08a] hover:bg-[#111a15]"
                >
                  <span className="font-medium text-[#ccd6cf]/80">{s.state}</span>
                  <span className="font-semibold tabular-nums text-[#38e08a]">{fmtUsd(s.p50)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {top.length > 0 && (
          <section className="mt-8">
            <h2 className="term-label mb-3">top-paying employers</h2>
            <ul className="divide-y divide-[rgba(120,200,160,0.12)] border border-[rgba(120,200,160,0.2)]">
              {top.map((t) => (
                <li
                  key={t.company.id}
                  className="flex items-center justify-between bg-[#0e1411] p-3 text-[13px] transition-colors hover:bg-[#111a15]"
                >
                  <Link
                    href={h1bSponsorPath(t.company.id, t.company.name)}
                    className="font-medium text-[#ccd6cf] hover:text-white hover:underline"
                  >
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
          Prevailing wage is the wage the employer files with the DOL, not necessarily what is paid.{" "}
          <Link
            href="/h1b-sponsors/leaderboard/methodology#salaries"
            className="text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]"
          >
            Methodology
          </Link>
        </p>
      </main>
    </div>
  )
}

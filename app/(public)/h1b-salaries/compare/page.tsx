import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import { SalaryCard, fmtUsd } from "@/components/salaries/SalaryCard"
import { getSocRoleBySlug } from "@/lib/salaries/soc-roles"
import { getWageForCompanyRole, type WageRollup } from "@/lib/salaries/wage-query"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"

export const revalidate = 86400

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
type SP = Record<string, string | undefined>

async function getCo(id: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!id || !hasPostgresEnv()) return null
  const { rows } = await getPostgresPool().query<{ id: string; name: string }>(
    "SELECT id, name FROM companies WHERE id = $1::uuid LIMIT 1",
    [id]
  )
  return rows[0] ?? null
}

// Factual delta only — never adversarial. Gated on a meaningful gap + adequate samples.
function deltaSentence(an: string, bn: string, a: WageRollup, b: WageRollup): string | null {
  if (!a.aggregate || !b.aggregate) return null
  if (a.aggregate.n < 20 || b.aggregate.n < 20) return null
  const pa = a.aggregate.p50
  const pb = b.aggregate.p50
  const hi = pa >= pb ? { n: an, v: pa } : { n: bn, v: pb }
  const lo = pa >= pb ? { v: pb } : { v: pa }
  const pct = Math.round(((hi.v - lo.v) / lo.v) * 100)
  if (pct < 15) return `${fmtUsd(pa)} vs ${fmtUsd(pb)} — within ${Math.max(pct, 1)}%, roughly comparable.`
  return `${hi.n}'s median is ${pct}% higher (${fmtUsd(hi.v)} vs ${fmtUsd(lo.v)}).`
}

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const [ca, cb, role] = await Promise.all([
    getCo(searchParams.a),
    getCo(searchParams.b),
    searchParams.role ? getSocRoleBySlug(searchParams.role) : Promise.resolve(null),
  ])
  if (!ca || !cb) return { title: "Compare H-1B salaries — Hireoven" }
  const state = searchParams.state ? ` in ${searchParams.state.toUpperCase()}` : ""
  const rolePart = role ? ` for ${role.label}` : ""
  const title = `${ca.name} vs ${cb.name} H-1B Salaries${rolePart}${state}`
  const og = `${BASE}/api/og/salary-compare?a=${ca.id}&b=${cb.id}&role=${searchParams.role ?? ""}&state=${searchParams.state ?? ""}`
  return {
    title,
    description: `Side-by-side H-1B median prevailing wages: ${ca.name} vs ${cb.name}. Sourced from DOL LCA filings.`,
    openGraph: { title, type: "article", images: [{ url: og, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, images: [og] },
  }
}

export default async function ComparePage({ searchParams }: { searchParams: SP }) {
  const role = searchParams.role ? await getSocRoleBySlug(searchParams.role) : null
  const state = searchParams.state?.toUpperCase()
  const [ca, cb] = await Promise.all([getCo(searchParams.a), getCo(searchParams.b)])

  if (!ca || !cb || !role) {
    return (
      <div className="min-h-dvh bg-[#F8FAFC]">
        <Navbar />
        <main className="mx-auto max-w-2xl px-4 py-16 text-center text-slate-600">
          <h1 className="text-xl font-semibold text-slate-900">Compare H-1B salaries</h1>
          <p className="mt-2 text-sm">
            Open a comparison from any role&rsquo;s top-employers list, or pass two company ids and a role.
          </p>
          <Link href="/h1b-salaries" className="mt-4 inline-block underline">Browse roles →</Link>
        </main>
      </div>
    )
  }

  const [wa, wb] = await Promise.all([
    getWageForCompanyRole(ca.id, role.soc_group, state),
    getWageForCompanyRole(cb.id, role.soc_group, state),
  ])
  const delta = deltaSentence(ca.name, cb.name, wa, wb)
  const where = state ? ` in ${state}` : ""

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {ca.name} vs {cb.name}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {role.label} · H-1B median prevailing wage{where}
        </p>

        {delta && (
          <p className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">
            {delta}
          </p>
        )}

        <div className="mt-4 space-y-4">
          <SalaryCard subtitle={ca.name} title={`${role.label}${where}`} aggregate={wa.aggregate} />
          <SalaryCard subtitle={cb.name} title={`${role.label}${where}`} aggregate={wb.aggregate} />
        </div>

        <p className="mt-6 text-xs text-slate-400">
          Prevailing wage is what the employer files, not necessarily what is paid; excludes bonus and
          equity.{" "}
          <Link href="/h1b-sponsors/leaderboard/methodology#salaries" className="underline">Methodology</Link>
        </p>
      </main>
    </div>
  )
}

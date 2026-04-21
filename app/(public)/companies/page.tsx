import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin"
import Navbar from "@/components/layout/Navbar"
import type { Company } from "@/types"

export const metadata: Metadata = {
  title: "Browse Companies — Hireoven",
  description:
    "Explore companies hiring now. Filter by H1B sponsorship, industry, and more. See jobs the moment they're posted.",
}

export const dynamic = "force-dynamic"

function SponsorsH1BBadge({ confidence }: { confidence: number }) {
  if (confidence >= 80)
    return (
      <span className="rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
        Strong H1B
      </span>
    )
  if (confidence >= 60)
    return (
      <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
        Likely H1B
      </span>
    )
  return null
}

export default async function PublicCompaniesPage() {
  const companies = hasSupabaseAdminEnv()
    ? await (async () => {
        const supabase = createAdminClient()
        const { data } = await supabase
          .from("companies")
          .select("id, name, domain, logo_url, industry, size, job_count, sponsors_h1b, sponsorship_confidence")
          .eq("is_active", true)
          .gt("job_count", 0)
          .order("job_count", { ascending: false })
        return data ?? []
      })()
    : []

  const grouped = companies.reduce<Record<string, Company[]>>((acc, company) => {
    const industry = company.industry ?? "Other"
    if (!acc[industry]) acc[industry] = []
    acc[industry].push(company as Company)
    return acc
  }, {})

  const totalJobs = companies.reduce((sum, c) => sum + (c.job_count ?? 0), 0)

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900">
            Companies hiring now
          </h1>
          <p className="mt-3 text-lg text-gray-500">
            {companies.length.toLocaleString()} companies ·{" "}
            {totalJobs.toLocaleString()} open roles
          </p>
        </div>

        {/* Sign-up CTA */}
        <div className="mb-10 rounded-2xl border border-[#BAE6FD] bg-[#F0F9FF] px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-[#0C4A6E]">Get instant alerts when companies post</p>
            <p className="text-sm text-[#0369A1] mt-0.5">Free to sign up. No spam.</p>
          </div>
          <Link
            href="/signup"
            className="rounded-xl bg-[#0369A1] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#075985] transition flex-shrink-0"
          >
            Sign up free →
          </Link>
        </div>

        {/* Company grid by industry */}
        <div className="space-y-12">
          {Object.entries(grouped).map(([industry, industryCompanies]) => (
            <section key={industry}>
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-400">
                {industry}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {industryCompanies.map((company) => (
                  <Link
                    key={company.id}
                    href={`/companies/${company.id}`}
                    className="group flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-4 transition hover:border-[#BAE6FD] hover:shadow-md"
                  >
                    <div className="flex-shrink-0">
                      {company.logo_url ? (
                        <Image
                          src={company.logo_url}
                          alt={company.name}
                          width={48}
                          height={48}
                          className="rounded-xl border border-gray-100 object-contain"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E0F2FE] text-sm font-bold text-[#0C4A6E]">
                          {company.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900 group-hover:text-[#0369A1] transition">
                        {company.name}
                      </p>
                      <p className="mt-0.5 text-sm text-gray-500">
                        {company.job_count} open role{company.job_count === 1 ? "" : "s"}
                      </p>
                      {company.sponsorship_confidence >= 60 && (
                        <div className="mt-2">
                          <SponsorsH1BBadge confidence={company.sponsorship_confidence} />
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}

import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { notFound } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import Navbar from "@/components/layout/Navbar"

export const revalidate = 3600

type Props = { params: Promise<{ id: string }> }

export async function generateStaticParams() {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("companies")
    .select("id")
    .eq("is_active", true)
    .gt("job_count", 0)
  return (data ?? []).map((c) => ({ id: c.id }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const supabase = createAdminClient()
  const { data: company } = await supabase
    .from("companies")
    .select("name, job_count, sponsorship_confidence, industry")
    .eq("id", id)
    .single()

  if (!company) return { title: "Company — Hireoven" }

  return {
    title: `${company.name} Jobs — Apply Fresh on Hireoven`,
    description: `${company.job_count} open roles at ${company.name}. See jobs the moment they're posted. ${company.sponsorship_confidence}% H1B sponsorship confidence.`,
    openGraph: {
      title: `${company.name} Jobs — Hireoven`,
      description: `${company.job_count} open roles · ${company.sponsorship_confidence}% H1B confidence`,
      type: "website",
    },
  }
}

export default async function PublicCompanyPage({ params }: Props) {
  const { id } = await params
  const supabase = createAdminClient()

  const [companyResult, jobsResult] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).single(),
    supabase
      .from("jobs")
      .select("id, title, location, is_remote, is_hybrid, seniority_level, employment_type, sponsors_h1b, sponsorship_score, first_detected_at, apply_url, skills")
      .eq("company_id", id)
      .eq("is_active", true)
      .order("first_detected_at", { ascending: false })
      .limit(50),
  ])

  if (companyResult.error || !companyResult.data) notFound()

  const company = companyResult.data
  const jobs = jobsResult.data ?? []

  function hoursAgo(ts: string) {
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <main className="mx-auto max-w-4xl px-6 py-12">
        {/* Header */}
        <div className="flex items-start gap-5 mb-8">
          {company.logo_url ? (
            <Image
              src={company.logo_url}
              alt={company.name}
              width={64}
              height={64}
              className="rounded-2xl border border-gray-200 object-contain flex-shrink-0"
            />
          ) : (
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-[#E0F2FE] text-xl font-bold text-[#0C4A6E]">
              {company.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">{company.name}</h1>
            <p className="mt-1 text-gray-500">
              {company.industry} · {company.job_count} open role{company.job_count === 1 ? "" : "s"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {company.sponsors_h1b && (
                <span className="rounded-full bg-sky-50 border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-700">
                  Sponsors H1B · {company.sponsorship_confidence}% confidence
                </span>
              )}
              {company.ats_type && (
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 capitalize">
                  {company.ats_type} ATS
                </span>
              )}
            </div>
          </div>
        </div>

        {/* CTA banner */}
        <div className="mb-8 rounded-2xl border border-[#BAE6FD] bg-[#F0F9FF] px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="font-medium text-[#0C4A6E]">
            Get an instant alert the next time {company.name} posts
          </p>
          <Link
            href={`/signup?watch=${company.id}`}
            className="rounded-xl bg-[#0369A1] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#075985] transition flex-shrink-0"
          >
            Sign up free →
          </Link>
        </div>

        {/* Jobs */}
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          {jobs.length} open role{jobs.length === 1 ? "" : "s"}
        </h2>

        {jobs.length === 0 ? (
          <p className="text-gray-500">No open roles right now.</p>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <a
                key={job.id}
                href={job.apply_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-5 py-4 transition hover:border-[#BAE6FD] hover:shadow-sm group"
              >
                <div>
                  <p className="font-semibold text-gray-900 group-hover:text-[#0369A1] transition">
                    {job.title}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {[
                      job.is_remote ? "Remote" : job.location,
                      job.seniority_level
                        ? job.seniority_level.charAt(0).toUpperCase() + job.seniority_level.slice(1)
                        : null,
                      job.sponsors_h1b ? "Sponsors H1B" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="text-xs text-gray-400">{hoursAgo(job.first_detected_at)}</p>
                  <p className="mt-1 text-xs font-medium text-[#0369A1]">Apply →</p>
                </div>
              </a>
            ))}
          </div>
        )}

        <div className="mt-10 border-t border-gray-100 pt-8 text-center">
          <p className="text-sm text-gray-500">
            Want alerts the moment {company.name} posts?{" "}
            <Link href="/signup" className="text-[#0369A1] font-medium hover:underline">
              Sign up free
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}

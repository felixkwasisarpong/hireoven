import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { notFound } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { AutofillButton } from "@/components/autofill/AutofillButton"
import Navbar from "@/components/layout/Navbar"
import type { Company, Job } from "@/types"

export const revalidate = 3600

type Props = { params: Promise<{ id: string }> }

export async function generateStaticParams() {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("is_active", true)
    .order("first_detected_at", { ascending: false })
    .limit(1000)
  return (data ?? []).map((j) => ({ id: j.id }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const supabase = createAdminClient()
  const { data: rawData } = await supabase
    .from("jobs")
    .select("title, location, is_remote, company:companies(name)")
    .eq("id", id)
    .single()

  if (!rawData) return { title: "Job — Hireoven" }
  const data = rawData as unknown as Pick<Job, "title" | "location" | "is_remote"> & { company: { name: string } | null }
  const companyName = data.company?.name ?? ""

  return {
    title: `${data.title} at ${companyName} — Hireoven`,
    description: `Apply for ${data.title} at ${companyName}. ${data.is_remote ? "Remote." : data.location ?? ""} See this job fresh on Hireoven.`,
    openGraph: {
      title: `${data.title} at ${companyName}`,
      description: `${data.is_remote ? "Remote · " : ""}Apply fresh on Hireoven`,
      type: "website",
    },
  }
}

export default async function PublicJobPage({ params }: Props) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: rawJob, error } = await supabase
    .from("jobs")
    .select("*, company:companies(*)")
    .eq("id", id)
    .single()

  if (error || !rawJob) notFound()

  const job = rawJob as unknown as Job & { company: Company | null }
  const company = job.company
  const skills: string[] = job.skills ?? []

  function sincePosted(ts: string) {
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
    if (mins < 60) return `${mins} minutes ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`
    const days = Math.floor(hrs / 24)
    return `${days} day${days === 1 ? "" : "s"} ago`
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <main className="mx-auto max-w-3xl px-6 py-12">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-gray-400">
          <Link href="/companies" className="hover:text-gray-600">Companies</Link>
          {" / "}
          <Link href={`/companies/${company?.id}`} className="hover:text-gray-600">
            {company?.name}
          </Link>
          {" / "}
          <span className="text-gray-600">{job.title}</span>
        </nav>

        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          {company?.logo_url ? (
            <Image
              src={company.logo_url}
              alt={company.name}
              width={56}
              height={56}
              className="rounded-xl border border-gray-200 object-contain flex-shrink-0"
            />
          ) : (
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-[#E0F2FE] text-lg font-bold text-[#0C4A6E]">
              {company?.name?.charAt(0).toUpperCase() ?? "?"}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">{company?.name}</p>
            <h1 className="mt-0.5 text-2xl font-bold text-gray-900">{job.title}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {[
                job.is_remote ? "Remote" : job.location,
                job.seniority_level ? job.seniority_level.charAt(0).toUpperCase() + job.seniority_level.slice(1) : null,
                job.employment_type === "fulltime" ? "Full-time" : job.employment_type,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 mb-6">
          {job.sponsors_h1b && (
            <span className="rounded-full bg-sky-50 border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-700">
              Sponsors H1B
            </span>
          )}
          {job.salary_min && job.salary_max && (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              ${Math.round(job.salary_min / 1000)}k–${Math.round(job.salary_max / 1000)}k
            </span>
          )}
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
            Detected {sincePosted(job.first_detected_at)}
          </span>
        </div>

        {/* Skills */}
        {skills.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span key={skill} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                {skill}
              </span>
            ))}
          </div>
        )}

        {/* Description */}
        {job.description && (
          <div className="mb-8 rounded-2xl border border-gray-100 bg-gray-50 p-6 text-sm leading-7 text-gray-700 whitespace-pre-line">
            {job.description}
          </div>
        )}

        {/* Apply CTA */}
        <div className="flex flex-col sm:flex-row gap-3 mb-10">
          <AutofillButton jobId={job.id} size="default" className="justify-center" />
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0369A1] px-6 py-3 text-sm font-semibold text-white hover:bg-[#075985] transition"
          >
            Apply directly at {company?.name} →
          </a>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#BAE6FD] bg-[#F0F9FF] px-6 py-3 text-sm font-semibold text-[#0369A1] hover:bg-[#E0F2FE] transition"
          >
            Create a free account for alerts like this
          </Link>
        </div>

        <p className="text-xs text-gray-400 text-center">
          This listing is sourced directly from {company?.name}&apos;s careers page and links there directly.
        </p>
      </main>
    </div>
  )
}

import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { notFound } from "next/navigation"
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin"
import { AutofillButton } from "@/components/autofill/AutofillButton"
import Navbar from "@/components/layout/Navbar"
import type { Company, Job } from "@/types"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!hasSupabaseAdminEnv()) return { title: "Job — Hireoven" }
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
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        {/* Breadcrumb */}
        <nav className="mb-8 text-sm text-muted-foreground">
          <Link href="/companies" className="transition-colors hover:text-strong">Companies</Link>
          {" / "}
          <Link href={`/companies/${company?.id}`} className="transition-colors hover:text-strong">
            {company?.name}
          </Link>
          {" / "}
          <span className="text-strong">{job.title}</span>
        </nav>

        <div className="surface-panel rounded-lg p-6 sm:p-8">
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-border pb-6">
          {company?.logo_url ? (
            <Image
              src={company.logo_url}
              alt={company.name}
              width={56}
              height={56}
              className="rounded-md border border-border object-contain flex-shrink-0"
            />
          ) : (
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-md border border-border bg-brand-tint text-lg font-bold text-brand-navy">
              {company?.name?.charAt(0).toUpperCase() ?? "?"}
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{company?.name}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-strong">{job.title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {[
                job.is_remote ? "Remote" : job.location,
                job.seniority_level ? job.seniority_level.charAt(0).toUpperCase() + job.seniority_level.slice(1) : null,
                job.employment_type === "fulltime" ? "Full-time" : job.employment_type,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 py-6">
          {job.sponsors_h1b && (
            <span className="rounded border border-border bg-surface-alt px-2.5 py-1 text-xs font-semibold text-brand-navy">
              Sponsors H1B
            </span>
          )}
          {job.salary_min && job.salary_max && (
            <span className="rounded border border-border bg-surface-muted px-2.5 py-1 text-xs font-medium tabular-nums text-strong">
              ${Math.round(job.salary_min / 1000)}k–${Math.round(job.salary_max / 1000)}k
            </span>
          )}
          <span className="rounded border border-border bg-surface-alt px-2.5 py-1 text-xs font-medium text-muted-foreground">
            Detected {sincePosted(job.first_detected_at)}
          </span>
        </div>

        {/* Skills */}
        {skills.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-1.5 border-b border-border pb-6">
            {skills.map((skill) => (
              <span key={skill} className="rounded border border-border bg-surface-alt px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {skill}
              </span>
            ))}
          </div>
        )}

        {/* Description */}
        {job.description && (
          <div className="mb-8 border border-border bg-surface-alt/50 p-5 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
            {job.description}
          </div>
        )}

        {/* Apply CTA */}
        <div className="flex flex-col gap-2.5 border-t border-border pt-6 sm:flex-row sm:flex-wrap sm:gap-3">
          <AutofillButton jobId={job.id} size="default" className="justify-center" />
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Apply directly at {company?.name} →
          </a>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-tint"
          >
            Create a free account for alerts like this
          </Link>
        </div>

        <p className="mt-8 border-t border-border pt-6 text-center text-xs text-muted-foreground">
          This listing is sourced directly from {company?.name}&apos;s careers page and links there directly.
        </p>
        </div>
      </main>
    </div>
  )
}

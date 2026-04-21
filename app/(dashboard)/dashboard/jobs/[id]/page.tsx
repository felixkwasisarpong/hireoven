import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ExternalLink, MapPin } from "lucide-react"
import { AutofillButton } from "@/components/autofill/AutofillButton"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { createClient } from "@/lib/supabase/server"
import type { Company, Job } from "@/types"

type Props = { params: Promise<{ id: string }> }

function formatEmploymentLabel(value: Job["employment_type"]) {
  if (!value) return null
  if (value === "fulltime") return "Full-time"
  if (value === "parttime") return "Part-time"
  if (value === "internship") return "Internship"
  if (value === "contract") return "Contract"
  return value
}

function formatSeniorityLabel(value: Job["seniority_level"]) {
  if (!value) return null
  if (value === "staff") return "Staff+"
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatDetectedTime(value: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function formatSalaryRange(job: Job) {
  if (job.salary_min == null || job.salary_max == null) return null
  const sym =
    job.salary_currency === "USD" || !job.salary_currency ? "$" : `${job.salary_currency} `
  return `${sym}${Math.round(job.salary_min / 1000)}k–${sym}${Math.round(job.salary_max / 1000)}k`
}

export default async function DashboardJobDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: rawJob, error } = await supabase
    .from("jobs")
    .select("*, company:companies(*)")
    .eq("id", id)
    .eq("is_active", true)
    .single()

  if (error || !rawJob) notFound()

  const job = rawJob as unknown as Job & { company: Company | null }
  const company = job.company
  const salaryLabel = formatSalaryRange(job)
  const details = [
    job.is_remote ? "Remote" : job.location,
    formatSeniorityLabel(job.seniority_level),
    formatEmploymentLabel(job.employment_type),
    salaryLabel,
  ].filter(Boolean) as string[]

  return (
    <main className="app-page">
      <div className="app-shell max-w-5xl space-y-5">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-strong"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to jobs
        </Link>

        <section className="surface-panel rounded-lg p-5 sm:p-7">
          <div className="flex items-start gap-4 border-b border-border pb-5">
            <CompanyLogo
              companyName={company?.name ?? "Company"}
              domain={company?.domain ?? null}
              logoUrl={company?.logo_url ?? null}
              className="h-14 w-14"
            />

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {company?.name ?? "Unknown company"}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-strong">
                {job.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {details.map((item) => (
                  <span
                    key={item}
                    className="rounded border border-border bg-surface-alt px-2 py-0.5 text-xs font-medium text-strong"
                  >
                    {item}
                  </span>
                ))}
                {!job.is_remote && job.location && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {job.location}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border py-4">
            <span className="rounded border border-border bg-surface-alt px-2.5 py-1 text-xs font-medium text-muted-foreground">
              Detected {formatDetectedTime(job.first_detected_at)}
            </span>
            {job.sponsors_h1b && (
              <span className="rounded border border-border bg-surface-alt px-2.5 py-1 text-xs font-semibold text-brand-navy">
                Sponsors H1B
              </span>
            )}
            {job.requires_authorization && (
              <span className="rounded border border-danger/30 bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger">
                No sponsorship
              </span>
            )}
          </div>

          {job.skills?.length ? (
            <div className="flex flex-wrap gap-1.5 border-b border-border py-4">
              {job.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded border border-border bg-surface-alt px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  {skill}
                </span>
              ))}
            </div>
          ) : null}

          <div className="py-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Job Description
            </h2>
            {job.description ? (
              <div className="rounded border border-border bg-surface-alt/50 p-4 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                {job.description}
              </div>
            ) : (
              <div className="rounded border border-border bg-surface-alt/50 p-4 text-sm text-muted-foreground">
                Description is still being fetched from the source posting. Run the description backfill job to refresh this record.
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:flex-wrap">
            <AutofillButton jobId={job.id} size="default" className="justify-center" />
            <Link
              href={`/dashboard/cover-letter/${job.id}`}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-strong transition-colors hover:bg-surface-alt"
            >
              Write cover letter
            </Link>
            <a
              href={job.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Apply directly
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </section>
      </div>
    </main>
  )
}

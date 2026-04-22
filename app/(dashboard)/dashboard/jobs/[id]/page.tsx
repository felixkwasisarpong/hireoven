import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Briefcase, ExternalLink, MapPin } from "lucide-react"
import { AutofillButton } from "@/components/autofill/AutofillButton"
import JobDetailSidebar from "@/components/jobs/JobDetailSidebar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { cleanJobTitle } from "@/lib/crawler/normalizer"
import { parseJobDescriptionSections } from "@/lib/jobs/description"
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
  const displayTitle = cleanJobTitle(job.title)
  const salaryLabel = formatSalaryRange(job)
  const descriptionSections = parseJobDescriptionSections(job.description)
  const details = [
    job.is_remote ? "Remote" : null,
    formatSeniorityLabel(job.seniority_level),
    formatEmploymentLabel(job.employment_type),
    salaryLabel,
  ].filter(Boolean) as string[]

  return (
    <main className="app-page">
      <div className="app-shell max-w-7xl space-y-5">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-strong"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to jobs
        </Link>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="surface-panel rounded-lg p-5 sm:p-7">
            <div className="border-b border-border pb-6">
              <div className="flex items-start gap-4">
                <CompanyLogo
                  companyName={company?.name ?? "Company"}
                  domain={company?.domain ?? null}
                  logoUrl={company?.logo_url ?? null}
                  className="h-16 w-16"
                />

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {company?.name ?? "Unknown company"}
                  </p>
                  <h1 className="mt-1 text-3xl font-semibold tracking-tight text-strong">
                    {displayTitle}
                  </h1>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                    {job.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {job.location}
                      </span>
                    ) : null}
                    {formatEmploymentLabel(job.employment_type) ? (
                      <span className="inline-flex items-center gap-1">
                        <Briefcase className="h-4 w-4" />
                        {formatEmploymentLabel(job.employment_type)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {details.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-border bg-surface-alt px-2.5 py-1 text-xs font-medium text-strong"
                      >
                        {item}
                      </span>
                    ))}
                    <span className="rounded-full border border-border bg-surface-alt px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      Detected {formatDetectedTime(job.first_detected_at)}
                    </span>
                    {job.sponsors_h1b && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        H1B Sponsorship Available
                      </span>
                    )}
                    {job.requires_authorization && (
                      <span className="rounded-full border border-danger/30 bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger">
                        U.S. work authorization required
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {job.skills?.length ? (
              <div className="flex flex-wrap gap-1.5 border-b border-border py-5">
                {job.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full border border-border bg-surface-alt px-2.5 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="space-y-6 py-5">
              <div>
                <h2 className="text-xl font-semibold text-strong">Job Details</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Review the role, key expectations, and qualifications before you apply.
                </p>
              </div>

              {descriptionSections.length > 0 ? (
                <div className="space-y-6">
                  {descriptionSections.map((section, index) => (
                    <section key={`${section.heading ?? "section"}-${index}`} className="space-y-3">
                      {section.heading ? (
                        <h3 className="text-lg font-semibold text-strong">{section.heading}</h3>
                      ) : null}

                      {section.paragraphs.map((paragraph, paragraphIndex) => (
                        <p
                          key={`p-${paragraphIndex}`}
                          className="text-sm leading-7 text-muted-foreground"
                        >
                          {paragraph}
                        </p>
                      ))}

                      {section.bullets.length > 0 ? (
                        <ul className="space-y-2 pl-5 text-sm leading-7 text-muted-foreground">
                          {section.bullets.map((bullet, bulletIndex) => (
                            <li key={`${index}-${bulletIndex}`} className="list-disc">
                              {bullet}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  ))}
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

          <JobDetailSidebar
            jobId={job.id}
            companyName={company?.name ?? "Company"}
            applyUrl={job.apply_url}
            salaryLabel={salaryLabel}
            sponsorsH1b={job.sponsors_h1b}
            sponsorshipScore={job.sponsorship_score}
            skills={job.skills ?? []}
          />
        </div>
      </div>
    </main>
  )
}

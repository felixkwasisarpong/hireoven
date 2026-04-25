import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { notFound } from "next/navigation"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { AutofillButton } from "@/components/autofill/AutofillButton"
import Navbar from "@/components/layout/Navbar"
import {
  resolveJobNormalization,
  type PersistedJobForNormalization,
} from "@/lib/jobs/normalization"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import type { Company, Job } from "@/types"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!hasPostgresEnv()) return { title: "Job - Hireoven" }
  const { id } = await params
  const pool = getPostgresPool()
  const { rows } = await pool.query<{
    title: string
    location: string | null
    is_remote: boolean
    company_name: string | null
  }>(
    `SELECT j.title, j.location, j.is_remote, c.name AS company_name
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE j.id = $1::uuid AND ${sqlJobLocatedInUsa("j")}
     LIMIT 1`,
    [id]
  )
  const data = rows[0]
  if (!data) return { title: "Job - Hireoven" }
  const companyName = data.company_name ?? ""

  return {
    title: `${data.title} at ${companyName} - Hireoven`,
    description: `Apply for ${data.title} at ${companyName}. ${data.is_remote ? "Remote." : (data.location ?? "")} See this job fresh on Hireoven.`,
    openGraph: {
      title: `${data.title} at ${companyName}`,
      description: `${data.is_remote ? "Remote · " : ""}Apply fresh on Hireoven`,
      type: "website",
    },
  }
}

export default async function PublicJobPage({ params }: Props) {
  if (!hasPostgresEnv()) notFound()

  const { id } = await params
  const pool = getPostgresPool()

  const jobResult = await pool.query<Job>(
    `SELECT * FROM jobs WHERE id = $1::uuid AND ${sqlJobLocatedInUsa("jobs")} LIMIT 1`,
    [id]
  )
  const jobRow = jobResult.rows[0]
  if (!jobRow) notFound()

  const companyResult = jobRow.company_id
    ? await pool.query<Company>(`SELECT * FROM companies WHERE id = $1::uuid LIMIT 1`, [
        jobRow.company_id,
      ])
    : { rows: [] as Company[] }

  const company = companyResult.rows[0] ?? null
  const job = { ...jobRow, company } as Job & { company: Company | null }

  const normalized = resolveJobNormalization(
    job as unknown as PersistedJobForNormalization
  )
  const page = normalized.pageView

  const topSections = [
    page.sections.about_role,
    page.sections.responsibilities,
    page.sections.requirements,
    page.sections.preferred_qualifications,
    page.sections.benefits,
    page.sections.company_info,
  ].filter((section) => section.items.length > 0)

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        <nav className="mb-8 text-sm text-muted-foreground">
          <Link href="/companies" className="transition-colors hover:text-strong">Companies</Link>
          {" / "}
          {company?.id ? (
            <Link href={`/companies/${company.id}`} className="transition-colors hover:text-strong">
              {company.name}
            </Link>
          ) : (
            <span>Company</span>
          )}
          {" / "}
          <span className="text-strong">{page.title}</span>
        </nav>

        <div className="surface-panel rounded-lg p-6 sm:p-8">
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
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-strong">{page.title}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {[
                  page.location,
                  page.seniority_label,
                  page.employment_label,
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 py-6">
            <span className="rounded border border-border bg-surface-alt px-2.5 py-1 text-xs font-semibold text-brand-navy">
              {page.sponsorship_label}
            </span>
            {page.salary_label && (
              <span className="rounded border border-border bg-surface-muted px-2.5 py-1 text-xs font-medium tabular-nums text-strong">
                {page.salary_label}
              </span>
            )}
            {page.posted_at_label && (
              <span className="rounded border border-border bg-surface-alt px-2.5 py-1 text-xs font-medium text-muted-foreground">
                Detected {page.posted_at_label}
              </span>
            )}
          </div>

          {page.skills.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-1.5 border-b border-border pb-6">
              {page.skills.map((skill) => (
                <span key={skill} className="rounded border border-border bg-surface-alt px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {skill}
                </span>
              ))}
            </div>
          )}

          {topSections.length > 0 ? (
            <div className="space-y-6">
              {topSections.map((section) => (
                <section key={section.key} className="rounded-lg border border-border bg-surface-alt/50 p-5">
                  <h2 className="text-base font-semibold text-strong">{section.label}</h2>
                  <ul className="mt-3 space-y-2">
                    {section.items.map((item) => (
                      <li key={item} className="text-sm leading-relaxed text-muted-foreground">
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="mb-8 border border-border bg-surface-alt/50 p-5 text-sm leading-relaxed text-muted-foreground">
              Full role details are still being normalized from the source posting.
            </div>
          )}

          <div className="mt-8 flex flex-col gap-2.5 border-t border-border pt-6 sm:flex-row sm:flex-wrap sm:gap-3">
            <AutofillButton jobId={job.id} size="default" className="justify-center" />
            <a
              href={page.apply_url}
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
            {company?.id ? (
              <Link
                href={`/companies/${company.id}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-tint"
              >
                View {company.name} immigration profile
              </Link>
            ) : null}
          </div>

          <p className="mt-8 border-t border-border pt-6 text-center text-xs text-muted-foreground">
            This listing is sourced directly from {company?.name}&apos;s careers page and normalized into a canonical job model.
          </p>
        </div>
      </main>
    </div>
  )
}

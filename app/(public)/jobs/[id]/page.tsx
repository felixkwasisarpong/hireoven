import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { AutofillButton } from "@/components/autofill/AutofillButton"
import CompanyLogo from "@/components/ui/CompanyLogo"
import Navbar from "@/components/layout/Navbar"
import {
  deriveAboutRoleParagraphs,
  resolveJobNormalization,
  type PersistedJobForNormalization,
} from "@/lib/jobs/normalization"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import StayScorePanel from "@/components/stay/StayScorePanel"
import OutcomeReporter from "@/components/stay/OutcomeReporter"
import { computeStayScore } from "@/lib/stay/stay-score"
import { getOutcomeSummary } from "@/lib/stay/outcomes"
import { siteBaseUrl } from "@/lib/seo/site-url"
import type { Company, Job } from "@/types"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ id: string }> }
type PublicJobRow = Job & {
  posted_at?: string | null
  closed_at?: string | null
}

const EMPLOYMENT_TYPE_SCHEMA: Partial<Record<NonNullable<Job["employment_type"]>, string>> = {
  fulltime: "FULL_TIME",
  parttime: "PART_TIME",
  contract: "CONTRACTOR",
  internship: "INTERN",
}

function isoDate(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function plainText(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim()
  return text ? text.slice(0, 5000) : undefined
}

function htmlEscape(value: string): string {
  return value.replace(
    /[<>&'"]/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&#39;",
        '"': "&quot;",
      })[char] ?? char,
  )
}

function jobPostingDescriptionHtml(
  sections: Array<{ label: string; items: string[] }>,
  fallback: string | null | undefined,
): string {
  const blocks = sections
    .map((section) => {
      const items = section.items.map((item) => item.trim()).filter(Boolean)
      if (items.length === 0) return null
      return (
        `<p>${htmlEscape(section.label)}</p>` +
        `<ul>${items.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul>`
      )
    })
    .filter(Boolean)

  if (blocks.length > 0) return blocks.join("")
  return `<p>${htmlEscape(plainText(fallback) ?? "Full role details are available on Hireoven.")}</p>`
}

function locationAddress(location: string | null | undefined) {
  const clean = location?.replace(/\s+/g, " ").trim()
  if (!clean || /^remote$/i.test(clean)) return undefined
  const parts = clean.split(",").map((part) => part.trim()).filter(Boolean)
  return {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      addressLocality: parts[0] ?? clean,
      ...(parts[1] ? { addressRegion: parts[1] } : {}),
      addressCountry: "US",
    },
  }
}

function baseSalary(job: PublicJobRow) {
  if (job.salary_min == null && job.salary_max == null) return undefined
  const currency = job.salary_currency?.trim() || "USD"
  const value =
    job.salary_min != null && job.salary_max != null
      ? { "@type": "QuantitativeValue", minValue: job.salary_min, maxValue: job.salary_max, unitText: "YEAR" }
      : { "@type": "QuantitativeValue", value: job.salary_min ?? job.salary_max, unitText: "YEAR" }

  return {
    "@type": "MonetaryAmount",
    currency,
    value,
  }
}

function absoluteUrl(value: string | null | undefined, base: string): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value, base).toString()
  } catch {
    return undefined
  }
}

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
     WHERE j.id = $1::uuid
       AND ${sqlPublishedJob("j")}
       AND ${sqlJobLocatedInUsa("j", { companyAlias: "c" })}
     LIMIT 1`,
    [id]
  )
  const data = rows[0]
  if (!data) return { title: "Job - Hireoven" }
  const companyName = data.company_name ?? ""
  const appUrl = siteBaseUrl()
  const canonicalUrl = `${appUrl}/jobs/${id}`
  const ogImageUrl = `${appUrl}/api/og/job/${id}`
  const locationStr = data.is_remote ? "Remote" : (data.location ?? "")
  const companyPart = companyName ? ` at ${companyName}` : ""

  return {
    title: `${data.title}${companyPart} - Hireoven`,
    description: `${data.title}${companyPart}${locationStr ? ` · ${locationStr}` : ""}. Fresh on Hireoven — see it before the crowd.`,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${data.title}${companyPart}`,
      description: `${locationStr ? `${locationStr} · ` : ""}Fresh job on Hireoven`,
      type: "website",
      url: canonicalUrl,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: `${data.title}${companyPart}` }],
      siteName: "Hireoven",
    },
    twitter: {
      card: "summary_large_image",
      title: `${data.title}${companyPart}`,
      description: `${locationStr ? `${locationStr} · ` : ""}Fresh job on Hireoven`,
      images: [ogImageUrl],
    },
  }
}

export default async function PublicJobPage({ params }: Props) {
  if (!hasPostgresEnv()) notFound()

  const { id } = await params
  const pool = getPostgresPool()

  const jobResult = await pool.query<PublicJobRow>(
    `SELECT jobs.*
     FROM jobs
     LEFT JOIN companies ON companies.id = jobs.company_id
     WHERE jobs.id = $1::uuid
       AND ${sqlPublishedJob("jobs")}
       AND ${sqlJobLocatedInUsa("jobs", { companyAlias: "companies" })}
     LIMIT 1`,
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
  const job = { ...jobRow, company } as PublicJobRow & { company: Company | null }

  // Per-job Stay Score — the survival-odds reframe, computed from this role's
  // salary + this employer's real sponsorship / cap-exempt signals.
  const capExemptCompany = company as (Company & { is_cap_exempt?: boolean | null }) | null
  const staySalary =
    jobRow.salary_min && jobRow.salary_max
      ? Math.round((jobRow.salary_min + jobRow.salary_max) / 2)
      : jobRow.salary_max ?? jobRow.salary_min ?? null
  const stayScore = computeStayScore({
    capExempt: capExemptCompany?.is_cap_exempt ?? null,
    sponsorsH1b: company?.sponsors_h1b ?? null,
    sponsorshipScore: company?.sponsorship_confidence ?? null,
    recentLcaCount: company?.h1b_sponsor_count_1yr ?? null,
    priorLcaCount: company?.h1b_sponsor_count_3yr ?? null,
    salary: staySalary,
    isStem: true,
  })
  const outcomeSummary = company
    ? await getOutcomeSummary({ companyId: company.id, employerName: company.name })
    : null

  const normalized = resolveJobNormalization(
    job as unknown as PersistedJobForNormalization
  )
  const page = normalized.pageView

  const aboutItems = deriveAboutRoleParagraphs(
    page.sections.about_role.items,
    page.clean_description
  )

  const aboutSection =
    aboutItems.length > 0
      ? { ...page.sections.about_role, items: aboutItems }
      : null

  // The view-model folds `qualifications` into `requirements`, so we don't
  // render it separately. Compensation comes before benefits — salary is the
  // highest-signal section after the role summary.
  const topSections = [
    aboutSection,
    page.sections.responsibilities,
    page.sections.requirements,
    page.sections.preferred_qualifications,
    page.sections.skills,
    page.sections.compensation,
    page.sections.benefits,
    page.sections.company_info,
    page.sections.equal_opportunity,
    page.sections.visa,
  ].filter((section): section is NonNullable<typeof section> =>
    Boolean(section && section.items.length > 0)
  )

  const base = siteBaseUrl()
  const canonicalUrl = `${base}/jobs/${job.id}`
  const description =
    plainText(page.clean_description) ??
    plainText(topSections.flatMap((section) => section.items).join(" ")) ??
    `${page.title}${company?.name ? ` at ${company.name}` : ""}.`
  const jobPostingDescription = jobPostingDescriptionHtml(
    topSections.map((section) => ({ label: section.label, items: section.items })),
    page.clean_description,
  )
  const address = locationAddress(page.location ?? job.location)
  const salaryJsonLd = baseSalary(job)
  const companyLogoUrl = absoluteUrl(company?.logo_url, base)
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: page.title,
    description: jobPostingDescription,
    identifier: {
      "@type": "PropertyValue",
      name: company?.name ?? "Hireoven",
      value: job.external_id ?? job.id,
    },
    datePosted: isoDate(job.posted_at ?? job.first_detected_at),
    url: canonicalUrl,
    directApply: false,
    hiringOrganization: {
      "@type": "Organization",
      name: company?.name ?? "Company",
      ...(company?.domain ? { sameAs: `https://${company.domain}` } : {}),
      ...(companyLogoUrl ? { logo: companyLogoUrl } : {}),
    },
    ...(job.employment_type ? { employmentType: EMPLOYMENT_TYPE_SCHEMA[job.employment_type] ?? job.employment_type } : {}),
    ...(job.is_remote ? { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "United States" } } : {}),
    ...(address ? { jobLocation: address } : {}),
    ...(salaryJsonLd ? { baseSalary: salaryJsonLd } : {}),
  }

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        <nav className="mb-8 text-[12.5px] text-[#ccd6cf]/45">
          <Link href="/companies" className="transition-colors hover:text-[#38e08a]">Companies</Link>
          {" / "}
          {company?.id ? (
            <Link href={`/companies/${company.id}`} className="transition-colors hover:text-[#38e08a]">
              {company.name}
            </Link>
          ) : (
            <span>Company</span>
          )}
          {" / "}
          <span className="text-[#ccd6cf]/80">{page.title}</span>
        </nav>

        <div className="term-panel p-6 sm:p-8">
          <div className="flex items-start gap-4 border-b border-[rgba(120,200,160,0.12)] pb-6">
            <CompanyLogo
              companyName={company?.name ?? "Company"}
              domain={company?.domain}
              logoUrl={company?.logo_url}
              className="h-14 w-14 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]"
            />
            <div>
              <p className="text-[11px] font-medium tracking-wide text-[#ccd6cf]/55">{company?.name}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">{page.title}</h1>
              <p className="mt-1.5 text-[13px] text-[#ccd6cf]/55">
                {[
                  page.location,
                  page.seniority_label,
                  page.employment_label,
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 py-6">
            <span className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-2.5 py-1 text-xs font-semibold text-[#ccd6cf]/80">
              {page.sponsorship_label}
            </span>
            {page.salary_label && (
              <span className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-2.5 py-1 text-xs font-semibold tabular-nums text-[#38e08a]">
                {page.salary_label}
              </span>
            )}
            {page.posted_at_label && (
              <span className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-2.5 py-1 text-xs font-medium text-[#ccd6cf]/55">
                Detected {page.posted_at_label}
              </span>
            )}
          </div>

          {page.skills.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-1.5 border-b border-[rgba(120,200,160,0.12)] pb-6">
              {page.skills.map((skill) => (
                <span key={skill} className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-2 py-0.5 text-[11px] font-medium text-[#ccd6cf]/65">
                  {skill}
                </span>
              ))}
            </div>
          )}

          <div className="mb-6">
            <StayScorePanel result={stayScore} />
            {company && (
              <OutcomeReporter
                companyId={company.id}
                employerName={company.name}
                wageLevel={stayScore.lottery?.level ?? null}
                initialSummary={outcomeSummary}
              />
            )}
          </div>

          {topSections.length > 0 ? (
            <div className="space-y-6">
              {topSections.map((section) => (
                <section key={section.key} className="border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-5">
                  <h2 className="text-base font-semibold text-white">{section.label}</h2>
                  <ul className="mt-3 space-y-2">
                    {section.items.map((item) => (
                      <li key={item} className="text-[13px] leading-relaxed text-[#ccd6cf]/65">
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="mb-8 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-5 text-[13px] leading-relaxed text-[#ccd6cf]/65">
              Full role details are still being normalized from the source posting.
            </div>
          )}

          <div className="mt-8 flex flex-col gap-2.5 border-t border-[rgba(120,200,160,0.12)] pt-6 sm:flex-row sm:flex-wrap sm:gap-3">
            <AutofillButton jobId={job.id} size="default" className="justify-center" />
            <a
              href={page.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              className="term-btn term-btn-amber justify-center"
            >
              Apply directly at {company?.name} →
            </a>
            <Link
              href="/signup?next=%2Fdashboard%2Fonboarding"
              className="term-btn justify-center"
            >
              Create a free account for alerts like this
            </Link>
            {company?.id ? (
              <Link
                href={`/companies/${company.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="term-btn justify-center"
              >
                View {company.name} immigration profile
              </Link>
            ) : null}
          </div>

          <p className="mt-8 border-t border-[rgba(120,200,160,0.12)] pt-6 text-center text-xs text-[#ccd6cf]/45">
            This listing is sourced directly from {company?.name}&apos;s careers page and normalized into a canonical job model.
          </p>
        </div>
      </main>
    </div>
  )
}

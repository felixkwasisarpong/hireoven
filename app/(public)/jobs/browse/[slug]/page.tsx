import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, Briefcase } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import PublicJobList from "@/components/jobs/PublicJobList"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import {
  JOB_COLLECTIONS,
  allCollectionSlugs,
  countCollection,
  getCollection,
  listCollection,
  type JobCollection,
} from "@/lib/jobs/collections"

// SEO landing pages — ISR hourly so counts stay fresh without rebuilding per
// request. dynamicParams stays true so a newly-added slug still renders.
export const revalidate = 3600
export const dynamicParams = true

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

type Props = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return allCollectionSlugs().map((slug) => ({ slug }))
}

function fill(template: string, count: number): string {
  return template.replace(/\{count\}/g, count.toLocaleString("en-US"))
}

// Up to 4 sibling collections (prefer same kind) for internal linking.
function relatedCollections(current: JobCollection): JobCollection[] {
  const sameKind = JOB_COLLECTIONS.filter((c) => c.kind === current.kind && c.slug !== current.slug)
  const others = JOB_COLLECTIONS.filter((c) => c.kind !== current.kind && c.slug !== current.slug)
  return [...sameKind, ...others].slice(0, 6)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const collection = getCollection(slug)
  if (!collection) return { title: "Jobs — Hireoven" }

  const count = hasPostgresEnv() ? await countCollection(getPostgresPool(), collection) : 0

  const title = fill(collection.seoTitle, count)
  const description = fill(collection.seoDescription, count)
  const canonical = `${BASE}/jobs/browse/${collection.slug}`

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title: collection.h1, description, type: "website" },
    twitter: { card: "summary_large_image", title: collection.h1, description },
  }
}

export default async function JobCollectionPage({ params }: Props) {
  const { slug } = await params
  const collection = getCollection(slug)
  if (!collection) notFound()

  if (!hasPostgresEnv()) notFound()
  const { total, jobs } = await listCollection(getPostgresPool(), collection, 50)
  if (total === 0) notFound()

  const related = relatedCollections(collection)

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: collection.h1,
    numberOfItems: total,
    itemListElement: jobs.slice(0, 50).map((j, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: j.title,
      url: `${BASE}/jobs/${j.id}`,
    })),
  }

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <nav className="text-[12.5px] text-[#ccd6cf]/45">
          <Link href="/jobs/browse" className="hover:text-[#38e08a]">
            Browse jobs
          </Link>{" "}
          / <span className="text-[#ccd6cf]/70">{collection.label}</span>
        </nav>

        <header className="mt-4 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-xs font-semibold text-[#ccd6cf]/80">
            <Briefcase className="h-3.5 w-3.5 text-[#f5a623]" /> <span className="tabular-nums text-[#38e08a]">{total.toLocaleString("en-US")}</span> live roles
          </span>
          <h1 className="mt-4 text-[1.9rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[2.3rem]">
            {collection.h1}
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[#ccd6cf]/70">{collection.tagline}</p>
        </header>

        <PublicJobList jobs={jobs} />

        {total > jobs.length && (
          <div className="mt-6">
            <Link
              href={`/signup?next=${encodeURIComponent(`/jobs/browse/${collection.slug}`)}`}
              className="term-btn term-btn-amber"
            >
              See all {total.toLocaleString("en-US")} roles &amp; set alerts <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="text-lg font-semibold text-white">Browse more</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {related.map((c) => (
                <Link
                  key={c.slug}
                  href={`/jobs/browse/${c.slug}`}
                  className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1.5 text-[12.5px] font-medium text-[#ccd6cf]/80 transition hover:border-[#38e08a] hover:text-[#38e08a]"
                >
                  {c.label} jobs
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-[#ccd6cf]/45">
          Live roles from Hireoven&apos;s continuously-updated US job index. Showing the{" "}
          {Math.min(jobs.length, total).toLocaleString("en-US")} most recent of {total.toLocaleString("en-US")}.
        </p>
      </main>
    </div>
  )
}

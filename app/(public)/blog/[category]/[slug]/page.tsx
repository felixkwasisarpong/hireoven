import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getPostBySlug } from "@/lib/blog/queries"
import Navbar from "@/components/layout/Navbar"

export const dynamic = "force-dynamic"

// Semantic per-category accents in the terminal palette: distinct-but-muted
// dark-tinted chips + a thin accent bar, kept visually separable on dark.
const CATEGORY_COLORS: Record<string, { bar: string; chip: string }> = {
  "h1b-visa-intel":     { bar: "bg-blue-400/70",    chip: "border-blue-500/25 bg-blue-500/12 text-blue-300" },
  "job-market-pulse":   { bar: "bg-violet-400/70",  chip: "border-violet-500/25 bg-violet-500/12 text-violet-300" },
  "career-strategy":    { bar: "bg-emerald-400/70", chip: "border-emerald-500/25 bg-emerald-500/12 text-emerald-300" },
  "tech-company-watch": { bar: "bg-orange-400/70",  chip: "border-orange-500/25 bg-orange-500/12 text-orange-300" },
  "interview-offers":   { bar: "bg-rose-400/70",    chip: "border-rose-500/25 bg-rose-500/12 text-rose-300" },
}

function categoryColor(slug: string) {
  return CATEGORY_COLORS[slug] ?? { bar: "bg-[#38e08a]/70", chip: "border-[rgba(120,200,160,0.2)] bg-[#0e1411] text-[#ccd6cf]/80" }
}

export async function generateMetadata({ params }: { params: { category: string; slug: string } }): Promise<Metadata> {
  const post = await getPostBySlug(params.slug)
  if (!post || post.status !== "published") return {}
  return {
    title: `${post.title} | Hireoven Blog`,
    description: post.seo_description ?? post.excerpt,
    openGraph: {
      title: post.title,
      description: post.seo_description ?? post.excerpt,
      type: "article",
      publishedTime: post.published_at ?? undefined,
    },
  }
}

export default async function PostPage({ params }: { params: { category: string; slug: string } }) {
  const post = await getPostBySlug(params.slug)

  if (!post || post.status !== "published") notFound()

  const category = post.category!
  const c = categoryColor(category.slug)
  const date = post.published_at
    ? new Date(post.published_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null

  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      {/* Category accent bar at the very top of content */}
      <div className={`h-0.5 w-full ${c.bar}`} />

      <main className="mx-auto max-w-4xl px-5 py-12 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-8 flex items-center gap-1.5 text-sm text-[#ccd6cf]/45">
          <Link href="/blog" className="hover:text-[#38e08a] transition-colors">Blog</Link>
          <span>/</span>
          <Link href={`/blog/${category.slug}`} className="hover:text-[#38e08a] transition-colors">{category.name}</Link>
        </nav>

        <article>
          <header className="mb-10">
            <span className={`inline-block border px-2.5 py-0.5 text-xs font-semibold ${c.chip}`}>
              {category.name}
            </span>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
              {post.title}
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-[#ccd6cf]/70">{post.excerpt}</p>
            <div className="mt-5 flex items-center gap-3 border-t border-[rgba(120,200,160,0.2)] pt-5 text-sm text-[#ccd6cf]/45">
              {date && <span>{date}</span>}
              {post.reading_time && (
                <>
                  <span className="text-[#ccd6cf]/25">·</span>
                  <span>{post.reading_time} min read</span>
                </>
              )}
              <span className="text-[#ccd6cf]/25">·</span>
              <span>Hireoven Blog</span>
            </div>
          </header>

          {post.hero_image_url && (
            <div className="mb-10 overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]">
              <div className="relative aspect-[3/2] w-full sm:aspect-[16/9]">
                <Image
                  src={post.hero_image_url}
                  alt={post.hero_image_alt ?? post.title}
                  fill
                  priority
                  sizes="(min-width: 768px) 42rem, 100vw"
                  className="object-cover"
                />
              </div>
            </div>
          )}

          {/* Body */}
          <div
            className="prose prose-invert max-w-none
              prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-white
              prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-3
              prose-p:text-[#ccd6cf] prose-p:leading-relaxed
              prose-li:text-[#ccd6cf] prose-li:leading-relaxed
              prose-ul:my-4 prose-ul:space-y-1
              prose-strong:text-white prose-strong:font-semibold
              prose-a:text-[#f5a623] prose-a:no-underline hover:prose-a:underline"
            dangerouslySetInnerHTML={{ __html: post.body }}
          />
        </article>

        {/* Footer nav */}
        <div className="mt-14 flex items-center justify-between border-t border-[rgba(120,200,160,0.2)] pt-8">
          <Link
            href={`/blog/${category.slug}`}
            className="text-sm font-semibold text-[#ccd6cf]/70 hover:text-white transition-colors"
          >
            ← More in {category.name}
          </Link>
          <Link
            href="/blog"
            className="text-sm font-semibold text-[#ccd6cf]/70 hover:text-white transition-colors"
          >
            All posts →
          </Link>
        </div>
      </main>
    </div>
  )
}

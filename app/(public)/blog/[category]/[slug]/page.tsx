import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getPostBySlug } from "@/lib/blog/queries"
import Navbar from "@/components/layout/Navbar"

export const revalidate = 3600

const CATEGORY_COLORS: Record<string, { bar: string; badge: string }> = {
  "h1b-visa-intel":     { bar: "bg-blue-500",   badge: "bg-blue-50 text-blue-700 border-blue-200" },
  "job-market-pulse":   { bar: "bg-violet-500",  badge: "bg-violet-50 text-violet-700 border-violet-200" },
  "career-strategy":    { bar: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  "tech-company-watch": { bar: "bg-orange-500",  badge: "bg-orange-50 text-orange-700 border-orange-200" },
  "interview-offers":   { bar: "bg-rose-500",    badge: "bg-rose-50 text-rose-700 border-rose-200" },
}

function categoryColor(slug: string) {
  return CATEGORY_COLORS[slug] ?? { bar: "bg-gray-400", badge: "bg-gray-50 text-gray-600 border-gray-200" }
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
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* Color accent bar at the very top of content */}
      <div className={`h-1 w-full ${c.bar}`} />

      <main className="mx-auto max-w-2xl px-5 py-12 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-8 flex items-center gap-1.5 text-sm text-gray-400">
          <Link href="/blog" className="hover:text-gray-700 transition-colors">Blog</Link>
          <span>/</span>
          <Link href={`/blog/${category.slug}`} className="hover:text-gray-700 transition-colors">{category.name}</Link>
        </nav>

        <article>
          <header className="mb-10">
            <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${c.badge}`}>
              {category.name}
            </span>
            <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-gray-900 sm:text-4xl">
              {post.title}
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-gray-500">{post.excerpt}</p>
            <div className="mt-5 flex items-center gap-3 border-t border-gray-100 pt-5 text-sm text-gray-400">
              {date && <span>{date}</span>}
              {post.reading_time && (
                <>
                  <span className="text-gray-200">·</span>
                  <span>{post.reading_time} min read</span>
                </>
              )}
              <span className="text-gray-200">·</span>
              <span>Hireoven Blog</span>
            </div>
          </header>

          {/* Body */}
          <div
            className="prose prose-gray max-w-none
              prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-gray-900
              prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-3
              prose-p:text-gray-600 prose-p:leading-relaxed
              prose-li:text-gray-600 prose-li:leading-relaxed
              prose-ul:my-4 prose-ul:space-y-1
              prose-strong:text-gray-800 prose-strong:font-semibold
              prose-a:text-[#0369A1] prose-a:no-underline hover:prose-a:underline"
            dangerouslySetInnerHTML={{ __html: post.body }}
          />
        </article>

        {/* Footer nav */}
        <div className="mt-14 flex items-center justify-between border-t border-gray-100 pt-8">
          <Link
            href={`/blog/${category.slug}`}
            className="text-sm font-semibold text-gray-500 hover:text-gray-900 transition-colors"
          >
            ← More in {category.name}
          </Link>
          <Link
            href="/blog"
            className="text-sm font-semibold text-gray-500 hover:text-gray-900 transition-colors"
          >
            All posts →
          </Link>
        </div>
      </main>
    </div>
  )
}

import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { getAllCategories, getPublishedPosts } from "@/lib/blog/queries"
import Navbar from "@/components/layout/Navbar"
import type { BlogPost, BlogCategory } from "@/types/blog"

export const metadata: Metadata = {
  title: "Blog | Hireoven",
  description: "Job market intelligence, H1B sponsorship insights, career strategy, and hiring trends — updated weekly by AI research.",
}

export const dynamic = "force-dynamic"

// One accent color per category slug for visual variety
const CATEGORY_COLORS: Record<string, { bar: string; badge: string; text: string }> = {
  "h1b-visa-intel":     { bar: "bg-blue-500",   badge: "bg-blue-50 text-blue-700 border-blue-200",   text: "text-blue-700" },
  "job-market-pulse":   { bar: "bg-violet-500",  badge: "bg-violet-50 text-violet-700 border-violet-200", text: "text-violet-700" },
  "career-strategy":    { bar: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", text: "text-emerald-700" },
  "tech-company-watch": { bar: "bg-orange-500",  badge: "bg-orange-50 text-orange-700 border-orange-200", text: "text-orange-700" },
  "interview-offers":   { bar: "bg-rose-500",    badge: "bg-rose-50 text-rose-700 border-rose-200",   text: "text-rose-700" },
}

function categoryColor(slug: string) {
  return CATEGORY_COLORS[slug] ?? { bar: "bg-gray-400", badge: "bg-gray-50 text-gray-600 border-gray-200", text: "text-gray-600" }
}

function CategoryBadge({ category }: { category: BlogCategory }) {
  const c = categoryColor(category.slug)
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${c.badge}`}>
      {category.name}
    </span>
  )
}

function FeaturedCard({ post }: { post: BlogPost }) {
  const category = post.category!
  const c = categoryColor(category.slug)
  const date = post.published_at
    ? new Date(post.published_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null

  return (
    <Link
      href={`/blog/${category.slug}/${post.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
    >
      {/* Color accent band */}
      <div className={`h-1.5 w-full ${c.bar}`} />
      <div className="flex flex-1 flex-col gap-4 p-7 md:p-8">
        <div className="flex items-center gap-3">
          <CategoryBadge category={category} />
          {post.reading_time && (
            <span className="text-xs text-gray-400">{post.reading_time} min read</span>
          )}
          {date && <span className="ml-auto text-xs text-gray-400">{date}</span>}
        </div>
        <div>
          <h2 className="text-xl font-bold leading-snug text-gray-900 transition-colors group-hover:text-[#0369A1] md:text-2xl">
            {post.title}
          </h2>
          <p className="mt-3 text-base leading-relaxed text-gray-500 line-clamp-3">{post.excerpt}</p>
        </div>
        <div className={`mt-auto flex items-center gap-1.5 text-sm font-semibold ${c.text} transition-gap`}>
          Read article
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </Link>
  )
}

function PostCard({ post }: { post: BlogPost }) {
  const category = post.category!
  const c = categoryColor(category.slug)
  const date = post.published_at
    ? new Date(post.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null

  return (
    <Link
      href={`/blog/${category.slug}/${post.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
    >
      <div className={`h-1 w-full ${c.bar}`} />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <CategoryBadge category={category} />
          {post.reading_time && (
            <span className="ml-auto text-xs text-gray-400">{post.reading_time} min</span>
          )}
        </div>
        <h3 className="text-[15px] font-semibold leading-snug text-gray-900 group-hover:text-[#0369A1] transition-colors line-clamp-2">
          {post.title}
        </h3>
        <p className="text-sm leading-relaxed text-gray-500 line-clamp-2">{post.excerpt}</p>
        {date && <p className="mt-auto pt-1 text-xs text-gray-400">{date}</p>}
      </div>
    </Link>
  )
}

export default async function BlogPage() {
  const [categories, posts] = await Promise.all([getAllCategories(), getPublishedPosts(30)])

  const [featured, ...rest] = posts

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="border-b border-gray-100 bg-[linear-gradient(180deg,#0f1115_0%,#1a2035_100%)] px-6 py-14 md:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#60a5fa]">Hireoven Blog</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
            The job market, decoded.
          </h1>
          <p className="mt-4 text-lg text-gray-400">
            Weekly intelligence on H1B sponsorship, hiring trends, career strategy, and the tech job market — researched and written by AI.
          </p>
        </div>
      </section>

      {/* ── Category nav ────────────────────────────────────────────── */}
      <div className="sticky top-[60px] z-20 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-3 lg:px-8 [&::-webkit-scrollbar]:hidden">
          <Link
            href="/blog"
            className="shrink-0 rounded-full bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white transition-colors"
          >
            All posts
          </Link>
          {categories.map((cat) => {
            const c = categoryColor(cat.slug)
            return (
              <Link
                key={cat.slug}
                href={`/blog/${cat.slug}`}
                className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors hover:opacity-90 ${c.badge}`}
              >
                {cat.name}
              </Link>
            )
          })}
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-12 lg:px-8">
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 h-16 w-16 rounded-2xl bg-gray-100 flex items-center justify-center text-2xl">✍️</div>
            <p className="text-lg font-semibold text-gray-700">No posts yet</p>
            <p className="mt-1 text-sm text-gray-400">Check back soon — new posts publish every weekday.</p>
          </div>
        ) : (
          <div className="space-y-10">
            {/* Featured */}
            {featured && (
              <div>
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-400">Latest</p>
                <FeaturedCard post={featured} />
              </div>
            )}

            {/* Rest */}
            {rest.length > 0 && (
              <div>
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-400">More stories</p>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {rest.map((post) => (
                    <PostCard key={post.id} post={post} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

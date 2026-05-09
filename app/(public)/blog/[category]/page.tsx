import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getCategoryBySlug, getPublishedPostsByCategory, getAllCategories } from "@/lib/blog/queries"
import Navbar from "@/components/layout/Navbar"
import type { BlogPost, BlogCategory } from "@/types/blog"

export const revalidate = 3600

export async function generateStaticParams() {
  const categories = await getAllCategories()
  return categories.map((c) => ({ category: c.slug }))
}

export async function generateMetadata({ params }: { params: { category: string } }): Promise<Metadata> {
  const category = await getCategoryBySlug(params.category)
  if (!category) return {}
  return {
    title: `${category.name} | Hireoven Blog`,
    description: category.description,
  }
}

const CATEGORY_COLORS: Record<string, { bar: string; badge: string; text: string; hero: string }> = {
  "h1b-visa-intel":     { bar: "bg-blue-500",   badge: "bg-blue-50 text-blue-700 border-blue-200",   text: "text-blue-700",   hero: "from-blue-900 to-blue-950" },
  "job-market-pulse":   { bar: "bg-violet-500",  badge: "bg-violet-50 text-violet-700 border-violet-200", text: "text-violet-700", hero: "from-violet-900 to-violet-950" },
  "career-strategy":    { bar: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", text: "text-emerald-700", hero: "from-emerald-900 to-emerald-950" },
  "tech-company-watch": { bar: "bg-orange-500",  badge: "bg-orange-50 text-orange-700 border-orange-200", text: "text-orange-700", hero: "from-orange-900 to-orange-950" },
  "interview-offers":   { bar: "bg-rose-500",    badge: "bg-rose-50 text-rose-700 border-rose-200",   text: "text-rose-700",   hero: "from-rose-900 to-rose-950" },
}

function categoryColor(slug: string) {
  return CATEGORY_COLORS[slug] ?? { bar: "bg-gray-400", badge: "bg-gray-50 text-gray-600 border-gray-200", text: "text-gray-600", hero: "from-gray-900 to-gray-950" }
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
        <div className="flex items-center justify-between">
          {post.reading_time && (
            <span className="text-xs text-gray-400">{post.reading_time} min read</span>
          )}
          {date && <span className="text-xs text-gray-400">{date}</span>}
        </div>
        <h3 className="text-[15px] font-semibold leading-snug text-gray-900 group-hover:text-[#0369A1] transition-colors line-clamp-2">
          {post.title}
        </h3>
        <p className="text-sm leading-relaxed text-gray-500 line-clamp-3">{post.excerpt}</p>
      </div>
    </Link>
  )
}

export default async function CategoryPage({ params }: { params: { category: string } }) {
  const [category, posts, allCategories] = await Promise.all([
    getCategoryBySlug(params.category),
    getPublishedPostsByCategory(params.category, 30),
    getAllCategories(),
  ])

  if (!category) notFound()

  const c = categoryColor(category.slug)

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* Hero */}
      <section className={`border-b border-gray-100 bg-gradient-to-b ${c.hero} px-6 py-14 md:py-20`}>
        <div className="mx-auto max-w-3xl text-center">
          <Link href="/blog" className="text-xs font-semibold uppercase tracking-widest text-white/40 hover:text-white/60 transition-colors">
            ← All posts
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
            {category.name}
          </h1>
          <p className="mt-4 text-lg text-white/60">{category.description}</p>
        </div>
      </section>

      {/* Category nav */}
      <div className="sticky top-[60px] z-20 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-3 lg:px-8 [&::-webkit-scrollbar]:hidden">
          <Link
            href="/blog"
            className="shrink-0 rounded-full border border-gray-200 px-4 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50"
          >
            All posts
          </Link>
          {allCategories.map((cat) => {
            const cc = categoryColor(cat.slug)
            const active = cat.slug === params.category
            return (
              <Link
                key={cat.slug}
                href={`/blog/${cat.slug}`}
                className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors hover:opacity-90 ${active ? cc.badge + " font-semibold" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
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
            <p className="text-lg font-semibold text-gray-700">No posts yet in this category</p>
            <p className="mt-1 text-sm text-gray-400">Check back soon — new posts publish every weekday.</p>
            <Link href="/blog" className="mt-6 text-sm font-semibold text-[#0369A1] hover:underline">
              ← Browse all posts
            </Link>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

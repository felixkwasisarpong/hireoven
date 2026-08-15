import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getCategoryBySlug, getPublishedPostsByCategory, getAllCategories } from "@/lib/blog/queries"
import Navbar from "@/components/layout/Navbar"
import type { BlogPost, BlogCategory } from "@/types/blog"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: { category: string } }): Promise<Metadata> {
  const category = await getCategoryBySlug(params.category)
  if (!category) return {}
  return {
    title: `${category.name} | Hireoven Blog`,
    description: category.description,
  }
}

// Semantic per-category accents in the terminal palette: distinct-but-muted
// dark-tinted chips + a thin accent bar, kept visually separable on the dark canvas.
const CATEGORY_COLORS: Record<string, { bar: string; chip: string; accent: string }> = {
  "h1b-visa-intel":     { bar: "bg-blue-400/70",    chip: "border-blue-500/25 bg-blue-500/12 text-blue-300",       accent: "text-blue-300" },
  "job-market-pulse":   { bar: "bg-violet-400/70",  chip: "border-violet-500/25 bg-violet-500/12 text-violet-300", accent: "text-violet-300" },
  "career-strategy":    { bar: "bg-emerald-400/70", chip: "border-emerald-500/25 bg-emerald-500/12 text-emerald-300", accent: "text-emerald-300" },
  "tech-company-watch": { bar: "bg-orange-400/70",  chip: "border-orange-500/25 bg-orange-500/12 text-orange-300", accent: "text-orange-300" },
  "interview-offers":   { bar: "bg-rose-400/70",    chip: "border-rose-500/25 bg-rose-500/12 text-rose-300",       accent: "text-rose-300" },
}

function categoryColor(slug: string) {
  return CATEGORY_COLORS[slug] ?? { bar: "bg-[#38e08a]/70", chip: "border-[rgba(120,200,160,0.2)] bg-[#0e1411] text-[#ccd6cf]/80", accent: "text-[#38e08a]" }
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
      className="term-panel term-panel-hover group flex flex-col overflow-hidden"
    >
      <div className={`h-0.5 w-full ${c.bar}`} />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="relative mb-1 h-36 overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]">
          {post.hero_image_url ? (
            <Image
              src={post.hero_image_url}
              alt={post.hero_image_alt ?? post.title}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="absolute inset-0" />
          )}
        </div>
        <div className="flex items-center justify-between">
          {post.reading_time && (
            <span className="text-xs text-[#ccd6cf]/45">{post.reading_time} min read</span>
          )}
          {date && <span className="text-xs text-[#ccd6cf]/45">{date}</span>}
        </div>
        <h3 className="text-[15px] font-semibold leading-snug text-white group-hover:text-[#f5a623] transition-colors line-clamp-2">
          {post.title}
        </h3>
        <p className="text-sm leading-relaxed text-[#ccd6cf]/55 line-clamp-3">{post.excerpt}</p>
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

  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      {/* Hero — flat terminal masthead. */}
      <section className="mx-auto w-full max-w-3xl px-4 pt-12 text-center sm:px-6 sm:pt-16">
        <Link href="/blog" className="term-label hover:text-[#38e08a] transition-colors">
          ← all posts
        </Link>
        <h1 className="mt-4 text-[2.2rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[3rem]">
          {category.name}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[#ccd6cf]/70">{category.description}</p>
      </section>

      {/* Category nav */}
      <div className="sticky top-[60px] z-20 mt-10 border-y border-[rgba(120,200,160,0.26)] bg-[#0a0e0c]">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 lg:px-8 [&::-webkit-scrollbar]:hidden">
          <Link
            href="/blog"
            className="shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3.5 py-1.5 text-sm font-medium text-[#ccd6cf]/80 transition hover:border-[#38e08a] hover:text-[#38e08a]"
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
                className={`shrink-0 border px-3.5 py-1.5 text-sm font-medium transition ${active ? cc.chip + " font-semibold" : "border-[rgba(120,200,160,0.2)] bg-[#0e1411] text-[#ccd6cf]/80 hover:border-[#38e08a] hover:text-[#38e08a]"}`}
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
            <p className="text-lg font-semibold text-white">No posts yet in this category</p>
            <p className="mt-1 text-sm text-[#ccd6cf]/45">Check back soon — new posts publish every weekday.</p>
            <Link href="/blog" className="mt-6 text-sm font-semibold text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
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

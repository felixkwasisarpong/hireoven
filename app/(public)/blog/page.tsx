import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  BookOpenCheck,
  Briefcase,
  Clock3,
  Flame,
  LineChart,
  Newspaper,
  Sparkles,
  type LucideIcon,
} from "lucide-react"
import { getAllCategories, getPublishedPosts } from "@/lib/blog/queries"
import Navbar from "@/components/layout/Navbar"
import type { BlogPost, BlogCategory } from "@/types/blog"

export const metadata: Metadata = {
  title: "Blog | Hireoven",
  description: "Job market intelligence, H1B sponsorship insights, career strategy, and hiring trends — updated weekly by AI research.",
}

export const revalidate = 3600

type CategoryTheme = {
  chip: string
  accent: string
  bar: string
  Icon: LucideIcon
}

// Semantic per-category accents, brought into the terminal palette: dark-tinted
// chips with distinct-but-muted hues so categories stay visually separable on dark.
const CATEGORY_COLORS: Record<string, CategoryTheme> = {
  "h1b-visa-intel": {
    chip: "border-blue-500/25 bg-blue-500/12 text-blue-700",
    accent: "text-blue-700",
    bar: "bg-blue-400/70",
    Icon: BookOpenCheck,
  },
  "job-market-pulse": {
    chip: "border-violet-500/25 bg-violet-500/12 text-violet-700",
    accent: "text-violet-700",
    bar: "bg-violet-400/70",
    Icon: LineChart,
  },
  "career-strategy": {
    chip: "border-emerald-500/25 bg-emerald-500/12 text-emerald-700",
    accent: "text-emerald-700",
    bar: "bg-emerald-400/70",
    Icon: Sparkles,
  },
  "tech-company-watch": {
    chip: "border-orange-500/25 bg-orange-500/12 text-orange-700",
    accent: "text-orange-700",
    bar: "bg-orange-400/70",
    Icon: Briefcase,
  },
  "interview-offers": {
    chip: "border-rose-500/25 bg-rose-500/12 text-rose-700",
    accent: "text-rose-700",
    bar: "bg-rose-400/70",
    Icon: Flame,
  },
}

function categoryColor(slug: string): CategoryTheme {
  return CATEGORY_COLORS[slug] ?? {
    chip: "border-[rgba(120,200,160,0.2)] bg-[#0e1411] text-[#ccd6cf]/80",
    accent: "text-[#38e08a]",
    bar: "bg-[#38e08a]/70",
    Icon: Newspaper,
  }
}

function formatDate(value: string | null, style: "short" | "long" = "short") {
  if (!value) return null
  return new Date(value).toLocaleDateString("en-US", {
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: "numeric",
  })
}

function CategoryBadge({ category }: { category: BlogCategory }) {
  const c = categoryColor(category.slug)
  return (
    <span className={`inline-flex items-center border px-2.5 py-1 text-xs font-semibold ${c.chip}`}>
      {category.name}
    </span>
  )
}

function StoryMeta({ post, longDate = false }: { post: BlogPost; longDate?: boolean }) {
  const date = formatDate(post.published_at, longDate ? "long" : "short")

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#ccd6cf]/45">
      {date && <span>{date}</span>}
      {post.reading_time && (
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3.5 w-3.5" aria-hidden />
          {post.reading_time} min read
        </span>
      )}
    </div>
  )
}

function PostVisual({
  post,
  category,
  className,
}: {
  post: BlogPost
  category: BlogCategory
  className: string
}) {
  const c = categoryColor(category.slug)
  const Icon = c.Icon

  return (
    <div className={`relative overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] ${className}`}>
      {post.hero_image_url ? (
        <Image
          src={post.hero_image_url}
          alt={post.hero_image_alt ?? post.title}
          fill
          sizes="(min-width: 1024px) 34rem, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 overflow-hidden bg-[var(--term-muted-surface)]">
          <div className={`absolute inset-x-0 top-0 h-1 ${c.bar}`} />
          <div className="absolute inset-5 grid grid-cols-[minmax(0,1fr)_6rem] gap-4 opacity-90">
            <div className="space-y-3">
              <div className="h-3 w-24 border border-[var(--term-line-strong)] bg-[var(--term-panel)]" />
              <div className="grid grid-cols-3 gap-2">
                <span className="h-14 border border-[var(--term-line-strong)] bg-[var(--term-panel)]" />
                <span className="h-14 border border-[var(--term-line-strong)] bg-[var(--term-panel)]" />
                <span className="h-14 border border-[var(--term-line-strong)] bg-[var(--term-panel)]" />
              </div>
              <div className="space-y-2">
                <span className="block h-2 w-4/5 bg-[var(--term-line-strong)]" />
                <span className="block h-2 w-3/5 bg-[var(--term-line-strong)]" />
                <span className="block h-2 w-2/5 bg-[var(--term-line-strong)]" />
              </div>
            </div>
            <div className="flex flex-col justify-between border border-[var(--term-line-strong)] bg-[var(--term-panel)] p-3">
              <Icon className={`h-8 w-8 ${c.accent}`} aria-hidden />
              <span className="h-2 w-full bg-[var(--term-line-strong)]" />
              <span className="h-2 w-2/3 bg-[var(--term-line-strong)]" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FeaturedCard({ post }: { post: BlogPost }) {
  const category = post.category!
  const c = categoryColor(category.slug)

  return (
    <Link
      href={`/blog/${category.slug}/${post.slug}`}
      className="term-panel term-panel-hover group relative flex min-h-[25rem] flex-col overflow-hidden p-6"
    >
      <div className={`absolute inset-x-0 top-0 h-0.5 ${c.bar}`} />
      <div className="relative flex flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CategoryBadge category={category} />
          <StoryMeta post={post} longDate />
        </div>
        <PostVisual post={post} category={category} className="mt-6 h-44 sm:h-56" />
        <div className="mt-auto max-w-2xl pt-8">
          <p className="term-label mb-3">latest briefing</p>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-white transition-colors group-hover:text-[#f5a623] sm:text-3xl lg:text-4xl">
            {post.title}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#ccd6cf]/65 line-clamp-3">
            {post.excerpt}
          </p>
          <div className={`mt-7 inline-flex items-center gap-2 text-sm font-semibold ${c.accent}`}>
            Read the analysis
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </div>
        </div>
      </div>
    </Link>
  )
}

function SideStory({ post, index }: { post: BlogPost; index: number }) {
  const category = post.category!

  return (
    <Link
      href={`/blog/${category.slug}/${post.slug}`}
      className="term-panel term-panel-hover group grid gap-4 p-4 sm:grid-cols-[6.5rem_minmax(0,1fr)]"
    >
      <PostVisual post={post} category={category} className="h-28 sm:h-full sm:min-h-[6.5rem]" />
      <div className="min-w-0">
        <p className="term-label">read {String(index + 1).padStart(2, "0")}</p>
        <h3 className="mt-1 text-[15px] font-semibold leading-snug text-white line-clamp-2 transition-colors group-hover:text-[#f5a623]">
          {post.title}
        </h3>
        <div className="mt-3">
          <StoryMeta post={post} />
        </div>
      </div>
    </Link>
  )
}

function PostCard({ post }: { post: BlogPost }) {
  const category = post.category!
  const c = categoryColor(category.slug)
  const Icon = c.Icon

  return (
    <Link
      href={`/blog/${category.slug}/${post.slug}`}
      className="term-panel term-panel-hover group relative flex min-h-[18rem] flex-col overflow-hidden p-5"
    >
      <div className={`absolute inset-x-0 top-0 h-0.5 ${c.bar}`} />
      <div className="flex items-center justify-between gap-3">
        <CategoryBadge category={category} />
        <Icon className={`h-4 w-4 ${c.accent}`} aria-hidden />
      </div>
      <PostVisual post={post} category={category} className="mt-5 h-36" />
      <h3 className="mt-5 text-lg font-semibold leading-snug tracking-tight text-white line-clamp-3 transition-colors group-hover:text-[#f5a623]">
        {post.title}
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-[#ccd6cf]/55 line-clamp-3">
        {post.excerpt}
      </p>
      <div className="mt-auto pt-6">
        <StoryMeta post={post} />
      </div>
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="term-panel px-6 py-20 text-center">
      <Newspaper className="mx-auto h-10 w-10 text-[#ccd6cf]/30" aria-hidden />
      <p className="mt-4 text-lg font-semibold text-white">No posts yet</p>
      <p className="mt-1 text-sm text-[#ccd6cf]/55">Check back soon. New research is queued for publication.</p>
    </div>
  )
}

export default async function BlogPage() {
  const [categories, posts] = await Promise.all([getAllCategories(), getPublishedPosts(30)])
  const [featured, ...remainingPosts] = posts
  const sideStories = remainingPosts.slice(0, 3)
  const rest = remainingPosts.slice(3)
  const categoryCounts = posts.reduce<Record<string, number>>((acc, post) => {
    const slug = post.category?.slug
    if (slug) acc[slug] = (acc[slug] ?? 0) + 1
    return acc
  }, {})

  const heroStats: [string, string][] = [
    [String(posts.length), "latest articles indexed"],
    [String(categories.length || 5), "topic tracks monitored"],
    ["1 hr", "freshness window"],
  ]

  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      {/* Hero — flat terminal masthead. */}
      <section className="mx-auto w-full max-w-6xl px-4 pt-12 sm:px-6 sm:pt-16 lg:px-8">
        <p className="term-label">Field notes</p>
        <h1 className="mt-4 max-w-3xl text-[2.4rem] font-semibold leading-[1.03] tracking-tight text-white sm:text-[3.4rem]">
          Field notes from the <span className="text-[#f5a623]">modern job market</span>
        </h1>
        <p className="mt-5 max-w-2xl text-[14px] leading-relaxed text-[#ccd6cf]/70">
          Weekly intelligence on H-1B sponsorship, tech hiring shifts, interview signals, and the moves that keep your search ahead of stale advice.
        </p>

        <div className="mt-9 grid gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-3">
          {heroStats.map(([value, label]) => (
            <div key={label} className="bg-[#0e1411] px-4 py-3">
              <p className="text-2xl font-semibold leading-none tabular-nums text-[#38e08a]">{value}</p>
              <p className="term-label mt-1.5">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="sticky top-[60px] z-20 mt-10 border-y border-[rgba(120,200,160,0.26)] bg-[#0a0e0c]">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 sm:px-6 lg:px-8 [&::-webkit-scrollbar]:hidden">
          <Link
            href="/blog"
            className="shrink-0 border border-[#f5a623] bg-[#f5a623] px-3.5 py-2 text-sm font-semibold text-[#0a0e0c]"
          >
            All posts
          </Link>
          {categories.map((cat) => {
            const c = categoryColor(cat.slug)
            const Icon = c.Icon
            return (
              <Link
                key={cat.slug}
                href={`/blog/${cat.slug}`}
                className={`inline-flex shrink-0 items-center gap-2 border px-3.5 py-2 text-sm font-medium transition ${c.chip}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {cat.name}
                <span className="text-[11px] opacity-60">{categoryCounts[cat.slug] ?? 0}</span>
              </Link>
            )
          })}
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        {posts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-14">
            {featured && (
              <section>
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <p className="term-label">{"Editor's desk"}</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Start with the latest signal</h2>
                  </div>
                </div>
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.8fr)]">
                  <FeaturedCard post={featured} />
                  {sideStories.length > 0 && (
                    <div className="grid gap-3">
                      {sideStories.map((post, index) => (
                        <SideStory key={post.id} post={post} index={index} />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {rest.length > 0 && (
              <section>
                <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="term-label">{"More stories"}</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Browse the research library</h2>
                  </div>
                  <p className="max-w-md text-sm leading-6 text-[#ccd6cf]/55">
                    Practical reads for applicants tracking sponsorship, market timing, company risk, and interview expectations.
                  </p>
                </div>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {rest.map((post) => (
                    <PostCard key={post.id} post={post} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

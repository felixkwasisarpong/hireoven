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
  bar: string
  badge: string
  text: string
  ring: string
  glow: string
  Icon: LucideIcon
}

const CATEGORY_COLORS: Record<string, CategoryTheme> = {
  "h1b-visa-intel": {
    bar: "bg-blue-500",
    badge: "border-blue-200 bg-blue-50 text-blue-700",
    text: "text-blue-700",
    ring: "group-hover:border-blue-200 group-hover:shadow-blue-950/10",
    glow: "from-blue-500/20",
    Icon: BookOpenCheck,
  },
  "job-market-pulse": {
    bar: "bg-violet-500",
    badge: "border-violet-200 bg-violet-50 text-violet-700",
    text: "text-violet-700",
    ring: "group-hover:border-violet-200 group-hover:shadow-violet-950/10",
    glow: "from-violet-500/20",
    Icon: LineChart,
  },
  "career-strategy": {
    bar: "bg-emerald-500",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    text: "text-emerald-700",
    ring: "group-hover:border-emerald-200 group-hover:shadow-emerald-950/10",
    glow: "from-emerald-500/20",
    Icon: Sparkles,
  },
  "tech-company-watch": {
    bar: "bg-orange-500",
    badge: "border-orange-200 bg-orange-50 text-orange-700",
    text: "text-orange-700",
    ring: "group-hover:border-orange-200 group-hover:shadow-orange-950/10",
    glow: "from-orange-500/20",
    Icon: Briefcase,
  },
  "interview-offers": {
    bar: "bg-rose-500",
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    text: "text-rose-700",
    ring: "group-hover:border-rose-200 group-hover:shadow-rose-950/10",
    glow: "from-rose-500/20",
    Icon: Flame,
  },
}

function categoryColor(slug: string): CategoryTheme {
  return CATEGORY_COLORS[slug] ?? {
    bar: "bg-slate-400",
    badge: "border-slate-200 bg-slate-50 text-slate-600",
    text: "text-slate-600",
    ring: "group-hover:border-slate-200 group-hover:shadow-slate-950/10",
    glow: "from-slate-500/20",
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
    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-bold ${c.badge}`}>
      {category.name}
    </span>
  )
}

function StoryMeta({ post, longDate = false }: { post: BlogPost; longDate?: boolean }) {
  const date = formatDate(post.published_at, longDate ? "long" : "short")

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-400">
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
    <div className={`relative overflow-hidden rounded-md border border-slate-200/70 bg-slate-100 ${className}`}>
      {post.hero_image_url ? (
        <Image
          src={post.hero_image_url}
          alt={post.hero_image_alt ?? post.title}
          fill
          sizes="(min-width: 1024px) 34rem, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${c.glow} via-white to-[#FF5C18]/10`} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/10 via-transparent to-white/10" />
      {!post.hero_image_url && (
        <div className={`absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-lg ${c.badge}`}>
          <Icon className="h-4 w-4" aria-hidden />
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
      className={`group relative flex min-h-[25rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/90 p-6 shadow-[0_20px_54px_-32px_rgba(15,23,42,0.55)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_28px_70px_-34px_rgba(15,23,42,0.65)] ${c.ring}`}
    >
      <div className={`absolute inset-x-0 top-0 h-1.5 ${c.bar}`} />
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.glow} via-transparent to-[#FF5C18]/10 opacity-80`} />
      <div className="relative flex flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CategoryBadge category={category} />
          <StoryMeta post={post} longDate />
        </div>
        <PostVisual post={post} category={category} className="mt-6 h-44 sm:h-56" />
        <div className="mt-auto max-w-2xl pt-8">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.24em] text-slate-400">Latest briefing</p>
          <h2 className="text-2xl font-black leading-tight tracking-tight text-slate-950 transition-colors group-hover:text-[#c2410c] sm:text-3xl lg:text-4xl">
            {post.title}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 line-clamp-3">
            {post.excerpt}
          </p>
          <div className={`mt-7 inline-flex items-center gap-2 text-sm font-black ${c.text}`}>
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
  const c = categoryColor(category.slug)

  return (
    <Link
      href={`/blog/${category.slug}/${post.slug}`}
      className={`group grid gap-4 rounded-lg border border-slate-200 bg-white/90 p-4 shadow-[0_12px_32px_-24px_rgba(15,23,42,0.55)] transition duration-200 hover:-translate-y-0.5 hover:bg-white sm:grid-cols-[6.5rem_minmax(0,1fr)] ${c.ring}`}
    >
      <PostVisual post={post} category={category} className="h-28 sm:h-full sm:min-h-[6.5rem]" />
      <div className="min-w-0">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
          Read {index + 1}
        </p>
        <h3 className="mt-1 text-[15px] font-black leading-snug text-slate-900 line-clamp-2 transition-colors group-hover:text-[#c2410c]">
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
      className={`group relative flex min-h-[18rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/90 p-5 shadow-[0_12px_34px_-26px_rgba(15,23,42,0.55)] transition duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_24px_52px_-30px_rgba(15,23,42,0.65)] ${c.ring}`}
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${c.bar}`} />
      <div className="flex items-center justify-between gap-3">
        <CategoryBadge category={category} />
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.badge}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </div>
      </div>
      <PostVisual post={post} category={category} className="mt-5 h-36" />
      <h3 className="mt-5 text-lg font-black leading-snug tracking-tight text-slate-950 line-clamp-3 transition-colors group-hover:text-[#c2410c]">
        {post.title}
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-slate-500 line-clamp-3">
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
    <div className="rounded-lg border border-dashed border-slate-300 bg-white/75 px-6 py-20 text-center">
      <Newspaper className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
      <p className="mt-4 text-lg font-black text-slate-800">No posts yet</p>
      <p className="mt-1 text-sm text-slate-500">Check back soon. New research is queued for publication.</p>
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

  return (
    <div className="min-h-screen">
      <Navbar />

      <section className="relative isolate overflow-hidden border-b border-white/20 bg-slate-950">
        <Image
          src="/blog/editorial-dashboard.png"
          alt="Hireoven job market intelligence dashboard"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-45"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,13,28,0.94)_0%,rgba(8,13,28,0.78)_46%,rgba(8,13,28,0.28)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,92,24,0.22),transparent_32%),radial-gradient(circle_at_78%_30%,rgba(59,130,246,0.18),transparent_30%)]" />

        <div className="relative mx-auto flex min-h-[31rem] max-w-6xl flex-col justify-end px-4 pb-12 pt-24 sm:px-6 md:min-h-[34rem] md:pb-16 lg:px-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.22em] text-white/70 backdrop-blur">
              <Newspaper className="h-3.5 w-3.5 text-[#FF9A3C]" aria-hidden />
              Hireoven Blog
            </div>
            <h1 className="mt-5 text-4xl font-black leading-[1.02] tracking-tight text-white sm:text-5xl md:text-6xl">
              Field notes from the modern job market.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-white/70 sm:text-lg">
              Weekly intelligence on H-1B sponsorship, tech hiring shifts, interview signals, and the moves that keep your search ahead of stale advice.
            </p>
          </div>

          <div className="mt-9 grid gap-3 sm:grid-cols-3">
            {[
              [String(posts.length), "latest articles indexed"],
              [String(categories.length || 5), "topic tracks monitored"],
              ["1 hr", "freshness window"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                <p className="text-2xl font-black text-white">{value}</p>
                <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.16em] text-white/50">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="sticky top-[60px] z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 sm:px-6 lg:px-8 [&::-webkit-scrollbar]:hidden">
          <Link
            href="/blog"
            className="shrink-0 rounded-md bg-slate-950 px-3.5 py-2 text-sm font-black text-white shadow-[0_8px_18px_-14px_rgba(15,23,42,0.8)]"
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
                className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-bold transition hover:-translate-y-px hover:shadow-sm ${c.badge}`}
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
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-[#FF5C18]">Editor&apos;s desk</p>
                    <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Start with the latest signal</h2>
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
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">More stories</p>
                    <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Browse the research library</h2>
                  </div>
                  <p className="max-w-md text-sm leading-6 text-slate-500">
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

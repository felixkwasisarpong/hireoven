import Link from "next/link"
import { Lightbulb, Search, TrendingUp } from "lucide-react"

const POPULAR_SEARCHES = [
  "Software Engineer",
  "Data Scientist",
  "Product Manager",
  "Machine Learning",
  "Frontend Engineer",
  "DevOps",
  "Cloud Architect",
  "Backend Engineer",
] as const

const TRENDING_FILTERS = [
  { label: "Remote · last 24h", href: "/dashboard?remote=true&within=24h" },
  { label: "Sponsorship + Senior", href: "/dashboard?sponsorship=true&seniority=senior" },
  { label: "$150k+ roles", href: "/dashboard?min_salary=150000" },
] as const

const TIPS = [
  "Apply within 24 hours of a posting going live — response rates drop fast after the first day.",
  "Tailor your resume's top third to the role: titles, scope and tools matter most for recruiters skimming.",
  "Filter by sponsorship signal first — saves hours of effort on roles that won't sponsor.",
  "Use saved searches with daily alerts so fresh matches come to you, not the other way around.",
]

/**
 * Lightweight static side column. Pure server component — no client JS, no
 * data fetching, renders instantly at SSR. Avoid duplicating sidebar-nav
 * destinations (Resume, Applications, Saved, Companies, etc.).
 */
export default function DashboardSpotlightColumn() {
  const tip = TIPS[0]

  return (
    <aside className="space-y-3">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-[#2563EB]" aria-hidden />
          <h3 className="text-[13px] font-semibold text-slate-900">Popular searches</h3>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {POPULAR_SEARCHES.map((q) => (
            <Link
              key={q}
              href={`/dashboard?q=${encodeURIComponent(q)}`}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 transition hover:border-[#2563EB]/40 hover:bg-sky-50 hover:text-[#2563EB]"
            >
              {q}
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden />
          <h3 className="text-[13px] font-semibold text-slate-900">Quick filters</h3>
        </div>
        <ul className="mt-2 space-y-0.5">
          {TRENDING_FILTERS.map(({ label, href }) => (
            <li key={href}>
              <Link
                href={href}
                className="block rounded-md px-2 py-1.5 text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-50 hover:text-[#2563EB]"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-white text-amber-600 ring-1 ring-amber-200">
            <Lightbulb className="h-4 w-4" aria-hidden />
          </span>
          <h3 className="text-[13px] font-semibold text-amber-900">Tip of the day</h3>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-amber-900/85">{tip}</p>
      </section>
    </aside>
  )
}

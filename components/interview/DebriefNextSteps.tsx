import Link from "next/link"

const ROUTE_PATTERNS: Array<{ pattern: RegExp; href: string }> = [
  { pattern: /coding test|coding interview/i, href: "/dashboard/interview/setup?type=coding" },
  { pattern: /live interview/i, href: "/dashboard/interview/setup?type=live" },
  { pattern: /text interview/i, href: "/dashboard/interview/setup?type=text" },
  { pattern: /resume tailoring|tailor.*resume/i, href: "/dashboard/resume/tailor" },
  { pattern: /resume/i, href: "/dashboard/resume" },
]

function getLink(text: string): string | null {
  for (const { pattern, href } of ROUTE_PATTERNS) {
    if (pattern.test(text)) return href
  }
  return null
}

export default function DebriefNextSteps({ steps }: { steps: string[] }) {
  if (steps.length === 0) return null
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <div className="h-4 w-0.5 rounded-full bg-slate-300" />
        <h2 className="text-[12px] font-bold uppercase tracking-widest text-slate-500">What to do next</h2>
      </div>
      <ol className="space-y-2">
        {steps.map((step, i) => {
          const href = getLink(step)
          return (
            <li key={i} className="flex gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[12px] font-bold text-orange-600">
                {i + 1}
              </span>
              <div className="flex-1 text-[13px] text-slate-800">
                {step}
                {href && (
                  <Link
                    href={href}
                    className="ml-2 text-[12px] font-semibold text-orange-500 hover:text-orange-600"
                  >
                    Start →
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

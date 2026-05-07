import Link from "next/link"

type Gap = { observation: string; suggestion: string; quote: string }

type Props = {
  gaps: Gap[]
  sessionType: string
  jobId: string | null
}

export default function DebriefGaps({ gaps, sessionType, jobId }: Props) {
  if (gaps.length === 0) return null

  const practiceHref = jobId
    ? `/dashboard/interview/setup?type=${sessionType}&jobId=${jobId}`
    : `/dashboard/interview/setup?type=${sessionType}`

  return (
    <section>
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-orange-600">Gaps to close</h2>
      <div className="space-y-3">
        {gaps.map((g, i) => (
          <div key={i} className="rounded-xl border border-orange-100 bg-orange-50/40 py-3 pl-4 pr-4 border-l-4 border-l-orange-500">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[14px] font-semibold text-slate-900">△ {g.observation}</p>
              <Link
                href={practiceHref}
                className="shrink-0 rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200"
              >
                Practice this →
              </Link>
            </div>
            {g.quote && (
              <p className="mt-1.5 text-[12px] italic text-slate-500">
                &ldquo;{g.quote}&rdquo;
              </p>
            )}
            {g.suggestion && (
              <p className="mt-1.5 text-[12px] text-slate-700">
                <span className="font-semibold text-orange-700">Fix: </span>
                {g.suggestion}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

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
      <div className="mb-3 flex items-center gap-2">
        <div className="h-4 w-0.5 rounded-full bg-orange-400" />
        <h2 className="text-[12px] font-bold uppercase tracking-widest text-orange-600">Gaps to close</h2>
      </div>
      <div className="space-y-2.5">
        {gaps.map((g, i) => (
          <div key={i} className="rounded-xl border border-orange-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-start gap-2.5 text-[13px] font-semibold text-slate-900">
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[10px] font-bold text-orange-600">△</span>
                {g.observation}
              </p>
              <Link
                href={practiceHref}
                className="shrink-0 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[11px] font-semibold text-orange-700 transition hover:bg-orange-100"
              >
                Practice →
              </Link>
            </div>
            {g.quote && (
              <p className="mt-2 pl-7 text-[12px] italic leading-relaxed text-slate-500">
                &ldquo;{g.quote}&rdquo;
              </p>
            )}
            {g.suggestion && (
              <p className="mt-2 pl-7 text-[12px] text-slate-700">
                <span className="font-semibold text-orange-600">Fix: </span>
                {g.suggestion}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

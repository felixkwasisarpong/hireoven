import Link from "next/link"

type Props = {
  sessionType: string
  jobId: string | null
}

export default function DebriefActions({ sessionType, jobId }: Props) {
  const canPracticeAgain = Boolean(jobId)
  const practiceHref = jobId
    ? `/dashboard/interview/setup?type=${sessionType}&jobId=${jobId}`
    : `/dashboard/interview/setup?type=${sessionType}`

  return (
    <div className="flex flex-wrap gap-3">
      <Link
        href="/dashboard/interview"
        className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        Run another
      </Link>

      {canPracticeAgain ? (
        <Link
          href={practiceHref}
          className="rounded-lg bg-orange-500 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-orange-600"
        >
          Practice this question again
        </Link>
      ) : (
        <Link
          href={practiceHref}
          className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5 text-[13px] font-semibold text-orange-600 transition hover:bg-orange-100"
        >
          Practice again
        </Link>
      )}

      <button
        type="button"
        disabled
        title="Sharing ships in the next update"
        className="cursor-not-allowed rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-[13px] font-semibold text-slate-400"
      >
        Share with mentor
      </button>
    </div>
  )
}

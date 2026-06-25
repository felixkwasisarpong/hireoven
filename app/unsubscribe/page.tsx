import type { Metadata } from "next"
import Link from "next/link"
import { applyUnsubscribe } from "@/lib/email/unsubscribe"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Unsubscribe — Hireoven",
  robots: { index: false },
}

const TYPE_LABEL: Record<string, string> = {
  weekly_digest: "the weekly digest",
  layoff_alert: "layoff alerts",
  scorecard_milestone: "scorecard milestone emails",
  opt_expiration: "OPT expiration reminders",
  lottery_brief: "seasonal briefs",
}

type SearchParams = Record<string, string | undefined>

// Visible footer link target. Applies the unsubscribe on load (so a plain link click
// works without a separate confirm step) and shows what changed.
export default async function UnsubscribePage({ searchParams }: { searchParams: SearchParams }) {
  const token = searchParams.token
  const result = token ? await applyUnsubscribe(token) : { applied: false, email_type: null }

  const what = result.email_type ? TYPE_LABEL[result.email_type] ?? "those emails" : "all emails"

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f4f6f9] px-4 text-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="text-lg font-extrabold tracking-tight">Hireoven</span>
        {result.applied ? (
          <>
            <h1 className="mt-5 text-xl font-semibold text-slate-900">You&rsquo;re unsubscribed</h1>
            <p className="mt-2 text-sm text-slate-500">
              You won&rsquo;t receive {what} anymore. This took effect immediately.
            </p>
            <Link
              href="/dashboard/email-preferences"
              className="mt-6 inline-flex rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Manage all email preferences
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-xl font-semibold text-slate-900">Link expired or invalid</h1>
            <p className="mt-2 text-sm text-slate-500">
              We couldn&rsquo;t process this unsubscribe link. You can manage every email type from
              your preference center.
            </p>
            <Link
              href="/dashboard/email-preferences"
              className="mt-6 inline-flex rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Email preferences
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

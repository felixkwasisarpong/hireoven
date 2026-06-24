import Link from "next/link"

export function ResumeRequiredEmptyState() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <h1 className="text-xl font-bold text-slate-900">Get your sponsorability scorecard</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        Upload a resume and we&rsquo;ll score how your profile fits the H-1B-sponsoring job
        market — skills demand, rarity, experience, and education.
      </p>
      <Link
        href="/dashboard/resume"
        className="mt-5 inline-flex rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
      >
        Upload a resume
      </Link>
    </div>
  )
}

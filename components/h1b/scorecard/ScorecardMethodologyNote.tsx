import Link from "next/link"

export function ScorecardMethodologyNote() {
  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-slate-50/60 p-5 text-sm text-slate-600">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
        How to read this score
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>The score reflects historical filing patterns, not a guarantee of future sponsorship.</li>
        <li>This is a single, company-wide view. Sponsorship can vary by role and team.</li>
        <li>
          A low grade can mean &ldquo;does not sponsor&rdquo; or simply &ldquo;a smaller employer
          with little public LCA history.&rdquo;
        </li>
      </ul>
      <p className="mt-3">
        Built from Department of Labor LCA and USCIS public data.{" "}
        <Link
          href="/h1b-sponsors/leaderboard/methodology"
          className="font-medium text-slate-800 underline hover:text-slate-900"
        >
          Full methodology
        </Link>
        .
      </p>
    </section>
  )
}

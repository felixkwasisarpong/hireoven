import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import CompanyLogo from "@/components/ui/CompanyLogo"
import StayDemo from "@/components/stay/StayDemo"
import { getCapExemptStats, getSkipListEmployers } from "@/lib/stay/queries"
import { getGlobalOutcomeCount } from "@/lib/stay/outcomes"
import { getFeaturedSocRoles } from "@/lib/salaries/soc-roles"
import { companyParam } from "@/lib/seo/company-seo"

export const revalidate = 3600

export const metadata: Metadata = {
  title: "Stay — will this job actually keep you in the U.S.? | Hireoven",
  description:
    "The 2026 rules made it far harder for international graduates to stay. Stay scores every job by your real odds of building a lasting career here — and surfaces the cap-exempt roles that skip the lottery entirely.",
  alternates: { canonical: "/stay" },
}

const SHOCKS = [
  {
    when: "effective feb 27, 2026",
    title: "Wage-weighted lottery",
    body: "The random lottery is gone. Entries now scale with salary level — so a typical new-grad offer drops from ~35% odds to roughly 15%. The rule targets entry-level talent directly.",
  },
  {
    when: "effective sep 21, 2025",
    title: "The $100,000 fee",
    body: "A six-figure fee chilled employer appetite to sponsor — even though it mostly does NOT apply to students already here filing a change of status. The fear is doing damage the fine print doesn't.",
  },
  {
    when: "effective sep 15, 2026",
    title: "The 30-day rule",
    body: "Duration of Status is over. Stays are capped at 4 years, the grace period is halved to 30 days, and every extension is now a formal USCIS filing that can be denied.",
  },
]

const MOAT = [
  {
    n: 1,
    title: "The sponsorship graph",
    body: "Entity-resolved DOL LCA + PERM + USCIS outcomes, normalized to the role level. Tedious infrastructure — which is exactly why nobody has cleanly joined “this live req” to “this employer's entry-level sponsorship behavior.”",
  },
  {
    n: 2,
    title: "The only live 2026 survival model",
    body: "First to encode the Feb-2026 weighted-lottery math and the Sep-2026 runway into a live per-candidate number. Being first on rules that are weeks old is a lead measured in months.",
  },
  {
    n: 3,
    title: "The outcome flywheel",
    body: "Every “got sponsored / got auto-rejected / won the lottery” report sharpens the model. Better scores → more trust → more shares → more outcomes — a compounding data loop.",
  },
]

const REASON_LABEL: Record<string, string> = {
  university: "University",
  govt_research: "Federal research",
  nonprofit_research: "Nonprofit research",
}

export default async function StayPage() {
  const [stats, skipList, outcomeCount, socRoles] = await Promise.all([
    getCapExemptStats(),
    getSkipListEmployers(9),
    getGlobalOutcomeCount(),
    getFeaturedSocRoles(),
  ])
  const roleOptions = socRoles.map((r) => ({ socGroup: r.soc_group, label: r.short_label || r.label }))

  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      {/* Hero */}
      <section className="mx-auto w-full max-w-[78rem] px-4 pt-12 sm:px-6 sm:pt-16 lg:px-10">
        <p className="term-label">Stay</p>
        <h1 className="mt-4 max-w-[20ch] text-[2.5rem] font-semibold leading-[1.03] tracking-tight text-white sm:text-[3.6rem]">
          Will this job actually <span className="text-[#f5a623]">keep you in the country?</span>
        </h1>
        <p className="mt-5 max-w-[62ch] text-[16px] leading-relaxed text-[#ccd6cf]/70">
          Every other tool tells you whether a company <em className="text-[#ccd6cf] not-italic">sponsors</em>. Stay scores
          every job by your real odds of building a lasting career here — under the rules as they exist today, not last year.
        </p>
      </section>

      {/* Live demo */}
      <section className="mx-auto mt-8 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <StayDemo capExemptRoles={stats.openRoles} roleOptions={roleOptions} />
      </section>

      {/* Clock copilot callout */}
      <section className="mx-auto mt-4 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <Link
          href="/stay/timeline"
          className="term-panel term-panel-hover flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center"
        >
          <div>
            <p className="term-label">Timeline copilot</p>
            <p className="mt-1.5 text-[15px] font-semibold text-white">
              Race your OPT clock — how many H-1B draws you really have, and what to do this week
            </p>
          </div>
          <span className="term-btn shrink-0">
            Open the copilot <ArrowRight className="h-4 w-4" />
          </span>
        </Link>
      </section>

      {/* Why now — the shocks */}
      <section className="mx-auto mt-16 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <p className="term-label">{"Why now — the playbook broke in one year"}</p>
        <h2 className="mt-3 text-[1.9rem] font-semibold tracking-tight text-white sm:text-[2.4rem]">
          Three federal shocks, one year, stacked on entry-level talent
        </h2>
        <div className="mt-8 grid gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] md:grid-cols-3">
          {SHOCKS.map((s) => (
            <div key={s.title} className="bg-[#0e1411] p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#e5695f]">{s.when}</p>
              <h3 className="mt-2 text-[18px] font-semibold text-white">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#ccd6cf]/70">{s.body}</p>
            </div>
          ))}
        </div>
        <Link href="/stay/rules" className="mt-4 inline-flex items-center gap-2 text-[13px] font-semibold text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
          Which of these actually apply to you? Check your case
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </section>

      {/* Lottery Skip List */}
      <section className="mx-auto mt-16 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="term-label">Lottery skip list</p>
            <h2 className="mt-3 text-[1.9rem] font-semibold tracking-tight text-white sm:text-[2.4rem]">
              The escape hatch: <span className="text-[#38e08a]">{stats.employers.toLocaleString()}</span> employers that skip the lottery
            </h2>
          </div>
          <Link href="/h1b-sponsors/cap-exempt" className="term-btn">
            See the full list <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-[#ccd6cf]/70">
          Universities, nonprofit research orgs, and teaching hospitals file H-1B year-round — no cap, no lottery.
          Post-wage-weighting, this is the single smartest path for entry-level talent.
        </p>

        {skipList.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {skipList.map((c) => (
              <Link
                key={c.id}
                href={`/h1b-sponsors/${companyParam(c.id, c.name)}`}
                className="term-panel term-panel-hover flex items-center gap-3 p-3.5"
              >
                <CompanyLogo
                  companyName={c.name}
                  domain={c.domain}
                  logoUrl={c.logo_url}
                  className="h-10 w-10 shrink-0 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-white">{c.name}</p>
                  <p className="truncate text-[11px] text-[#6c7a72]">
                    {c.cap_exempt_reason ? REASON_LABEL[c.cap_exempt_reason] ?? "Cap-exempt" : "Cap-exempt"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[15px] font-semibold tabular-nums text-[#38e08a]">{c.open_roles.toLocaleString()}</p>
                  <p className="text-[10px] uppercase text-[#6c7a72]">roles</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-6 text-[13px] text-[#6c7a72]">Cap-exempt employer list is loading from the sponsorship graph.</p>
        )}
      </section>

      {/* Moat */}
      <section className="mx-auto mt-16 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <p className="term-label">{"The moat — a data engine competitors can't clone in a quarter"}</p>
        {outcomeCount > 0 && (
          <p className="mt-2 text-[13px] text-[#ccd6cf]/60">
            <span className="tabular-nums text-[#38e08a]">{outcomeCount.toLocaleString()}</span> real outcomes reported by job
            seekers so far — every one sharpens the score.
          </p>
        )}
        <div className="mt-6 grid gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] md:grid-cols-3">
          {MOAT.map((m) => (
            <div key={m.n} className="bg-[#0e1411] p-6">
              <span className="flex h-9 w-9 items-center justify-center border border-[#f5a623]/40 bg-[#f5a623]/12 text-[15px] font-bold text-[#f5a623]">
                {m.n}
              </span>
              <h3 className="mt-4 text-[17px] font-semibold text-white">{m.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#ccd6cf]/70">{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto mt-16 mb-20 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <div className="term-panel p-8 text-center sm:p-12">
          <p className="term-label">{"Join the first cohort"}</p>
          <h2 className="mx-auto mt-3 max-w-[24ch] text-[1.9rem] font-semibold tracking-tight text-white sm:text-[2.4rem]">
            Know your real odds before you waste 500 applications
          </h2>
          <p className="mx-auto mt-3 max-w-[52ch] text-[14px] leading-relaxed text-[#ccd6cf]/70">
            Free forever to score jobs and browse lottery-free roles. Early members get the timeline copilot first.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/signup?next=%2Fdashboard%2Fonboarding" className="term-btn term-btn-amber">
              Get early access <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/stay/talent" className="term-btn">
              Get discovered by sponsors
            </Link>
            <Link href="/find" className="term-btn">
              Browse jobs
            </Link>
          </div>
        </div>
        <p className="mt-6 text-center text-[12px] leading-relaxed text-[#6c7a72]">
          Odds and scores are modeled from public DOL/USCIS data and the 2026 rule changes (weighted-selection final rule
          eff. Feb 27 2026; Duration-of-Status final rule eff. Sep 15 2026). Not legal or immigration advice.
        </p>
      </section>
    </div>
  )
}

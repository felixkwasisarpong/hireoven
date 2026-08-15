import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import TalentSignup from "@/components/stay/TalentSignup"
import { getTalentPoolStats } from "@/lib/stay/talent"
import { getFeaturedSocRoles, getSocLabelMap } from "@/lib/salaries/soc-roles"

export const revalidate = 600

export const metadata: Metadata = {
  title: "Get discovered by sponsor-verified employers | Stay by Hireoven",
  description:
    "Flip the ATS-rejection dynamic. Build one profile — only employers with verified DOL sponsorship history can reach you. No more “yes” to sponsorship auto-rejecting your résumé.",
  alternates: { canonical: "/stay/talent" },
}

export default async function StayTalentPage() {
  const [socRoles, stats] = await Promise.all([getFeaturedSocRoles(), getTalentPoolStats()])
  const roleOptions = socRoles.map((r) => ({ socGroup: r.soc_group, label: r.short_label || r.label }))

  // Resolve role labels for the aggregate pool (PII-free).
  const labelMap = stats.byRole.length > 0 ? await getSocLabelMap(stats.byRole.map((r) => r.socGroup)) : new Map()
  const byRole = stats.byRole.map((r) => ({ ...r, label: labelMap.get(r.socGroup)?.label ?? r.label }))

  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      <section className="mx-auto w-full max-w-[78rem] px-4 pt-12 sm:px-6 sm:pt-16 lg:px-10">
        <Link href="/stay" className="term-label transition-colors hover:text-[#38e08a]">
          &lt; stay
        </Link>
        <h1 className="mt-4 max-w-[22ch] text-[2.3rem] font-semibold leading-[1.04] tracking-tight text-white sm:text-[3.1rem]">
          Get discovered by <span className="text-[#f5a623]">sponsor-verified employers</span>
        </h1>
        <p className="mt-5 max-w-[64ch] text-[16px] leading-relaxed text-[#ccd6cf]/70">
          Every application asks “will you need sponsorship?” — and a truthful “yes” auto-rejects you before a human
          reads your résumé. Flip it: build one profile, and only employers with verified DOL sponsorship history can
          reach out. You&apos;re pre-qualified, not filtered out.
        </p>
      </section>

      <section className="mx-auto mt-8 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <TalentSignup roleOptions={roleOptions} />
      </section>

      {/* PII-free talent-pool teaser — the employer hook */}
      <section className="mx-auto mt-14 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <p className="term-label">{"The pool — sponsor-seeking talent, in aggregate"}</p>
        {stats.total > 0 ? (
          <>
            <h2 className="mt-3 text-[1.9rem] font-semibold tracking-tight text-white sm:text-[2.4rem]">
              <span className="text-[#38e08a] tabular-nums">{stats.total.toLocaleString()}</span> candidates in the pool
            </h2>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className="term-panel p-5">
                <p className="term-label mb-3">by role</p>
                <div className="flex flex-col gap-2">
                  {byRole.map((r) => (
                    <div key={r.socGroup} className="flex items-center justify-between text-[13.5px]">
                      <span className="text-[#ccd6cf]/80">{r.label}</span>
                      <span className="tabular-nums text-[#38e08a]">{r.n.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="term-panel p-5">
                <p className="term-label mb-3">by visa status</p>
                <div className="flex flex-col gap-2">
                  {stats.byVisa.map((v) => (
                    <div key={v.visa} className="flex items-center justify-between text-[13.5px]">
                      <span className="text-[#ccd6cf]/80">{v.label}</span>
                      <span className="tabular-nums text-[#38e08a]">{v.n.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-[#ccd6cf]/70">
            The pool is just opening. Be one of the first profiles sponsor-verified employers see.
          </p>
        )}
      </section>

      {/* Employer CTA */}
      <section className="mx-auto mt-14 mb-20 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <div className="term-panel p-6 sm:p-8">
          <p className="term-label">{"For employers"}</p>
          <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-[#ccd6cf]/85">
            Sponsor international talent already? Reach pre-qualified, sponsorship-aware candidates directly — no résumé
            pile, no wasted “does this person need sponsorship?” screens. Verified-employer access is invite-only while
            we build the pool.
          </p>
          <Link href="/partners" className="term-btn term-btn-amber mt-5">
            Request employer access
          </Link>
        </div>
        <p className="mt-6 text-[12px] leading-relaxed text-[#6c7a72]">
          Individual profiles are never shown publicly — only these aggregate counts. Contact details are released only
          to verified employers. Not legal or immigration advice.
        </p>
      </section>
    </div>
  )
}

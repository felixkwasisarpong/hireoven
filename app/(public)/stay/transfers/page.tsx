import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import { getTransferFriendlyEmployers } from "@/lib/h1b/transfer-velocity"
import { getFeaturedSocRoles } from "@/lib/salaries/soc-roles"

export const revalidate = 3600

export const metadata: Metadata = {
  title: "Who can transfer your H-1B — ranked by real filings | Stay by Hireoven",
  description:
    "A laid-off H-1B worker has 30 days. These employers actually filed H-1B transfers in your occupation and state — ranked by workers transferred, with how fast their filings clear.",
  alternates: { canonical: "/stay/transfers" },
}

const STATES = [
  "CA", "NY", "TX", "WA", "MA", "NJ", "IL", "VA", "GA", "NC", "PA", "FL",
  "MD", "CO", "AZ", "MI", "OH", "MN", "CT", "OR",
]

/**
 * §4 Transfer Velocity, as a candidate-facing tool.
 *
 * The LCA form breaks TOTAL_WORKER_POSITIONS into six integer counts, one of which
 * (CHANGE_EMPLOYER) is an H-1B transfer. USCIS's Employer Data Hub — what every competitor uses —
 * collapses transfers, extensions and amendments into a single "Continuing" bucket, so
 * per-employer transfer volume is unobtainable there. From DOL it is a GROUP BY, which is why
 * this page can exist at all.
 *
 * Framed around the 30-day clock because that is the actual decision being made: after a layoff
 * the only question that matters is who can file fast enough, and the market's current answer is
 * law-firm blog posts.
 */
export default async function StayTransfersPage({
  searchParams,
}: {
  searchParams: { soc?: string; state?: string }
}) {
  const soc = (searchParams.soc ?? "").trim()
  const state = (searchParams.state ?? "").trim().toUpperCase()

  const [roles, employers] = await Promise.all([
    getFeaturedSocRoles(),
    getTransferFriendlyEmployers({
      socPrefix: soc || null,
      stateAbbr: state || null,
      sinceDays: 365,
      limit: 30,
    }),
  ])

  const activeRole = roles.find((r) => r.soc_group === soc)
  const scope = [activeRole?.label ?? null, state || null].filter(Boolean).join(" · ")

  const qs = (next: { soc?: string; state?: string }) => {
    const p = new URLSearchParams()
    const s = next.soc ?? soc
    const st = next.state ?? state
    if (s) p.set("soc", s)
    if (st) p.set("state", st)
    const q = p.toString()
    return q ? `/stay/transfers?${q}` : "/stay/transfers"
  }

  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      <section className="mx-auto w-full max-w-[78rem] px-4 pt-12 sm:px-6 sm:pt-16 lg:px-10">
        <Link href="/stay" className="term-label transition-colors hover:text-[#38e08a]">
          &lt; stay
        </Link>
        <h1 className="mt-4 max-w-[24ch] text-[2.3rem] font-semibold leading-[1.04] tracking-tight text-white sm:text-[3.1rem]">
          Who can actually <span className="text-[#f5a623]">transfer your H-1B</span>
        </h1>
        <p className="mt-5 max-w-[66ch] text-[16px] leading-relaxed text-[#ccd6cf]/70">
          After a layoff the clock is short, and the only question that matters is who can file fast enough.
          These employers filed real H-1B transfers in the last year — not &ldquo;we sponsor&rdquo; on a careers
          page, but <span className="text-white">labor condition applications to take over someone&apos;s
          existing visa</span>. Ranked by the number of transfer positions they authorized.
        </p>
      </section>

      {/* Filters */}
      <section className="mx-auto mt-8 w-full max-w-[78rem] px-4 sm:px-6 lg:px-10">
        <div className="term-panel p-5">
          <p className="term-label">Occupation</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Link
              href={qs({ soc: "" })}
              className={`border px-2.5 py-1 text-[12px] ${!soc ? "border-[#38e08a] text-[#38e08a]" : "border-[rgba(120,200,160,0.22)] text-[#ccd6cf]/70 hover:text-white"}`}
            >
              All
            </Link>
            {roles.map((r) => (
              <Link
                key={r.soc_group}
                href={qs({ soc: r.soc_group })}
                className={`border px-2.5 py-1 text-[12px] ${soc === r.soc_group ? "border-[#38e08a] text-[#38e08a]" : "border-[rgba(120,200,160,0.22)] text-[#ccd6cf]/70 hover:text-white"}`}
              >
                {r.short_label || r.label}
              </Link>
            ))}
          </div>

          <p className="term-label mt-5">Worksite state</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Link
              href={qs({ state: "" })}
              className={`border px-2.5 py-1 text-[12px] ${!state ? "border-[#38e08a] text-[#38e08a]" : "border-[rgba(120,200,160,0.22)] text-[#ccd6cf]/70 hover:text-white"}`}
            >
              Anywhere
            </Link>
            {STATES.map((s) => (
              <Link
                key={s}
                href={qs({ state: s })}
                className={`border px-2.5 py-1 text-[12px] ${state === s ? "border-[#38e08a] text-[#38e08a]" : "border-[rgba(120,200,160,0.22)] text-[#ccd6cf]/70 hover:text-white"}`}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="mx-auto mt-6 w-full max-w-[78rem] px-4 pb-20 sm:px-6 lg:px-10">
        {employers.length === 0 ? (
          <div className="term-panel p-6 text-[14px] text-[#ccd6cf]/70">
            No H-1B transfers on record for {scope || "this selection"} in the last year. Try widening the
            occupation or removing the state filter — transfer filings are concentrated in a relatively small
            number of employers.
          </div>
        ) : (
          <>
            <p className="mb-3 text-[13px] text-[#ccd6cf]/55">
              {employers.length} employer{employers.length === 1 ? "" : "s"} filed H-1B transfers
              {scope ? ` — ${scope}` : ""} in the last 12 months.
            </p>
            <div className="term-panel overflow-x-auto">
              <table className="w-full min-w-[46rem] text-[13px]">
                <thead>
                  <tr className="border-b border-[rgba(120,200,160,0.16)] text-left text-[11px] uppercase tracking-wide text-[#ccd6cf]/45">
                    <th className="px-4 py-3 font-medium">Employer</th>
                    <th className="px-4 py-3 text-right font-medium">Transfer positions</th>
                    <th className="px-4 py-3 text-right font-medium">Filings</th>
                    <th className="px-4 py-3 text-right font-medium">Median decision</th>
                    <th className="px-4 py-3 text-right font-medium">Last transfer</th>
                  </tr>
                </thead>
                <tbody>
                  {employers.map((e) => (
                    <tr key={e.employerNormalized} className="border-b border-[rgba(120,200,160,0.08)] last:border-0">
                      <td className="px-4 py-3">
                        <span className="text-white">{e.employerName}</span>
                        {e.isCapExempt && (
                          <span className="ml-2 border border-[rgba(120,200,160,0.3)] px-1.5 py-0.5 text-[10px] text-[#38e08a]">
                            cap-exempt · files year-round
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-white">{e.transferPositions}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#ccd6cf]/65">{e.transferFilings}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#ccd6cf]/65">
                        {e.medianDecisionDays !== null ? `${e.medianDecisionDays}d` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#ccd6cf]/45">
                        {e.lastTransferAt ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="mt-4 max-w-[76ch] text-[11px] leading-relaxed text-[#ccd6cf]/40">
          Counts come from certified Labor Condition Applications where the employer recorded a change of
          employer — the field USCIS&apos;s public data folds into a single &ldquo;continuing&rdquo; bucket.
          <span className="text-[#ccd6cf]/60">
            {" "}
            An LCA authorizes positions; it is not a record of hires. A single application can cover up to
            dozens of positions, so &ldquo;transfer positions&rdquo; is an upper bound on people, not a headcount
            — large employers file blanket applications and will rank high here.
          </span>{" "}
          &ldquo;Median decision&rdquo; is the time from filing to decision on the labor condition application,
          which precedes the petition and is not the full transfer timeline. Employers are matched by name, so
          figures may be split across a company&apos;s legal entities. A past transfer is evidence an employer
          can do this, not a promise they will.
        </p>
      </section>
    </div>
  )
}

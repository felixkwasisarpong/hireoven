import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import Navbar from "@/components/layout/Navbar"
import { getSocRoleBySlug, getFeaturedSocRoles } from "@/lib/salaries/soc-roles"
import {
  getTransferFriendlyEmployers,
  getIndexableTransferSlices,
  MIN_EMPLOYERS_FOR_INDEX,
} from "@/lib/h1b/transfer-velocity"

export const revalidate = 86400
export const dynamicParams = true

/**
 * Indexable role x state H-1B transfer pages.
 *
 * Search intent this answers: "who can transfer my H-1B as a software engineer in California".
 * Today the market's answer is law-firm blog posts, because per-employer transfer volume is not
 * computable from the USCIS data everyone else uses — CHANGE_EMPLOYER is an integer count on the
 * LCA, and USCIS folds transfers into one "Continuing" bucket. That is the whole reason a page
 * like this can exist.
 *
 * ⚠ THIN PAGES ARE NOT INDEXED. generateStaticParams only emits slices with at least
 * MIN_EMPLOYERS_FOR_INDEX distinct employers, and any slice rendered below that threshold sets
 * robots noindex in metadata. A programmatic page that ranks two employers is not an answer, and
 * publishing hundreds of them would damage the domain rather than help it.
 */

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",
  DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",
  MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",
  NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",
  TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",
  WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia",PR:"Puerto Rico",
}

export async function generateStaticParams() {
  try {
    const roles = await getFeaturedSocRoles()
    const bySoc = new Map(roles.map((r) => [r.soc_group, r.slug]))
    const slices = await getIndexableTransferSlices({ socGroups: [...bySoc.keys()] })
    return slices
      .filter((s) => bySoc.has(s.socGroup))
      .map((s) => ({ "role-slug": bySoc.get(s.socGroup)!, state: s.stateAbbr }))
  } catch {
    return []
  }
}

type Props = { params: Promise<{ "role-slug": string; state: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params
  const role = await getSocRoleBySlug(p["role-slug"])
  const state = p.state.toUpperCase()
  if (!role || !STATE_NAMES[state]) return { title: "Not found — Hireoven" }

  const employers = await getTransferFriendlyEmployers({
    socPrefix: role.soc_group,
    stateAbbr: state,
    limit: MIN_EMPLOYERS_FOR_INDEX,
  })
  const thin = employers.length < MIN_EMPLOYERS_FOR_INDEX

  return {
    title: `${role.label} H-1B Transfer Employers in ${STATE_NAMES[state]}`,
    description:
      `Employers that filed H-1B transfers for ${role.label} roles in ${STATE_NAMES[state]} in the last 12 months, ` +
      `ranked by transfer positions, with how fast their labor condition applications clear. From DOL filings.`,
    alternates: { canonical: `/stay/transfers/${role.slug}/by-state/${state}` },
    // Never index a page whose table is too short to answer the question it promises.
    ...(thin ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function TransfersRoleStatePage({ params }: Props) {
  const p = await params
  const role = await getSocRoleBySlug(p["role-slug"])
  const state = p.state.toUpperCase()
  if (!role || !STATE_NAMES[state]) notFound()

  const employers = await getTransferFriendlyEmployers({
    socPrefix: role.soc_group,
    stateAbbr: state,
    sinceDays: 365,
    limit: 30,
  })

  const totalPositions = employers.reduce((n, e) => n + e.transferPositions, 0)
  const stateName = STATE_NAMES[state]

  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto w-full max-w-[72rem] px-4 py-10 sm:px-6 lg:px-10">
        <nav className="mb-5 text-[13px] text-[#ccd6cf]/45">
          <Link href="/stay" className="hover:text-[#38e08a]">Stay</Link>
          <span className="mx-1.5 text-[#ccd6cf]/25">/</span>
          <Link href="/stay/transfers" className="hover:text-[#38e08a]">H-1B transfers</Link>
          <span className="mx-1.5 text-[#ccd6cf]/25">/</span>
          <span className="text-[#ccd6cf]/70">{role.label} · {state}</span>
        </nav>

        <h1 className="max-w-[26ch] text-[2rem] font-semibold leading-[1.06] tracking-tight text-white sm:text-[2.6rem]">
          Who transfers H-1Bs for <span className="text-[#f5a623]">{role.label}</span> in {stateName}
        </h1>

        <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-[#ccd6cf]/70">
          {employers.length > 0 ? (
            <>
              <span className="text-white">{employers.length} employers</span> filed H-1B transfers for{" "}
              {role.label} roles in {stateName} over the last 12 months, covering{" "}
              <span className="text-white">{totalPositions.toLocaleString()} transfer positions</span>. A transfer
              is a petition to take over an existing H-1B — which is what matters when you have weeks, not months.
            </>
          ) : (
            <>No H-1B transfer filings for {role.label} in {stateName} in the last 12 months. Transfers concentrate
            in a small number of employers, so try a neighbouring state or the national list.</>
          )}
        </p>

        {employers.length > 0 && (
          <div className="term-panel mt-7 overflow-x-auto">
            <table className="w-full min-w-[42rem] text-[13px]">
              <thead>
                <tr className="border-b border-[rgba(120,200,160,0.16)] text-left text-[11px] uppercase tracking-wide text-[#ccd6cf]/45">
                  <th className="px-4 py-3 font-medium">Employer</th>
                  <th className="px-4 py-3 text-right font-medium">Transfer positions</th>
                  <th className="px-4 py-3 text-right font-medium">Filings</th>
                  <th className="px-4 py-3 text-right font-medium">Median decision</th>
                </tr>
              </thead>
              <tbody>
                {employers.map((e) => (
                  <tr key={e.employerNormalized} className="border-b border-[rgba(120,200,160,0.08)] last:border-0">
                    <td className="px-4 py-3 text-white">
                      {e.employerName}
                      {e.isCapExempt && (
                        <span className="ml-2 border border-[rgba(120,200,160,0.3)] px-1.5 py-0.5 text-[10px] text-[#38e08a]">
                          cap-exempt
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-white">{e.transferPositions}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#ccd6cf]/65">{e.transferFilings}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#ccd6cf]/65">
                      {e.medianDecisionDays !== null ? `${e.medianDecisionDays}d` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2 text-[12px]">
          <Link href="/stay/transfers" className="border border-[rgba(120,200,160,0.22)] px-2.5 py-1 text-[#ccd6cf]/70 hover:text-white">
            All roles &amp; states
          </Link>
          <Link href={`/h1b-salaries/by-role/${role.slug}/by-state/${state}`} className="border border-[rgba(120,200,160,0.22)] px-2.5 py-1 text-[#ccd6cf]/70 hover:text-white">
            {role.label} salaries in {state}
          </Link>
        </div>

        <p className="mt-6 max-w-[74ch] text-[11px] leading-relaxed text-[#ccd6cf]/40">
          From certified Labor Condition Applications where the employer recorded a change of employer — the field
          USCIS&apos;s public data folds into a single &ldquo;continuing&rdquo; bucket. An LCA authorizes positions
          and is not a record of hires; one application can cover many positions, so large blanket filers rank high
          by construction. &ldquo;Median decision&rdquo; covers the labor condition application, which precedes the
          petition and is not the full transfer timeline. A past transfer shows an employer can do this, not that
          they will.
        </p>
      </main>
    </div>
  )
}

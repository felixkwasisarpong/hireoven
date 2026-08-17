import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import { listCapExemptCompanies, getCapExemptCounts } from "@/lib/h1b/cap-exempt-registry"

export const revalidate = 86400

/**
 * The cap-exempt employer registry.
 *
 * WHY THIS PAGE IS WORTH INDEXING: there is no official cap-exempt list. Exemption under
 * INA 214(g)(5) is adjudicated per petition on Form I-129 and never published, so every list in
 * this market is inferred from institution names or IPEDS. We can do better for a meaningful
 * slice of it, because employers declare ACWIA coverage — and which statutory prong they fall
 * under — on their own Department of Labor wage determinations.
 *
 * Attested records are shown first and labelled as such, because the distinction between "the
 * employer told the government this" and "the name contains the word university" is the entire
 * value of the page.
 *
 * ⚠ Wording is "states"/"attested", never "verified". A candidate who turns down a lottery-subject
 * offer because we told them an employer was exempt is a real harm, and attestation is not a
 * USCIS adjudication.
 */

export const metadata: Metadata = {
  title: "H-1B Cap-Exempt Employers — Hiring Now (Attested from DOL Filings)",
  description:
    "Cap-exempt employers with open roles: universities, affiliated nonprofits and research organisations that can file H-1B petitions year-round without the lottery. Ranked with employer-attested DOL declarations first.",
  alternates: { canonical: "/stay/cap-exempt" },
}

const REASON_LABEL: Record<string, string> = {
  university: "Institution of higher education",
  affiliated_nonprofit: "Affiliated nonprofit",
  nonprofit_research: "Nonprofit / government research",
  govt_research: "Government research",
}

export default async function CapExemptRegistryPage() {
  const [companies, counts] = await Promise.all([
    listCapExemptCompanies({ limit: 300 }),
    getCapExemptCounts(),
  ])

  const attested = companies.filter((c) => c.source === "acwia_attested")
  const inferred = companies.filter((c) => c.source !== "acwia_attested")

  return (
    <div className="term-page min-h-dvh">
      <Navbar />

      <section className="mx-auto w-full max-w-[76rem] px-4 pt-12 sm:px-6 sm:pt-16 lg:px-10">
        <Link href="/stay" className="term-label transition-colors hover:text-[#38e08a]">&lt; stay</Link>
        <h1 className="mt-4 max-w-[24ch] text-[2.2rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-[3rem]">
          H-1B <span className="text-[#f5a623]">cap-exempt</span> employers hiring now
        </h1>
        <p className="mt-5 max-w-[68ch] text-[16px] leading-relaxed text-[#ccd6cf]/70">
          Cap-exempt employers file H-1B petitions <span className="text-white">year-round, with no lottery</span>.
          There is no official government list — exemption is decided per petition and never published — so every
          list in this market is inferred from institution names. {counts ? (
            <>These <span className="text-white">{counts.attested.toLocaleString()}</span> employers declared
            ACWIA coverage on their own Department of Labor wage determinations.</>
          ) : null}
        </p>
      </section>

      {attested.length > 0 && (
        <section className="mx-auto mt-9 w-full max-w-[76rem] px-4 sm:px-6 lg:px-10">
          <h2 className="term-label">Employer-attested</h2>
          <p className="mt-1 text-[13px] text-[#ccd6cf]/55">
            These employers stated on a DOL filing which statutory ground they qualify under.
          </p>
          <div className="term-panel mt-3 overflow-x-auto">
            <table className="w-full min-w-[38rem] text-[13px]">
              <thead>
                <tr className="border-b border-[rgba(120,200,160,0.16)] text-left text-[11px] uppercase tracking-wide text-[#ccd6cf]/45">
                  <th className="px-4 py-3 font-medium">Employer</th>
                  <th className="px-4 py-3 font-medium">Grounds stated</th>
                  <th className="px-4 py-3 text-right font-medium">Open roles</th>
                </tr>
              </thead>
              <tbody>
                {attested.map((c) => (
                  <tr key={c.id} className="border-b border-[rgba(120,200,160,0.08)] last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/companies/${c.id}`} className="text-white hover:text-[#38e08a]">{c.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-[#ccd6cf]/65">
                      {c.reason ? REASON_LABEL[c.reason] ?? c.reason : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#ccd6cf]/70">{c.jobCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {inferred.length > 0 && (
        <section className="mx-auto mt-9 w-full max-w-[76rem] px-4 sm:px-6 lg:px-10">
          <h2 className="term-label">Likely cap-exempt</h2>
          <p className="mt-1 text-[13px] text-[#ccd6cf]/55">
            Identified from a .edu domain, institution name or federal-laboratory pattern rather than a filing.
            Treat as a strong hint, not a determination.
          </p>
          <div className="term-panel mt-3 overflow-x-auto">
            <table className="w-full min-w-[38rem] text-[13px]">
              <thead>
                <tr className="border-b border-[rgba(120,200,160,0.16)] text-left text-[11px] uppercase tracking-wide text-[#ccd6cf]/45">
                  <th className="px-4 py-3 font-medium">Employer</th>
                  <th className="px-4 py-3 font-medium">Basis</th>
                  <th className="px-4 py-3 text-right font-medium">Open roles</th>
                </tr>
              </thead>
              <tbody>
                {inferred.map((c) => (
                  <tr key={c.id} className="border-b border-[rgba(120,200,160,0.08)] last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/companies/${c.id}`} className="text-white hover:text-[#38e08a]">{c.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-[#ccd6cf]/65">
                      {c.reason ? REASON_LABEL[c.reason] ?? c.reason : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#ccd6cf]/70">{c.jobCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mx-auto mt-8 w-full max-w-[76rem] px-4 pb-20 sm:px-6 lg:px-10">
        <p className="max-w-[76ch] text-[11px] leading-relaxed text-[#ccd6cf]/40">
          Cap exemption under INA 214(g)(5) covers institutions of higher education, nonprofits related to or
          affiliated with one, and nonprofit or governmental research organisations. It is adjudicated per petition
          by USCIS and is never published as a list. &ldquo;Employer-attested&rdquo; here means the employer made
          that declaration on a Department of Labor prevailing wage determination — it is the employer&apos;s own
          statement, not a USCIS determination, and coverage can change. Confirm with the employer&apos;s
          immigration counsel before making a decision that depends on it.
        </p>
      </section>
    </div>
  )
}

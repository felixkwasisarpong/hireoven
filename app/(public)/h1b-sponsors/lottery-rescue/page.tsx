import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"

export const revalidate = 86400

export const metadata: Metadata = {
  title: "If You Lost the H-1B Lottery: Cap-Exempt Employers and STEM OPT",
  description:
    "A plain guide to your options after an H-1B lottery rejection — cap-exempt employers who file outside the cap (INA 214(g)(5)) and E-Verify employers for STEM OPT extensions.",
  alternates: { canonical: "/h1b-sponsors/lottery-rescue" },
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-8 scroll-mt-24 text-xl font-semibold text-white">
      {children}
    </h2>
  )
}

export default function LotteryRescuePage() {
  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <article className="text-[15px] leading-relaxed text-[#ccd6cf]/80">
          <p className="term-label">&gt; lottery_rescue --after-rejection</p>
          <h1 className="mt-4 text-[2.1rem] font-semibold leading-tight tracking-tight text-white sm:text-[2.6rem]">
            If you <span className="text-[#f5a623]">lost</span> the H-1B lottery
            <span className="ml-1 inline-block w-[0.5ch] animate-pulse text-[#38e08a]">_</span>
          </h1>
          <p className="mt-4">
            Each year the H-1B cap is far smaller than the number of registrations, so most
            applicants are not selected. A rejection is common and it is not the end of the road.
            This page explains the two legal routes most people in this position look into next.
            It is informational, not legal advice — for your specific case, talk to an immigration
            attorney.
          </p>

          <H2 id="cap-exempt">Cap-exempt employers</H2>
          <p className="mt-2">
            Some employers can file an H-1B petition <strong>outside the annual lottery</strong>,
            at any time of year. Under{" "}
            <a
              href="https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
            >
              INA 214(g)(5)
            </a>
            , the cap does not apply to institutions of higher education, nonprofit organizations
            affiliated with them, and nonprofit or governmental research organizations. In practice
            that means universities, university-affiliated hospitals and research centers, and
            federal labs can sponsor an H-1B without entering the lottery.
          </p>
          <p className="mt-2">
            If you work for a cap-exempt employer, you can hold H-1B status even though you were
            never selected in the cap. Some people use a cap-exempt role to maintain status while
            re-entering the lottery in a later year.
          </p>
          <p className="mt-2">
            We maintain a searchable list of likely cap-exempt employers, classified from public
            signals (employer name, web domain, and industry). Always confirm cap-exempt status with
            the specific employer before relying on it.
          </p>
          <p className="mt-3">
            <Link href="/h1b-sponsors/cap-exempt" className="term-btn term-btn-amber">
              Browse cap-exempt employers →
            </Link>
          </p>

          <H2 id="stem-opt">STEM OPT and E-Verify</H2>
          <p className="mt-2">
            If you are an F-1 student with a degree in an eligible STEM field, you may qualify for a
            24-month extension of your Optional Practical Training (OPT). A condition of the STEM OPT
            extension is that your employer must be enrolled in{" "}
            <a
              href="https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/optional-practical-training-extension-for-stem-students-stem-opt"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
            >
              E-Verify
            </a>
            , the federal employment-eligibility program. A STEM OPT extension buys additional time
            to be selected in a future H-1B lottery.
          </p>
          <p className="mt-2">
            Before accepting an offer that you are counting on for STEM OPT, confirm the employer is
            enrolled in E-Verify. You can check any employer directly in the{" "}
            <a
              href="https://www.e-verify.gov/e-verify-employer-search"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
            >
              USCIS E-Verify employer search
            </a>
            .
          </p>

          <H2 id="other">Other timelines worth knowing</H2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Standard OPT gives 12 months of work authorization after graduation; the STEM extension adds 24 more.</li>
            <li>Cap-exempt H-1B petitions can be filed year-round, not just during the spring registration window.</li>
            <li>Employers can re-register you for the cap in a future year while you hold another status.</li>
          </ul>

          <p className="mt-8 text-xs text-[#ccd6cf]/45">
            Sources: USCIS H-1B specialty occupations (INA 214(g)(5)); USCIS STEM OPT extension;
            USCIS E-Verify employer search. This page is informational and not a substitute for advice
            from a licensed immigration attorney.
          </p>
        </article>
      </main>
    </div>
  )
}

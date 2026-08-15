import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"

export const metadata: Metadata = {
  title: "H-1B Sponsor Leaderboard Methodology & Data Sources",
  description:
    "How Hireoven ranks H-1B sponsors: data sources (DOL LCA, USCIS), what each metric means, caveats, refresh cadence, and inclusion thresholds.",
  alternates: { canonical: "/h1b-sponsors/leaderboard/methodology" },
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-[#ccd6cf]/70">{children}</div>
    </section>
  )
}

export default function MethodologyPage() {
  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link
          href="/h1b-sponsors/leaderboard"
          className="text-[13px] text-[#ccd6cf]/60 underline decoration-[rgba(120,200,160,0.2)] underline-offset-4 hover:text-[#38e08a]"
        >
          ← Back to leaderboard
        </Link>
        <p className="term-label mt-6">{"Methodology"}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
          Leaderboard <span className="text-[#f5a623]">methodology</span>
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[#ccd6cf]/70">
          How the H-1B Sponsor Leaderboard is built, what its numbers mean, and where they
          come from.
        </p>

        <Section title="Data sources">
          <p>
            Rankings are built from the U.S. Department of Labor&rsquo;s{" "}
            <strong className="text-[#ccd6cf]">Labor Condition Application (LCA) disclosure data</strong>, the public
            record every employer must file before petitioning for an H-1B worker. The
            current dataset covers <strong className="text-[#ccd6cf]">fiscal year 2025</strong> (Oct 2024 – Sep 2025).
          </p>
          <p>
            We also maintain USCIS H-1B Employer Data Hub records (actual petition
            approvals/denials) used elsewhere on company profiles; the leaderboard itself
            ranks on LCA filings.
          </p>
        </Section>

        <Section title="What each metric means">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong className="text-[#ccd6cf]">Certified filings:</strong> LCAs certified by the DOL for that
              employer. This is a measure of <em>filing volume</em>, not approved visas.
            </li>
            <li>
              <strong className="text-[#ccd6cf]">Certification rate:</strong> certified ÷ (certified + denied). The
              DOL certifies the large majority of LCAs, so a low rate is a meaningful signal.
            </li>
            <li>
              <strong className="text-[#ccd6cf]">Top states:</strong> worksite states most frequently listed on the
              employer&rsquo;s filings.
            </li>
          </ul>
        </Section>

        <Section title="Important caveats">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              An LCA is filed <em>before</em> the visa petition, so it is not a granted H-1B.
              Filing volume reflects hiring intent and scale, not visas issued.
            </li>
            <li>
              Staffing and consulting firms file at high volume by nature of their business.
              Use the <strong className="text-[#ccd6cf]">&ldquo;Exclude staffing firms&rdquo;</strong> toggle for a view
              weighted toward direct employers.
            </li>
            <li>
              Employers are matched to companies by normalized name; some filings may be
              unattributed or split across legal-entity name variants we merge where possible.
            </li>
          </ul>
        </Section>

        <Section title="Inclusion threshold">
          <p>
            A company appears once it has at least <strong className="text-[#ccd6cf]">5 LCA filings</strong> and is an
            active employer in our directory. Name variants of the same company are merged
            into a single row.
          </p>
        </Section>

        <Section title="Refresh cadence">
          <p>
            Rankings are recomputed nightly from the latest imported DOL data. The
            &ldquo;updated&rdquo; date on the leaderboard reflects the last refresh.
          </p>
        </Section>

        <section id="layoffs" className="mt-8 scroll-mt-24">
          <h2 className="text-lg font-semibold text-white">Workforce / layoff signal</h2>
          <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-[#ccd6cf]/70">
            <p>
              The workforce signal on each sponsor reflects publicly reported layoff
              activity. It is informational, not a prediction or an endorsement.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong className="text-[#ccd6cf]">Data sources:</strong> U.S. Department of Labor WARN Act filings
                (via layoffdata.com&rsquo;s public dataset) and reported layoff events.
              </li>
              <li>
                <strong className="text-[#ccd6cf]">Tiers:</strong> <em>No recent layoffs</em> (none in 12 months),{" "}
                <em>Recent layoffs</em> (one event in 12 months), <em>Elevated</em> (two or
                more events, or an accelerating trend), <em>Active</em> (an event in the
                last 90 days or a confirmed hiring freeze).
              </li>
              <li>
                <strong className="text-[#ccd6cf]">Refresh:</strong> the layoff importer runs daily; counts use rolling
                90-day and 12-month windows.
              </li>
              <li>
                <strong className="text-[#ccd6cf]">What it is not:</strong> a forecast, financial advice, or a judgment
                of any company. It surfaces records that are already public. WARN covers mass
                layoffs above state thresholds, so smaller cuts may not appear.
              </li>
            </ul>
            <p>
              Spotted an error? <a href="/support" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">Let us know</a> and we&rsquo;ll correct it.
            </p>
          </div>
        </section>

        <section id="personal-scorecard" className="mt-8 scroll-mt-24">
          <h2 className="text-lg font-semibold text-white">Personal sponsorability scorecard</h2>
          <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-[#ccd6cf]/70">
            <p>
              Your personal scorecard is a <strong className="text-[#ccd6cf]">profile-vs-market fit</strong> signal — how your
              resume lines up with the H-1B-sponsoring job market. It is not a guarantee, and it is
              not a measure of your worth.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong className="text-[#ccd6cf]">Skills demand</strong> — how many sponsor postings (last 12 months) want your
                top skills.
              </li>
              <li>
                <strong className="text-[#ccd6cf]">Skills rarity</strong> — how rare-but-in-demand your skill stack is (a niche
                edge). v1 uses a demand-based proxy.
              </li>
              <li>
                <strong className="text-[#ccd6cf]">Experience fit</strong> — how your years of experience align with your stated
                seniority.
              </li>
              <li>
                <strong className="text-[#ccd6cf]">Education</strong> — models LCA approval patterns (advanced + STEM degrees,
                work authorization).
              </li>
            </ul>
            <p>
              Each component is scored out of 25 for a total out of 100, mapped to a grade from A+ to
              C. The lowest band is &ldquo;Building Profile&rdquo; — a common profile, never
              &ldquo;unsponsorable.&rdquo; The score updates whenever you update your resume.
            </p>
          </div>
        </section>

        <section id="embeds" className="mt-8 scroll-mt-24">
          <h2 className="text-lg font-semibold text-white">Embeddable widgets</h2>
          <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-[#ccd6cf]/70">
            <p>
              The leaderboard, company scorecards, and personal scorecards are available as{" "}
              <Link href="/embed" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
                embeddable widgets
              </Link>{" "}
              for any site. They render server-side, set no cookies, and run no tracking script on
              the host page.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong className="text-[#ccd6cf]">Personal widgets</strong> are shown only while you keep your card public;
                revoking the link replaces the widget with an &ldquo;unavailable&rdquo; card.
              </li>
              <li>
                <strong className="text-[#ccd6cf]">Analytics</strong> record only the embedding site&rsquo;s domain and a
                hashed, truncated user-agent. We never store IP addresses, full URLs, or visitor
                identities.
              </li>
              <li>
                <strong className="text-[#ccd6cf]">Attribution</strong> (&ldquo;Powered by Hireoven&rdquo;) is required on the
                free tier and removable only with a partner plan.
              </li>
            </ul>
          </div>
        </section>

        <section id="salaries" className="mt-8 scroll-mt-24">
          <h2 className="text-lg font-semibold text-white">H-1B salaries</h2>
          <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-[#ccd6cf]/70">
            <p>
              Salary figures are <strong className="text-[#ccd6cf]">prevailing wages</strong> from certified DOL Labor Condition
              Application (LCA) filings. The prevailing wage is the wage an employer commits to pay
              when filing — it is <strong className="text-[#ccd6cf]">not</strong> necessarily what is actually paid, and it
              excludes bonus, equity, and sign-on.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Wages filed in hourly, weekly, bi-weekly, or monthly units are converted to an annual
                figure before any statistic is computed; obvious data errors (outside ~$15k–$1M) are
                dropped.
              </li>
              <li>
                We show the <strong className="text-[#ccd6cf]">median</strong> (p50) with the 25th and 75th percentiles, never a
                mean — wage distributions are skewed, and the median resists outliers.
              </li>
              <li>
                Every statistic shows its <strong className="text-[#ccd6cf]">sample size</strong> and fiscal-year range. We do
                not display a median computed from fewer than <strong className="text-[#ccd6cf]">5 filings</strong> — those read
                &ldquo;insufficient public data&rdquo; instead.
              </li>
              <li>Wage levels (I–IV) reflect the experience tier the employer filed under.</li>
              <li>No individual filing records are shown — aggregates only. Refreshed nightly.</li>
            </ul>
            <p>
              Company-scoped pages cover employers we&rsquo;ve matched to filings; role and state
              pages aggregate all certified filings, matched or not.
            </p>
          </div>
        </section>

        <section id="cap-exempt" className="mt-8 scroll-mt-24">
          <h2 className="text-lg font-semibold text-white">Cap-exempt classification</h2>
          <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-[#ccd6cf]/70">
            <p>
              Under INA 214(g)(5), institutions of higher education, affiliated nonprofits, and
              governmental/nonprofit research organizations can file H-1B petitions outside the
              annual cap. We classify employers from public signals:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong className="text-emerald-300">High</strong> — a <code className="text-[#38e08a]">.edu</code> domain, an unambiguous university name, or a federal research lab.</li>
              <li><strong className="text-amber-300">Medium</strong> — &ldquo;College&rdquo; in the name or an education industry.</li>
              <li><strong className="text-[#ccd6cf]/70">Low</strong> — a research-mission name signal we can&rsquo;t fully confirm. Shown with a &ldquo;verify with employer&rdquo; note.</li>
            </ul>
            <p>
              Re-classified nightly. This is a heuristic, not legal advice — always confirm cap-exempt
              status with the employer before relying on it for a petition.
            </p>
          </div>
        </section>

        <section id="e-verify" className="mt-8 scroll-mt-24">
          <h2 className="text-lg font-semibold text-white">E-Verify status</h2>
          <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-[#ccd6cf]/70">
            <p>
              E-Verify is the federal employment-eligibility program; enrollment is required for the
              24-month STEM OPT extension. USCIS publishes participation through a daily-updated{" "}
              <a
                href="https://www.e-verify.gov/e-verify-employer-search"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
              >
                employer search tool
              </a>
              , not a bulk download, so we surface E-Verify only on employers we can match by exact
              normalized name (no fuzzy matching — a false flag could harm a STEM OPT case). For any
              employer not flagged here, check the official tool directly. Enrollment can change
              between USCIS updates.
            </p>
          </div>
        </section>

        <Section title="Corrections">
          <p>
            Spotted something off? We publish corrections.{" "}
            <Link href="/support" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
              Contact us
            </Link>
            .
          </p>
        </Section>
      </main>
    </div>
  )
}

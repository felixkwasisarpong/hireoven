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
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-2 text-slate-600">{children}</div>
    </section>
  )
}

export default function MethodologyPage() {
  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link
          href="/h1b-sponsors/leaderboard"
          className="text-sm text-slate-500 underline hover:text-slate-700"
        >
          ← Back to leaderboard
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
          Leaderboard methodology
        </h1>
        <p className="mt-2 text-slate-600">
          How the H-1B Sponsor Leaderboard is built, what its numbers mean, and where they
          come from.
        </p>

        <Section title="Data sources">
          <p>
            Rankings are built from the U.S. Department of Labor&rsquo;s{" "}
            <strong>Labor Condition Application (LCA) disclosure data</strong>, the public
            record every employer must file before petitioning for an H-1B worker. The
            current dataset covers <strong>fiscal year 2025</strong> (Oct 2024 – Sep 2025).
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
              <strong>Certified filings:</strong> LCAs certified by the DOL for that
              employer. This is a measure of <em>filing volume</em>, not approved visas.
            </li>
            <li>
              <strong>Certification rate:</strong> certified ÷ (certified + denied). The
              DOL certifies the large majority of LCAs, so a low rate is a meaningful signal.
            </li>
            <li>
              <strong>Top states:</strong> worksite states most frequently listed on the
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
              Use the <strong>&ldquo;Exclude staffing firms&rdquo;</strong> toggle for a view
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
            A company appears once it has at least <strong>5 LCA filings</strong> and is an
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
          <h2 className="text-lg font-semibold text-slate-900">Workforce / layoff signal</h2>
          <div className="mt-2 space-y-2 text-slate-600">
            <p>
              The workforce signal on each sponsor reflects publicly reported layoff
              activity. It is informational, not a prediction or an endorsement.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Data sources:</strong> U.S. Department of Labor WARN Act filings
                (via layoffdata.com&rsquo;s public dataset) and reported layoff events.
              </li>
              <li>
                <strong>Tiers:</strong> <em>No recent layoffs</em> (none in 12 months),{" "}
                <em>Recent layoffs</em> (one event in 12 months), <em>Elevated</em> (two or
                more events, or an accelerating trend), <em>Active</em> (an event in the
                last 90 days or a confirmed hiring freeze).
              </li>
              <li>
                <strong>Refresh:</strong> the layoff importer runs daily; counts use rolling
                90-day and 12-month windows.
              </li>
              <li>
                <strong>What it is not:</strong> a forecast, financial advice, or a judgment
                of any company. It surfaces records that are already public. WARN covers mass
                layoffs above state thresholds, so smaller cuts may not appear.
              </li>
            </ul>
            <p>
              Spotted an error? <a href="/support" className="underline hover:text-slate-800">Let us know</a> and we&rsquo;ll correct it.
            </p>
          </div>
        </section>

        <section id="personal-scorecard" className="mt-8 scroll-mt-24">
          <h2 className="text-lg font-semibold text-slate-900">Personal sponsorability scorecard</h2>
          <div className="mt-2 space-y-2 text-slate-600">
            <p>
              Your personal scorecard is a <strong>profile-vs-market fit</strong> signal — how your
              resume lines up with the H-1B-sponsoring job market. It is not a guarantee, and it is
              not a measure of your worth.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Skills demand</strong> — how many sponsor postings (last 12 months) want your
                top skills.
              </li>
              <li>
                <strong>Skills rarity</strong> — how rare-but-in-demand your skill stack is (a niche
                edge). v1 uses a demand-based proxy.
              </li>
              <li>
                <strong>Experience fit</strong> — how your years of experience align with your stated
                seniority.
              </li>
              <li>
                <strong>Education</strong> — models LCA approval patterns (advanced + STEM degrees,
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

        <Section title="Corrections">
          <p>
            Spotted something off? We publish corrections.{" "}
            <Link href="/support" className="underline hover:text-slate-800">
              Contact us
            </Link>
            .
          </p>
        </Section>
      </main>
    </div>
  )
}

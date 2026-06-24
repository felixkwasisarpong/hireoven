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

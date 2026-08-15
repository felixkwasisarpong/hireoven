import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import MarketingFooter from "@/components/marketing/MarketingFooter"

export const metadata: Metadata = {
  title: "Terms of Service - Hireoven",
  description: "Terms and conditions for using Hireoven.",
}

export default function TermsPage() {
  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="term-label">Terms of service</p>
        <h1 className="mt-3 text-[2rem] font-semibold tracking-tight text-white">Terms of Service</h1>
        <p className="mt-2 text-[13px] text-[#ccd6cf]/45">Last updated: April 2025</p>

        <div className="mt-10 space-y-8 text-[14px] leading-relaxed text-[#ccd6cf]">

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">1. What Hireoven is</h2>
            <p>
              Hireoven is a job monitoring service that crawls publicly available company career pages and
              surfaces new job listings to registered users via alerts and a dashboard feed. We are not a
              recruiter, staffing agency, or employment platform. We do not facilitate applications - we
              link directly to the original job posting on the company&apos;s own careers page.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">2. Your account</h2>
            <p>
              You must provide a valid email address and keep your login credentials secure. You are
              responsible for all activity on your account. You must be at least 16 years old to use
              Hireoven.
            </p>
            <p className="mt-3">
              We reserve the right to suspend or terminate accounts that abuse the service (e.g. automated
              scraping via our API, creating fake accounts, or attempting to interfere with crawl
              infrastructure).
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">3. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Scrape or bulk-export job data from Hireoven for redistribution</li>
              <li>Use the service to build a competing job aggregator without permission</li>
              <li>Attempt to circumvent rate limits or access internal APIs</li>
              <li>Submit false or misleading information when creating alerts</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">4. Job data accuracy</h2>
            <p>
              Job listings on Hireoven are sourced automatically from company career pages. We make no
              guarantees about the accuracy, completeness, or timeliness of listings. A job shown as
              &quot;open&quot; may have been filled. Always verify the listing directly on the company&apos;s
              careers page before applying.
            </p>
            <p className="mt-3">
              H1B sponsorship scores and visa signals are estimates derived from public data (USCIS petition
              records and job description text). They are not legal advice. Consult an immigration attorney
              for sponsorship guidance.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">5. Intellectual property</h2>
            <p>
              The Hireoven platform, brand, and original content are owned by Hireoven. Job descriptions
              and company names are the property of their respective owners and are reproduced here for
              informational purposes only.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">6. Disclaimer of warranties</h2>
            <p>
              Hireoven is provided &quot;as is&quot; without warranty of any kind. We do not guarantee uninterrupted
              service, that every job will be detected within 30 minutes, or that sponsorship assessments
              are accurate. Use the service at your own risk.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">7. Limitation of liability</h2>
            <p>
              To the fullest extent permitted by law, Hireoven is not liable for any indirect, incidental,
              or consequential damages arising from your use of or inability to use the service, including
              missed job opportunities.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">8. Changes</h2>
            <p>
              We may update these terms. Continued use of Hireoven after changes are posted constitutes
              acceptance of the revised terms. Material changes will be emailed to registered users at
              least 14 days in advance.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">9. Contact</h2>
            <p>
              Questions about these terms? Email{" "}
              <a href="mailto:legal@hireoven.com" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
                legal@hireoven.com
              </a>.
            </p>
          </section>

        </div>

        <div className="mt-12 border-t border-[rgba(120,200,160,0.2)] pt-8 text-[13px] text-[#ccd6cf]/55">
          Also see our{" "}
          <Link href="/privacy" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
            Privacy Policy
          </Link>{" "}
          or return to{" "}
          <Link href="/" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
            Hireoven
          </Link>.
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}

import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"

export const metadata: Metadata = {
  title: "Privacy Policy — Hireoven",
  description: "How Hireoven collects, uses, and protects your personal information.",
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: April 2025</p>

        <div className="prose prose-gray max-w-none text-gray-700 leading-relaxed space-y-8">

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. What we collect</h2>
            <p>
              When you create an account, we collect your email address and password (hashed). When you
              set up job alerts, we store your alert preferences (keywords, location, seniority, sponsorship
              filters). We log which jobs you view and apply to so we can improve relevance.
            </p>
            <p className="mt-3">
              We do not collect your résumé, phone number, or any payment information (Hireoven is free).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. How we use your data</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Send you job alert emails matching your saved preferences</li>
              <li>Show you personalized job feeds inside the dashboard</li>
              <li>Calculate aggregate platform statistics (total jobs, companies monitored)</li>
              <li>Improve crawl coverage and job matching accuracy</li>
            </ul>
            <p className="mt-3">We never sell your personal data to third parties.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Emails and notifications</h2>
            <p>
              You control alert frequency (immediate, daily digest, weekly digest, or off) from your
              dashboard settings. You can unsubscribe from all emails at any time via the unsubscribe
              link in any email we send. Transactional emails (password reset, account confirmation)
              cannot be disabled.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Data storage</h2>
            <p>
              Your data is stored in Supabase (hosted on AWS us-east-1). Emails are sent via Resend.
              The app runs on infrastructure we operate (e.g. self-hosted Docker). We use Vercel
              Analytics for anonymous page-view statistics — no personal identifiers are sent to
              Vercel Analytics.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Cookies</h2>
            <p>
              We use a single session cookie to keep you logged in. We do not use advertising cookies
              or third-party tracking pixels.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Your rights</h2>
            <p>
              You can delete your account at any time from Dashboard → Settings → Delete account. This
              permanently removes your email, alert preferences, and activity logs within 30 days.
            </p>
            <p className="mt-3">
              To request a data export or ask questions, email us at{" "}
              <a href="mailto:privacy@hireoven.com" className="text-[#0369A1] hover:underline">
                privacy@hireoven.com
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Changes to this policy</h2>
            <p>
              We may update this policy as the product evolves. We will notify registered users by email
              for any material changes at least 14 days before they take effect.
            </p>
          </section>

        </div>

        <div className="mt-12 border-t border-gray-100 pt-8 text-sm text-gray-500">
          Questions? Email{" "}
          <a href="mailto:privacy@hireoven.com" className="text-[#0369A1] hover:underline">
            privacy@hireoven.com
          </a>{" "}
          or return to{" "}
          <Link href="/" className="text-[#0369A1] hover:underline">
            Hireoven
          </Link>.
        </div>
      </main>
    </div>
  )
}

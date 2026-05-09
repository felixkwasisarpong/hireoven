import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"

export const metadata: Metadata = {
  title: "Support - Hireoven",
  description: "Get help with Hireoven. Contact support, find answers to common questions, and learn how to use the extension.",
}

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Support</h1>
        <p className="text-sm text-gray-400 mb-10">We&apos;re here to help.</p>

        <div className="prose prose-gray max-w-none text-gray-700 leading-relaxed space-y-8">

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Contact us</h2>
            <p>
              For any questions, issues, or feedback, email us at{" "}
              <a href="mailto:support@hireoven.com" className="text-[#0369A1] hover:underline">
                support@hireoven.com
              </a>
              . We typically respond within one business day.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Chrome extension</h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-medium text-gray-900">The extension isn&apos;t detecting jobs on a page</h3>
                <p className="mt-1 text-sm">
                  Make sure you&apos;re signed in to your Hireoven account. The extension works on LinkedIn, Greenhouse,
                  Lever, Ashby, Workday, iCIMS, SmartRecruiters, BambooHR, Glassdoor, Indeed, and Handshake. If a
                  job isn&apos;t detected on a supported site, try refreshing the page and clicking the extension icon.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">Jobs aren&apos;t saving to my dashboard</h3>
                <p className="mt-1 text-sm">
                  Click the extension icon and check that you&apos;re logged in. If you see a sign-in prompt, log in
                  through the popup. If the issue persists, try removing and re-adding the extension.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">How do I install the extension?</h3>
                <p className="mt-1 text-sm">
                  Search for &quot;Hireoven Scout Bridge&quot; in the Chrome Web Store and click Add to Chrome. You&apos;ll
                  need a Hireoven account — sign up free at{" "}
                  <Link href="/" className="text-[#0369A1] hover:underline">hireoven.com</Link>.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Account &amp; billing</h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-medium text-gray-900">How do I cancel my subscription?</h3>
                <p className="mt-1 text-sm">
                  Go to your dashboard, open the Billing tab, and click &quot;Cancel plan.&quot; Your access continues
                  until the end of the current billing period.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">I was charged incorrectly</h3>
                <p className="mt-1 text-sm">
                  Email{" "}
                  <a href="mailto:support@hireoven.com" className="text-[#0369A1] hover:underline">
                    support@hireoven.com
                  </a>{" "}
                  with your account email and a description of the charge. We&apos;ll resolve it within 2 business days.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">How do I delete my account?</h3>
                <p className="mt-1 text-sm">
                  Email{" "}
                  <a href="mailto:support@hireoven.com" className="text-[#0369A1] hover:underline">
                    support@hireoven.com
                  </a>{" "}
                  from your registered address and request account deletion. We&apos;ll process it within 7 days.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Data &amp; privacy</h2>
            <p>
              The Hireoven Scout Bridge extension only reads job listing data from pages you actively visit and
              uses your session cookie to authenticate saves to your account. We do not track your browsing
              history or collect data from non-job pages. See our{" "}
              <Link href="/privacy" className="text-[#0369A1] hover:underline">Privacy Policy</Link> for full details.
            </p>
          </section>

        </div>

        <div className="mt-12 border-t border-gray-100 pt-8 text-sm text-gray-500">
          Also see our{" "}
          <Link href="/privacy" className="text-[#0369A1] hover:underline">Privacy Policy</Link>
          {" "}or{" "}
          <Link href="/terms" className="text-[#0369A1] hover:underline">Terms of Service</Link>
          {", "}or return to{" "}
          <Link href="/" className="text-[#0369A1] hover:underline">Hireoven</Link>.
        </div>
      </main>
    </div>
  )
}

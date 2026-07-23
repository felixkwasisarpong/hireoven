import type { Metadata } from "next"
import Link from "next/link"
import Navbar from "@/components/layout/Navbar"
import MarketingFooter from "@/components/marketing/MarketingFooter"

export const metadata: Metadata = {
  title: "Support - Hireoven",
  description: "Get help with Hireoven. Contact support, find answers to common questions, and learn how to use the extension.",
}

export default function SupportPage() {
  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="term-label">&gt; support</p>
        <h1 className="mt-3 text-[2rem] font-semibold tracking-tight text-white">Support</h1>
        <p className="mt-2 text-[13px] text-[#ccd6cf]/45">We&apos;re here to help.</p>

        <div className="mt-10 space-y-8 text-[14px] leading-relaxed text-[#ccd6cf]">

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">Contact us</h2>
            <p>
              For any questions, issues, or feedback, email us at{" "}
              <a href="mailto:support@hireoven.com" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
                support@hireoven.com
              </a>
              . We typically respond within one business day.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">Chrome extension</h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-white">The extension isn&apos;t detecting jobs on a page</h3>
                <p className="mt-1 text-[13px] text-[#ccd6cf]/80">
                  Make sure you&apos;re signed in to your Hireoven account. The extension works on LinkedIn, Greenhouse,
                  Lever, Ashby, Workday, iCIMS, SmartRecruiters, BambooHR, Glassdoor, Indeed, and Handshake. If a
                  job isn&apos;t detected on a supported site, try refreshing the page and clicking the extension icon.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-white">Jobs aren&apos;t saving to my dashboard</h3>
                <p className="mt-1 text-[13px] text-[#ccd6cf]/80">
                  Click the extension icon and check that you&apos;re logged in. If you see a sign-in prompt, log in
                  through the popup. If the issue persists, try removing and re-adding the extension.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-white">How do I install the extension?</h3>
                <p className="mt-1 text-[13px] text-[#ccd6cf]/80">
                  Search for &quot;Hireoven Apex Bridge&quot; in the Chrome Web Store and click Add to Chrome. You&apos;ll
                  need a Hireoven account — sign up free at{" "}
                  <Link href="/" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">hireoven.com</Link>.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">Account &amp; billing</h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-white">How do I cancel my subscription?</h3>
                <p className="mt-1 text-[13px] text-[#ccd6cf]/80">
                  Go to your dashboard, open the Billing tab, and click &quot;Cancel plan.&quot; Your access continues
                  until the end of the current billing period.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-white">I was charged incorrectly</h3>
                <p className="mt-1 text-[13px] text-[#ccd6cf]/80">
                  Email{" "}
                  <a href="mailto:support@hireoven.com" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
                    support@hireoven.com
                  </a>{" "}
                  with your account email and a description of the charge. We&apos;ll resolve it within 2 business days.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-white">How do I delete my account?</h3>
                <p className="mt-1 text-[13px] text-[#ccd6cf]/80">
                  Email{" "}
                  <a href="mailto:support@hireoven.com" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">
                    support@hireoven.com
                  </a>{" "}
                  from your registered address and request account deletion. We&apos;ll process it within 7 days.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-[1.05rem] font-semibold text-white">Data &amp; privacy</h2>
            <p>
              The Hireoven Apex Bridge extension only reads job listing data from pages you actively visit and
              uses your session cookie to authenticate saves to your account. We do not track your browsing
              history or collect data from non-job pages. See our{" "}
              <Link href="/privacy" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">Privacy Policy</Link> for full details.
            </p>
          </section>

        </div>

        <div className="mt-12 border-t border-[rgba(120,200,160,0.2)] pt-8 text-[13px] text-[#ccd6cf]/55">
          Also see our{" "}
          <Link href="/privacy" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">Privacy Policy</Link>
          {" "}or{" "}
          <Link href="/terms" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">Terms of Service</Link>
          {", "}or return to{" "}
          <Link href="/" className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]">Hireoven</Link>.
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}

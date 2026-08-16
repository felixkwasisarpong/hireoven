import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { LaunchNavbar } from "@/components/waitlist/LaunchChrome"
import LaunchJobFeed from "@/components/waitlist/LaunchJobFeed"
import ScrollToWaitlist from "@/components/waitlist/ScrollToWaitlist"
import WaitlistForm from "@/components/waitlist/WaitlistForm"
import { getPostgresPool } from "@/lib/postgres/server"
import { getPublicSiteUrl } from "@/lib/waitlist/site-url"

const site = getPublicSiteUrl()

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: "Hireoven - Jobs served fresh",
  description:
    "See job listings within minutes of being posted. H1B sponsorship scores built in. Join the waitlist.",
  openGraph: {
    title: "The job board that beats everyone to it",
    description: "Real-time jobs + H1B intel. Launching soon.",
    url: "/launch",
    siteName: "Hireoven",
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: "Hireoven - jobs served fresh",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "The job board that beats everyone to it",
    description: "Real-time jobs + H1B intel. Launching soon.",
    images: ["/api/og"],
  },
}

export const dynamic = "force-dynamic"

async function getWaitlistDisplayCount() {
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM waitlist`)
    const c = Number(rows[0]?.c ?? 0)
    return c > 0 ? c : 1247
  } catch {
    return 1247
  }
}

function ProblemIconClock() {
  return (
    <div
      className="relative mx-auto flex h-14 w-14 items-center justify-center border border-[rgba(120,200,160,0.26)] bg-[#0e1411]"
      aria-hidden
    >
      <span className="absolute left-1/2 top-[26%] h-[28%] w-[2px] origin-bottom rounded-full bg-red-400" />
      <span className="absolute left-1/2 top-[30%] h-[24%] w-[2px] origin-bottom rotate-[55deg] rounded-full bg-red-400" />
    </div>
  )
}

function ProblemIconChain() {
  return (
    <div className="mx-auto flex h-14 w-14 items-center justify-center border border-[rgba(120,200,160,0.26)] bg-[#0e1411] text-[#ccd6cf]/50" aria-hidden>
      <svg viewBox="0 0 56 56" className="h-9 w-9">
        <circle cx="14" cy="28" r="8" fill="none" stroke="currentColor" strokeWidth="3" />
        <circle cx="42" cy="28" r="8" fill="none" stroke="currentColor" strokeWidth="3" />
        <path
          d="M22 28h12"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

function ProblemIconBolt() {
  return (
    <div className="mx-auto flex h-14 w-14 items-center justify-center border border-[rgba(120,200,160,0.26)] bg-[#0e1411] text-[#f5a623]" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current">
        <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
      </svg>
    </div>
  )
}

export default async function LaunchPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const waitlistCount = await getWaitlistDisplayCount()
  const confirmed =
    typeof searchParams.confirmed === "string"
      ? searchParams.confirmed === "true"
      : Array.isArray(searchParams.confirmed)
        ? searchParams.confirmed[0] === "true"
        : false
  const unsub =
    typeof searchParams.unsubscribed === "string"
      ? searchParams.unsubscribed === "1"
      : false

  return (
    <div className="term-page min-h-dvh">
      <LaunchNavbar />

      {confirmed ? (
        <div className="border-b border-[rgba(120,200,160,0.26)] bg-[#0e1411] px-4 py-3 text-center text-sm font-medium text-[#38e08a]">
          Email confirmed! You&apos;re officially on the list. We&apos;ll be in touch soon.
        </div>
      ) : null}
      {unsub ? (
        <div className="border-b border-[rgba(120,200,160,0.26)] bg-[#0e1411] px-4 py-3 text-center text-sm text-[#ccd6cf]/60">
          You&apos;ve been unsubscribed from waitlist updates.
        </div>
      ) : null}

      {/* Hero */}
      <section className="border-b border-[rgba(120,200,160,0.2)] px-4 py-14 lg:py-20">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[3fr_2fr] lg:items-center">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-[11px] font-semibold text-[#ccd6cf]/80">
              <span className="h-2 w-2 rounded-full bg-[#38e08a]" />
              {"building in public // launching soon"}
            </div>
            <h1 className="text-[2.4rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-[3.25rem] lg:leading-[1.08]">
              Jobs posted <span className="text-[#f5a623]">minutes</span> ago.
              <br />
              Not days.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[#ccd6cf]/70">
              Hireoven monitors thousands of company career pages in real time so you apply
              before the flood of applicants even knows the job exists.
            </p>

            <div className="mt-8 max-w-xl">
              <Suspense
                fallback={
                  <div className="h-14 animate-pulse border border-[rgba(120,200,160,0.2)] bg-[#0e1411]" />
                }
              >
                <WaitlistForm
                  variant="simple"
                  id="launch-waitlist-form"
                  emailInputId="waitlist-email-hero"
                />
              </Suspense>
              <p className="mt-4 text-[13px] text-[#ccd6cf]/60">
                Join{" "}
                <span className="font-semibold tabular-nums text-[#38e08a]">
                  {waitlistCount.toLocaleString()}
                </span>{" "}
                job seekers already on the waitlist
              </p>
            </div>
          </div>
          <div className="min-w-0">
            <LaunchJobFeed />
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="px-4 py-16 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-white lg:text-4xl">
            The job board delay is costing you interviews
          </h2>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            <div className="text-center">
              <ProblemIconClock />
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-red-700">
                The current reality
              </p>
              <ul className="mt-4 space-y-2 text-sm font-medium leading-relaxed text-red-700/90">
                <li>You apply on LinkedIn</li>
                <li>The job was posted 4 days ago</li>
                <li>347 people already applied</li>
                <li>The recruiter stopped reading after day 1</li>
              </ul>
            </div>
            <div className="text-center">
              <ProblemIconChain />
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-[#ccd6cf]/50">
                Why it happens
              </p>
              <ul className="mt-4 space-y-2 text-sm leading-relaxed text-[#ccd6cf]/60">
                <li>Job boards crawl company pages once a day</li>
                <li>Then they index, deduplicate, and surface</li>
                <li>By the time you see it - it&apos;s old news</li>
              </ul>
            </div>
            <div className="text-center">
              <ProblemIconBolt />
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-[#f5a623]">
                The Hireoven difference
              </p>
              <ul className="mt-4 space-y-2 text-sm font-semibold leading-relaxed text-[#f5a623]">
                <li>We detect new jobs within minutes</li>
                <li>You get an alert before anyone else</li>
                <li>Apply when there are 3 applicants, not 300</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* International */}
      <section className="border-y border-[rgba(120,200,160,0.2)] px-4 py-16 lg:py-24">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="term-label">For OPT, STEM OPT, and H1B seekers</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white lg:text-4xl">
              The most painful part of your job search - finally solved.
            </h2>

            <div className="mt-10 space-y-8">
              <div>
                <p className="font-medium text-white">
                  You apply to 50 jobs not knowing which ones sponsor.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#ccd6cf]/65">
                  → We show H1B sponsorship confidence scores on every listing - based on real
                  USCIS petition data.
                </p>
              </div>
              <div>
                <p className="font-medium text-white">
                  You waste time on jobs that say &apos;must be authorized without
                  sponsorship.&apos;
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#ccd6cf]/65">
                  → Our AI reads every job description and flags visa language instantly.
                </p>
              </div>
              <div>
                <p className="font-medium text-white">
                  Your OPT clock is ticking and you don&apos;t know which companies move fast
                  enough.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#ccd6cf]/65">
                  → Our OPT urgency routing surfaces companies with historically fast H1B
                  processes first.
                </p>
              </div>
            </div>

            <ScrollToWaitlist
              emailInputId="waitlist-email-hero"
              className="term-btn term-btn-amber mt-10"
            >
              I need this - add me to the waitlist
            </ScrollToWaitlist>
          </div>

          <div className="term-panel p-8">
            <div className="grid gap-6 text-center sm:grid-cols-3">
              <div>
                <p className="text-3xl font-semibold tabular-nums text-[#38e08a]">1.1M</p>
                <p className="mt-1 text-xs font-medium text-[#ccd6cf]/60">
                  international students in the US
                </p>
              </div>
              <div>
                <p className="text-3xl font-semibold tabular-nums text-[#38e08a]">73%</p>
                <p className="mt-1 text-xs font-medium text-[#ccd6cf]/60">
                  say visa sponsorship uncertainty is their biggest job search challenge
                </p>
              </div>
              <div>
                <p className="text-3xl font-semibold tabular-nums text-[#38e08a]">0</p>
                <p className="mt-1 text-xs font-medium text-[#ccd6cf]/60">
                  job boards built specifically for them
                </p>
              </div>
            </div>
            <p className="mt-8 text-center text-lg font-semibold text-white">Until now.</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-4 py-16 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-white">How it works</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                step: "1",
                title: "We watch. You sleep.",
                body: "Our crawler monitors 10,000+ company career pages every 30 minutes. The moment a job appears - we know about it.",
              },
              {
                step: "2",
                title: "Instant alert. Your phone buzzes.",
                body: "We match new jobs to your profile and send an instant push notification or email. You see it before the job board crawlers do.",
              },
              {
                step: "3",
                title: "Apply first. Stand out.",
                body: "Click straight through to the company's own application page. No middleman. Be applicant #3, not #347.",
              },
            ].map((s) => (
              <div key={s.step} className="term-panel-hover p-6">
                <span className="text-xs font-semibold tabular-nums text-[#f5a623]">{s.step}</span>
                <h3 className="mt-2 text-lg font-semibold text-white">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#ccd6cf]/65">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Early members */}
      <section className="border-y border-[rgba(120,200,160,0.2)] px-4 py-16 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-white">Join early. Get more.</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                badge: "Founding member perk",
                title: "Lock in 40% off Pro forever",
                body: "Early members pay $11/month when we launch paid plans. Price goes up for everyone else.",
              },
              {
                badge: "Early access perk",
                title: "Direct access to the founders",
                body: "Early members get a private Discord channel where you influence what we build next. Your pain points become our roadmap.",
              },
              {
                badge: "Early access perk",
                title: "First access to every new feature",
                body: "Resume tools, autofill, interview prep - you get it before anyone else.",
              },
            ].map((c) => (
              <div key={c.title} className="term-panel flex flex-col p-6">
                <span className="w-fit border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#f5a623]">
                  {c.badge}
                </span>
                <h3 className="mt-4 text-lg font-semibold text-white">{c.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-[#ccd6cf]/65">
                  {c.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Building in public */}
      <section className="px-4 py-16 lg:py-24">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-white">
            We&apos;re building this in public
          </h2>
          <div className="term-panel mt-10 overflow-hidden">
            <div className="border-b border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-[#f5a623] text-center text-sm font-bold leading-10 text-[#0a0e0c]">
                  H
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Hireoven</p>
                  <p className="text-xs text-[#ccd6cf]/45">@hireoven</p>
                </div>
              </div>
            </div>
            <div className="px-4 py-5 text-[15px] leading-relaxed text-[#ccd6cf]">
              <p>
                Day 23 of building Hireoven:
                <br />
                <br />
                Just crossed 1,000 companies monitored.
                <br />
                Detected 847 new jobs in the last 24 hours.
                <br />
                Average time from company posting to our detection: 18 minutes.
                <br />
                Getting faster every day. 🚀
                <br />
                <br />
                <span className="text-[#f5a623]">waitlist: hireoven.com/launch</span>
              </p>
            </div>
          </div>
          <p className="mt-6 text-center text-sm">
            <Link
              href="https://twitter.com/hireoven"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[#f5a623] underline decoration-[#c2410c]/40 underline-offset-4 hover:decoration-[#c2410c]"
            >
              Follow our journey →
            </Link>
          </p>
          <p className="mt-3 text-center text-xs text-[#ccd6cf]/45">
            Update this post weekly as you build in public.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-[rgba(120,200,160,0.2)] px-4 py-16 lg:py-20">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-white lg:text-4xl">
            Be <span className="text-[#f5a623]">first</span>. Apply first. Get hired first.
          </h2>
          <p className="mt-3 text-sm text-[#ccd6cf]/70">
            Join {waitlistCount.toLocaleString()} job seekers on the waitlist
          </p>
          <div className="mt-8 text-left">
            <Suspense
              fallback={
                <div className="h-40 animate-pulse border border-[rgba(120,200,160,0.2)] bg-[#0e1411]" />
              }
            >
              <WaitlistForm
                variant="expanded"
                id="launch-waitlist-form-bottom"
                emailInputId="waitlist-email-final"
                className="term-panel p-6 [&_button]:bg-[#f5a623] [&_button]:text-[#0a0e0c] [&_button]:hover:bg-[#f5a623]/90 [&_input]:border-[rgba(120,200,160,0.2)] [&_input]:bg-[#0a0e0c] [&_input]:text-[#ccd6cf]"
              />
            </Suspense>
          </div>
        </div>
      </section>

    </div>
  )
}

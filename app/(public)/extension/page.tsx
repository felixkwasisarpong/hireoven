import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Gauge,
  Lock,
  Shield,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react"
import Navbar from "@/components/layout/Navbar"

export const metadata: Metadata = {
  title: "Hireoven Apex Bridge — Match scores & autofill on every job posting",
  description:
    "The Chrome extension that overlays a match score, missing-skills analysis, and one-click autofill on Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, BambooHR and more. Free.",
  openGraph: {
    title: "Hireoven Apex Bridge for Chrome",
    description:
      "Match scores, autofill, and Apex AI overlaid on every job posting. Free Chrome extension.",
    images: ["/extension/apex-analysis.png"],
  },
}

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/hireoven-apex-bridge/mkmfffcaimjnaecoelnanifookmdbfok"

const EXTENSION_NATIVE_ATS = [
  "Greenhouse",
  "Lever",
  "Ashby",
  "Workday",
  "iCIMS",
  "SmartRecruiters",
  "BambooHR",
]

const HIREOVEN_TRACKED_ATS = [
  "Workable",
  "Recruitee",
  "Teamtailor",
  "Personio",
  "JazzHR",
  "Jobvite",
  "SAP SuccessFactors",
  "Taleo",
  "Oracle Recruiting",
  "USAJOBS",
  "Eightfold",
  "Avature",
  "Rippling",
  "Breezy",
  "Pinpoint",
  "Gem",
  "Radancy",
  "IBM",
  "Google",
  "TikTok",
  "Apple",
  "Netflix",
  "Walmart",
  "Adecco",
  "Kelly",
]

// ── Local primitives ─────────────────────────────────────────────────────────

function ChromeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <circle cx="24" cy="24" r="22" fill="#fff" />
      <path d="M24 12h17.4A22 22 0 0 0 6.6 13.3l8.7 15.1A10 10 0 0 1 24 12z" fill="#EA4335" />
      <path d="M6.6 13.3A22 22 0 0 0 13.6 41.4l8.7-15.1A10 10 0 0 1 15.3 28.4z" fill="#FBBC05" />
      <path d="M24 36a22 22 0 0 0 19.7-12H30.4A10 10 0 0 1 22.3 26.3L13.6 41.4A22 22 0 0 0 24 36z" fill="#34A853" />
      <circle cx="24" cy="24" r="9" fill="#fff" />
      <circle cx="24" cy="24" r="6.5" fill="#4285F4" />
    </svg>
  )
}

function CtaButton({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string
  children: React.ReactNode
  variant?: "primary" | "ghost"
  className?: string
}) {
  if (variant === "primary") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`term-btn term-btn-amber ${className}`}
      >
        <ChromeMark className="h-5 w-5" />
        {children}
        <ArrowRight className="h-4 w-4 opacity-80" />
      </a>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`term-btn ${className}`}
    >
      {children}
    </a>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  body,
  accent,
}: {
  icon: React.ElementType
  title: string
  body: string
  accent?: string
}) {
  return (
    <div className="term-panel-hover bg-[#0e1411] p-6">
      <div className="inline-flex h-10 w-10 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#f5a623]">
        <Icon className="h-5 w-5" strokeWidth={2} />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-white">{title}</h3>
      <p className="mt-1.5 text-[13.5px] leading-[1.65] text-[#ccd6cf]/65">{body}</p>
      {accent && <p className="term-label mt-3 text-[#f5a623]">{accent}</p>}
    </div>
  )
}

function AtsPill({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-3 py-1 text-[12px] font-medium text-[#ccd6cf]/80 transition hover:border-[#38e08a] hover:text-[#38e08a]">
      {name}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExtensionPage() {
  return (
    <div className="term-page min-h-dvh">
      <Navbar />
      <main>
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div>
            <p className="term-label">Chrome extension</p>

            <h1 className="mt-4 text-[2.4rem] font-semibold leading-[1.02] tracking-tight text-white sm:text-[3.2rem]">
              A match score on every{" "}
              <span className="text-[#f5a623]">job posting</span>
            </h1>

            <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#ccd6cf]/70">
              Hireoven Apex Bridge overlays a real-time match score, missing-skills
              analysis, and one-click autofill on the ATS pages you&apos;re already on
              — Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters,
              BambooHR, and more.
            </p>

            <div className="mt-7 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <CtaButton href={CHROME_STORE_URL}>Add to Chrome — free</CtaButton>
              <Link
                href="/launch"
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#ccd6cf]/70 transition hover:text-[#38e08a]"
              >
                Or join the Hireoven waitlist
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-7 flex items-center gap-5 text-[12px] text-[#ccd6cf]/45">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-[#38e08a]" />
                Your data stays in your browser
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-[#38e08a]" />
                Never auto-submits
              </span>
            </div>
          </div>

          {/* Hero image stack */}
          <div className="relative">
            <div className="relative overflow-hidden border border-[rgba(120,200,160,0.26)]">
              <Image
                src="/extension/apex-analysis.png"
                alt="Hireoven Apex analysis overlay showing match score, matched and missing skills on a Greenhouse job posting"
                width={1280}
                height={800}
                className="block h-auto w-full"
                priority
              />
            </div>
            <div className="pointer-events-none absolute -bottom-6 -right-4 hidden w-[58%] overflow-hidden border border-[rgba(120,200,160,0.26)] bg-[#0a0e0c] sm:block">
              <Image
                src="/extension/autofill-drawer.png"
                alt="Hireoven autofill drawer pre-filling an application form with field-by-field review controls"
                width={1280}
                height={800}
                className="block h-auto w-full"
              />
            </div>
          </div>
        </section>

        {/* ── ATS strip ───────────────────────────────────────────────────── */}
        <section className="mt-20 border-y border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-4 py-8 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div>
              <p className="term-label">ATS coverage</p>
              <p className="mt-2 text-[13px] leading-relaxed text-[#ccd6cf]/60">
                Native autofill on the major application systems, with broad
                tracking across the rest of the Hireoven job graph.
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <p className="term-label mb-2">extension-native autofill</p>
                <div className="flex flex-wrap items-center gap-2">
                  {EXTENSION_NATIVE_ATS.map((ats) => (
                    <AtsPill key={ats} name={ats} />
                  ))}
                </div>
              </div>
              <div>
                <p className="term-label mb-2">also tracked by hireoven</p>
                <div className="flex flex-wrap items-center gap-2">
                  {HIREOVEN_TRACKED_ATS.map((ats) => (
                    <AtsPill key={ats} name={ats} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────────────── */}
        <section className="px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto mb-14 max-w-2xl text-center">
              <p className="term-label">{"Built for the actual application loop"}</p>
              <h2 className="mt-3 text-[1.9rem] font-semibold tracking-tight text-white sm:text-[2.4rem]">
                Stop guessing whether you should apply.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-[#ccd6cf]/65">
                Apex reads the posting, scores your fit, surfaces the gap, then fills
                the form. You stay in the loop on every action.
              </p>
            </div>

            <div className="grid gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={Gauge}
                title="Instant match score"
                body="Overlay your match against the JD on any career page — skills, experience, education, role fit. Computed before you scroll the requirements."
                accent="Pulled from your Hireoven profile"
              />
              <FeatureCard
                icon={Sparkles}
                title="Missing-skills callouts"
                body="Highlights exactly which required skills you don't have on your resume — so you know whether to apply, tailor, or skip."
              />
              <FeatureCard
                icon={Wand2}
                title="One-click autofill"
                body="Detects every field on the application form (Workday includes), suggests values from your profile, and waits for your review before filling."
                accent="Field-by-field approval"
              />
              <FeatureCard
                icon={FileText}
                title="Resume tailoring on the spot"
                body="Open Apex, tailor your resume to this JD, and attach the new version — without leaving the page."
              />
              <FeatureCard
                icon={Zap}
                title="Save to pipeline"
                body="One click adds the job to your Hireoven applications board, status set to Saved, ready to track."
              />
              <FeatureCard
                icon={Shield}
                title="You're always in control"
                body="The extension never auto-submits. Every fill, every save, every action requires your explicit OK."
              />
            </div>
          </div>
        </section>

        {/* ── Screenshot showcase ─────────────────────────────────────────── */}
        <section className="px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="term-label">Apex analysis</p>
                <h3 className="mt-3 text-[1.6rem] font-semibold tracking-tight text-white sm:text-[2rem]">
                  Hit a job page. See your fit in a second.
                </h3>
                <p className="mt-4 text-[15px] leading-[1.7] text-[#ccd6cf]/65">
                  The Apex bar attaches to every ATS page. Click it and the analysis
                  panel slides in with a match score, matched and missing skills,
                  sponsorship signal, and the option to tailor your resume right
                  there. Designed to be unobtrusive — it stays out of your way until
                  you call it.
                </p>
                <ul className="mt-5 space-y-2.5 text-[14px] text-[#ccd6cf]/80">
                  {[
                    "Match score against your primary resume",
                    "Matched skills · missing skills, side by side",
                    "H-1B sponsorship signal at a glance",
                    "Tailor resume / generate cover letter from the same surface",
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]">
                        <Check className="h-3 w-3 text-[#38e08a]" strokeWidth={3} />
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="overflow-hidden border border-[rgba(120,200,160,0.26)] bg-[#0e1411]">
                <Image
                  src="/extension/apex-analysis.png"
                  alt="Apex analysis panel on a Greenhouse application showing 71% match, matched skills (Data Engineering, PyTorch, Python, AWS, Compliance), and missing skills (Machine Learning, TensorFlow)"
                  width={1280}
                  height={800}
                  className="block h-auto w-full"
                />
              </div>
            </div>

            <div className="mt-24 grid gap-12 lg:grid-cols-2 lg:items-center">
              <div className="order-2 overflow-hidden border border-[rgba(120,200,160,0.26)] bg-[#0e1411] lg:order-1">
                <Image
                  src="/extension/autofill-drawer.png"
                  alt="Autofill drawer listing every form field with WILL FILL / NEEDS REVIEW status before submission"
                  width={1280}
                  height={800}
                  className="block h-auto w-full"
                />
              </div>
              <div className="order-1 lg:order-2">
                <p className="term-label">Autofill drawer</p>
                <h3 className="mt-3 text-[1.6rem] font-semibold tracking-tight text-white sm:text-[2rem]">
                  Fill 15 fields in 15 seconds. With a review pass.
                </h3>
                <p className="mt-4 text-[15px] leading-[1.7] text-[#ccd6cf]/65">
                  Click <span className="font-semibold text-[#ccd6cf]">Autofill</span> on
                  the Apex bar. A drawer opens listing every detected field with a
                  status: <span className="font-semibold text-[#f5a623]">WILL FILL</span> when
                  Apex is confident, <span className="font-semibold text-[#f5a623]">NEEDS REVIEW</span> for
                  custom questions, <span className="font-semibold text-[#f5a623]">REVIEW BELOW</span> for
                  uploads. Hit <span className="font-semibold text-[#ccd6cf]">Confirm</span> and
                  it fills — never submits.
                </p>
                <ul className="mt-5 space-y-2.5 text-[14px] text-[#ccd6cf]/80">
                  {[
                    "Field-by-field detection + status",
                    "Works on dynamic Workday & multi-step forms",
                    "Resume / cover letter attached automatically",
                    "Confirm before fill — never auto-submits",
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c]">
                        <Check className="h-3 w-3 text-[#38e08a]" strokeWidth={3} />
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── Trust / privacy ─────────────────────────────────────────────── */}
        <section className="px-4 py-16 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-3">
            {[
              {
                icon: Lock,
                title: "Your data stays put",
                body: "Scores compute against your Hireoven profile — the extension never sells, shares, or trains on your resume.",
              },
              {
                icon: Shield,
                title: "No auto-submits",
                body: "The extension fills fields. You decide when to submit. Every time.",
              },
              {
                icon: Sparkles,
                title: "Free, no account walls",
                body: "Core match scoring works with any free Hireoven account. Pro features stay where they belong — opt-in.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-[#0e1411] p-6">
                <div className="inline-flex h-9 w-9 items-center justify-center border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#f5a623]">
                  <Icon className="h-4 w-4" />
                </div>
                <h4 className="mt-3 text-[14px] font-semibold text-white">{title}</h4>
                <p className="mt-1 text-[13px] leading-[1.6] text-[#ccd6cf]/60">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Final CTA ───────────────────────────────────────────────────── */}
        <section className="px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="term-label">{"Install once"}</p>
            <h2 className="mt-3 text-[1.9rem] font-semibold tracking-tight text-white sm:text-[2.4rem]">
              The extension is the easy part.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#ccd6cf]/65">
              Install it once. It works on supported ATS and job pages, with no
              setup beyond signing into your Hireoven account.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <CtaButton href={CHROME_STORE_URL}>Add to Chrome — free</CtaButton>
              <CtaButton href="/launch" variant="ghost">
                Join the waitlist
                <ArrowRight className="h-4 w-4" />
              </CtaButton>
            </div>
            <p className="term-label mt-6">
              compatible with chrome, edge, brave &amp; arc · chrome web store ·{" "}
              <a
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
              >
                view listing
              </a>
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

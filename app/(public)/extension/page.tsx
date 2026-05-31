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
    "The Chrome extension that overlays a match score, missing-skills analysis, and one-click autofill on Greenhouse, Lever, Ashby, Workday, iCIMS and more. Free.",
  openGraph: {
    title: "Hireoven Apex Bridge for Chrome",
    description:
      "Match scores, autofill, and Apex AI overlaid on every job posting. Free Chrome extension.",
    images: ["/extension/apex-analysis.png"],
  },
}

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/hireoven-apex-bridge/mkmfffcaimjnaecoelnanifookmdbfok"

// ── Local primitives ─────────────────────────────────────────────────────────

function GradientBlob({
  className,
  color,
}: {
  className: string
  color: string
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute rounded-full blur-[80px] ${className}`}
      style={{ background: color }}
    />
  )
}

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
        className={`inline-flex items-center justify-center gap-2.5 rounded-2xl px-6 py-3.5 text-sm font-bold text-white shadow-[0_10px_28px_-12px_rgba(255,92,24,0.55)] transition hover:brightness-110 active:scale-[0.99] ${className}`}
        style={{ background: "linear-gradient(135deg,#FF5C18,#FF7A35)" }}
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
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/10 ${className}`}
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
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-[#FF5C18]/30 hover:shadow-[0_10px_30px_-15px_rgba(15,23,42,0.18)]">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#FFE9DC] to-[#FFD2B5] text-[#FF5C18]">
        <Icon className="h-5 w-5" strokeWidth={2.25} />
      </div>
      <h3 className="mt-4 text-[15px] font-bold tracking-tight text-slate-900">{title}</h3>
      <p className="mt-1.5 text-[13.5px] leading-[1.65] text-slate-500">{body}</p>
      {accent && (
        <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#FF5C18]/80">
          {accent}
        </p>
      )}
    </div>
  )
}

function AtsPill({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[12px] font-semibold text-slate-600">
      {name}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExtensionPage() {
  return (
    <>
      <Navbar />
      <main className="bg-slate-50">
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-[#0C0A1E] px-4 pb-20 pt-16 sm:px-6 sm:pt-20">
          <GradientBlob className="-left-32 top-0 h-[420px] w-[420px]" color="rgba(255,92,24,0.18)" />
          <GradientBlob className="-right-32 bottom-0 h-[360px] w-[360px]" color="rgba(124,58,237,0.16)" />

          <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 backdrop-blur-sm">
                <Sparkles className="h-3.5 w-3.5 text-[#FF9A3C]" />
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">
                  Chrome extension · v0.1.0
                </span>
              </div>

              <h1 className="mt-5 text-[34px] font-black leading-[1.05] tracking-tight text-white sm:text-[44px] lg:text-[52px]">
                A match score on
                <br />
                <span
                  style={{
                    background: "linear-gradient(90deg,#FF5C18,#FF9A3C)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  every job posting.
                </span>
              </h1>

              <p className="mt-5 max-w-xl text-[16px] leading-[1.65] text-white/65">
                Hireoven Apex Bridge overlays a real-time match score, missing-skills
                analysis, and one-click autofill on the ATS pages you&apos;re already on
                — Greenhouse, Lever, Ashby, Workday, iCIMS, and more.
              </p>

              <div className="mt-7 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <CtaButton href={CHROME_STORE_URL}>Add to Chrome — free</CtaButton>
                <Link
                  href="/launch"
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/70 transition hover:text-white"
                >
                  Or join the Hireoven waitlist
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="mt-7 flex items-center gap-5 text-[12px] text-white/40">
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" />
                  Your data stays in your browser
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  Never auto-submits
                </span>
              </div>
            </div>

            {/* Hero image stack */}
            <div className="relative">
              <div className="relative overflow-hidden rounded-2xl border border-white/10 shadow-[0_30px_60px_-25px_rgba(0,0,0,0.55)]">
                <Image
                  src="/extension/apex-analysis.png"
                  alt="Hireoven Apex analysis overlay showing match score, matched and missing skills on a Greenhouse job posting"
                  width={1280}
                  height={800}
                  className="block h-auto w-full"
                  priority
                />
              </div>
              <div className="pointer-events-none absolute -bottom-6 -right-4 hidden w-[58%] overflow-hidden rounded-xl border border-white/10 shadow-[0_30px_60px_-25px_rgba(0,0,0,0.6)] sm:block">
                <Image
                  src="/extension/autofill-drawer.png"
                  alt="Hireoven autofill drawer pre-filling an application form with field-by-field review controls"
                  width={1280}
                  height={800}
                  className="block h-auto w-full"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── ATS strip ───────────────────────────────────────────────────── */}
        <section className="border-y border-slate-200/60 bg-white px-4 py-7 sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Works on every major ATS
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {["Greenhouse", "Lever", "Ashby", "Workday", "iCIMS", "SmartRecruiters", "Workable"].map(
                (ats) => (
                  <AtsPill key={ats} name={ats} />
                )
              )}
            </div>
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden px-4 py-20 sm:px-6"
          style={{ background: "linear-gradient(160deg,#FFF8F4 0%,#F9F8FF 50%,#F4F8FF 100%)" }}
        >
          <div className="relative mx-auto max-w-6xl">
            <div className="mx-auto mb-14 max-w-2xl text-center">
              <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#FF5C18]">
                Built for the actual application loop
              </p>
              <h2 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                Stop guessing whether you should apply.
              </h2>
              <p className="mt-4 text-lg text-slate-500">
                Apex reads the posting, scores your fit, surfaces the gap, then fills
                the form. You stay in the loop on every action.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#FF5C18]">
                  Apex analysis
                </p>
                <h3 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
                  Hit a job page. See your fit in a second.
                </h3>
                <p className="mt-4 text-[15px] leading-[1.7] text-slate-500">
                  The Apex bar attaches to every ATS page. Click it and the analysis
                  panel slides in with a match score, matched and missing skills,
                  sponsorship signal, and the option to tailor your resume right
                  there. Designed to be unobtrusive — it stays out of your way until
                  you call it.
                </p>
                <ul className="mt-5 space-y-2.5 text-[14px] text-slate-600">
                  {[
                    "Match score against your primary resume",
                    "Matched skills · missing skills, side by side",
                    "H-1B sponsorship signal at a glance",
                    "Tailor resume / generate cover letter from the same surface",
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                        <Check className="h-3 w-3 text-emerald-600" strokeWidth={3} />
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_-25px_rgba(15,23,42,0.25)]">
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
              <div className="order-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_-25px_rgba(15,23,42,0.25)] lg:order-1">
                <Image
                  src="/extension/autofill-drawer.png"
                  alt="Autofill drawer listing every form field with WILL FILL / NEEDS REVIEW status before submission"
                  width={1280}
                  height={800}
                  className="block h-auto w-full"
                />
              </div>
              <div className="order-1 lg:order-2">
                <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#FF5C18]">
                  Autofill drawer
                </p>
                <h3 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
                  Fill 15 fields in 15 seconds. With a review pass.
                </h3>
                <p className="mt-4 text-[15px] leading-[1.7] text-slate-500">
                  Click <span className="font-semibold text-slate-700">Autofill</span> on
                  the Apex bar. A drawer opens listing every detected field with a
                  status: <span className="font-semibold text-emerald-600">WILL FILL</span> when
                  Apex is confident, <span className="font-semibold text-amber-600">NEEDS REVIEW</span> for
                  custom questions, <span className="font-semibold text-rose-600">REVIEW BELOW</span> for
                  uploads. Hit <span className="font-semibold text-slate-700">Confirm</span> and
                  it fills — never submits.
                </p>
                <ul className="mt-5 space-y-2.5 text-[14px] text-slate-600">
                  {[
                    "Field-by-field detection + status",
                    "Works on dynamic Workday & multi-step forms",
                    "Resume / cover letter attached automatically",
                    "Confirm before fill — never auto-submits",
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                        <Check className="h-3 w-3 text-emerald-600" strokeWidth={3} />
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
        <section className="bg-white px-4 py-16 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-6 rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-8 sm:grid-cols-3 sm:p-10">
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
              <div key={title}>
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#0C0A1E] text-[#FF9A3C]">
                  <Icon className="h-4 w-4" />
                </div>
                <h4 className="mt-3 text-[14px] font-bold text-slate-900">{title}</h4>
                <p className="mt-1 text-[13px] leading-[1.6] text-slate-500">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Final CTA ───────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-[#0C0A1E] px-4 py-20 sm:px-6">
          <GradientBlob className="-left-20 top-0 h-72 w-72" color="rgba(255,92,24,0.2)" />
          <GradientBlob className="-right-20 bottom-0 h-72 w-72" color="rgba(124,58,237,0.18)" />

          <div className="relative mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              The extension is the easy part.
            </h2>
            <p className="mt-4 text-[16px] leading-[1.65] text-white/55">
              Install it once. It works on every ATS page you visit, with no setup
              beyond signing into your Hireoven account.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <CtaButton href={CHROME_STORE_URL}>Add to Chrome — free</CtaButton>
              <CtaButton href="/launch" variant="ghost">
                Join the waitlist
                <ArrowRight className="h-4 w-4" />
              </CtaButton>
            </div>
            <p className="mt-6 text-[11px] text-white/30">
              Compatible with Chrome, Edge, Brave & Arc · Chrome Web Store ·{" "}
              <a
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline"
              >
                View listing
              </a>
            </p>
          </div>
        </section>
      </main>
    </>
  )
}

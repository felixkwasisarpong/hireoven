import type { Metadata } from "next"
import Link from "next/link"
import { Sparkles, Compass, Users, BellRing, ShieldCheck, ArrowRight } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import PartnerInquiryForm from "@/components/marketing/PartnerInquiryForm"
import { getPublishedTestimonials, getPublishedPartners } from "@/lib/marketing/social-proof-store"

export const revalidate = 3600

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"

export const metadata: Metadata = {
  title: "Partner with Hireoven — career centers, bootcamps, creators & coaches",
  description:
    "Give your audience a real hiring edge: fresh jobs straight from company career pages with H-1B sponsorship intelligence. Co-branded landing pages, curated feeds, and referral perks for partners.",
  alternates: { canonical: `${BASE}/partners` },
  openGraph: {
    title: "Partner with Hireoven",
    description:
      "Co-branded landing pages, curated job feeds, and sponsorship intelligence for your audience of job seekers.",
    type: "website",
  },
}

const AUDIENCES = [
  { title: "University career offices", body: "Help international students find sponsor-friendly employers faster." },
  { title: "Coding bootcamps", body: "Give grads a live feed of fresh, relevant roles the day they post." },
  { title: "Immigration attorneys", body: "Point clients to employers with real H-1B petition history." },
  { title: "Tech creators & YouTubers", body: "Share a tool your audience actually keeps using — with your link on it." },
  { title: "LinkedIn creators", body: "Turn your job-search content into a resource people bookmark." },
  { title: "Resume coaches", body: "Send clients to roles matched to their target titles and visa needs." },
]

const BENEFITS = [
  {
    Icon: Sparkles,
    title: "A co-branded landing page",
    body: "Your name and audience, our live job data — a page you can share anywhere as your own.",
  },
  {
    Icon: Compass,
    title: "A curated job feed",
    body: "Filtered to the roles, locations, and visa needs your people care about, refreshed continuously.",
  },
  {
    Icon: Users,
    title: "Referral perks for your members",
    body: "Premium features, faster alerts, and resume-review credits your audience can unlock through you.",
  },
  {
    Icon: BellRing,
    title: "Co-branded weekly reports",
    body: "A fresh-jobs and sponsorship digest with your branding, ready to send to your list.",
  },
]

export default async function PartnersPage() {
  const [testimonials, partners] = await Promise.all([getPublishedTestimonials(), getPublishedPartners()])

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-slate-950">
      <Navbar />

      {/* Hero */}
      <section className="mx-auto w-full max-w-3xl px-4 pt-12 text-center sm:px-6 sm:pt-16">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <ShieldCheck className="h-3.5 w-3.5" /> Partnerships
        </span>
        <h1 className="mt-4 text-[30px] font-black leading-[1.1] tracking-tight text-slate-950 sm:text-[42px]">
          Give your audience a real hiring edge.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-slate-600">
          Fresh jobs straight from company career pages, with H-1B sponsorship intelligence on every role.
          Partner with Hireoven and put it in front of your people — under your name.
        </p>
        <a
          href="#become-a-partner"
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-emerald-700"
        >
          Become a partner <ArrowRight className="h-4 w-4" />
        </a>
      </section>

      {/* Who we partner with */}
      <section className="mx-auto mt-16 w-full max-w-4xl px-4 sm:px-6">
        <h2 className="text-center text-[13px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Who we partner with
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCES.map((a) => (
            <div key={a.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-[15px] font-bold text-slate-900">{a.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">{a.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What you get */}
      <section className="mx-auto mt-16 w-full max-w-3xl px-4 sm:px-6">
        <h2 className="text-center text-[22px] font-bold text-slate-900">What partners get</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {BENEFITS.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <Icon className="h-6 w-6 text-emerald-600" />
              <h3 className="mt-3 text-[15px] font-bold text-slate-900">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials — rendered only when published rows exist (admin-managed). */}
      {testimonials.length > 0 && (
        <section className="mx-auto mt-16 w-full max-w-3xl px-4 sm:px-6">
          <h2 className="text-center text-[22px] font-bold text-slate-900">What partners say</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {testimonials.map((t, i) => (
              <figure key={i} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <blockquote className="text-[15px] leading-relaxed text-slate-800">&ldquo;{t.quote}&rdquo;</blockquote>
                <figcaption className="mt-4 flex items-center gap-3">
                  {t.avatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.avatarUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
                  )}
                  <div>
                    <p className="text-[14px] font-semibold text-slate-900">{t.name}</p>
                    <p className="text-[12.5px] text-slate-500">
                      {t.role}
                      {t.org ? ` · ${t.org}` : ""}
                    </p>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* Partner logos — rendered only when published rows exist. */}
      {partners.length > 0 && (
        <section className="mx-auto mt-16 w-full max-w-4xl px-4 sm:px-6">
          <h2 className="text-center text-[13px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Trusted by
          </h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-6">
            {partners.map((p) => {
              const inner = p.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.logoUrl} alt={p.name} height={32} className="h-8 w-auto opacity-70 grayscale" />
              ) : (
                <span className="text-[15px] font-semibold text-slate-500">{p.name}</span>
              )
              return p.url ? (
                <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer">
                  {inner}
                </a>
              ) : (
                <span key={p.name}>{inner}</span>
              )
            })}
          </div>
        </section>
      )}

      {/* Inquiry form */}
      <section id="become-a-partner" className="mx-auto mt-16 mb-20 w-full max-w-2xl px-4 sm:px-6 scroll-mt-20">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-[22px] font-bold text-slate-900">Become a partner</h2>
          <p className="mt-2 text-[14px] text-slate-600">
            Tell us who you reach and we&apos;ll set up a co-branded page or curated feed you can share. It&apos;s free.
          </p>
          <div className="mt-6">
            <PartnerInquiryForm />
          </div>
          <p className="mt-6 text-[13px] text-slate-500">
            Prefer email? Reach us at{" "}
            <a href="mailto:hello@hireoven.com" className="font-medium text-emerald-700 underline-offset-2 hover:underline">
              hello@hireoven.com
            </a>{" "}
            — or see other ways to{" "}
            <Link href="/contact" className="font-medium text-emerald-700 underline-offset-2 hover:underline">
              get in touch
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  )
}

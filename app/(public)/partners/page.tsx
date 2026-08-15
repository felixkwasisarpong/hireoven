import type { Metadata } from "next"
import Link from "next/link"
import { Sparkles, Compass, Users, BellRing, ArrowRight } from "lucide-react"
import Navbar from "@/components/layout/Navbar"
import PartnerInquiryForm from "@/components/marketing/PartnerInquiryForm"
import { getPublishedTestimonials, getPublishedPartners } from "@/lib/marketing/social-proof-store"
import { siteBaseUrl } from "@/lib/seo/site-url"

export const revalidate = 3600

const BASE = siteBaseUrl()

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
    <div className="term-page min-h-dvh">
      <Navbar />

      {/* Hero — flat terminal, no photo band. */}
      <section className="mx-auto grid w-full max-w-[78rem] items-end gap-10 px-4 pt-12 sm:px-6 sm:pt-16 md:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)]">
        <div>
          <p className="term-label">Partnerships</p>
          <h1 className="mt-4 max-w-[43rem] text-[2.4rem] font-semibold leading-[1.02] tracking-tight text-white sm:text-[3.4rem]">
            Give your audience a real <span className="text-[#f5a623]">hiring edge</span>
          </h1>
          <p className="mt-4 max-w-[36rem] text-[14px] leading-relaxed text-[#ccd6cf]/70">
            Fresh jobs straight from company career pages, with H-1B sponsorship intelligence on every role.
            Partner with Hireoven and put it in front of your people under your name.
          </p>
          <a href="#become-a-partner" className="term-btn term-btn-amber mt-7">
            Become a partner <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        <div className="term-panel p-4">
          <p className="term-label border-b border-[rgba(120,200,160,0.12)] pb-3">Partner surface</p>
          <div className="mt-4 space-y-3">
            {["Co-branded landing page", "Curated sponsor-friendly feed", "Weekly fresh-jobs report"].map((line, i) => (
              <div key={line} className="flex items-center justify-between border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] px-4 py-3">
                <span className="text-[14px] font-medium text-white">{line}</span>
                <span className="text-2xl font-semibold leading-none tabular-nums text-[#38e08a]">0{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who we partner with */}
      <section className="mx-auto mt-16 w-full max-w-4xl px-4 sm:px-6">
        <h2 className="term-label text-center">{"Who we partner with"}</h2>
        <div className="mt-5 grid gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCES.map((a) => (
            <div key={a.title} className="term-panel-hover bg-[#0e1411] p-5">
              <h3 className="text-[14px] font-semibold text-white">{a.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#ccd6cf]/65">{a.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What you get */}
      <section className="mx-auto mt-16 w-full max-w-3xl px-4 sm:px-6">
        <p className="term-label text-center">{"What partners get"}</p>
        <div className="mt-6 grid gap-px overflow-hidden border border-[rgba(120,200,160,0.2)] bg-[rgba(120,200,160,0.2)] sm:grid-cols-2">
          {BENEFITS.map(({ Icon, title, body }) => (
            <div key={title} className="term-panel-hover bg-[#0e1411] p-5">
              <Icon className="h-5 w-5 text-[#f5a623]" />
              <h3 className="mt-3 text-[14px] font-semibold text-white">{title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#ccd6cf]/65">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials — rendered only when published rows exist (admin-managed). */}
      {testimonials.length > 0 && (
        <section className="mx-auto mt-16 w-full max-w-3xl px-4 sm:px-6">
          <p className="term-label text-center">{"What partners say"}</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {testimonials.map((t, i) => (
              <figure key={i} className="term-panel p-6">
                <blockquote className="text-[14px] leading-relaxed text-[#ccd6cf]">&ldquo;{t.quote}&rdquo;</blockquote>
                <figcaption className="mt-4 flex items-center gap-3">
                  {t.avatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.avatarUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
                  )}
                  <div>
                    <p className="text-[14px] font-semibold text-white">{t.name}</p>
                    <p className="text-[12.5px] text-[#ccd6cf]/50">
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
          <p className="term-label text-center">{"Trusted by"}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-6">
            {partners.map((p) => {
              const inner = p.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.logoUrl} alt={p.name} height={32} className="h-8 w-auto opacity-70 grayscale" />
              ) : (
                <span className="text-[15px] font-semibold text-[#ccd6cf]/60">{p.name}</span>
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
      <section id="become-a-partner" className="mx-auto mb-20 mt-16 w-full max-w-2xl scroll-mt-20 px-4 sm:px-6">
        <div className="term-panel p-6 sm:p-8">
          <p className="term-label">{"Become a partner"}</p>
          <h2 className="mt-2 text-[1.9rem] font-semibold leading-tight tracking-tight text-white">Become a partner</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[#ccd6cf]/70">
            Tell us who you reach and we&apos;ll set up a co-branded page or curated feed you can share. It&apos;s free.
          </p>
          <div className="mt-6">
            <PartnerInquiryForm />
          </div>
          <p className="mt-6 text-[13px] text-[#ccd6cf]/50">
            Prefer email? Reach us at{" "}
            <a
              href="mailto:hello@hireoven.com"
              className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
            >
              hello@hireoven.com
            </a>{" "}
            — or see other ways to{" "}
            <Link
              href="/contact"
              className="text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
            >
              get in touch
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  )
}

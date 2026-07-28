import type { Metadata } from "next"
import { siteBaseUrl } from "@/lib/seo/site-url"

const BASE = siteBaseUrl()

const FAQ_ITEMS = [
  {
    q: "Is the free plan actually free?",
    a: "Yes - always. No credit card, no trial period, no expiration. We believe everyone deserves access to real-time job listings.",
  },
  {
    q: "When will I be charged?",
    a: "Paid plans are charged when you check out. You can cancel anytime from billing settings.",
  },
  {
    q: "Can I switch between monthly and yearly?",
    a: "Yes, anytime from your billing settings. If you switch to yearly mid-month we'll prorate the difference.",
  },
  {
    q: "I'm on OPT or H1B. Do I need to pay for international tools?",
    a: "International tools are free for OPT, STEM OPT, and H1B candidates. Just set your visa status during signup. OPT countdown, offer risk analysis, urgency routing, and all sponsorship intelligence unlock automatically.",
  },
  {
    q: "Does Hireoven help with the H1B application itself?",
    a: "We help you find companies that sponsor and understand your odds before you apply. We don't provide immigration legal advice - for that, consult an immigration attorney.",
  },
]

export const metadata: Metadata = {
  title: "Hireoven pricing - fresh jobs, AI applications, and H-1B intel",
  description:
    "Compare Hireoven plans for real-time jobs, AI resume tools, autofill, alerts, and H-1B sponsorship intelligence. Start free with no credit card.",
  alternates: { canonical: `${BASE}/pricing` },
  openGraph: {
    title: "Hireoven pricing",
    description: "Real-time jobs, AI application tools, and H-1B sponsorship intel with a free plan.",
    type: "website",
    url: `${BASE}/pricing`,
  },
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  }

  return (
    <>
      {children}
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  )
}

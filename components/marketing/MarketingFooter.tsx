import Link from "next/link"
import { Check } from "lucide-react"
import HireovenLogo from "@/components/ui/HireovenLogo"

type FooterLink = {
  href: string
  label: string
}

function FooterColumn({ links, title }: { links: FooterLink[]; title: string }) {
  return (
    <div>
      <p className="term-label mb-3">{title}</p>
      <ul className="space-y-2.5">
        {links.map(({ href, label }) => (
          <li key={href}>
            <Link className="text-[13px] font-medium text-[#ccd6cf]/55 transition hover:text-[#38e08a]" href={href}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function MarketingFooter() {
  return (
    <footer className="border-t border-[rgba(120,200,160,0.26)] bg-[#0a0e0c] px-5 py-16 font-mono lg:px-12">
      <div className="mx-auto max-w-[78rem]">
        <div className="grid gap-10 md:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
          <div>
            <Link href="/">
              <HireovenLogo className="h-10 w-auto max-w-[180px] [filter:brightness(0)_invert(1)]" variant="full" />
            </Link>
            <p className="mt-4 max-w-[18rem] text-[13px] leading-6 text-[#ccd6cf]/55">
              Fresh jobs, sponsor proof, and AI application workflows for job seekers who move early.
            </p>
          </div>

          <FooterColumn
            title="Product"
            links={[
              { href: "/find", label: "Find jobs" },
              { href: "/features", label: "Features" },
              { href: "/extension", label: "Extension" },
              { href: "/pricing", label: "Pricing" },
            ]}
          />
          <FooterColumn
            title="H-1B data"
            links={[
              { href: "/h1b-sponsors/leaderboard", label: "Sponsor leaderboard" },
              { href: "/h1b-sponsors/leaderboard/methodology", label: "Methodology" },
              { href: "/h1b-salaries", label: "H-1B salaries" },
              { href: "/companies", label: "Companies" },
            ]}
          />
          <FooterColumn
            title="Account"
            links={[
              { href: "/login", label: "Sign in" },
              { href: "/signup?next=%2Fdashboard%2Fonboarding", label: "Create account" },
              { href: "/support", label: "Support" },
            ]}
          />
          <FooterColumn
            title="Company"
            links={[
              { href: "/partners", label: "Partners" },
              { href: "/contact", label: "Contact" },
              { href: "/privacy", label: "Privacy" },
              { href: "/terms", label: "Terms" },
            ]}
          />
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[rgba(120,200,160,0.12)] pt-6">
          <p className="text-[12px] text-[#ccd6cf]/45">© {new Date().getFullYear()} Hireoven. All rights reserved.</p>
          <div className="flex items-center gap-2 text-[12px] font-medium text-[#ccd6cf]/45">
            <Check className="h-3.5 w-3.5 text-[#f5a623]" aria-hidden />
            Built for fast, evidence-backed applications.
          </div>
        </div>
      </div>
    </footer>
  )
}

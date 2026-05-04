import Link from "next/link"
import { BadgePercent, Building2, Sparkles } from "lucide-react"
import HireovenLogo from "@/components/ui/HireovenLogo"
import NavbarAuthCluster from "./NavbarAuthCluster"

export default function Navbar() {
  return (
    <nav className="glass-nav sticky top-0 z-40 px-4 py-2 lg:px-8">
      <div className="mx-auto flex w-full max-w-[88rem] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-6 sm:gap-8">
          <Link href="/" className="flex shrink-0 items-center">
            <HireovenLogo variant="wordmark" className="-my-2 h-24 w-auto sm:h-28" priority />
          </Link>
          <div className="hidden items-center gap-6 md:flex">
            <Link
              href="/features"
              className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-strong"
            >
              <Sparkles className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              Features
            </Link>
            <Link
              href="/companies"
              className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-strong"
            >
              <Building2 className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              Companies
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-strong"
            >
              <BadgePercent className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              Pricing
            </Link>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <NavbarAuthCluster />
        </div>
      </div>
    </nav>
  )
}

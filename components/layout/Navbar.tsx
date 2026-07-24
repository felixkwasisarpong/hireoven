import Link from "next/link"
import HireovenLogo from "@/components/ui/HireovenLogo"
import MarketingThemeToggle from "@/components/marketing/MarketingThemeToggle"
import NavbarAuthCluster from "./NavbarAuthCluster"
import MobileNav from "./MobileNav"
import { NAV_LINKS } from "./nav-links"

export default function Navbar() {
  return (
    <nav className="term-nav sticky top-0 z-40 px-4 py-2.5 backdrop-blur-sm lg:px-8">
      <div className="mx-auto flex w-full max-w-[88rem] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-6 sm:gap-8">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="text-[var(--term-green)]" aria-hidden>&gt;</span>
            <HireovenLogo variant="header" className="marketing-logo h-9 w-auto sm:h-10" priority />
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-2 border-b border-transparent px-2 py-1.5 font-mono text-[13px] font-medium lowercase text-[var(--term-fg)] opacity-75 transition-colors hover:border-[var(--term-green)] hover:text-[var(--term-green)] hover:opacity-100"
              >
                <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MarketingThemeToggle />
          <div className="flex items-center gap-1 border border-[var(--term-line-strong)] bg-[var(--term-panel)] p-1 shadow-[0_1px_0_rgba(7,19,14,0.04)]">
            <NavbarAuthCluster />
          </div>
          <MobileNav />
        </div>
      </div>
    </nav>
  )
}

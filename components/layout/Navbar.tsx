import Link from "next/link"
import HireovenLogo from "@/components/ui/HireovenLogo"
import NavbarAuthCluster from "./NavbarAuthCluster"
import MobileNav from "./MobileNav"
import { NAV_LINKS } from "./nav-links"

export default function Navbar() {
  return (
    <nav className="glass-nav sticky top-0 z-40 px-4 py-2 lg:px-8">
      <div className="mx-auto flex w-full max-w-[88rem] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-6 sm:gap-8">
          <Link href="/" className="flex shrink-0 items-center">
            <HireovenLogo variant="header" className="h-10 w-auto sm:h-12" priority />
          </Link>
          <div className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-strong"
              >
                <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
            <NavbarAuthCluster />
          </div>
          <MobileNav />
        </div>
      </div>
    </nav>
  )
}

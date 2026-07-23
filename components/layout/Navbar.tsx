import Link from "next/link"
import HireovenLogo from "@/components/ui/HireovenLogo"
import NavbarAuthCluster from "./NavbarAuthCluster"
import MobileNav from "./MobileNav"
import { NAV_LINKS } from "./nav-links"

export default function Navbar() {
  return (
    <nav className="term-nav sticky top-0 z-40 px-4 py-2.5 backdrop-blur-sm lg:px-8">
      <div className="mx-auto flex w-full max-w-[88rem] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-6 sm:gap-8">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="text-[#38e08a]" aria-hidden>&gt;</span>
            <HireovenLogo variant="header" className="h-9 w-auto sm:h-10 [filter:brightness(0)_invert(1)]" priority />
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-2 border-b border-transparent px-2 py-1.5 font-mono text-[13px] font-medium lowercase text-[#ccd6cf]/70 transition-colors hover:border-[#38e08a] hover:text-[#38e08a]"
              >
                <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 border border-[rgba(120,200,160,0.26)] bg-[#0e1411] p-1">
            <NavbarAuthCluster />
          </div>
          <MobileNav />
        </div>
      </div>
    </nav>
  )
}

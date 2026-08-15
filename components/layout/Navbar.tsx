import Link from "next/link"
import HireovenLogo from "@/components/ui/HireovenLogo"
import MarketingNavLinks from "./MarketingNavLinks"
import NavbarAuthCluster from "./NavbarAuthCluster"
import MobileNav from "./MobileNav"

export default function Navbar() {
  return (
    <nav className="term-nav sticky top-0 z-40 px-4 py-2 backdrop-blur-sm lg:px-8">
      <div className="mx-auto flex w-full max-w-[118rem] items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-7 xl:gap-9">
          <Link href="/" className="marketing-nav-brand" prefetch>
            <HireovenLogo variant="mark" className="h-8 w-8 shrink-0 rounded-md border border-[rgba(17,16,15,0.08)] bg-white p-0.5" priority />
            <span className="min-w-0 leading-none">
              <span className="block text-[18px] font-extrabold leading-none">
                <span className="marketing-brand-hire">Hire</span>
                <span className="marketing-brand-oven">Oven</span>
              </span>
              <span className="mt-1 hidden text-[9px] font-semibold leading-none tracking-normal text-[rgba(18,16,14,0.5)] sm:block">
                Fresh openings from the source
              </span>
            </span>
          </Link>
          <MarketingNavLinks />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="marketing-auth-shell">
            <NavbarAuthCluster />
          </div>
          <MobileNav />
        </div>
      </div>
    </nav>
  )
}

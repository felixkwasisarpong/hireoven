import Link from "next/link"
import { BadgePercent, Building2, LogIn, Sparkles, UserPlus } from "lucide-react"
import HireovenLogo from "@/components/ui/HireovenLogo"

export default function Navbar() {
  return (
    <nav className="glass-nav sticky top-0 z-40 px-4 py-3 lg:px-8">
      <div className="mx-auto flex w-full max-w-[88rem] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-6 sm:gap-8">
          <Link href="/" className="flex shrink-0 items-center">
            <HireovenLogo className="h-10 w-auto" priority />
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
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface-alt hover:text-strong"
          >
            <LogIn className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            <span className="hidden sm:inline">Login</span>
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-[0_1px_0_rgba(0,0,0,0.06)] transition-colors hover:bg-primary-hover"
          >
            <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
            Sign up
          </Link>
        </div>
      </div>
    </nav>
  )
}

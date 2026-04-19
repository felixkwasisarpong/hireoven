import Link from "next/link"
import HireovenLogo from "@/components/ui/HireovenLogo"

export default function Navbar() {
  return (
    <nav className="glass-nav sticky top-0 z-40 px-4 py-3 lg:px-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center">
            <HireovenLogo className="h-10 w-auto" priority />
          </Link>
          <Link
            href="/pricing"
            className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-strong sm:block"
          >
            Pricing
          </Link>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <Link
            href="/login"
            className="rounded-md px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface-alt hover:text-strong"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-[0_1px_0_rgba(0,0,0,0.06)] transition-colors hover:bg-primary-hover"
          >
            Sign up
          </Link>
        </div>
      </div>
    </nav>
  )
}

import Link from "next/link"
import HireovenLogo from "@/components/ui/HireovenLogo"

export function LaunchNavbar() {
  return (
    <header className="term-nav sticky top-0 z-50 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 lg:px-6">
        <Link href="/launch" className="flex shrink-0 items-center gap-2">
          <HireovenLogo className="marketing-logo h-11 w-auto" priority />
        </Link>
        <Link
          href="/login"
          className="text-sm font-semibold text-[#ccd6cf]/70 transition-colors hover:text-[#38e08a]"
        >
          Already have an account? Log in
        </Link>
      </div>
    </header>
  )
}

export function LaunchFooter() {
  return (
    <footer className="border-t border-[rgba(120,200,160,0.2)] py-10 text-center">
      <div className="mx-auto max-w-6xl px-4 text-sm text-[#ccd6cf]/55">
        <p>
          © <span suppressHydrationWarning>{new Date().getFullYear()}</span> Hireoven ·{" "}
          <Link href="/privacy" className="font-medium text-[#ccd6cf]/70 underline-offset-4 transition-colors hover:text-[#38e08a]">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" className="font-medium text-[#ccd6cf]/70 underline-offset-4 transition-colors hover:text-[#38e08a]">
            Terms
          </Link>
        </p>
        <p className="mt-2 text-xs">Made with care for job seekers everywhere</p>
      </div>
    </footer>
  )
}

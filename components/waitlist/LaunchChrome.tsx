import Link from "next/link"
import HireovenLogo from "@/components/ui/HireovenLogo"

export function LaunchNavbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 lg:px-6">
        <Link href="/launch" className="flex shrink-0 items-center">
          <HireovenLogo className="h-9 w-auto" priority />
        </Link>
        <Link
          href="/login"
          className="text-sm font-semibold text-muted-foreground transition hover:text-strong"
        >
          Already have an account? Log in
        </Link>
      </div>
    </header>
  )
}

export function LaunchFooter() {
  return (
    <footer className="border-t border-border py-10 text-center">
      <div className="mx-auto max-w-6xl px-4 text-sm text-muted-foreground">
        <p>
          © {new Date().getFullYear()} Hireoven ·{" "}
          <Link href="/privacy" className="font-medium underline-offset-4 hover:underline">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" className="font-medium underline-offset-4 hover:underline">
            Terms
          </Link>
        </p>
        <p className="mt-2 text-xs">Made with care for job seekers everywhere</p>
      </div>
    </footer>
  )
}

import Link from "next/link"
import HireovenLogo from "@/components/ui/HireovenLogo"

export default function Navbar() {
  return (
    <nav className="glass-nav sticky top-0 z-40 px-4 py-4 lg:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Link href="/" className="flex items-center">
          <HireovenLogo className="h-10 w-auto" priority />
        </Link>
        <div className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/90 p-1 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <Link
            href="/login"
            className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-[#FF5C18] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,92,24,0.24)] transition-colors hover:bg-[#E14F0E]"
          >
            Sign up
          </Link>
        </div>
      </div>
    </nav>
  )
}

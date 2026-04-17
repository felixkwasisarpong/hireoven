import Link from "next/link"
import HireovenLogo from "@/components/ui/HireovenLogo"

export default function Navbar() {
  return (
    <nav className="border-b border-gray-100 px-6 py-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <Link href="/" className="flex items-center">
          <HireovenLogo className="h-10 w-auto" priority />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="text-sm font-medium text-gray-600 hover:text-gray-900 px-4 py-2 rounded-md transition-colors"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="text-sm font-medium text-white bg-[#1D9E75] hover:bg-[#188560] px-4 py-2 rounded-md transition-colors"
          >
            Sign up
          </Link>
        </div>
      </div>
    </nav>
  )
}

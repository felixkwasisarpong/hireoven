"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogIn, Sparkles, X } from "lucide-react"

interface AuthWallProps {
  variant?: "modal" | "page"
  onClose?: () => void
  message?: string
}

export default function AuthWall({
  variant = "modal",
  onClose,
  message = "Sign in to access this feature",
}: AuthWallProps) {
  const pathname = usePathname()
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`
  const signupHref = `/signup?next=${encodeURIComponent(pathname)}`

  const content = (
    <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-8 text-center shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFF1E8]">
        <Sparkles className="h-6 w-6 text-[#FF5C18]" />
      </div>
      <h2 className="text-lg font-semibold text-slate-900">Sign in to continue</h2>
      <p className="mt-2 text-sm text-slate-500">{message}</p>

      <div className="mt-6 flex flex-col gap-2.5">
        <Link
          href={signupHref}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#FF5C18] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E] shadow-[0_4px_14px_rgba(255,92,24,0.28)]"
        >
          <Sparkles className="h-4 w-4" />
          Create free account
        </Link>
        <Link
          href={loginHref}
          className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <LogIn className="h-4 w-4" />
          Sign in
        </Link>
      </div>
    </div>
  )

  if (variant === "page") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        {content}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative animate-scale-in">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute -right-2 -top-2 z-10 rounded-full border border-slate-200 bg-white p-1.5 text-slate-400 shadow-sm transition hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {content}
      </div>
    </div>
  )
}

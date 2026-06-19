import Link from "next/link"
import { ArrowLeft, Search } from "lucide-react"

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-white px-6 text-center">
      <div
        className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: "linear-gradient(135deg,#FF5C18,#FF9A3C)" }}
      >
        <Search className="h-8 w-8 text-white" strokeWidth={2} />
      </div>

      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#FF5C18]">404</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-sm text-base text-slate-500 leading-relaxed">
        This page doesn&apos;t exist or was moved. Try one of the links below.
      </p>

      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(255,92,24,0.35)] transition hover:brightness-105"
          style={{ background: "linear-gradient(135deg,#FF5C18,#FF7A35)" }}
        >
          Go to dashboard
        </Link>
      </div>

      <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        {[
          { href: "/companies", label: "Companies" },
          { href: "/pricing", label: "Pricing" },
          { href: "/extension", label: "Chrome extension" },
          { href: "/login", label: "Sign in" },
        ].map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="text-sm text-slate-400 transition hover:text-slate-700"
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  )
}

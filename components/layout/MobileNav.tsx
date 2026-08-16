"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Menu, X } from "lucide-react"
import { NAV_LINKS } from "./nav-links"

export default function MobileNav() {
  const [open, setOpen] = useState(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const pathname = usePathname()
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)

  // Close the menu whenever the route changes (link tapped).
  useEffect(() => {
    setOpen(false)
    setPendingHref(null)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    NAV_LINKS.forEach(({ href }) => router.prefetch(href))
  }, [open, router])

  // Close on Escape or when the user clicks outside the anchored dropdown.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="marketing-mobile-trigger"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--term-ink-line)] bg-[var(--term-ink)] p-2 shadow-[0_16px_40px_rgba(16,24,40,0.24)]">
          <nav className="flex flex-col" aria-label="Mobile">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`))
              const pending = pendingHref === href
              return (
                <Link
                  key={href}
                  href={href}
                  onFocus={() => router.prefetch(href)}
                  onClick={() => setOpen(false)}
                  onPointerDown={() => setPendingHref(href)}
                  onTouchStart={() => router.prefetch(href)}
                  prefetch
                  className={`marketing-mobile-link ${active ? "is-active" : ""} ${pending ? "is-pending" : ""}`}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                  {label}
                </Link>
              )
            })}
          </nav>
        </div>
      )}
    </div>
  )
}

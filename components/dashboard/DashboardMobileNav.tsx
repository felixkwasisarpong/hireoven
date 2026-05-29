"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { X } from "lucide-react"
import DashboardSidebarNav from "@/components/dashboard/DashboardSidebarNav"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { cn } from "@/lib/utils"

type MobileNavCtx = {
  open: boolean
  setOpen: (next: boolean) => void
  toggle: () => void
}

const Ctx = createContext<MobileNavCtx | null>(null)

export function useDashboardMobileNav() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useDashboardMobileNav must be used inside DashboardMobileNavProvider")
  return ctx
}

export function DashboardMobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Close on route change so tapping a nav link dismisses the drawer.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  // Lock body scroll while drawer is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const toggle = useCallback(() => setOpen((v) => !v), [])

  return (
    <Ctx.Provider value={{ open, setOpen, toggle }}>
      {children}
      <DashboardMobileNavDrawer />
    </Ctx.Provider>
  )
}

function DashboardMobileNavDrawer() {
  const { open, setOpen } = useDashboardMobileNav()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  // Outer wrapper exists only to absorb `body.site-chroma > * { position: relative }` from globals.css —
  // without it, our fixed overlay below would be forced into the document flow.
  const node = (
    <div>
    <div
      className={cn(
        "fixed inset-0 z-[60] xl:hidden",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Close navigation"
        onClick={() => setOpen(false)}
        tabIndex={open ? 0 : -1}
        className={cn(
          "absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0"
        )}
      />

      <aside
        className={cn(
          "dashboard-feed-skin absolute inset-y-0 left-0 flex w-[84vw] max-w-[300px] flex-col gap-4 border-r border-slate-200 bg-white p-4 shadow-xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Dashboard navigation"
      >
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="block rounded-lg outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
            onClick={() => setOpen(false)}
          >
            <HireovenLogo variant="full" className="h-12 w-auto max-w-[220px]" priority />
            <span className="sr-only">Hireoven home</span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="soft-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto [-webkit-overflow-scrolling:touch]">
          <DashboardSidebarNav variant="light" navSkin="feed" />
        </div>
      </aside>
    </div>
    </div>
  )

  return createPortal(node, document.body)
}

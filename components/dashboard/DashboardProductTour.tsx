"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Lock, Sparkles, X } from "lucide-react"
import { PLAN_NAMES, type FeatureKey, type Plan } from "@/lib/gates"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { useSubscription } from "@/lib/hooks/useSubscription"

const TOUR_START_EVENT = "hireoven:product-tour:start"
const TOUR_OPEN_GROUPS_EVENT = "hireoven:product-tour:open-groups"

type TourMode = "default" | "premium"
type StepGroup = "core" | "premium"

type TourStep = {
  id: string
  group: StepGroup
  title: string
  body: string
  selector?: string
  bullets?: string[]
  ctaLabel?: string
  ctaFeature?: FeatureKey
  highlightPadding?: number
}

type Rect = {
  top: number
  left: number
  width: number
  height: number
  bottom: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function findVisibleElement(selector: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll(selector))
  for (const node of all) {
    if (!(node instanceof HTMLElement)) continue
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    const style = window.getComputedStyle(node)
    if (style.display === "none" || style.visibility === "hidden") continue
    return node
  }
  return null
}

function buildTourSteps(plan: Plan | null): TourStep[] {
  const upsellFeature: FeatureKey | undefined =
    plan === "pro" ? "apex_strategy" : plan === "pro_max" ? undefined : "apex_actions"

  const upsellPlanName =
    plan === "pro" ? PLAN_NAMES.pro_max : plan === "pro_max" ? PLAN_NAMES.pro_max : PLAN_NAMES.pro

  const upsellBullets =
    plan === "pro"
      ? [
          "Apex strategy plans for high-conversion applications.",
          "Cohorts and brand intel to prioritize easier wins.",
          "Advanced H-1B intelligence for sponsorship risk.",
        ]
      : plan === "pro_max"
        ? [
            "You already have full access to Pro + Pro Max features.",
            "Use the locked nav previews as a quick map for where to go next.",
          ]
        : [
            "Apex actions for resume tailoring and role-specific targeting.",
            "Interview copilot and prep flows to improve response quality.",
            "Cohorts, fair chance, and brand intelligence insights.",
          ]

  return [
    {
      id: "welcome",
      group: "core",
      title: "Welcome to your dashboard",
      body: "This walkthrough covers every major product area so users can see the full workflow in one pass.",
    },
    {
      id: "search",
      group: "core",
      selector: "[data-tour=\"dashboard-search\"]",
      title: "Search live openings",
      body: "Use this search bar to target titles, companies, or skills in real time.",
      highlightPadding: 6,
    },
    {
      id: "filters",
      group: "core",
      selector: "[data-tour=\"dashboard-filters\"]",
      title: "Refine with filters",
      body: "Quick filters help narrow by location, salary, sponsorship, and match-focused sorting.",
      highlightPadding: 8,
    },
    {
      id: "watchlist",
      group: "core",
      selector: "[data-tour=\"nav-watchlist\"]",
      title: "Track target companies",
      body: "Keep priority companies in your watchlist so you can react quickly when new roles open.",
      highlightPadding: 8,
    },
    {
      id: "alerts",
      group: "core",
      selector: "[data-tour=\"nav-alerts\"]",
      title: "Alerts for new roles",
      body: "Use alerts to get notified as soon as matching openings are posted.",
      highlightPadding: 8,
    },
    {
      id: "interview",
      group: "core",
      selector: "[data-tour=\"nav-interview\"]",
      title: "Interview prep and live sessions",
      body: "Practice with AI interview flows and move into live sessions when ready.",
      highlightPadding: 8,
    },
    {
      id: "applications",
      group: "core",
      selector: "[data-tour=\"nav-applications\"]",
      title: "Application tracking",
      body: "Track submissions, pipeline stages, and outcomes in one place.",
      highlightPadding: 8,
    },
    {
      id: "resume",
      group: "core",
      selector: "[data-tour=\"nav-resume\"]",
      title: "Resume workspace",
      body: "Build, score, and tailor resume versions for specific roles.",
      highlightPadding: 8,
    },
    {
      id: "cover-letters",
      group: "core",
      selector: "[data-tour=\"nav-cover-letters\"]",
      title: "Cover letter generation",
      body: "Generate and reuse tailored letters tied to your saved opportunities.",
      highlightPadding: 8,
    },
    {
      id: "autofill",
      group: "core",
      selector: "[data-tour=\"nav-autofill\"]",
      title: "Autofill applications",
      body: "Speed up application forms with one-click autofill support.",
      highlightPadding: 8,
    },
    {
      id: "international",
      group: "core",
      selector: "[data-tour=\"nav-international\"]",
      title: "International workflow",
      body: "Access international job search, eligibility, and offer-risk tooling.",
      highlightPadding: 8,
    },
    {
      id: "h1b-intel",
      group: "core",
      selector: "[data-tour=\"nav-h-1b-intel\"]",
      title: "H-1B intelligence",
      body: "Use petition history and sponsorship signals to prioritize targets.",
      highlightPadding: 8,
    },
    {
      id: "premium-apex",
      group: "premium",
      selector: "[data-tour=\"nav-apex\"]",
      title: "Apex is your AI application copilot",
      body: "Even if this is locked right now, this is where tailored resume actions and deeper job strategy live.",
      highlightPadding: 8,
    },
    {
      id: "premium-cohorts",
      group: "premium",
      selector: "[data-tour=\"nav-cohorts\"]",
      title: "Premium strategy insights",
      body: "Cohorts, fair chance, and brand intel help you decide where to spend time for higher return.",
      highlightPadding: 8,
    },
    {
      id: "premium-fair-chance",
      group: "premium",
      selector: "[data-tour=\"nav-fair-chance\"]",
      title: "Fair chance intelligence",
      body: "Find employers with stronger fair-chance indicators before applying.",
      highlightPadding: 8,
    },
    {
      id: "premium-brand",
      group: "premium",
      selector: "[data-tour=\"nav-brand\"]",
      title: "Brand and visibility",
      body: "Track external brand signals that can influence recruiter response rate.",
      highlightPadding: 8,
    },
    {
      id: "premium-summary",
      group: "premium",
      title: `${upsellPlanName} unlocks your full workflow`,
      body:
        plan === "pro_max"
          ? "You are already on the highest plan."
          : `You can preview locked areas now and upgrade when ready to unlock everything end to end.`,
      bullets: upsellBullets,
      ctaLabel:
        plan === "pro"
          ? "Upgrade to Pro Max"
          : plan === "pro_max"
            ? undefined
            : "Start Pro",
      ctaFeature: upsellFeature,
    },
  ]
}

export default function DashboardProductTour() {
  const pathname = usePathname()
  const { plan, isLoading } = useSubscription()
  const { showUpgrade } = useUpgradeModal()

  const [mounted, setMounted] = useState(false)
  const [seenLoaded, setSeenLoaded] = useState(false)
  const [hasSeenTour, setHasSeenTour] = useState(true)
  const [open, setOpen] = useState(false)
  const [steps, setSteps] = useState<TourStep[]>([])
  const [index, setIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [cardHeight, setCardHeight] = useState(260)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const startTimerRef = useRef<number | null>(null)

  const activeStep = steps[index] ?? null

  const markTourSeen = useCallback(async () => {
    setHasSeenTour(true)
    setSeenLoaded(true)
    try {
      await fetch("/api/profile/tour", { method: "POST" })
    } catch {}
  }, [])

  const closeTour = useCallback(() => {
    setOpen(false)
    void markTourSeen()
  }, [markTourSeen])

  const startTour = useCallback(
    (mode: TourMode = "default") => {
      if (typeof window === "undefined") return
      window.dispatchEvent(new CustomEvent(TOUR_OPEN_GROUPS_EVENT))
      if (startTimerRef.current) window.clearTimeout(startTimerRef.current)

      startTimerRef.current = window.setTimeout(() => {
        const seeded = buildTourSteps(plan)
        const available = seeded.filter((step) => {
          if (!step.selector) return true
          return Boolean(findVisibleElement(step.selector))
        })
        if (!available.length) return
        const premiumStart = available.findIndex((step) => step.group === "premium")
        const startIndex = mode === "premium" && premiumStart >= 0 ? premiumStart : 0
        setSteps(available)
        setIndex(startIndex)
        setOpen(true)
      }, 140)
    },
    [plan]
  )

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    return () => {
      if (startTimerRef.current) window.clearTimeout(startTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!mounted || pathname !== "/dashboard") return
    let cancelled = false

    async function loadSeenState() {
      try {
        const res = await fetch("/api/profile/tour", { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { seenAt?: string | null }
        if (cancelled) return
        setHasSeenTour(Boolean(data.seenAt))
      } catch {
        if (cancelled) return
        setHasSeenTour(false)
      } finally {
        if (!cancelled) setSeenLoaded(true)
      }
    }

    void loadSeenState()
    return () => {
      cancelled = true
    }
  }, [mounted, pathname])

  useEffect(() => {
    if (!mounted) return
    const syncViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    syncViewport()
    window.addEventListener("resize", syncViewport)
    return () => window.removeEventListener("resize", syncViewport)
  }, [mounted])

  useEffect(() => {
    if (!mounted) return
    function handleStart(event: Event) {
      const detail = (event as CustomEvent<{ mode?: TourMode }>).detail
      startTour(detail?.mode === "premium" ? "premium" : "default")
    }
    window.addEventListener(TOUR_START_EVENT, handleStart as EventListener)
    return () => window.removeEventListener(TOUR_START_EVENT, handleStart as EventListener)
  }, [mounted, startTour])

  useEffect(() => {
    if (!mounted || open || isLoading || !seenLoaded) return
    if (pathname !== "/dashboard") return
    if (hasSeenTour) return

    const timer = window.setTimeout(() => startTour("default"), 200)
    return () => window.clearTimeout(timer)
  }, [hasSeenTour, isLoading, mounted, open, pathname, seenLoaded, startTour])

  useEffect(() => {
    if (!open || !activeStep?.selector) {
      setTargetRect(null)
      return
    }

    const node = findVisibleElement(activeStep.selector)
    if (!node) {
      setTargetRect(null)
      return
    }
    node.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })

    const syncRect = () => {
      const liveNode = findVisibleElement(activeStep.selector!)
      if (!liveNode) {
        setTargetRect(null)
        return
      }
      const rect = liveNode.getBoundingClientRect()
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
      })
    }

    syncRect()
    window.addEventListener("resize", syncRect)
    window.addEventListener("scroll", syncRect, true)
    const timer = window.setInterval(syncRect, 300)
    return () => {
      window.removeEventListener("resize", syncRect)
      window.removeEventListener("scroll", syncRect, true)
      window.clearInterval(timer)
    }
  }, [activeStep?.selector, open])

  useEffect(() => {
    if (!open || !cardRef.current) return
    setCardHeight(cardRef.current.getBoundingClientRect().height)
  }, [open, index, steps.length])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeTour()
        return
      }
      if (event.key === "ArrowRight") {
        setIndex((current) => Math.min(current + 1, steps.length - 1))
      }
      if (event.key === "ArrowLeft") {
        setIndex((current) => Math.max(current - 1, 0))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [closeTour, open, steps.length])

  const cardStyle = useMemo(() => {
    if (viewport.width <= 0 || viewport.height <= 0) return {}
    if (viewport.width < 1024) {
      return {
        left: 12,
        right: 12,
        bottom: 12,
      } as const
    }

    if (!targetRect) {
      const width = Math.min(420, viewport.width - 24)
      return {
        width,
        left: (viewport.width - width) / 2,
        top: (viewport.height - cardHeight) / 2,
      } as const
    }

    const width = Math.min(420, viewport.width - 24)
    const left = clamp(targetRect.left + targetRect.width / 2 - width / 2, 12, viewport.width - width - 12)
    const fitsBelow = targetRect.bottom + cardHeight + 20 < viewport.height
    const rawTop = fitsBelow ? targetRect.bottom + 14 : targetRect.top - cardHeight - 14
    const top = clamp(rawTop, 12, viewport.height - cardHeight - 12)
    return { width, left, top } as const
  }, [cardHeight, targetRect, viewport.height, viewport.width])

  if (!mounted || !open || !activeStep) return null

  const isLastStep = index === steps.length - 1
  const canGoBack = index > 0
  const padding = activeStep.highlightPadding ?? 8

  return (
    <div className="fixed inset-0 z-[95]">
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[1px]" />

      {targetRect && (
        <div
          className="pointer-events-none absolute rounded-xl border-2 border-[#FF8A3D] shadow-[0_0_0_9999px_rgba(2,6,23,0.56)] transition-all"
          style={{
            top: targetRect.top - padding,
            left: targetRect.left - padding,
            width: targetRect.width + padding * 2,
            height: targetRect.height + padding * 2,
          }}
        />
      )}

      <div
        ref={cardRef}
        className="absolute rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_30px_80px_rgba(15,23,42,0.35)]"
        style={cardStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Product tour · Step {index + 1} of {steps.length}
          </p>
          <button
            type="button"
            onClick={closeTour}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close product tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h3 className="mt-1.5 text-[17px] font-bold text-slate-900">{activeStep.title}</h3>
        <p className="mt-2 text-[13.5px] leading-6 text-slate-600">{activeStep.body}</p>

        {activeStep.bullets && activeStep.bullets.length > 0 && (
          <ul className="mt-3 space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {activeStep.bullets.map((item) => (
              <li key={item} className="flex items-start gap-2 text-[12.5px] text-slate-700">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF5C18]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        {activeStep.ctaLabel && activeStep.ctaFeature && (
          <button
            type="button"
            onClick={() => {
              showUpgrade(activeStep.ctaFeature!)
              closeTour()
            }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#FF5C18] px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#E6500E]"
          >
            <Lock className="h-3.5 w-3.5" />
            {activeStep.ctaLabel}
          </button>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={closeTour}
            className="text-[12px] font-semibold text-slate-500 transition hover:text-slate-800"
          >
            Skip tour
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIndex((current) => Math.max(current - 1, 0))}
              disabled={!canGoBack}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (isLastStep) {
                  closeTour()
                  return
                }
                setIndex((current) => Math.min(current + 1, steps.length - 1))
              }}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-slate-700"
            >
              {isLastStep ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react"

type ToastTone = "success" | "error" | "info"

type ToastAction = {
  label: string
  href: string
}

type Toast = {
  id: string
  title: string
  description?: string
  tone: ToastTone
  action?: ToastAction
}

type ToastInput = Omit<Toast, "id">

type ToastContextValue = {
  pushToast: (toast: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const ROUTE_TOASTS: Record<string, ToastInput> = {
  "access-denied": {
    tone: "error",
    title: "Access denied",
    description: "You do not have permission to view the admin panel.",
  },
}

function iconForTone(tone: ToastTone) {
  if (tone === "success") return CheckCircle2
  if (tone === "error") return AlertCircle
  return Info
}

function classesForTone(tone: ToastTone) {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900"
  }
  if (tone === "error") {
    return "border-red-200 bg-red-50 text-red-900"
  }
  return "border-sky-200 bg-sky-50 text-sky-900"
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<string, number>>(new Map())

  const pushToast = useCallback((toast: ToastInput) => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { ...toast, id }])

    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
      timersRef.current.delete(id)
    }, 4200)

    timersRef.current.set(id, timer)
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of Array.from(timersRef.current.values())) {
        window.clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [])

  const value = useMemo(() => ({ pushToast }), [pushToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-3">
        {toasts.map((toast) => {
          const Icon = iconForTone(toast.tone)
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-[0_20px_60px_rgba(15,23,42,0.10)] ${classesForTone(
                toast.tone
              )}`}
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-1 text-sm opacity-80">{toast.description}</p>
                  ) : null}
                  {toast.action ? (
                    <a
                      href={toast.action.href}
                      className="mt-2 inline-flex items-center text-xs font-bold underline underline-offset-2 opacity-90 hover:opacity-100"
                    >
                      {toast.action.label} →
                    </a>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setToasts((current) =>
                      current.filter((item) => item.id !== toast.id)
                    )
                  }
                  className="rounded-full p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100"
                  aria-label="Dismiss toast"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function RouteToastBridge() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const context = useContext(ToastContext)

  useEffect(() => {
    const toastKey = searchParams.get("toast")
    if (!toastKey || !context) return

    const toast = ROUTE_TOASTS[toastKey]
    if (!toast) return

    context.pushToast(toast)

    const next = new URLSearchParams(searchParams.toString())
    next.delete("toast")
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [context, pathname, router, searchParams])

  return null
}

export function useToast() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error("useToast must be used within ToastProvider")
  }

  return context
}

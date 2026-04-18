"use client"

import { useEffect, useMemo, useState } from "react"
import { BellRing, CheckCircle2, X } from "lucide-react"

const DISMISS_KEY = "hireoven:push-dismissed-until"
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const normalized = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(normalized)
  return Uint8Array.from(Array.from(rawData, (char) => char.charCodeAt(0)))
}

async function fetchPublicKey() {
  const response = await fetch("/api/alerts/subscribe")
  if (!response.ok) throw new Error("Unable to load push configuration")
  const payload = (await response.json()) as { publicKey?: string }
  if (!payload.publicKey) throw new Error("Missing VAPID public key")
  return payload.publicKey
}

async function persistSubscription(subscription: PushSubscription) {
  const response = await fetch("/api/alerts/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  })

  if (!response.ok) {
    throw new Error("Unable to save push subscription")
  }
}

export default function PushNotificationSetup() {
  const [supported, setSupported] = useState(false)
  const [loading, setLoading] = useState(true)
  const [subscribed, setSubscribed] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function checkStatus() {
      const isSupported =
        "Notification" in window &&
        "serviceWorker" in navigator &&
        "PushManager" in window

      setSupported(isSupported)
      if (!isSupported) {
        setLoading(false)
        return
      }

      const dismissedUntil = Number(window.localStorage.getItem(DISMISS_KEY) ?? "0")
      if (dismissedUntil > Date.now()) {
        setDismissed(true)
      }

      const registration = await navigator.serviceWorker.ready
      const existingSubscription = await registration.pushManager.getSubscription()

      if (existingSubscription) {
        setSubscribed(true)
        setSuccess(true)
        try {
          await persistSubscription(existingSubscription)
        } catch {
          // Keep UI calm if the server sync fails during initialization.
        }
      }

      setLoading(false)
    }

    void checkStatus()
  }, [])

  const shouldShow = useMemo(() => {
    if (loading || !supported) return false
    if (dismissed) return false
    return !subscribed
  }, [dismissed, loading, subscribed, supported])

  async function enableNotifications() {
    setError(null)
    setLoading(true)

    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        throw new Error("Notification permission was not granted")
      }

      const [publicKey, registration] = await Promise.all([
        fetchPublicKey(),
        navigator.serviceWorker.ready,
      ])

      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
      }

      await persistSubscription(subscription)
      setSubscribed(true)
      setSuccess(true)
    } catch (nextError) {
      setError((nextError as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function dismiss() {
    window.localStorage.setItem(
      DISMISS_KEY,
      String(Date.now() + DISMISS_WINDOW_MS)
    )
    setDismissed(true)
  }

  if (!shouldShow && !success) return null

  return (
    <div className="rounded-[28px] border border-[#CDEBFF] bg-[#F5FBFF] p-4">
      {success ? (
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-[#0369A1]" />
          <div>
            <p className="text-sm font-semibold text-[#0C4A6E]">
              You&apos;ll be notified instantly
            </p>
            <p className="text-xs text-[#365E7D]">
              Hireoven will alert you when fresh jobs drop.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#0369A1]">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Get instant alerts when jobs drop
              </p>
              <p className="mt-1 text-sm text-gray-600">
                Enable notifications so new matches reach you before the crowd.
              </p>
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void enableNotifications()}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-2xl bg-[#0369A1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075985] disabled:opacity-60"
            >
              {loading ? "Enabling…" : "Enable"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-200 bg-white text-gray-500 transition hover:border-gray-300 hover:text-gray-700"
              aria-label="Dismiss push notification prompt"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

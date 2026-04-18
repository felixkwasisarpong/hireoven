"use client"

import { useEffect } from "react"

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        await Promise.all(registrations.map((registration) => registration.unregister()))

        if ("caches" in window) {
          const keys = await window.caches.keys()
          await Promise.all(
            keys
              .filter((key) => key.startsWith("hireoven-"))
              .map((key) => window.caches.delete(key))
          )
        }
      })

      return
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.update())
      .catch((error) => {
        console.error("[pwa] service worker registration failed", error)
      })
  }, [])

  return null
}

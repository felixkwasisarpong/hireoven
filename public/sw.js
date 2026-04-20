const STATIC_CACHE = "hireoven-static-v3"
const DATA_CACHE = "hireoven-data-v3"
const META_CACHE = "hireoven-meta-v2"
const OFFLINE_URL = "/offline.html"
const JOB_COUNT_META_URL = "/__offline__/jobs-count"
const NOTIFICATION_COUNT_META_URL = "/__offline__/notification-count"
const CORE_ASSETS = [
  "/",
  "/dashboard",
  "/offline.html",
  "/icon-192.png",
  "/icon-512.png",
]

function isStaticAsset(request) {
  const url = new URL(request.url)

  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/")) {
    return false
  }

  if (request.destination && request.destination !== "document") {
    return true
  }

  return /\.(?:js|css|png|jpg|jpeg|svg|ico|webp|woff2?)$/i.test(url.pathname)
}

function isApiOrJobDataRequest(request) {
  const url = new URL(request.url)
  return (
    (url.origin === self.location.origin && url.pathname.startsWith("/api/")) ||
    url.pathname.startsWith("/rest/v1/jobs")
  )
}

async function setMetaValue(key, value) {
  const cache = await caches.open(META_CACHE)
  await cache.put(
    key,
    new Response(JSON.stringify({ count: value }), {
      headers: { "Content-Type": "application/json" },
    })
  )
}

async function getMetaValue(key) {
  const cache = await caches.open(META_CACHE)
  const response = await cache.match(key)
  if (!response) return 0

  try {
    const payload = await response.json()
    return typeof payload.count === "number" ? payload.count : 0
  } catch {
    return 0
  }
}

async function updateCachedJobsCount(request, response) {
  if (!response.ok || !isApiOrJobDataRequest(request)) return

  try {
    const payload = await response.clone().json()
    const count = Array.isArray(payload?.jobs)
      ? payload.jobs.length
      : typeof payload?.totalCount === "number"
        ? payload.totalCount
        : 0

    await setMetaValue(JOB_COUNT_META_URL, count)
  } catch {
    // Ignore non-JSON responses.
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)

  try {
    const response = await fetch(request)
    if (response.ok) {
      await cache.put(request, response.clone())
      await updateCachedJobsCount(request, response)
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached

    if (request.mode === "navigate") {
      return (await caches.match(OFFLINE_URL)) || Response.error()
    }

    return new Response("Offline", { status: 503, statusText: "Offline" })
  }
}

/**
 * Navigations are never cached. Cached HTML after a deploy can reference deleted
 * `/_next/static/*` assets, causing an unstyled page. Offline navigations fall
 * back to the offline shell only.
 */
async function navigateNetworkOnly(request) {
  try {
    return await fetch(request)
  } catch {
    return (await caches.match(OFFLINE_URL)) || Response.error()
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE)
    await cache.put(request, response.clone())
  }

  return response
}

async function clearNotificationBadge() {
  await setMetaValue(NOTIFICATION_COUNT_META_URL, 0)

  if (typeof self.registration.clearAppBadge === "function") {
    try {
      await self.registration.clearAppBadge()
    } catch {
      // Ignore unsupported badge implementations.
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      await Promise.allSettled(CORE_ASSETS.map((asset) => cache.add(asset)))
      await self.skipWaiting()
    })()
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => ![STATIC_CACHE, DATA_CACHE, META_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {}

  event.waitUntil(
    (async () => {
      const currentCount = await getMetaValue(NOTIFICATION_COUNT_META_URL)
      const nextCount = currentCount + 1
      await setMetaValue(NOTIFICATION_COUNT_META_URL, nextCount)

      if (typeof self.registration.setAppBadge === "function") {
        try {
          await self.registration.setAppBadge(nextCount)
        } catch {
          // Ignore unsupported badge implementations.
        }
      }

      await self.registration.showNotification(payload.title || "Hireoven", {
        body: payload.body || "Fresh jobs are waiting for you.",
        icon: payload.icon || "/icon-192.png",
        badge: payload.badge || "/badge-72.png",
        data: payload.data || {},
        actions: payload.actions || [],
      })
    })()
  )
})

self.addEventListener("notificationclick", (event) => {
  const { action, notification } = event
  const applyUrl = notification.data?.applyUrl

  notification.close()

  event.waitUntil(
    (async () => {
      await clearNotificationBadge()

      if (action === "dismiss") {
        return
      }

      if (action === "apply" && applyUrl) {
        await self.clients.openWindow(applyUrl)
        return
      }

      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      const dashboardClient = allClients.find((client) => client.url.includes("/dashboard"))

      if (dashboardClient) {
        await dashboardClient.focus()
        return
      }

      await self.clients.openWindow("/dashboard")
    })()
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)

  if (url.origin === self.location.origin && url.pathname === JOB_COUNT_META_URL) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(META_CACHE)
        return (
          (await cache.match(JOB_COUNT_META_URL)) ||
          new Response(JSON.stringify({ count: 0 }), {
            headers: { "Content-Type": "application/json" },
          })
        )
      })()
    )
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(navigateNetworkOnly(request))
    return
  }

  if (isApiOrJobDataRequest(request)) {
    event.respondWith(networkFirst(request, DATA_CACHE))
    return
  }

  if (isStaticAsset(request)) {
    event.respondWith(cacheFirst(request))
  }
})

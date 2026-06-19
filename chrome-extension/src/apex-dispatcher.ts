/**
 * Apex aggregator dispatcher (background-context).
 *
 * Receives APEX_* messages from aggregator content scripts and (a) forwards
 * job/company writes to the web app, (b) relays UI gate/answer prompts to the
 * active hireoven.com tab via window.postMessage, (c) tracks site connection
 * status for the web app's "extension connected?" indicator.
 *
 * This module never scrapes pages. Scrapers live in content scripts on the
 * user's active tab (per brief constraint).
 */

const APP_ORIGINS = [
  "http://localhost:3000",
  "https://hireoven.com",
] as const
const SESSION_COOKIE_NAME = "ho_session"

type AggregatorSite = "linkedin" | "glassdoor" | "indeed" | "handshake"

interface ScrapedJob {
  site: AggregatorSite
  sourceId: string
  title: string
  company: string
  companyUrl?: string
  location: string
  workMode?: "remote" | "hybrid" | "onsite"
  employmentType?: string
  postedAt: string
  postedAtPrecision: "exact" | "day" | "bucket"
  description: string
  salary?: string
  salaryConfirmed?: boolean
  applyMode: { kind: string; driver?: string; destinationGuess?: string }
  metadata: Record<string, unknown>
}

// ── Per-site connection tracking ─────────────────────────────────────────────

const lastConnectedAt = new Map<AggregatorSite, number>()
const PING_TIMEOUT_MS = 5000

function recordConnection(site: AggregatorSite): void {
  lastConnectedAt.set(site, Date.now())
}

/** Returns the sites that responded to the last broadcast APEX_PING within 5s. */
async function pingAllTabs(): Promise<{ connected: AggregatorSite[] }> {
  const tabs = await chrome.tabs.query({})
  const responses = new Set<AggregatorSite>()
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return
      try {
        const reply = await Promise.race<{ alive?: boolean; site?: AggregatorSite } | null>([
          new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id!, { type: "APEX_PING" }, (r) => {
              if (chrome.runtime.lastError) {
                resolve(null)
                return
              }
              resolve(r ?? null)
            })
          }),
          new Promise((resolve) => setTimeout(() => resolve(null), PING_TIMEOUT_MS)),
        ])
        if (reply?.alive && reply.site) responses.add(reply.site)
      } catch {
        // sendMessage may throw if no listener — ignore
      }
    }),
  )
  return { connected: Array.from(responses) }
}

// ── Auth / API helper (mirrors background.ts apiRequest pattern) ─────────────

async function resolveOrigin(): Promise<string> {
  // Keep aggregator API writes on the production app by default. Local
  // development routes through the main background service worker's devMode.
  return APP_ORIGINS[1]
}

async function getSessionToken(origin: string): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: origin, name: SESSION_COOKIE_NAME }, (cookie) => {
      resolve(cookie?.value ?? null)
    })
  })
}

async function postApex<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const origin = await resolveOrigin()
  const token = await getSessionToken(origin)
  if (!token) return { ok: false, error: "no_session", status: 401 }
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Hireoven-Extension": "apex-aggregator",
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      return { ok: false, error: text || response.statusText, status: response.status }
    }
    return { ok: true, data: (await response.json()) as T }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function getApex<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const origin = await resolveOrigin()
  const token = await getSessionToken(origin)
  if (!token) return { ok: false, error: "no_session", status: 401 }
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Hireoven-Extension": "apex-aggregator",
      },
    })
    if (!response.ok) {
      return { ok: false, error: response.statusText, status: response.status }
    }
    return { ok: true, data: (await response.json()) as T }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Hireoven-tab relay (window.postMessage bridge) ───────────────────────────

/**
 * Send a relay event to all hireoven.com tabs and, if any of them respond
 * within `timeoutMs`, return the first response. Used for gate/answer prompts
 * that need user input via the BrowserContextRail UI.
 *
 * If no hireoven.com tab is open OR no response arrives in time, returns null.
 */
async function relayToHireovenTab<T = unknown>(
  payload: Record<string, unknown>,
  timeoutMs = 60000,
): Promise<T | null> {
  const tabs = await chrome.tabs.query({})
  const hireovenTabs = tabs.filter((t) =>
    t.url ? APP_ORIGINS.some((o) => t.url!.startsWith(o)) : false,
  )
  if (hireovenTabs.length === 0) return null

  return await Promise.race<T | null>([
    new Promise<T | null>((resolve) => {
      let settled = false
      for (const tab of hireovenTabs) {
        if (!tab.id) continue
        chrome.tabs.sendMessage(
          tab.id,
          { type: "BROADCAST_CONTEXT", context: null, events: [], apexRelay: payload },
          (response) => {
            if (chrome.runtime.lastError) return
            if (settled) return
            if (response && typeof response === "object") {
              settled = true
              resolve(response as T)
            }
          },
        )
      }
    }),
    new Promise<T | null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ])
}

/**
 * Broadcast an event to hireoven.com tabs without waiting for a reply
 * (e.g. opening the ApplyAgentFlow drawer).
 */
async function broadcastToHireovenTabs(payload: Record<string, unknown>): Promise<void> {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id) continue
    if (!tab.url || !APP_ORIGINS.some((o) => tab.url!.startsWith(o))) continue
    chrome.tabs.sendMessage(
      tab.id,
      { type: "BROADCAST_CONTEXT", context: null, events: [], apexBroadcast: payload },
      () => {
        void chrome.runtime.lastError
      },
    )
  }
}

// ── Indeed redirect chain follower ──────────────────────────────────────────

/**
 * Follow `indeed.com/rc/clk?…` redirect chains via redirect: 'manual' to
 * surface the final destination URL plus a guess at the destination ATS.
 * Stops at 5 hops. Background-only because content scripts can't follow
 * cross-origin manual redirects.
 */
async function followIndeedRedirect(initialUrl: string): Promise<{ finalUrl: string; atsGuess: string | null }> {
  let current = initialUrl
  for (let i = 0; i < 5; i++) {
    try {
      const response = await fetch(current, { method: "HEAD", redirect: "manual" })
      const location = response.headers.get("location")
      if (!location) break
      current = new URL(location, current).toString()
      const u = new URL(current)
      if (!/(\.|^)indeed\./i.test(u.hostname)) break
    } catch {
      break
    }
  }
  return { finalUrl: current, atsGuess: guessAtsFromUrl(current) }
}

function guessAtsFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.endsWith("greenhouse.io")) return "greenhouse"
    if (host.endsWith("lever.co")) return "lever"
    if (host.endsWith("ashbyhq.com")) return "ashby"
    if (host.endsWith("myworkdayjobs.com") || host.endsWith("workdayjobs.com")) return "workday"
    if (host.endsWith("icims.com")) return "icims"
    if (host.endsWith("smartrecruiters.com")) return "smartrecruiters"
    if (host.endsWith("bamboohr.com")) return "bamboohr"
    return null
  } catch {
    return null
  }
}

// ── Public dispatcher entry point ───────────────────────────────────────────

/**
 * Returns true if `message` was claimed (caller should `return true` to keep
 * the channel open). Returns false to let other listeners handle it.
 */
export function dispatchApexMessage(
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): boolean {
  if (typeof message !== "object" || message === null) return false
  const m = message as Record<string, unknown>
  const type = m.type
  if (typeof type !== "string" || !type.startsWith("APEX_")) return false

  switch (type) {
    case "APEX_CONNECTED": {
      const site = m.site as AggregatorSite | undefined
      if (site) recordConnection(site)
      void broadcastToHireovenTabs({ kind: "apex.connected", site })
      sendResponse({ ok: true })
      return false
    }

    case "APEX_PING_REQUEST": {
      // Initiated by the hireoven.com page when it wants a connection probe.
      void pingAllTabs().then((result) => sendResponse(result))
      return true
    }

    case "APEX_INGEST_JOB": {
      const job = m.job as ScrapedJob | undefined
      if (!job) {
        sendResponse({ ok: false, error: "missing job" })
        return false
      }
      void postApex("/api/apex/jobs/ingest", { source: job.site, job }).then(sendResponse)
      return true
    }

    case "APEX_TRACK_INTEREST": {
      const job = m.job as ScrapedJob | undefined
      const applyMethod = (m.applyMethod as string) ?? "express_interest"
      if (!job) {
        sendResponse({ ok: false, error: "missing job" })
        return false
      }
      void postApex("/api/apex/jobs/ingest", { source: job.site, job, applyMethod }).then(sendResponse)
      return true
    }

    case "APEX_ENRICH_COMPANY": {
      void postApex("/api/apex/companies/enrich", {
        source: m.source,
        companyName: m.companyName,
        explicit: !!m.explicit,
        signals: m.signals,
      }).then(sendResponse)
      return true
    }

    case "APEX_GET_USER_MAJOR": {
      void getApex<{ profile?: { field_of_study?: string | null } | null }>(
        "/api/extension/autofill-profile",
      ).then((res) => {
        if (res.ok) {
          sendResponse({ major: res.data.profile?.field_of_study ?? null })
        } else {
          sendResponse({ major: null })
        }
      })
      return true
    }

    case "APEX_OPEN_APPLY_FLOW": {
      void broadcastToHireovenTabs({
        kind: "apex.openApplyFlow",
        site: m.site,
        jobId: m.jobId,
        scrapedJob: m.scrapedJob,
      })
      sendResponse({ ok: true })
      return false
    }

    case "APEX_GATE_STEP": {
      void relayToHireovenTab<{ approved?: boolean; reason?: string }>({
        kind: "apex.gateStep",
        driver: m.driver,
        stepName: m.stepName,
      }).then((reply) => {
        sendResponse(reply ?? { approved: false, reason: "no_rail" })
      })
      return true
    }

    case "APEX_NEEDS_ANSWER": {
      void relayToHireovenTab<{ answer?: string | null }>({
        kind: "apex.needsAnswer",
        driver: m.driver,
        question: m.question,
      }).then((reply) => sendResponse(reply ?? { answer: null }))
      return true
    }

    case "APEX_DISQUALIFY_WARNING": {
      void relayToHireovenTab<{ proceed?: boolean }>({
        kind: "apex.disqualifyWarning",
        driver: m.driver,
        question: m.question,
        savedAnswer: m.savedAnswer,
      }).then((reply) => sendResponse(reply ?? { proceed: false }))
      return true
    }

    case "APEX_LOCKED_RESUME": {
      void relayToHireovenTab<{ proceed?: boolean }>({
        kind: "apex.lockedResume",
        driver: m.driver,
      }).then((reply) => sendResponse(reply ?? { proceed: false }))
      return true
    }

    case "APEX_RESOLVE_INDEED_REDIRECT": {
      const url = m.url as string | undefined
      if (!url) {
        sendResponse({ finalUrl: null, atsGuess: null })
        return false
      }
      void followIndeedRedirect(url).then(sendResponse)
      return true
    }

    default:
      return false
  }
}

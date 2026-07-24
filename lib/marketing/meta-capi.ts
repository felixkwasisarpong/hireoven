import { createHash } from "crypto"

// Meta Conversions API (server-side) — sends conversion events straight to
// Meta from our backend, so signup completions are counted even when the
// browser pixel is blocked (iOS ATT, ad-blockers). Deduped with any browser
// pixel via a shared event_id. Fully guarded: if unconfigured it no-ops, and
// it NEVER throws — a marketing call must never break auth.
//
// Configure with env vars (read directly, like GOOGLE_CLIENT_ID):
//   META_PIXEL_ID            – your Meta Pixel / dataset id
//   META_CAPI_ACCESS_TOKEN   – Conversions API access token
//   META_CAPI_TEST_EVENT_CODE (optional) – for Meta's Test Events tab

const GRAPH_VERSION = "v19.0"

function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex")
}

export type MetaCapiEvent = {
  eventName: "CompleteRegistration" | "Lead"
  /** Dedup key shared with the browser pixel (use the new user's id). */
  eventId: string
  email?: string | null
  eventSourceUrl?: string | null
  clientIpAddress?: string | null
  clientUserAgent?: string | null
  fbp?: string | null
  fbc?: string | null
}

/** Parse Meta's _fbp / _fbc cookies from a raw Cookie header for better matching. */
export function parseFbCookies(cookieHeader: string | null): {
  fbp: string | null
  fbc: string | null
} {
  if (!cookieHeader) return { fbp: null, fbc: null }
  const get = (key: string) => {
    const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`))
    return m ? decodeURIComponent(m[1]) : null
  }
  return { fbp: get("_fbp"), fbc: get("_fbc") }
}

export async function sendMetaCapiEvent(evt: MetaCapiEvent): Promise<void> {
  const pixelId = process.env.META_PIXEL_ID?.trim()
  const token = process.env.META_CAPI_ACCESS_TOKEN?.trim()
  if (!pixelId || !token) return // not configured — no-op

  const userData: Record<string, unknown> = {}
  if (evt.email) userData.em = [sha256(evt.email)]
  if (evt.clientIpAddress) userData.client_ip_address = evt.clientIpAddress
  if (evt.clientUserAgent) userData.client_user_agent = evt.clientUserAgent
  if (evt.fbp) userData.fbp = evt.fbp
  if (evt.fbc) userData.fbc = evt.fbc

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: evt.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: evt.eventId,
        action_source: "website",
        ...(evt.eventSourceUrl ? { event_source_url: evt.eventSourceUrl } : {}),
        user_data: userData,
      },
    ],
  }
  if (process.env.META_CAPI_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_CAPI_TEST_EVENT_CODE
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)
  try {
    await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    )
  } catch {
    // Timeout / network / Meta error — analytics must never break signup.
  } finally {
    clearTimeout(timeout)
  }
}

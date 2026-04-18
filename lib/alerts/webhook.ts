import { createHmac, timingSafeEqual } from "crypto"

function compareSignatures(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)

  if (expectedBuffer.length !== providedBuffer.length) return false
  return timingSafeEqual(expectedBuffer, providedBuffer)
}

export function verifyWebhookSignature(rawBody: string, headers: Headers) {
  const secret = process.env.SUPABASE_WEBHOOK_SECRET
  if (!secret) {
    throw new Error("Missing SUPABASE_WEBHOOK_SECRET")
  }

  const directSecret =
    headers.get("x-supabase-webhook-secret") ??
    headers.get("x-webhook-secret") ??
    headers.get("authorization")?.replace(/^Bearer\s+/i, "")

  if (directSecret && compareSignatures(secret, directSecret)) {
    return true
  }

  const providedSignature =
    headers.get("x-supabase-signature") ??
    headers.get("x-webhook-signature") ??
    headers.get("x-signature-256") ??
    headers.get("x-signature")

  if (!providedSignature) return false

  const digest = createHmac("sha256", secret).update(rawBody).digest()
  const candidates = [
    digest.toString("hex"),
    `sha256=${digest.toString("hex")}`,
    digest.toString("base64"),
    `sha256=${digest.toString("base64")}`,
  ]

  return candidates.some((candidate) => compareSignatures(candidate, providedSignature))
}

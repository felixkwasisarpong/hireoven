import { createHash, randomBytes } from "crypto"

export const SIGNAL_API_KEY_PREFIX = "apxsk_live_"

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function createSignalApiKey(entropyBytes = 24): {
  rawKey: string
  keyPrefix: string
  keyHash: string
} {
  const entropy = randomBytes(entropyBytes).toString("hex")
  const rawKey = `${SIGNAL_API_KEY_PREFIX}${entropy}`
  return {
    rawKey,
    keyPrefix: rawKey.slice(0, 16),
    keyHash: sha256Hex(rawKey),
  }
}


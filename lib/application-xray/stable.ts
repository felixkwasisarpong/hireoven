import { createHash } from "node:crypto"

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortValue((value as Record<string, unknown>)[key])
  }
  return out
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

const EM_DASH_RE = /\u2014/g

export function replaceEmDash(text: string): string {
  return text.replace(EM_DASH_RE, "-")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== "[object Object]") return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function sanitizeGeneratedText<T>(value: T): T {
  if (typeof value === "string") {
    return replaceEmDash(value) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeneratedText(item)) as T
  }

  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      next[k] = sanitizeGeneratedText(v)
    }
    return next as T
  }

  return value
}

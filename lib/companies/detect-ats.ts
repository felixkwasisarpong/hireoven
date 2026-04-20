export type AtsType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "icims"
  | "bamboohr"
  | "custom"

export type AtsDetection = {
  atsType: AtsType
  atsIdentifier: string | null
  confidence: "high" | "medium" | "low"
}

function safeUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function cleanIdentifier(value: string | null | undefined) {
  if (!value) return null
  const cleaned = value.trim().replace(/^@+/, "")
  return cleaned.length > 0 ? cleaned : null
}

export function detectAtsFromUrl(rawUrl: string): AtsDetection | null {
  const parsed = safeUrl(rawUrl.trim())
  if (!parsed) return null

  const host = parsed.hostname.toLowerCase()
  const pathParts = parsed.pathname.split("/").filter(Boolean)

  if (host === "boards.greenhouse.io" || host.endsWith(".greenhouse.io")) {
    const identifier =
      cleanIdentifier(pathParts[0]) ??
      cleanIdentifier(host.split(".")[0])
    return { atsType: "greenhouse", atsIdentifier: identifier, confidence: "high" }
  }

  if (host === "jobs.lever.co") {
    const identifier = cleanIdentifier(pathParts[0])
    return { atsType: "lever", atsIdentifier: identifier, confidence: "high" }
  }

  if (host === "jobs.ashbyhq.com") {
    const identifier = cleanIdentifier(pathParts[0])
    return { atsType: "ashby", atsIdentifier: identifier, confidence: "high" }
  }

  if (host.includes("myworkdayjobs.com")) {
    return { atsType: "workday", atsIdentifier: null, confidence: "high" }
  }

  if (host.endsWith(".icims.com") || host === "icims.com") {
    return { atsType: "icims", atsIdentifier: null, confidence: "medium" }
  }

  if (host.endsWith(".bamboohr.com") || host === "bamboohr.com") {
    const identifier = cleanIdentifier(host.split(".")[0])
    return { atsType: "bamboohr", atsIdentifier: identifier, confidence: "high" }
  }

  return null
}

export function detectAts({
  careersUrl,
  applyUrls,
}: {
  careersUrl: string | null
  applyUrls: string[]
}): AtsDetection | null {
  const fromApply = applyUrls
    .map((url) => detectAtsFromUrl(url))
    .filter((x): x is AtsDetection => Boolean(x))

  if (fromApply.length > 0) {
    const counts = new Map<AtsType, number>()
    for (const hit of fromApply) {
      counts.set(hit.atsType, (counts.get(hit.atsType) ?? 0) + 1)
    }
    const bestType = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (bestType) {
      const withType = fromApply.filter((hit) => hit.atsType === bestType)
      const bestId =
        withType.find((hit) => hit.atsIdentifier)?.atsIdentifier ?? null
      return {
        atsType: bestType,
        atsIdentifier: bestId,
        confidence: withType.length >= 2 ? "high" : "medium",
      }
    }
  }

  if (careersUrl) {
    return detectAtsFromUrl(careersUrl)
  }

  return null
}

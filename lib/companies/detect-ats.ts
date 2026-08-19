import { extractGreenhouseBoardToken, isGreenhouseHost } from "@/lib/companies/greenhouse-url"
import { detectAtsFromHtml } from "@/lib/companies/ats-signatures"

export type AtsType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "icims"
  | "taleo"
  | "successfactors"
  | "oraclecloud"
  | "phenom"
  | "eightfold"
  | "avature"
  | "adp"
  | "ukg"
  | "smartrecruiters"
  | "bamboohr"
  | "jobvite"
  | "workable"
  | "recruitee"
  | "rippling"
  | "custom"

export type AtsDetection = {
  atsType: AtsType
  atsIdentifier: string | null
  confidence: "high" | "medium" | "low"
  source?: "url" | "html"
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

  if (isGreenhouseHost(host)) {
    const identifier =
      cleanIdentifier(extractGreenhouseBoardToken(rawUrl)) ??
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

  // myworkdaysite.com is Workday's other careers host — same boards, tenant in
  // the path (wd5.myworkdaysite.com/recruiting/<tenant>/<site>) instead of the
  // subdomain. Without it these URLs looked like an unknown vendor and the
  // Career Site Scout could not classify them at all.
  if (
    host.includes("myworkdayjobs.com") ||
    host.endsWith(".workdayjobs.com") ||
    host.endsWith(".myworkdaysite.com")
  ) {
    return { atsType: "workday", atsIdentifier: null, confidence: "high" }
  }

  if (host.endsWith(".icims.com") || host === "icims.com") {
    return { atsType: "icims", atsIdentifier: null, confidence: "high" }
  }

  if (host.endsWith(".taleo.net")) {
    return { atsType: "taleo", atsIdentifier: cleanIdentifier(host.replace(/\.taleo\.net$/, "")), confidence: "high" }
  }

  if (
    /^(career(?:1[0-2]?|[2-9]))\.successfactors\.(com|eu)$/.test(host) ||
    host === "jobs.hr.cloud.sap"
  ) {
    return { atsType: "successfactors", atsIdentifier: cleanIdentifier(parsed.searchParams.get("company")), confidence: "high" }
  }

  if (host.endsWith(".oraclecloud.com") && parsed.pathname.includes("/CandidateExperience/")) {
    return { atsType: "oraclecloud", atsIdentifier: null, confidence: "high" }
  }

  if (host.endsWith(".phenompeople.com")) {
    return { atsType: "phenom", atsIdentifier: cleanIdentifier(host.split(".")[0]), confidence: "high" }
  }

  if (host.endsWith(".eightfold.ai")) {
    return { atsType: "eightfold", atsIdentifier: cleanIdentifier(host.split(".")[0]), confidence: "high" }
  }

  if (host.endsWith(".avature.net")) {
    return { atsType: "avature", atsIdentifier: cleanIdentifier(host.split(".")[0]), confidence: "high" }
  }

  if (
    host === "workforcenow.adp.com" ||
    host === "recruiting.adp.com" ||
    host.endsWith(".adpemployment.com")
  ) {
    return { atsType: "adp", atsIdentifier: null, confidence: "high" }
  }

  if (host === "recruiting.ultipro.com" || host === "recruiting2.ultipro.com" || host.endsWith(".ukg.net")) {
    return { atsType: "ukg", atsIdentifier: null, confidence: "high" }
  }

  if (host === "jobs.smartrecruiters.com") {
    const identifier = cleanIdentifier(pathParts[0])
    return { atsType: "smartrecruiters", atsIdentifier: identifier, confidence: "high" }
  }

  if (host === "jobs.jobvite.com") {
    const identifier = cleanIdentifier(pathParts[0])
    return { atsType: "jobvite", atsIdentifier: identifier, confidence: "high" }
  }

  if (host === "apply.workable.com") {
    const identifier = cleanIdentifier(pathParts[0])
    return { atsType: "workable", atsIdentifier: identifier, confidence: "high" }
  }

  if (host.endsWith(".recruitee.com")) {
    const identifier = cleanIdentifier(host.split(".")[0])
    return { atsType: "recruitee", atsIdentifier: identifier, confidence: "high" }
  }

  if (host.endsWith(".bamboohr.com") || host === "bamboohr.com") {
    const identifier = cleanIdentifier(host.split(".")[0])
    return { atsType: "bamboohr", atsIdentifier: identifier, confidence: "high" }
  }

  if (host === "ats.rippling.com") {
    // Boards are served both as /slug/jobs and under a locale prefix
    // (/en-GB/slug/jobs), which is the form Rippling's own locale switcher
    // produces — so the first segment is not reliably the company slug.
    const isLocale = (segment: string | undefined) =>
      Boolean(segment) && /^[a-z]{2}(-[a-z]{2,3})?$/i.test(segment!)
    const segments =
      pathParts.length > 1 && isLocale(pathParts[0]) && pathParts[1] !== "jobs"
        ? pathParts.slice(1)
        : pathParts
    return { atsType: "rippling", atsIdentifier: cleanIdentifier(segments[0]), confidence: "high" }
  }

  return null
}

export function detectAts({
  careersUrl,
  applyUrls,
  html,
}: {
  careersUrl: string | null
  applyUrls: string[]
  /**
   * Optional rendered HTML of the careers page. When provided and URL-based
   * detection is inconclusive, the HTML is scanned for ATS signatures
   * (boards.greenhouse.io scripts, jobs.lever.co references, Workday markers,
   * etc.) so that branded portals — most notably iCIMS — are recognized.
   */
  html?: string | null
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
        source: "url",
      }
    }
  }

  if (careersUrl) {
    const fromUrl = detectAtsFromUrl(careersUrl)
    if (fromUrl) return { ...fromUrl, source: "url" }
  }

  // Fall back to HTML signature detection — useful for branded portals
  // (e.g. careers.acme.com proxying iCIMS) where URL alone is uninformative.
  if (html && careersUrl) {
    const fromHtml = detectAtsFromHtml({ url: careersUrl, html })
    if (fromHtml) {
      return {
        atsType: fromHtml.atsType,
        atsIdentifier: null,
        confidence: fromHtml.confidence,
        source: "html",
      }
    }
  }

  return null
}

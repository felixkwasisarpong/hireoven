export type AtsType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "icims"
  | "bamboohr"
  | "custom"

export type AtsEvidence = {
  atsType: AtsType
  confidence: "high" | "medium" | "low"
  reasons: string[]
}

type SignatureRule = {
  atsType: Exclude<AtsType, "custom">
  confidence: "high" | "medium" | "low"
  test: (payload: { url: string; html: string }) => string | null
}

const RULES: SignatureRule[] = [
  {
    atsType: "greenhouse",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("boards.greenhouse.io")) return "URL host matches boards.greenhouse.io"
      if (html.includes("boards.greenhouse.io")) return "HTML references boards.greenhouse.io"
      if (html.includes("grnh.se")) return "HTML references greenhouse shortlinks"
      return null
    },
  },
  {
    atsType: "lever",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("jobs.lever.co")) return "URL host matches jobs.lever.co"
      if (html.includes("jobs.lever.co")) return "HTML references jobs.lever.co"
      if (html.includes("lever-apply") || html.includes("lever.co/v2")) return "Lever script markers found"
      return null
    },
  },
  {
    atsType: "ashby",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("jobs.ashbyhq.com")) return "URL host matches jobs.ashbyhq.com"
      if (html.includes("jobs.ashbyhq.com")) return "HTML references jobs.ashbyhq.com"
      if (html.includes("ashbyhq")) return "Ashby markers found"
      return null
    },
  },
  {
    atsType: "workday",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("myworkdayjobs.com")) return "URL host matches myworkdayjobs.com"
      if (html.includes("myworkdayjobs.com")) return "HTML references myworkdayjobs.com"
      if (html.includes("wd5.myworkdayjobs") || html.includes("workday/cxs")) return "Workday markers found"
      return null
    },
  },
  {
    atsType: "icims",
    confidence: "medium",
    test: ({ url, html }) => {
      if (url.includes(".icims.com")) return "URL host matches *.icims.com"
      if (html.includes(".icims.com")) return "HTML references icims domain"
      if (html.includes("icims applicant tracking")) return "iCIMS text marker found"
      return null
    },
  },
  {
    atsType: "bamboohr",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes(".bamboohr.com")) return "URL host matches *.bamboohr.com"
      if (html.includes(".bamboohr.com/jobs")) return "HTML references bamboohr jobs"
      if (html.includes("bamboohr")) return "BambooHR marker found"
      return null
    },
  },
]

export function detectAtsFromHtml({
  url,
  html,
}: {
  url: string
  html: string
}): AtsEvidence | null {
  const normalizedUrl = url.toLowerCase()
  const normalizedHtml = html.toLowerCase()

  for (const rule of RULES) {
    const reason = rule.test({ url: normalizedUrl, html: normalizedHtml })
    if (!reason) continue

    return {
      atsType: rule.atsType,
      confidence: rule.confidence,
      reasons: [reason],
    }
  }

  return null
}

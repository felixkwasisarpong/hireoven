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
      if (html.includes("wd5.myworkdayjobs") || html.includes("/wday/cxs/") || html.includes("workday/cxs")) return "Workday markers found"
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
    atsType: "taleo",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes(".taleo.net/careersection/")) return "URL host matches Taleo careersection"
      if (html.includes(".taleo.net/careersection/")) return "HTML references Taleo careersection"
      if (html.includes("taleo.net") && html.includes("jobsearch.ftl")) return "Taleo jobsearch markers found"
      return null
    },
  },
  {
    atsType: "successfactors",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("successfactors.com/career") || url.includes("successfactors.eu/career")) return "URL host matches SAP SuccessFactors career"
      if (url.includes("jobs.hr.cloud.sap")) return "URL host matches SAP jobs.hr.cloud.sap"
      if (html.includes("successfactors.com/career") || html.includes("successfactors.eu/career")) return "HTML references SAP SuccessFactors career"
      if (html.includes("jobs.hr.cloud.sap")) return "HTML references SAP jobs.hr.cloud.sap"
      return null
    },
  },
  {
    atsType: "oraclecloud",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("oraclecloud.com/hcmui/candidateexperience/")) return "URL host matches Oracle Cloud Candidate Experience"
      if (html.includes("oraclecloud.com/hcmui/candidateexperience/")) return "HTML references Oracle Cloud Candidate Experience"
      if (html.includes("/hcmui/candidateexperience/") && html.includes("/sites/")) return "Oracle Cloud Candidate Experience markers found"
      return null
    },
  },
  {
    atsType: "phenom",
    confidence: "medium",
    test: ({ url, html }) => {
      if (url.includes("phenompeople.com")) return "URL host matches phenompeople.com"
      if (html.includes("phenompeople.com")) return "HTML references phenompeople.com"
      if (html.includes("phenom") && html.includes("job")) return "Phenom job markers found"
      return null
    },
  },
  {
    atsType: "eightfold",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("eightfold.ai")) return "URL host matches eightfold.ai"
      if (html.includes("eightfold.ai")) return "HTML references eightfold.ai"
      if (html.includes("eightfold") && html.includes("career")) return "Eightfold career markers found"
      return null
    },
  },
  {
    atsType: "avature",
    confidence: "medium",
    test: ({ url, html }) => {
      if (url.includes("avature.net")) return "URL host matches avature.net"
      if (html.includes("avature.net")) return "HTML references avature.net"
      if (html.includes("avature") && html.includes("job")) return "Avature job markers found"
      return null
    },
  },
  {
    atsType: "adp",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("workforcenow.adp.com") || url.includes("recruiting.adp.com") || url.includes("adpemployment.com")) return "URL host matches ADP recruiting"
      if (html.includes("workforcenow.adp.com") || html.includes("recruiting.adp.com") || html.includes("adpemployment.com")) return "HTML references ADP recruiting"
      return null
    },
  },
  {
    atsType: "ukg",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("recruiting.ultipro.com") || url.includes("recruiting2.ultipro.com") || url.includes(".ukg.net")) return "URL host matches UKG recruiting"
      if (html.includes("recruiting.ultipro.com") || html.includes("recruiting2.ultipro.com") || html.includes(".ukg.net")) return "HTML references UKG recruiting"
      return null
    },
  },
  {
    atsType: "smartrecruiters",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("jobs.smartrecruiters.com")) return "URL host matches jobs.smartrecruiters.com"
      if (html.includes("jobs.smartrecruiters.com")) return "HTML references jobs.smartrecruiters.com"
      if (html.includes("smartrecruiters")) return "SmartRecruiters marker found"
      return null
    },
  },
  {
    atsType: "jobvite",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("jobs.jobvite.com")) return "URL host matches jobs.jobvite.com"
      if (url.includes("jobvite.com")) return "URL host matches jobvite.com"
      if (html.includes("jobs.jobvite.com")) return "HTML references jobs.jobvite.com"
      if (html.includes("jobvite")) return "Jobvite markers found"
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
  {
    atsType: "workable",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes("apply.workable.com")) return "URL host matches apply.workable.com"
      if (html.includes("apply.workable.com")) return "HTML references apply.workable.com"
      if (html.includes("workable.com") && html.includes("jobs")) return "Workable job markers found"
      return null
    },
  },
  {
    atsType: "recruitee",
    confidence: "high",
    test: ({ url, html }) => {
      if (url.includes(".recruitee.com")) return "URL host matches recruitee.com"
      if (html.includes(".recruitee.com")) return "HTML references recruitee.com"
      if (html.includes("recruitee") && html.includes("jobs")) return "Recruitee job markers found"
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

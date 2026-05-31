export function buildJDDecodePrompt(title: string, description: string, resumeSummary?: string): string {
  return `You are the Apex Job Description Decoder. Your job is to read a job posting with radical honesty — like a trusted insider who has seen thousands of these and knows all the tricks.

JOB TITLE: ${title}

JOB DESCRIPTION:
${description.slice(0, 6000)}

${resumeSummary ? `CANDIDATE PROFILE SUMMARY:\n${resumeSummary}\n` : ""}

Respond with a JSON object matching this exact shape (no markdown, raw JSON only):

{
  "mustHaves": ["string — actual hard requirement, not fluff"],
  "niceToHaves": ["string — nice-to-have reframed honestly"],
  "hiddenExpectations": ["string — unstated but implied expectation"],
  "tldr": "string — one brutally honest sentence summarizing this job",
  "overallScore": number (0-100, how healthy and honest this JD is — 100 = perfectly transparent),
  "additionalRedFlags": [
    { "id": "string", "severity": "critical|warning|note", "label": "string", "excerpt": "string", "explanation": "string" }
  ],
  "additionalGreenSignals": ["string"]
}

Rules:
- mustHaves = things you would actually be blocked without (not just listed as "required")
- niceToHaves = the 3+ "preferred" items that are really just wish-list padding
- hiddenExpectations = read between the lines — what is this role actually asking for that they won't say outright?
- tldr = be honest, even if it sounds harsh (e.g. "This is a senior IC role disguised as mid-level to underpay the hire")
- overallScore = deduct for vague comp, overreach, red flags; add for transparency, clear scope, honest requirements
- additionalRedFlags = any we missed from the rules engine
- Keep each string concise (under 120 chars)`
}

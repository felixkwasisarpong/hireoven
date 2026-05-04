import type { NegotiationTimeline, NegotiationTimelineStep } from "./types"

export function getNegotiationTimeline(
  offerDeadline: Date | null,
  analysisComplete: boolean
): NegotiationTimeline {
  const now = new Date()

  const daysRemaining = offerDeadline
    ? Math.ceil((offerDeadline.getTime() - now.getTime()) / 86_400_000)
    : null

  const urgencyLevel =
    daysRemaining === null ? "low"
    : daysRemaining <= 2 ? "high"
    : daysRemaining <= 5 ? "medium"
    : "low"

  const deadlineStr = offerDeadline
    ? offerDeadline.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null

  const steps: NegotiationTimelineStep[] = [
    {
      day: "Day 0 — Today",
      action: "Thank them and ask for time to review",
      script: `"Thank you so much for the offer — I'm really excited about this opportunity. Could I have until [${deadlineStr ?? "end of week"}] to review the full package and get back to you?"`,
      isAutomatic: false,
    },
    {
      day: "Day 1–2",
      action: "Run your market research",
      script: analysisComplete
        ? "Your analysis is ready. Review the salary benchmark, component breakdown, and counter-offer script in the Negotiate tab."
        : "Hireoven is analyzing your offer against LCA prevailing wages and market benchmarks. Your counter-offer script will be ready within minutes.",
      isAutomatic: true,
    },
    {
      day: "Day 2–3",
      action: "Prepare your counter-offer",
      script: "Review the generated email and verbal scripts. Adjust numbers to reflect any competing offers. Practice the verbal script out loud at least twice.",
      isAutomatic: false,
    },
    {
      day: "Day 3–4",
      action: "Make the ask — verbal first, then email",
      script: `Request a call: "I'd love to hop on a quick call to discuss the offer before I sign. Are you free tomorrow for 15 minutes?" After the call, send the email version to create a paper trail.`,
      isAutomatic: false,
    },
    {
      day: "Day 5+",
      action: "Handle their response",
      script: urgencyLevel === "high"
        ? "Deadline is close. If they can't move on base, ask for a one-time signing bonus and a 6-month salary review. Do not accept below your fallback without exploring all components first."
        : "If they counter, use your middle fallback position. If they are firm, request one non-salary item (signing bonus, equity refresh, extra PTO). Document everything in writing before signing.",
      isAutomatic: false,
    },
  ]

  return { deadline: deadlineStr, daysRemaining, steps, urgencyLevel }
}

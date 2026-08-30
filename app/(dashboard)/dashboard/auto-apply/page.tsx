import { getSessionUser } from "@/lib/auth/session-user"
import { getAutoApplyLog } from "@/lib/apex/auto-apply/store"
import { getRemainingAllowance } from "@/lib/apex/auto-apply/limits"
import { getPendingQuestions } from "@/lib/autofill/screening-answers"
import { getPlanForUserId } from "@/lib/gates/server-gate"
import type { AutoApplyRecord } from "@/lib/apex/auto-apply/types"
import AutoApplyActivityClient from "./AutoApplyActivityClient"

export const dynamic = "force-dynamic"

export const metadata = { title: "Auto-apply activity" }

export default async function AutoApplyPage() {
  const session = await getSessionUser()
  if (!session?.sub) {
    return <AutoApplyActivityClient log={[]} allowance={null} questions={[]} />
  }

  const plan = await getPlanForUserId(session.sub)
  // Both fail closed on their own, so a broken read shows an empty, honest
  // screen rather than an optimistic one.
  const [log, allowance, questions] = await Promise.all([
    getAutoApplyLog(session.sub, 100),
    getRemainingAllowance(session.sub, plan, "UTC").catch(() => null),
    getPendingQuestions(session.sub, 25),
  ])

  return (
    <AutoApplyActivityClient
      log={log as AutoApplyRecord[]}
      questions={questions}
      allowance={
        allowance
          ? {
              allowed: allowance.allowed,
              reason: allowance.reason,
              usedThisWeek: allowance.usedThisWeek,
              weeklyCap: allowance.limits.weeklyCap,
              enabled: allowance.limits.enabled,
            }
          : null
      }
    />
  )
}

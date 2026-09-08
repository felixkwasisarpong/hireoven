import { getSessionUser } from "@/lib/auth/session-user"
import { getAutoApplyLog } from "@/lib/apex/auto-apply/store"
import { getRemainingAllowance } from "@/lib/apex/auto-apply/limits"
import { getPendingQuestions } from "@/lib/autofill/screening-answers"
import { getAutoApplyPrefs } from "@/lib/apex/auto-apply/store"
import {
  isAutoApplyLiveSubmitAllowed,
  isAutoApplyPostSubmitOutreachAllowed,
} from "@/lib/apex/auto-apply/live-submit"
import { getPlanForUserId } from "@/lib/gates/server-gate"
import type { AutoApplyRecord } from "@/lib/apex/auto-apply/types"
import AutoApplyActivityClient from "./AutoApplyActivityClient"

export const dynamic = "force-dynamic"

export const metadata = { title: "Auto-apply activity" }

export default async function AutoApplyPage() {
  const session = await getSessionUser()
  if (!session?.sub) {
    return (
      <AutoApplyActivityClient
        log={[]}
        allowance={null}
        questions={[]}
        enabled={false}
        liveSubmitEnabled={false}
        postSubmitOutreachEnabled={false}
      />
    )
  }

  const plan = await getPlanForUserId(session.sub)
  // Both fail closed on their own, so a broken read shows an empty, honest
  // screen rather than an optimistic one.
  const [log, allowance, questions, prefs] = await Promise.all([
    getAutoApplyLog(session.sub, 100),
    getRemainingAllowance(session.sub, plan, "UTC").catch(() => null),
    getPendingQuestions(session.sub, 25),
    getAutoApplyPrefs(session.sub),
  ])
  const liveSubmitEnabled = allowance?.limits.enabled === true &&
    isAutoApplyLiveSubmitAllowed({
      userId: session.sub,
      email: session.email,
    })
  const postSubmitOutreachEnabled = liveSubmitEnabled && isAutoApplyPostSubmitOutreachAllowed({
    userId: session.sub,
    email: session.email,
  })

  return (
    <AutoApplyActivityClient
      log={log as AutoApplyRecord[]}
      questions={questions}
      enabled={prefs.enabled === true}
      liveSubmitEnabled={liveSubmitEnabled}
      postSubmitOutreachEnabled={postSubmitOutreachEnabled}
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

import { getSessionUser } from "@/lib/auth/session-user"
import { fetchAutofillProfileSummaryForUser } from "@/lib/autofill/profile"
import type { AutofillProfile } from "@/types"
import AutofillPageClient from "./AutofillPageClient"

export const dynamic = "force-dynamic"

type AutofillPageInitialData = {
  initialAutofillProfile: AutofillProfile | null
  initialLoaded: boolean
}

async function getInitialData(): Promise<AutofillPageInitialData> {
  const fallback: AutofillPageInitialData = {
    initialAutofillProfile: null,
    initialLoaded: false,
  }

  const session = await getSessionUser()
  if (!session?.sub) return fallback

  try {
    const summary = await fetchAutofillProfileSummaryForUser(session.sub)
    return {
      initialAutofillProfile: summary.profile,
      initialLoaded: true,
    }
  } catch {
    return fallback
  }
}

export default async function AutofillPage() {
  const { initialAutofillProfile, initialLoaded } = await getInitialData()

  return (
    <AutofillPageClient
      initialAutofillProfile={initialAutofillProfile}
      initialLoaded={initialLoaded}
    />
  )
}

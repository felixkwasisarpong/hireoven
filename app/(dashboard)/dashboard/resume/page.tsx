import ResumePageClient from "./ResumePageClient"

type TabId = "overview" | "library" | "generate" | "edit" | "tailor"

const VALID_TABS: TabId[] = ["overview", "library", "generate", "edit", "tailor"]
export const dynamic = "force-dynamic"

function parseTab(value: string | string[] | undefined): TabId {
  const candidate = Array.isArray(value) ? value[0] : value
  if (candidate && VALID_TABS.includes(candidate as TabId)) {
    return candidate as TabId
  }
  return "overview"
}

export default function ResumePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const initialTab = parseTab(searchParams?.tab)
  return <ResumePageClient initialTab={initialTab} />
}

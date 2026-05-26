import ResetPasswordPageClient from "./ResetPasswordPageClient"

export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

function readStringParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return typeof value === "string" ? value : null
}

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  const token = readStringParam(searchParams?.token)
  return <ResetPasswordPageClient initialToken={token} />
}

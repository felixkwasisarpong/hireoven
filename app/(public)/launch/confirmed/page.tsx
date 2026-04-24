import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import ConfirmedShareBlock from "@/components/waitlist/ConfirmedShareBlock"
import { LaunchFooter, LaunchNavbar } from "@/components/waitlist/LaunchChrome"
import { WaitlistSuccessCheck } from "@/components/waitlist/WaitlistForm"
import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { getWaitlistPosition } from "@/lib/waitlist/position"

export const metadata: Metadata = {
  title: "You're confirmed - Hireoven",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function LaunchConfirmedPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const token =
    typeof searchParams.token === "string"
      ? searchParams.token
      : Array.isArray(searchParams.token)
        ? searchParams.token[0]
        : undefined

  if (!token?.trim()) {
    redirect("/launch")
  }

  if (!hasPostgresEnv()) {
    redirect("/launch")
  }

  const pool = getPostgresPool()
  const { rows } = await pool.query<{ id: string; joined_at: string }>(
    `SELECT id, joined_at FROM waitlist WHERE confirmation_token = $1 LIMIT 1`,
    [token.trim()]
  )
  const row = rows[0]

  if (!row) {
    redirect("/launch?error=invalid-token")
  }

  const position = await getWaitlistPosition(row.joined_at)

  return (
    <div className="min-h-screen bg-background">
      <LaunchNavbar />
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="flex justify-center">
          <div className="animate-scale-in">
            <WaitlistSuccessCheck />
          </div>
        </div>
        <h1 className="mt-8 text-3xl font-extrabold text-strong">You&apos;re confirmed!</h1>
        <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
          You&apos;re #{position} in line - we&apos;ll email you the moment we launch.
        </p>

        <ConfirmedShareBlock waitlistId={row.id} />
        <p className="mt-10 text-sm">
          <Link href="/launch" className="font-semibold text-teal-700 hover:underline">
            ← Back to launch page
          </Link>
        </p>
      </main>
      <LaunchFooter />
    </div>
  )
}

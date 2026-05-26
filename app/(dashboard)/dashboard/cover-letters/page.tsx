import { getSessionUser } from "@/lib/auth/session-user"
import { getPostgresPool } from "@/lib/postgres/server"
import type { CoverLetter } from "@/types"
import CoverLettersPageClient from "./CoverLettersPageClient"

export const dynamic = "force-dynamic"

type CoverLettersInitialData = {
  initialLetters: CoverLetter[]
  initialLoaded: boolean
}

async function getCoverLettersInitialData(): Promise<CoverLettersInitialData> {
  const fallback: CoverLettersInitialData = {
    initialLetters: [],
    initialLoaded: false,
  }

  const session = await getSessionUser()
  if (!session?.sub) return fallback

  try {
    const pool = getPostgresPool()
    const result = await pool.query<CoverLetter>(
      `SELECT *
       FROM cover_letters
       WHERE user_id = $1::uuid
       ORDER BY created_at DESC`,
      [session.sub],
    )

    return {
      initialLetters: result.rows,
      initialLoaded: true,
    }
  } catch {
    return fallback
  }
}

export default async function CoverLettersPage() {
  const { initialLetters, initialLoaded } = await getCoverLettersInitialData()

  return (
    <CoverLettersPageClient
      initialLetters={initialLetters}
      initialLoaded={initialLoaded}
    />
  )
}

/**
 * PATCH /api/extension/cover-letter/[id]
 *
 * Updates a saved cover letter's body (used when the user edits the generated
 * draft in the extension's right-rail review pane). Recomputes word_count.
 *
 * Auth: Bearer <ho_session JWT> sent by the Chrome extension.
 */

import { NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import {
  extensionError,
  extensionCorsHeaders,
  handleExtensionPreflight,
  readExtensionJsonBody,
  requireExtensionAuth,
} from "@/lib/extension/auth"

export const runtime = "nodejs"
export const maxDuration = 10

export function OPTIONS(request: Request) {
  return handleExtensionPreflight(request)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = request.headers.get("origin")
  const headers = extensionCorsHeaders(origin)

  const [user, errResponse] = await requireExtensionAuth(request)
  if (errResponse) return errResponse

  const { id } = await context.params
  if (!id) return extensionError(request, 400, "id is required", { headers })

  const [body, bodyError] = await readExtensionJsonBody<{ body?: string; was_used?: boolean }>(request)
  if (bodyError) return bodyError

  const newBody = typeof body.body === "string" ? body.body.trim() : null
  const wasUsed = typeof body.was_used === "boolean" ? body.was_used : null

  if (newBody === null && wasUsed === null) {
    return extensionError(request, 400, "Nothing to update", { headers })
  }

  const pool = getPostgresPool()

  if (newBody !== null) {
    const wordCount = newBody.split(/\s+/).filter(Boolean).length
    const result = await pool.query(
      `UPDATE cover_letters
         SET body = $1, word_count = $2, updated_at = NOW()
         ${wasUsed === true ? ", was_used = true" : ""}
       WHERE id = $3 AND user_id = $4`,
      [newBody, wordCount, id, user.sub],
    )
    if (result.rowCount === 0) {
      return extensionError(request, 404, "Cover letter not found", { headers })
    }
  } else if (wasUsed !== null) {
    const result = await pool.query(
      `UPDATE cover_letters SET was_used = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
      [wasUsed, id, user.sub],
    )
    if (result.rowCount === 0) {
      return extensionError(request, 404, "Cover letter not found", { headers })
    }
  }

  return NextResponse.json({ ok: true }, { headers })
}

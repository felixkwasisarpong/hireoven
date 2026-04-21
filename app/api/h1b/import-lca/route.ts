import { NextRequest, NextResponse } from 'next/server'
import { assertAdminAccess } from '@/lib/admin/auth'
import { importLCAData, type ImportProgress } from '@/lib/h1b/lca-importer'
import { invalidateSOCBaseRateCache } from '@/lib/h1b/predictor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Admin-only endpoint: upload a DOL LCA Excel file and import it.
 *
 * Streams progress as NDJSON (one JSON object per line). Each line is either:
 *   { type: "progress", phase, processed, total, inserted, message? }
 *   { type: "result",   ...ImportResult }
 *   { type: "error",    error }
 *
 * Accepts a multipart/form-data body with:
 *   file: the .xlsx file (required)
 *   fiscalYear: number (optional, used if the file rows don't carry one)
 *
 * Company creation is NOT handled here — use
 * `scripts/reconcile-companies-from-imports.ts` after import.
 *
 * The service-role key header is also accepted so this can be triggered
 * from local scripts without going through the UI.
 */
export async function POST(request: NextRequest) {
  const serviceKey = request.headers.get('x-service-role-key')
  if (serviceKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const access = await assertAdminAccess()
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  }

  const fiscalYearRaw = formData.get('fiscalYear')
  const fiscalYear =
    typeof fiscalYearRaw === 'string' && fiscalYearRaw.trim() !== ''
      ? Number(fiscalYearRaw)
      : undefined

  const buffer = await file.arrayBuffer()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }

      try {
        const result = await importLCAData(buffer, {
          fiscalYear,
          onProgress: (p: ImportProgress) => {
            send({ type: 'progress', ...p })
          },
        })
        invalidateSOCBaseRateCache()
        send({ type: 'result', ...result })
      } catch (err) {
        console.error('LCA import failed', err)
        send({ type: 'error', error: (err as Error).message ?? 'Import failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-content-type-options': 'nosniff',
    },
  })
}

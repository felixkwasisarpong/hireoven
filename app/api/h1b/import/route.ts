import { NextRequest, NextResponse } from 'next/server'
import { assertAdminAccess } from '@/lib/admin/auth'
import { importH1BDataFromBuffer } from '@/lib/h1b/uscis-parser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Streams NDJSON progress for a USCIS H-1B Employer Data Hub upload.
 * Same shape as the LCA import route.
 *
 * Company creation is NOT handled here — the importer only attaches
 * `h1b_records.company_id` when a normalised employer name matches an
 * existing `companies` row. Unmatched employers are reconciled by
 * `scripts/reconcile-companies-from-imports.ts`.
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
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }

      try {
        const result = await importH1BDataFromBuffer(buffer, {
          onProgress: (p) => {
            send({ type: 'progress', ...p })
          },
        })
        send({ type: 'result', ...result })
      } catch (err) {
        console.error('USCIS import failed', err)
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

import { NextRequest, NextResponse } from 'next/server'
import { assertAdminAccess } from '@/lib/admin/auth'
import { importH1BDataFromBuffer } from '@/lib/h1b/uscis-parser'

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

  const csvContent = await file.text()
  const result = await importH1BDataFromBuffer(csvContent)
  return NextResponse.json({ success: true, ...result })
}

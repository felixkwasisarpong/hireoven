import { NextRequest, NextResponse } from 'next/server'
import { importH1BDataFromBuffer } from '@/lib/h1b/uscis-parser'

export async function POST(request: NextRequest) {
  const serviceKey = request.headers.get('x-service-role-key')
  if (serviceKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const csvContent = await file.text()
  const result = await importH1BDataFromBuffer(csvContent)
  return NextResponse.json({ success: true, ...result })
}

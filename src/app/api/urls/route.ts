import { NextRequest, NextResponse } from 'next/server'

// Mock data store (replace with Supabase later)
const mockUrls = [
  {
    id: '1',
    user_id: 'demo-user',
    url: 'https://example-competitor.com',
    name: '競合A社',
    check_interval: 'weekly',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
]

export async function GET() {
  return NextResponse.json({ urls: mockUrls })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const newUrl = {
    id: crypto.randomUUID(),
    user_id: 'demo-user',
    url: body.url,
    name: body.name || new URL(body.url).hostname,
    check_interval: body.check_interval || 'weekly',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  mockUrls.push(newUrl)
  return NextResponse.json({ url: newUrl }, { status: 201 })
}

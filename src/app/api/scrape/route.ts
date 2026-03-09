import { NextRequest, NextResponse } from 'next/server'
import { generateMockChanges } from '@/lib/services/scraper'
import { analyzeChanges } from '@/lib/services/ai-analyzer'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { url, urlName } = body

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  try {
    const diff = generateMockChanges(url)
    const analysis = await analyzeChanges(diff)

    return NextResponse.json({
      success: true,
      result: {
        url,
        urlName,
        changes: diff.changes,
        analysis,
        scrapedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Scrape error:', error)
    return NextResponse.json({ error: 'Scraping failed' }, { status: 500 })
  }
}

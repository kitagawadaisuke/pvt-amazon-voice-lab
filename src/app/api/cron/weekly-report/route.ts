import { NextRequest, NextResponse } from 'next/server'
import { generateMockChanges } from '@/lib/services/scraper'
import { analyzeChanges } from '@/lib/services/ai-analyzer'
import { sendReportEmail } from '@/lib/services/email'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const mockUrls = [
      { url: 'https://example-competitor.com', name: '競合A社' },
      { url: 'https://another-competitor.com', name: '競合B社' },
    ]

    const changes = []
    for (const urlInfo of mockUrls) {
      const diff = generateMockChanges(urlInfo.url)
      if (diff.hasSignificantChanges) {
        const analysis = await analyzeChanges(diff)
        changes.push({
          url: urlInfo.url,
          urlName: urlInfo.name,
          summary: analysis.summary,
          importance: analysis.importance,
          insights: analysis.insights,
        })
      }
    }

    if (changes.length > 0) {
      const today = new Date()
      const reportDate = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`

      await sendReportEmail({
        to: 'demo@example.com',
        userName: 'デモユーザー',
        reportDate,
        changes,
      })
    }

    return NextResponse.json({
      success: true,
      processedUrls: mockUrls.length,
      changesFound: changes.length,
    })
  } catch (error) {
    console.error('Cron job error:', error)
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 })
  }
}

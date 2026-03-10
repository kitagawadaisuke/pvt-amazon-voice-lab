import { NextRequest, NextResponse } from 'next/server'
import { getReportByAsin } from '@/lib/store/review-memory-store'

export async function GET(request: NextRequest) {
  const asin = request.nextUrl.searchParams.get('asin')?.trim()

  if (!asin) {
    return NextResponse.json({ error: 'asin が必要です' }, { status: 400 })
  }

  const report = getReportByAsin(asin)
  if (!report) {
    return NextResponse.json({ error: '分析レポートが見つかりません' }, { status: 404 })
  }

  return NextResponse.json({ report })
}

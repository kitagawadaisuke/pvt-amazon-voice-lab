import { NextRequest, NextResponse } from 'next/server'
import { fetchReviews, validateAsin } from '@/lib/services/review-scraper'
import { analyzeReviews } from '@/lib/services/pox-analyzer'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { asin: rawAsin, apiKey: userApiKey } = body

  if (!rawAsin) {
    return NextResponse.json({ error: 'ASINを入力してください' }, { status: 400 })
  }

  const asin = validateAsin(rawAsin)
  if (!asin) {
    return NextResponse.json(
      { error: '有効なASIN（例: B0DEMO12345）またはAmazon商品URLを入力してください' },
      { status: 400 }
    )
  }

  try {
    // Step 1: レビュー取得
    const reviews = await fetchReviews(asin)

    // Step 2: POX分析
    const report = await analyzeReviews(reviews, userApiKey)

    return NextResponse.json({
      success: true,
      report,
      reviewSummary: {
        total: reviews.totalReviews,
        averageRating: reviews.averageRating,
        lowRatingCount: reviews.lowRatingReviews.length,
        highRatingCount: reviews.highRatingReviews.length,
      },
    })
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json({ error: '分析に失敗しました' }, { status: 500 })
  }
}

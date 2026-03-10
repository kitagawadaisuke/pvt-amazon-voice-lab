import { NextRequest, NextResponse } from 'next/server'
import { fetchReviews, validateAsin, ReviewCollection } from '@/lib/services/review-scraper'
import { analyzeReviews } from '@/lib/services/pox-analyzer'
import { getCollectionByAsin, saveAnalysisResult } from '@/lib/store/review-memory-store'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { asin: rawAsin, apiKey: userApiKey, source, reviews: extensionReviews, customCategories } = body

  // Chrome拡張からのデータ受信
  if (source === 'chrome_extension' && extensionReviews) {
    try {
      const reviewCollection: ReviewCollection = {
        asin: extensionReviews.asin,
        productName: extensionReviews.productName,
        totalReviews: extensionReviews.totalReviews,
        averageRating: extensionReviews.averageRating,
        ratingBreakdown: extensionReviews.ratingBreakdown || calculateBreakdown(extensionReviews.reviews || []),
        reviews: extensionReviews.reviews || [],
        lowRatingReviews: extensionReviews.lowRatingReviews || [],
        highRatingReviews: extensionReviews.highRatingReviews || [],
        fetchedAt: extensionReviews.fetchedAt,
        fetchedCount: extensionReviews.fetchedCount || (extensionReviews.reviews || []).length,
        source: extensionReviews.source || 'mock',
        warnings: extensionReviews.warnings || [],
      }

      console.log(`Chrome拡張からレビュー受信: ${reviewCollection.reviews.length}件 (low: ${reviewCollection.lowRatingReviews.length}, high: ${reviewCollection.highRatingReviews.length})`)

      const report = await analyzeReviews(reviewCollection, userApiKey, { customCategories })
      saveAnalysisResult({
        asin: reviewCollection.asin,
        productName: reviewCollection.productName,
        averageRating: reviewCollection.averageRating,
        totalReviews: reviewCollection.totalReviews,
        report,
        collection: reviewCollection,
      })

      return NextResponse.json({
        success: true,
        report,
        reviewSummary: {
          total: reviewCollection.totalReviews,
          averageRating: reviewCollection.averageRating,
          lowRatingCount: reviewCollection.lowRatingReviews.length,
          highRatingCount: reviewCollection.highRatingReviews.length,
          fetchedCount: reviewCollection.reviews.length,
          source: 'chrome_extension',
        },
      }, { headers: corsHeaders })
    } catch (error) {
      console.error('Analysis error (extension):', error)
      return NextResponse.json({ error: '分析に失敗しました' }, { status: 500, headers: corsHeaders })
    }
  }

  // 従来のASIN入力 → API取得フロー
  if (!rawAsin) {
    return NextResponse.json({ error: 'ASINを入力してください' }, { status: 400, headers: corsHeaders })
  }

  const asin = validateAsin(rawAsin)
  if (!asin) {
    return NextResponse.json(
      { error: '有効なASIN（例: B0DEMO12345）またはAmazon商品URLを入力してください' },
      { status: 400, headers: corsHeaders }
    )
  }

  try {
    const reviews = getCollectionByAsin(asin) || await fetchReviews(asin)
    const report = await analyzeReviews(reviews, userApiKey, { customCategories })
    saveAnalysisResult({
      asin: reviews.asin,
      productName: reviews.productName,
      averageRating: reviews.averageRating,
      totalReviews: reviews.totalReviews,
      report,
      collection: reviews,
    })

    return NextResponse.json({
      success: true,
      report,
      reviewSummary: {
        total: reviews.totalReviews,
        averageRating: reviews.averageRating,
        lowRatingCount: reviews.lowRatingReviews.length,
        highRatingCount: reviews.highRatingReviews.length,
        fetchedCount: reviews.fetchedCount,
        source: reviews.source,
        warnings: reviews.warnings,
      },
    }, { headers: corsHeaders })
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '分析に失敗しました' },
      { status: 500, headers: corsHeaders }
    )
  }
}

function calculateBreakdown(reviews: { rating: number }[]): { [key: number]: number } {
  const breakdown: { [key: number]: number } = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  reviews.forEach(r => { breakdown[r.rating] = (breakdown[r.rating] || 0) + 1 })
  return breakdown
}

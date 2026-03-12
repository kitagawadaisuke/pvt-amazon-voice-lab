import { NextRequest, NextResponse } from 'next/server'
import { getCollectionByAsin, getReportByAsin, updateReportNotes } from '@/lib/store/review-memory-store'

export async function GET(request: NextRequest) {
  const asin = request.nextUrl.searchParams.get('asin')?.trim()

  if (!asin) {
    return NextResponse.json({ error: 'asin が必要です' }, { status: 400 })
  }

  const report = getReportByAsin(asin)
  if (!report) {
    return NextResponse.json({ error: '分析レポートが見つかりません' }, { status: 404 })
  }

  const collection = getCollectionByAsin(asin)

  return NextResponse.json({
    report,
    reviewContext: collection ? {
      averageRating: collection.averageRating,
      ratingBreakdown: collection.ratingBreakdown,
      totalReviews: collection.totalReviews,
      reviewListCount: collection.reviewListCount || collection.reviews.length,
      starFetchStats: collection.starFetchStats || {},
      reviews: collection.reviews.map((review) => ({
        title: review.title,
        body: review.body,
        rating: review.rating,
        date: review.date,
      })),
      lowRatingReviews: collection.lowRatingReviews.slice(0, 5),
      highRatingReviews: collection.highRatingReviews.slice(0, 5),
      price: collection.price ?? null,
    } : null,
  })
}

export async function PATCH(request: NextRequest) {
  const body = await request.json()
  const asin = body.asin?.trim()
  const notes = typeof body.notes === 'string' ? body.notes : ''

  if (!asin) {
    return NextResponse.json({ error: 'asin が必要です' }, { status: 400 })
  }

  const report = updateReportNotes(asin, notes)
  if (!report) {
    return NextResponse.json({ error: '分析レポートが見つかりません' }, { status: 404 })
  }

  return NextResponse.json({ success: true, report })
}

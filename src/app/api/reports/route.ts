import { NextRequest, NextResponse } from 'next/server'
import { getCollectionByAsin, getReportByAsin, updateReportNotes, updateReportCategoryNames } from '@/lib/store/review-memory-store'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  const asin = request.nextUrl.searchParams.get('asin')?.trim()

  if (!asin) {
    return NextResponse.json({ error: 'asin が必要です' }, { status: 400 })
  }

  const report = await getReportByAsin(supabase, asin)
  if (!report) {
    return NextResponse.json({ error: '分析レポートが見つかりません' }, { status: 404 })
  }

  const collection = await getCollectionByAsin(supabase, asin)

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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  const body = await request.json()
  const asin = body.asin?.trim()

  if (!asin) {
    return NextResponse.json({ error: 'asin が必要です' }, { status: 400 })
  }

  // 観点名の更新
  if (Array.isArray(body.categoryNames)) {
    const report = await updateReportCategoryNames(supabase, asin, body.categoryNames)
    if (!report) {
      return NextResponse.json({ error: '分析レポートが見つかりません' }, { status: 404 })
    }
    return NextResponse.json({ success: true, report })
  }

  // メモの更新
  const notes = typeof body.notes === 'string' ? body.notes : ''
  const report = await updateReportNotes(supabase, asin, notes)
  if (!report) {
    return NextResponse.json({ error: '分析レポートが見つかりません' }, { status: 404 })
  }

  return NextResponse.json({ success: true, report })
}

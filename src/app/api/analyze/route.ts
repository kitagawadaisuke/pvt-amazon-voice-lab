import { NextRequest, NextResponse } from 'next/server'
import { fetchReviews, validateAsin, ReviewCollection } from '@/lib/services/review-scraper'
import { analyzeReviews } from '@/lib/services/pox-analyzer'
import { getCollectionByAsin, saveAnalysisResult } from '@/lib/store/review-memory-store'
import { createClient } from '@/lib/supabase/server'
import { checkUsage, PLANS } from '@/lib/plans'
import type { Plan } from '@/types/database'

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
  const { asin: rawAsin, apiKey: userApiKey, source, reviews: extensionReviews, customCategories, poxGuidance, analysisDepth } = body

  // --- 認証 & 使用量チェック ---
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { error: 'ログインが必要です', code: 'AUTH_REQUIRED' },
      { status: 401, headers: corsHeaders }
    )
  }

  // プロフィール取得
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single()

  const plan: Plan = (profile?.plan as Plan) || 'free'

  // 今月の使用回数を取得
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const { count: monthlyUsage } = await supabase
    .from('analysis_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', monthStart)

  const usageResult = checkUsage(plan, monthlyUsage || 0, !!userApiKey)
  const planConfig = PLANS[plan]

  if (usageResult.status === 'byok_not_allowed') {
    return NextResponse.json(
      { error: 'APIキーの利用はStandardプラン限定です。アップグレードしてください。', code: 'BYOK_NOT_ALLOWED' },
      { status: 403, headers: corsHeaders }
    )
  }
  if (usageResult.status === 'limit_reached') {
    return NextResponse.json(
      { error: `今月の無料分析上限（${usageResult.limit}回）に達しました。Standardプランにアップグレードしてください。`, code: 'LIMIT_REACHED', limit: usageResult.limit, usage: monthlyUsage },
      { status: 403, headers: corsHeaders }
    )
  }
  if (usageResult.status === 'byok_required' && !userApiKey) {
    return NextResponse.json(
      { error: `今月のサービス側分析上限（${planConfig.monthlyLimit}回）を超えました。APIキーを設定すると無制限に続行できます。`, code: 'BYOK_REQUIRED', limit: planConfig.monthlyLimit, usage: monthlyUsage },
      { status: 403, headers: corsHeaders }
    )
  }

  // 使用するAPIキーを決定
  const effectiveApiKey = usageResult.status === 'byok_required' ? userApiKey : undefined
  // effectiveApiKey が undefined の場合、analyzeReviews 内でサーバー側キーが使われる

  // Chrome拡張からのデータ受信
  if (source === 'chrome_extension' && extensionReviews) {
    try {
      const reviewCollection: ReviewCollection = {
        asin: extensionReviews.asin,
        productName: extensionReviews.productName,
        totalReviews: extensionReviews.totalReviews,
        reviewListCount: extensionReviews.reviewListCount || extensionReviews.textReviewCount || (extensionReviews.reviews || []).length,
        starFetchStats: extensionReviews.starFetchStats || {},
        averageRating: extensionReviews.averageRating,
        ratingBreakdown: extensionReviews.ratingBreakdown || calculateBreakdown(extensionReviews.reviews || []),
        reviews: extensionReviews.reviews || [],
        lowRatingReviews: extensionReviews.lowRatingReviews || [],
        highRatingReviews: extensionReviews.highRatingReviews || [],
        fetchedAt: extensionReviews.fetchedAt,
        fetchedCount: extensionReviews.fetchedCount || (extensionReviews.reviews || []).length,
        source: extensionReviews.source || 'mock',
        warnings: extensionReviews.warnings || [],
        price: extensionReviews.price ?? null,
      }

      console.log(`Chrome拡張からレビュー受信: ${reviewCollection.reviews.length}件 (low: ${reviewCollection.lowRatingReviews.length}, high: ${reviewCollection.highRatingReviews.length})`)

      const report = await analyzeReviews(reviewCollection, effectiveApiKey, { customCategories, poxGuidance, analysisDepth })
      saveAnalysisResult({
        asin: reviewCollection.asin,
        productName: reviewCollection.productName,
        averageRating: reviewCollection.averageRating,
        totalReviews: reviewCollection.totalReviews,
        report,
        collection: reviewCollection,
      })

      // 使用量記録（モック分析は除外）
      if (!report.isMock) {
        await supabase.from('analysis_usage').insert({
          user_id: user.id,
          asin: reviewCollection.asin,
          product_name: reviewCollection.productName,
        })
      }

      return NextResponse.json({
        success: true,
        report,
        usage: { current: (monthlyUsage || 0) + 1, limit: planConfig.monthlyLimit, plan },
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
    const report = await analyzeReviews(reviews, effectiveApiKey, { customCategories, poxGuidance, analysisDepth })
    saveAnalysisResult({
      asin: reviews.asin,
      productName: reviews.productName,
      averageRating: reviews.averageRating,
      totalReviews: reviews.totalReviews,
      report,
      collection: reviews,
    })

    // 使用量記録（モック分析は除外）
    if (!report.isMock) {
      await supabase.from('analysis_usage').insert({
        user_id: user.id,
        asin: reviews.asin,
        product_name: reviews.productName,
      })
    }

    return NextResponse.json({
      success: true,
      report,
      usage: { current: (monthlyUsage || 0) + 1, limit: planConfig.monthlyLimit, plan },
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

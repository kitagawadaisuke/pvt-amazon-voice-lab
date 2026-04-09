import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get('origin') || ''
  const allowed =
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('http://localhost')
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { headers: getCorsHeaders(request) })
}

// content.js からの進捗報告を受け取り collection_jobs テーブルを更新
export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request)

  // Bearer トークン認証
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: '認証が必要です' },
      { status: 401, headers: corsHeaders }
    )
  }

  const token = authHeader.slice(7)
  const admin = createAdminClient()
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) {
    return NextResponse.json(
      { error: '無効なトークンです' },
      { status: 401, headers: corsHeaders }
    )
  }

  const body = await request.json()
  const {
    asin,
    phase,
    currentPage,
    totalReviews,
    textReviewCount,
    status,
    displayTotalPages,
    completedFilters,
    blockReason,
    productName,
  } = body

  if (!asin) {
    return NextResponse.json(
      { error: 'ASINが必要です' },
      { status: 400, headers: corsHeaders }
    )
  }

  // UPSERT: user_id + asin でユニーク
  const jobData: Record<string, unknown> = {
    user_id: user.id,
    asin,
    status: status || 'collecting',
    phase: phase || null,
    current_page: currentPage || 0,
    total_collected: totalReviews || 0,
    text_review_count: textReviewCount || 0,
    display_total_pages: displayTotalPages || 0,
    completed_filters: completedFilters || [],
    block_reason: blockReason || null,
    updated_at: new Date().toISOString(),
  }

  if (productName) {
    jobData.product_name = productName
  }
  if (status === 'collecting' && !body.startedAt) {
    jobData.started_at = new Date().toISOString()
  }
  if (status === 'completed' || status === 'blocked') {
    jobData.completed_at = new Date().toISOString()
  }

  const { error } = await admin
    .from('collection_jobs')
    .upsert(
      { ...jobData },
      { onConflict: 'user_id,asin', ignoreDuplicates: false }
    )

  if (error) {
    console.error('[collection-progress] UPSERT error:', error)
    return NextResponse.json(
      { error: '進捗更新に失敗しました' },
      { status: 500, headers: corsHeaders }
    )
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders })
}

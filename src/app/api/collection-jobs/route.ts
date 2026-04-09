import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET: ユーザーのアクティブなジョブ一覧
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('collection_jobs')
    .select('*')
    .eq('user_id', user.id)
    .in('status', ['pending', 'collecting', 'analyzing', 'blocked'])
    .order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'ジョブ取得に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ jobs: data })
}

// POST: 新しい収集ジョブを作成
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  const { asin, productName } = await request.json()
  if (!asin) {
    return NextResponse.json({ error: 'ASINが必要です' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('collection_jobs')
    .upsert(
      {
        user_id: user.id,
        asin,
        product_name: productName || null,
        status: 'pending',
        phase: null,
        current_page: 0,
        total_collected: 0,
        text_review_count: 0,
        display_total_pages: 0,
        completed_filters: [],
        block_reason: null,
        started_at: new Date().toISOString(),
        completed_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,asin', ignoreDuplicates: false }
    )
    .select()
    .single()

  if (error) {
    console.error('[collection-jobs] Create error:', error)
    return NextResponse.json({ error: 'ジョブ作成に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ job: data })
}

// DELETE: ジョブをキャンセル
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  const { asin } = await request.json()
  if (!asin) {
    return NextResponse.json({ error: 'ASINが必要です' }, { status: 400 })
  }

  const { error } = await supabase
    .from('collection_jobs')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('asin', asin)
    .in('status', ['pending', 'collecting', 'blocked'])

  if (error) {
    return NextResponse.json({ error: 'キャンセルに失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

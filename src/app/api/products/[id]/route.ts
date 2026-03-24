import { NextRequest, NextResponse } from 'next/server'
import { deleteProductById } from '@/lib/store/review-memory-store'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  const { id } = await params
  const deleted = await deleteProductById(supabase, id)

  if (!deleted) {
    return NextResponse.json({ error: '商品が見つかりません' }, { status: 404 })
  }

  return NextResponse.json({ success: true, deleted: id })
}

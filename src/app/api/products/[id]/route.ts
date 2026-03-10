import { NextRequest, NextResponse } from 'next/server'
import { deleteProductById } from '@/lib/store/review-memory-store'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const deleted = deleteProductById(id)

  if (!deleted) {
    return NextResponse.json({ error: '商品が見つかりません' }, { status: 404 })
  }

  return NextResponse.json({ success: true, deleted: id })
}

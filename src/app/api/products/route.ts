import { NextRequest, NextResponse } from 'next/server'
import { validateAsin } from '@/lib/services/review-scraper'
import { addProduct, getProductByAsin, listProducts } from '@/lib/store/review-memory-store'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  const products = await listProducts(supabase)
  return NextResponse.json({ products })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  const body = await request.json()
  const { asin: rawAsin, name } = body

  if (!rawAsin) {
    return NextResponse.json({ error: 'ASINを入力してください' }, { status: 400 })
  }

  const asin = validateAsin(rawAsin)
  if (!asin) {
    return NextResponse.json(
      { error: '有効なASIN（例: B0DEMOASIN）またはAmazon商品URLを入力してください' },
      { status: 400 }
    )
  }

  const existing = await getProductByAsin(supabase, asin)
  if (existing) {
    return NextResponse.json({ error: 'この商品は既に登録されています' }, { status: 409 })
  }

  const newProduct = await addProduct(supabase, user.id, { asin, name })
  return NextResponse.json({ product: newProduct }, { status: 201 })
}

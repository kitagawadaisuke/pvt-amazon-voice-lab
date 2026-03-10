import { NextRequest, NextResponse } from 'next/server'
import { validateAsin } from '@/lib/services/review-scraper'
import { addProduct, getProductByAsin, listProducts } from '@/lib/store/review-memory-store'

export async function GET() {
  return NextResponse.json({ products: listProducts() })
}

export async function POST(request: NextRequest) {
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

  if (getProductByAsin(asin)) {
    return NextResponse.json({ error: 'この商品は既に登録されています' }, { status: 409 })
  }

  const newProduct = addProduct({ asin, name })
  return NextResponse.json({ product: newProduct }, { status: 201 })
}

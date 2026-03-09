import { NextRequest, NextResponse } from 'next/server'
import { validateAsin } from '@/lib/services/review-scraper'

interface MockProduct {
  id: string
  asin: string
  name: string
  lastAnalyzedAt: string | null
  averageRating: number | null
  totalReviews: number | null
  created_at: string
}

// Mock data store (replace with Supabase later)
const mockProducts: MockProduct[] = [
  {
    id: '1',
    asin: 'B0DEMOASIN',
    name: 'シュワッシュ 炭酸シャンプー 200ml',
    lastAnalyzedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    averageRating: 3.6,
    totalReviews: 15,
    created_at: new Date().toISOString(),
  },
]

export async function GET() {
  return NextResponse.json({ products: mockProducts })
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

  // 重複チェック
  if (mockProducts.some(p => p.asin === asin)) {
    return NextResponse.json({ error: 'この商品は既に登録されています' }, { status: 409 })
  }

  const newProduct = {
    id: crypto.randomUUID(),
    asin,
    name: name || `Amazon商品 ${asin}`,
    lastAnalyzedAt: null,
    averageRating: null,
    totalReviews: null,
    created_at: new Date().toISOString(),
  }
  mockProducts.push(newProduct)
  return NextResponse.json({ product: newProduct }, { status: 201 })
}

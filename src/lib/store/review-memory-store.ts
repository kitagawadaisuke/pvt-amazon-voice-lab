import fs from 'node:fs'
import path from 'node:path'
import type { ReviewAnalysisReport } from '@/lib/services/pox-analyzer'

export interface StoredProduct {
  id: string
  asin: string
  name: string
  lastAnalyzedAt: string | null
  averageRating: number | null
  totalReviews: number | null
  created_at: string
}

interface StoreShape {
  products: Record<string, StoredProduct>
  reports: Record<string, ReviewAnalysisReport>
}

const STORE_DIR = path.join(process.cwd(), '.data')
const STORE_PATH = path.join(STORE_DIR, 'review-store.json')

function createDefaultStore(): StoreShape {
  return {
    products: {
      B0DEMOASIN: {
        id: '1',
        asin: 'B0DEMOASIN',
        name: 'シュワッシュ 炭酸シャンプー 200ml',
        lastAnalyzedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        averageRating: 3.6,
        totalReviews: 15,
        created_at: new Date().toISOString(),
      },
    },
    reports: {},
  }
}

function ensureStoreFile() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true })
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(createDefaultStore(), null, 2), 'utf8')
  }
}

function readStore(): StoreShape {
  ensureStoreFile()

  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return {
      products: parsed.products || createDefaultStore().products,
      reports: parsed.reports || {},
    }
  } catch {
    const fallback = createDefaultStore()
    fs.writeFileSync(STORE_PATH, JSON.stringify(fallback, null, 2), 'utf8')
    return fallback
  }
}

function writeStore(store: StoreShape) {
  ensureStoreFile()
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export function listProducts(): StoredProduct[] {
  const store = readStore()
  return Object.values(store.products).sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export function getProductByAsin(asin: string): StoredProduct | undefined {
  const store = readStore()
  return store.products[asin]
}

export function addProduct(input: { asin: string; name?: string }): StoredProduct {
  const store = readStore()
  const existing = store.products[input.asin]
  if (existing) return existing

  const product: StoredProduct = {
    id: crypto.randomUUID(),
    asin: input.asin,
    name: input.name || `Amazon商品 ${input.asin}`,
    lastAnalyzedAt: null,
    averageRating: null,
    totalReviews: null,
    created_at: new Date().toISOString(),
  }

  store.products[product.asin] = product
  writeStore(store)
  return product
}

export function deleteProductById(id: string): boolean {
  const store = readStore()
  const entry = Object.values(store.products).find((product) => product.id === id)
  if (!entry) return false

  delete store.products[entry.asin]
  delete store.reports[entry.asin]
  writeStore(store)
  return true
}

export function saveAnalysisResult(input: {
  asin: string
  productName: string
  averageRating: number
  totalReviews: number
  report: ReviewAnalysisReport
}): StoredProduct {
  const store = readStore()
  const existing = store.products[input.asin]
  const product: StoredProduct = {
    id: existing?.id || crypto.randomUUID(),
    asin: input.asin,
    name: input.productName || existing?.name || `Amazon商品 ${input.asin}`,
    lastAnalyzedAt: input.report.analyzedAt,
    averageRating: input.averageRating,
    totalReviews: input.totalReviews,
    created_at: existing?.created_at || new Date().toISOString(),
  }

  store.products[input.asin] = product
  store.reports[input.asin] = input.report
  writeStore(store)
  return product
}

export function getReportByAsin(asin: string): ReviewAnalysisReport | undefined {
  const store = readStore()
  return store.reports[asin]
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReviewAnalysisReport } from '@/lib/services/pox-analyzer'
import type { ReviewCollection } from '@/lib/services/review-scraper'

export interface StoredProduct {
  id: string
  asin: string
  name: string
  lastAnalyzedAt: string | null
  averageRating: number | null
  totalReviews: number | null
  price?: number | null
  created_at: string
}

// DB行 → StoredProduct (snake_case → camelCase)
function toStoredProduct(row: Record<string, unknown>): StoredProduct {
  return {
    id: row.id as string,
    asin: row.asin as string,
    name: row.name as string,
    lastAnalyzedAt: (row.last_analyzed_at as string) ?? null,
    averageRating: row.average_rating != null ? Number(row.average_rating) : null,
    totalReviews: (row.total_reviews as number) ?? null,
    price: row.price != null ? Number(row.price) : null,
    created_at: row.created_at as string,
  }
}

export async function listProducts(supabase: SupabaseClient): Promise<StoredProduct[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []).map(toStoredProduct)
}

export async function getProductByAsin(supabase: SupabaseClient, asin: string): Promise<StoredProduct | null> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('asin', asin)
    .maybeSingle()

  if (error) throw error
  return data ? toStoredProduct(data) : null
}

export async function addProduct(
  supabase: SupabaseClient,
  userId: string,
  input: { asin: string; name?: string }
): Promise<StoredProduct> {
  const existing = await getProductByAsin(supabase, input.asin)
  if (existing) return existing

  const { data, error } = await supabase
    .from('products')
    .insert({
      user_id: userId,
      asin: input.asin,
      name: input.name || `Amazon商品 ${input.asin}`,
    })
    .select()
    .single()

  if (error) throw error
  return toStoredProduct(data)
}

export async function deleteProductById(supabase: SupabaseClient, id: string): Promise<boolean> {
  // まずASINを取得（関連データ削除用）
  const { data: product } = await supabase
    .from('products')
    .select('asin')
    .eq('id', id)
    .maybeSingle()

  if (!product) return false

  // 関連データを先に削除
  await supabase.from('review_reports').delete().eq('asin', product.asin)
  await supabase.from('review_collections').delete().eq('asin', product.asin)

  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
  return true
}

export async function saveAnalysisResult(
  supabase: SupabaseClient,
  userId: string,
  input: {
    asin: string
    productName: string
    averageRating: number
    totalReviews: number
    report: ReviewAnalysisReport
    collection: ReviewCollection
  }
): Promise<StoredProduct> {
  // Product UPSERT
  const { data: product, error: productError } = await supabase
    .from('products')
    .upsert({
      user_id: userId,
      asin: input.asin,
      name: input.productName,
      last_analyzed_at: input.report.analyzedAt,
      average_rating: input.averageRating,
      total_reviews: input.totalReviews,
      price: input.collection.price ?? null,
    }, { onConflict: 'user_id,asin' })
    .select()
    .single()

  if (productError) throw productError

  // Report UPSERT
  const { error: reportError } = await supabase
    .from('review_reports')
    .upsert({
      user_id: userId,
      asin: input.asin,
      report_data: input.report as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,asin' })

  if (reportError) throw reportError

  // Collection UPSERT
  const { error: collectionError } = await supabase
    .from('review_collections')
    .upsert({
      user_id: userId,
      asin: input.asin,
      collection_data: input.collection as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,asin' })

  if (collectionError) throw collectionError

  return toStoredProduct(product)
}

export async function getReportByAsin(supabase: SupabaseClient, asin: string): Promise<ReviewAnalysisReport | null> {
  const { data, error } = await supabase
    .from('review_reports')
    .select('report_data')
    .eq('asin', asin)
    .maybeSingle()

  if (error) throw error
  return (data?.report_data as unknown as ReviewAnalysisReport) ?? null
}

export async function getCollectionByAsin(supabase: SupabaseClient, asin: string): Promise<ReviewCollection | null> {
  const { data, error } = await supabase
    .from('review_collections')
    .select('collection_data')
    .eq('asin', asin)
    .maybeSingle()

  if (error) throw error
  return (data?.collection_data as unknown as ReviewCollection) ?? null
}

export async function updateReportNotes(
  supabase: SupabaseClient,
  asin: string,
  notes: string
): Promise<ReviewAnalysisReport | null> {
  const { data, error } = await supabase
    .from('review_reports')
    .select('report_data')
    .eq('asin', asin)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const report = data.report_data as unknown as ReviewAnalysisReport
  const updatedReport: ReviewAnalysisReport = { ...report, notes }

  const { error: updateError } = await supabase
    .from('review_reports')
    .update({
      report_data: updatedReport as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq('asin', asin)

  if (updateError) throw updateError
  return updatedReport
}

export async function updateReportCategoryNames(
  supabase: SupabaseClient,
  asin: string,
  categoryNames: { index: number; name: string }[]
): Promise<ReviewAnalysisReport | null> {
  const { data, error } = await supabase
    .from('review_reports')
    .select('report_data')
    .eq('asin', asin)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const report = data.report_data as unknown as ReviewAnalysisReport

  const updatedBreakdown = report.categoryBreakdown.map((item, i) => {
    const update = categoryNames.find((c) => c.index === i)
    return update ? { ...item, category: update.name } : item
  })

  const updatedFramework = (report.categoryFramework || []).map((item, i) => {
    const update = categoryNames.find((c) => c.index === i)
    return update ? { ...item, name: update.name } : item
  })

  const updatedReport: ReviewAnalysisReport = {
    ...report,
    categoryBreakdown: updatedBreakdown,
    categoryFramework: updatedFramework,
  }

  const { error: updateError } = await supabase
    .from('review_reports')
    .update({
      report_data: updatedReport as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq('asin', asin)

  if (updateError) throw updateError
  return updatedReport
}

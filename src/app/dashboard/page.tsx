'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import type { CategoryDefinition } from '@/lib/services/pox-analyzer'

interface Product {
  id: string
  asin: string
  name: string
  lastAnalyzedAt: string | null
  averageRating: number | null
  totalReviews: number | null
}

interface CategoryBreakdown {
  category: string
  mentionCount: number
  mentionRate: number
  topMentions: string[]
}

interface PoxElement {
  title: string
  description: string
  evidence: string[]
  confidence: 'high' | 'medium' | 'low'
}

interface AnalysisReport {
  asin: string
  productName: string
  analyzedAt: string
  categoryFramework: CategoryDefinition[]
  totalReviewsAnalyzed: number
  categoryBreakdown: CategoryBreakdown[]
  poxAnalysis: {
    pod: PoxElement[]
    pop: PoxElement[]
    pof: PoxElement[]
  }
  painPoints: { title: string; count: number; severity: 'high' | 'medium' | 'low' }[]
  satisfactionPoints: { title: string; count: number }[]
  unmetNeeds: string[]
  priceSentiment: { expensive: number; reasonable: number; goodValue: number }
  actionRecommendations: string[]
}

type CategoryEditorValue = CategoryDefinition

const CATEGORY_TEMPLATES: Array<{
  id: string
  label: string
  categories: CategoryEditorValue[]
}> = [
  {
    id: 'electronics',
    label: '電子機器・アクセサリ',
    categories: [
      { name: '互換性・対応機器', description: 'どの機器で使えるか、非対応条件、利用前の前提条件' },
      { name: '装着・接続性', description: 'はめやすさ、接続しやすさ、手順のわかりやすさ、扱いやすさ' },
      { name: '再生・動作品質', description: '認識精度、動作安定性、期待通りに機能するか' },
      { name: '価格・コスパ', description: '価格の納得感、費用対効果、品質とのバランス' },
    ],
  },
  {
    id: 'beauty',
    label: '美容・日用品',
    categories: [
      { name: '仕様・成分', description: '容量、成分、香り、容器など購入前に気にする情報' },
      { name: '使用感', description: '使っている最中の感覚、刺激、扱いやすさ' },
      { name: '効果実感', description: '継続利用での変化、期待した効果が得られたか' },
      { name: '価格・コスパ', description: '価格の納得感、継続しやすさ、量に対する価値' },
    ],
  },
  {
    id: 'food',
    label: '食品・サプリ',
    categories: [
      { name: '原材料・仕様', description: '原材料、容量、栄養成分など購入前提の情報' },
      { name: '味・飲みやすさ', description: '味、香り、食べやすさ、飲みやすさ' },
      { name: '体感・満足度', description: '継続利用での体感、満足度、期待との一致' },
      { name: '価格・続けやすさ', description: '価格の納得感、継続購入のしやすさ、コスパ' },
    ],
  },
  {
    id: 'custom',
    label: '現在の設定を使用',
    categories: [],
  },
]

const severityStyles = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-green-100 text-green-800',
}

const confidenceLabels = { high: '確度高', medium: '確度中', low: '確度低' }

export default function Dashboard() {
  const searchParams = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [loadingReportId, setLoadingReportId] = useState<string | null>(null)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [activeTab, setActiveTab] = useState<'products' | 'report'>('products')
  const [editingCategories, setEditingCategories] = useState(false)
  const [categoryEditorValues, setCategoryEditorValues] = useState<CategoryEditorValue[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('custom')
  const [error, setError] = useState<string | null>(null)
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [userApiKey, setUserApiKey] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  // localStorageからAPIキーを復元
  useEffect(() => {
    const saved = localStorage.getItem('reviewai_api_key')
    if (saved) setUserApiKey(saved)
  }, [])

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(d => setProducts(d.products))
  }, [])

  useEffect(() => {
    if (!report) return
    setCategoryEditorValues(
      (report.categoryFramework?.length ? report.categoryFramework : report.categoryBreakdown.map((item) => ({
        name: item.category,
        description: '',
      }))).map((item) => ({
        name: item.name,
        description: item.description || '',
      }))
    )
    setSelectedTemplateId('custom')
  }, [report])

  useEffect(() => {
    const asin = searchParams.get('asin')
    if (!asin) return

    let cancelled = false

    const loadReport = async () => {
      setError(null)
      try {
        const [productsRes, reportRes] = await Promise.all([
          fetch('/api/products'),
          fetch(`/api/reports?asin=${encodeURIComponent(asin)}`),
        ])

        const productsData = await productsRes.json()
        if (!cancelled && productsRes.ok) {
          setProducts(productsData.products || [])
        }

        const reportData = await reportRes.json()
        if (!reportRes.ok) {
          throw new Error(reportData.error || '分析レポートの取得に失敗しました')
        }

        if (!cancelled) {
          setReport(reportData.report)
          setActiveTab('report')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '分析レポートの取得に失敗しました')
        }
      }
    }

    loadReport()

    return () => {
      cancelled = true
    }
  }, [searchParams])

  const openReport = async (product: Product) => {
    setLoadingReportId(product.id)
    setError(null)
    try {
      const res = await fetch(`/api/reports?asin=${encodeURIComponent(product.asin)}`)
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '分析レポートが見つかりません')
      }
      setReport(data.report)
      setActiveTab('report')
      window.history.replaceState({}, '', `/dashboard?asin=${encodeURIComponent(product.asin)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析レポートが見つかりません')
    }
    setLoadingReportId(null)
  }

  const deleteProduct = async (id: string) => {
    await fetch(`/api/products/${id}`, { method: 'DELETE' })
    setProducts(prev => prev.filter(p => p.id !== id))
  }

  const currentReportProduct = report ? products.find((product) => product.asin === report.asin) : null
  const totalRatingsCount = currentReportProduct?.totalReviews || 0
  const commentCoverageRate = totalRatingsCount > 0 && report
    ? ((report.totalReviewsAnalyzed / totalRatingsCount) * 100).toFixed(1)
    : null

  const updateCategoryName = (index: number, category: string) => {
    if (!report) return
    const nextBreakdown = report.categoryBreakdown.map((item, itemIndex) => (
      itemIndex === index ? { ...item, category } : item
    ))
    setReport({ ...report, categoryBreakdown: nextBreakdown })
    setCategoryEditorValues((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, name: category } : item
    )))
  }

  const updateCategoryDescription = (index: number, description: string) => {
    setCategoryEditorValues((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, description } : item
    )))
  }

  const applyCategoryTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId)
    if (templateId === 'custom') return

    const template = CATEGORY_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return

    setCategoryEditorValues(template.categories.map((category) => ({ ...category })))
    if (!report) return
    setReport({
      ...report,
      categoryBreakdown: report.categoryBreakdown.map((item, index) => ({
        ...item,
        category: template.categories[index]?.name || item.category,
      })),
      categoryFramework: template.categories.map((category) => ({ ...category })),
    })
  }

  const rerunAnalysisWithCategories = async () => {
    if (!report) return

    setReanalyzing(true)
    setError(null)
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: report.asin,
          apiKey: userApiKey || undefined,
          customCategories: categoryEditorValues.map((item) => ({
            name: item.name,
            description: item.description,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '再分析に失敗しました')
      }
      setReport(data.report)
      setEditingCategories(false)
      setSelectedTemplateId('custom')
      window.history.replaceState({}, '', `/dashboard?asin=${encodeURIComponent(data.report.asin)}`)
      const productsRes = await fetch('/api/products')
      const productsData = await productsRes.json()
      if (productsRes.ok) {
        setProducts(productsData.products || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '再分析に失敗しました')
    }
    setReanalyzing(false)
  }

  const copyShareLink = async () => {
    if (!report) return

    const shareUrl = `${window.location.origin}/dashboard?asin=${encodeURIComponent(report.asin)}`
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareMessage('共有リンクをコピーしました')
      window.setTimeout(() => setShareMessage(null), 2000)
    } catch {
      setShareMessage('共有リンクのコピーに失敗しました')
      window.setTimeout(() => setShareMessage(null), 2000)
    }
  }

  const printReport = () => {
    window.print()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
          }

          header,
          .print\\:hidden {
            display: none !important;
          }

          main {
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          .bg-gray-50 {
            background: white !important;
          }

          .shadow-sm,
          .shadow,
          .shadow-md,
          .shadow-lg {
            box-shadow: none !important;
          }

          .border-gray-200,
          .border-gray-100 {
            border-color: #d1d5db !important;
          }

          .rounded-xl,
          .rounded-lg {
            border-radius: 0.5rem !important;
          }

          .space-y-6 > * + *,
          .space-y-3 > * + * {
            margin-top: 1rem !important;
          }

          .break-inside-avoid {
            break-inside: avoid;
          }
        }
      `}</style>
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ReviewAI</h1>
            <p className="text-sm text-gray-500">Amazon レビュー分析 x POXフレームワーク</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
              {userApiKey ? 'BYOK' : 'Free Plan'}
            </span>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              title="設定"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
        {/* Settings Panel */}
        {showSettings && (
          <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
            <div className="max-w-6xl mx-auto">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  Anthropic API Key
                </label>
                <input
                  type="password"
                  value={userApiKey}
                  onChange={e => {
                    setUserApiKey(e.target.value)
                    if (e.target.value) {
                      localStorage.setItem('reviewai_api_key', e.target.value)
                    } else {
                      localStorage.removeItem('reviewai_api_key')
                    }
                  }}
                  placeholder="sk-ant-... (入力するとBYOKモード: 自分のキーで無制限分析)"
                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {userApiKey && (
                  <span className="text-xs text-green-600 font-medium whitespace-nowrap">BYOK有効</span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                自分のAPIキーを使うと分析回数無制限。未入力の場合はサービス側のキーを使用（プランに応じた制限あり）。
              </p>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit print:hidden">
          <button
            onClick={() => setActiveTab('products')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'products' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            レポート一覧 ({products.length})
          </button>
          <button
            onClick={() => setActiveTab('report')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'report' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            分析レポート
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {activeTab === 'products' && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">収集済みレポート</h2>
              <p className="text-sm text-gray-500">
                Amazon 上でレビュー取得と分析を完了した商品だけがここに表示されます。
              </p>
            </div>

            {/* Product List */}
            <div className="space-y-3">
              {products.map(product => (
                <div key={product.id} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-gray-900">{product.name}</h3>
                      <p className="text-sm text-gray-500 font-mono">ASIN: {product.asin}</p>
                      <div className="flex items-center gap-3 mt-1">
                        {product.averageRating && (
                          <span className="text-xs text-yellow-600">
                            {'★'.repeat(Math.round(product.averageRating))} {product.averageRating}
                          </span>
                        )}
                        {product.totalReviews && (
                          <span className="text-xs text-gray-400">{product.totalReviews}件のレビュー</span>
                        )}
                        {product.lastAnalyzedAt && (
                          <span className="text-xs text-gray-400">
                            最終分析: {new Date(product.lastAnalyzedAt).toLocaleDateString('ja-JP')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => openReport(product)}
                        disabled={loadingReportId === product.id}
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                      >
                        {loadingReportId === product.id ? '読込中...' : 'レポートを見る'}
                      </button>
                      <button
                        onClick={() => deleteProduct(product.id)}
                        className="px-3 py-2 text-red-500 text-sm hover:bg-red-50 rounded-lg transition-colors"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {products.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-lg mb-1">レポートはまだありません</p>
                  <p className="text-sm">Amazon 側でレビュー取得と分析を完了すると、ここに一覧表示されます</p>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'report' && report && (
          <div className="space-y-6">
            {/* Report Header */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
              <div className="mb-2">
                <h2 className="text-xl font-bold text-gray-900">{report.productName}</h2>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-gray-500 font-mono">ASIN: {report.asin}</p>
                <span className="text-xs text-gray-400">
                  {new Date(report.analyzedAt).toLocaleString('ja-JP')} / {report.totalReviewsAnalyzed}件分析
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2 print:hidden">
                <button
                  onClick={copyShareLink}
                  className="inline-flex items-center rounded-full border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 transition-colors"
                >
                  共有リンクをコピー
                </button>
                <button
                  onClick={printReport}
                  className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  印刷 / PDF保存
                </button>
              </div>
              {shareMessage && (
                <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700 print:hidden">
                  {shareMessage}
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-3 mt-4">
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs text-gray-500 mb-1">総評価数</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {totalRatingsCount > 0 ? `${totalRatingsCount}件` : '不明'}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs text-gray-500 mb-1">コメント付きレビュー</div>
                  <div className="text-lg font-semibold text-gray-900">{report.totalReviewsAnalyzed}件</div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs text-gray-500 mb-1">コメント率</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {commentCoverageRate ? `${commentCoverageRate}%` : '不明'}
                  </div>
                </div>
              </div>
            </div>

            {/* Category Breakdown (Step A) */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
              <div className="flex items-center justify-between mb-4 gap-4">
                <h3 className="text-lg font-semibold text-gray-900">Step A: レビュー構造化分析</h3>
                <div className="flex items-center gap-2">
                  {editingCategories && (
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => applyCategoryTemplate(e.target.value)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {CATEGORY_TEMPLATES.map((template) => (
                        <option key={template.id} value={template.id}>{template.label}</option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={() => setEditingCategories(prev => !prev)}
                    className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    {editingCategories ? '編集完了' : 'カテゴリ名を編集'}
                  </button>
                  {editingCategories && (
                    <button
                      onClick={rerunAnalysisWithCategories}
                      disabled={reanalyzing}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {reanalyzing ? '再分析中...' : 'このカテゴリで再分析'}
                    </button>
                  )}
                </div>
              </div>
              <div className="mb-6 rounded-xl border border-gray-100 bg-gradient-to-br from-slate-50 to-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">レビュー論点の分布</h4>
                    <p className="text-xs text-gray-500">どの観点に言及が集まっているかを比較</p>
                  </div>
                  <span className="text-xs text-gray-400">言及割合</span>
                </div>
                <div className="space-y-3">
                  {report.categoryBreakdown.map((cat, i) => (
                    <div key={`chart-${i}`} className="grid grid-cols-[minmax(0,180px)_1fr_56px] items-center gap-3">
                      <div className="truncate text-sm font-medium text-gray-700">{cat.category}</div>
                      <div className="relative h-4 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-500 to-emerald-400 transition-all"
                          style={{ width: `${cat.mentionRate}%` }}
                        />
                      </div>
                      <div className="text-right text-sm font-semibold text-blue-600">{cat.mentionRate}%</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {report.categoryBreakdown.map((cat, i) => (
                  <div key={i} className="border border-gray-100 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      {editingCategories ? (
                        <div className="flex-1 pr-3">
                          <input
                            type="text"
                            value={categoryEditorValues[i]?.name || cat.category}
                            onChange={(e) => updateCategoryName(i, e.target.value)}
                            className="w-full max-w-full rounded border border-gray-300 px-2 py-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      ) : (
                        <span className="font-medium text-sm">{cat.category}</span>
                      )}
                      <span className="text-sm font-bold text-blue-600">{cat.mentionRate}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${cat.mentionRate}%` }}
                      />
                    </div>
                    {editingCategories && (
                      <textarea
                        value={categoryEditorValues[i]?.description || ''}
                        onChange={(e) => updateCategoryDescription(i, e.target.value)}
                        placeholder="このカテゴリで何を見たいかを入力してください"
                        className="mb-3 min-h-20 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                    <div className="flex flex-wrap gap-1">
                      {cat.topMentions.map((mention, j) => (
                        <span key={j} className="px-2 py-0.5 bg-gray-50 text-gray-600 text-xs rounded">
                          {mention}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* POX Analysis (Step B) */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Step B: POX分析</h3>
              <div className="space-y-6">
                {/* Pod */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-1 bg-blue-600 text-white text-xs font-bold rounded">Pod</span>
                    <span className="text-sm font-medium text-gray-700">Point of Difference - 独自優位性候補</span>
                  </div>
                  <div className="space-y-3">
                    {report.poxAnalysis.pod.map((item, i) => (
                      <div key={i} className="ml-4 border-l-2 border-blue-300 pl-4">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm">{item.title}</h4>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${severityStyles[item.confidence]}`}>
                            {confidenceLabels[item.confidence]}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                        <div className="mt-2 space-y-1">
                          {item.evidence.map((ev, j) => (
                            <p key={j} className="text-xs text-gray-400 italic">&ldquo;{ev}&rdquo;</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* POP */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-1 bg-gray-600 text-white text-xs font-bold rounded">POP</span>
                    <span className="text-sm font-medium text-gray-700">Point of Parity - カテゴリ必須機能</span>
                  </div>
                  <div className="space-y-3">
                    {report.poxAnalysis.pop.map((item, i) => (
                      <div key={i} className="ml-4 border-l-2 border-gray-300 pl-4">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm">{item.title}</h4>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${severityStyles[item.confidence]}`}>
                            {confidenceLabels[item.confidence]}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                        <div className="mt-2 space-y-1">
                          {item.evidence.map((ev, j) => (
                            <p key={j} className="text-xs text-gray-400 italic">&ldquo;{ev}&rdquo;</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pof */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-1 bg-orange-500 text-white text-xs font-bold rounded">Pof</span>
                    <span className="text-sm font-medium text-gray-700">Point of Failure - 戦略的妥協候補</span>
                  </div>
                  <div className="space-y-3">
                    {report.poxAnalysis.pof.map((item, i) => (
                      <div key={i} className="ml-4 border-l-2 border-orange-300 pl-4">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm">{item.title}</h4>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${severityStyles[item.confidence]}`}>
                            {confidenceLabels[item.confidence]}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                        <div className="mt-2 space-y-1">
                          {item.evidence.map((ev, j) => (
                            <p key={j} className="text-xs text-gray-400 italic">&ldquo;{ev}&rdquo;</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Insights Summary (Step C) */}
              <div className="grid md:grid-cols-2 gap-6">
              {/* Pain Points */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
                <h3 className="text-base font-semibold text-gray-900 mb-3">不満 TOP5</h3>
                <div className="space-y-2">
                  {report.painPoints.map((pain, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 w-5">{i + 1}.</span>
                        <span className="text-sm">{pain.title}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{pain.count}件</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${severityStyles[pain.severity]}`}>
                          {pain.severity === 'high' ? '深刻' : pain.severity === 'medium' ? '中程度' : '軽微'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Satisfaction Points */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
                <h3 className="text-base font-semibold text-gray-900 mb-3">満足 TOP5</h3>
                <div className="space-y-2">
                  {report.satisfactionPoints.map((sat, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 w-5">{i + 1}.</span>
                        <span className="text-sm">{sat.title}</span>
                      </div>
                      <span className="text-xs text-gray-400">{sat.count}件</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Unmet Needs */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
                <h3 className="text-base font-semibold text-gray-900 mb-3">未充足ニーズ</h3>
                <ul className="space-y-1.5">
                  {report.unmetNeeds.map((need, i) => (
                    <li key={i} className="text-sm text-gray-600 flex gap-2">
                      <span className="text-purple-500 mt-0.5">*</span>
                      {need}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Price Sentiment */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
                <h3 className="text-base font-semibold text-gray-900 mb-3">価格感度</h3>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-red-600">高い</span>
                      <span className="font-medium">{report.priceSentiment.expensive}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="bg-red-400 h-2 rounded-full" style={{ width: `${report.priceSentiment.expensive}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-yellow-600">妥当</span>
                      <span className="font-medium">{report.priceSentiment.reasonable}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="bg-yellow-400 h-2 rounded-full" style={{ width: `${report.priceSentiment.reasonable}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-green-600">コスパ良い</span>
                      <span className="font-medium">{report.priceSentiment.goodValue}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="bg-green-400 h-2 rounded-full" style={{ width: `${report.priceSentiment.goodValue}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Recommendations */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">推奨アクション</h3>
              <div className="space-y-3">
                {report.actionRecommendations.map((action, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-700 text-xs font-bold rounded-full flex items-center justify-center">
                      {i + 1}
                    </span>
                    <p className="text-sm text-gray-700">{action}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'report' && !report && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-1">分析レポートがありません</p>
            <p className="text-sm">商品管理タブから商品を選択し「POX分析」を実行してください</p>
          </div>
        )}
      </main>
    </div>
  )
}

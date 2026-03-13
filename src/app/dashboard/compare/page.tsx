'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

// ── 型定義 ──

interface PoxElement {
  title: string
  description: string
  evidence: string[]
  confidence: 'high' | 'medium' | 'low'
  reviewCount?: number
}

interface CompareReport {
  asin: string
  productName: string
  analyzedAt: string
  totalReviewsAnalyzed: number
  categoryFramework?: { name: string; description?: string }[]
  categoryBreakdown: {
    category: string
    mentionCount: number
    mentionRate: number
    topMentions: string[]
  }[]
  poxAnalysis: {
    pod: PoxElement[]
    pop: PoxElement[]
    pof: PoxElement[]
  }
  priceSentiment?: {
    expensive: number
    reasonable: number
    goodValue: number
  }
  isMock?: boolean
}

interface ReviewContext {
  averageRating: number
  totalReviews: number
  ratingBreakdown: Record<string, number>
  price: number | null
}

interface FetchResult {
  asin: string
  report: CompareReport | null
  reviewContext: ReviewContext | null
  error: string | null
}

// ── 定数 ──

const confidenceLabels = { high: '確度 高', medium: '確度 中', low: '確度 低' }
const confidenceStyles = {
  high: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-600',
}

const PRODUCT_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
]

const BAR_COLORS = [
  'bg-blue-400',
  'bg-emerald-400',
  'bg-amber-400',
  'bg-purple-400',
  'bg-rose-400',
]

// ── ヘルパー ──

function formatPrice(price: number | null | undefined): string {
  if (price == null) return '-'
  return `¥${price.toLocaleString()}`
}

function renderStars(rating: number): string {
  const full = Math.floor(rating)
  const half = rating - full >= 0.5 ? 1 : 0
  return '★'.repeat(full) + (half ? '☆' : '') + ' ' + rating.toFixed(1)
}

// ── メインコンポーネント ──

function CompareContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [results, setResults] = useState<FetchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [poxTab, setPoxTab] = useState<'pod' | 'pop' | 'pof'>('pod')
  const [memos, setMemos] = useState<Record<string, string>>({})
  const [copySuccess, setCopySuccess] = useState(false)
  const [unifyOpen, setUnifyOpen] = useState(false)
  const [unifySelectedAsin, setUnifySelectedAsin] = useState<string | null>(null)
  const [unifyingAsins, setUnifyingAsins] = useState<Set<string>>(new Set())
  const [unifyError, setUnifyError] = useState<string | null>(null)
  const [editingCategories, setEditingCategories] = useState(false)
  const [editedCategories, setEditedCategories] = useState<string[]>([])
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reanalyzingAsin, setReanalyzingAsin] = useState<string | null>(null)
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  const asins = (searchParams.get('asins') || '').split(',').filter(Boolean)
  const memoKey = `compare-memo:${asins.sort().join(',')}`

  // APIキー・メモ読み込み
  useEffect(() => {
    const savedKey = localStorage.getItem('reviewai_api_key')
    if (savedKey) setApiKeyInput(savedKey)
  }, [])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(memoKey)
      if (saved) setMemos(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [memoKey])

  const saveMemo = useCallback((asin: string, text: string) => {
    setMemos((prev) => {
      const next = { ...prev, [asin]: text }
      try { localStorage.setItem(memoKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [memoKey])

  // データ取得
  useEffect(() => {
    if (asins.length === 0) return

    setLoading(true)
    Promise.all(
      asins.map((asin) =>
        fetch(`/api/reports?asin=${encodeURIComponent(asin)}`)
          .then((r) => r.json())
          .then((data) => ({
            asin,
            report: data.report as CompareReport | null,
            reviewContext: data.reviewContext as ReviewContext | null,
            error: null,
          }))
          .catch((err) => ({ asin, report: null, reviewContext: null, error: (err as Error).message }))
      )
    ).then((res) => {
      setResults(res)
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const reports = results.filter((r): r is FetchResult & { report: CompareReport } => r.report !== null)

  // ── カテゴリ ユニオン構築 ──
  const allCategories = (() => {
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const r of reports) {
      for (const cat of r.report.categoryBreakdown) {
        if (!seen.has(cat.category)) {
          seen.add(cat.category)
          ordered.push(cat.category)
        }
      }
    }
    return ordered
  })()

  // カテゴリが全商品で完全一致しているか
  const categoriesMatch = reports.length > 1 && reports.every((r) => {
    const cats = r.report.categoryBreakdown.map((c) => c.category).sort().join(',')
    return cats === reports[0].report.categoryBreakdown.map((c) => c.category).sort().join(',')
  })

  // カテゴリ編集モード開始
  const startEditCategories = () => {
    setEditedCategories([...allCategories])
    setEditingCategories(true)
  }

  // カテゴリ名更新
  const updateEditedCategory = (index: number, value: string) => {
    setEditedCategories((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  // カテゴリ追加・削除
  const addEditedCategory = () => {
    setEditedCategories((prev) => [...prev, ''])
  }
  const removeEditedCategory = (index: number) => {
    setEditedCategories((prev) => prev.filter((_, i) => i !== index))
  }

  // 編集したカテゴリで全商品を再分析
  const handleReanalyzeAll = async () => {
    const validCategories = editedCategories.filter((c) => c.trim())
    if (validCategories.length === 0) return

    setReanalyzing(true)
    setUnifyError(null)

    try {
      const apiKey = localStorage.getItem('reviewai_api_key') || ''
      const customCats = validCategories.map((name) => ({ name }))

      await Promise.allSettled(
        reports.map(async (r) => {
          const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin: r.asin, apiKey, customCategories: customCats }),
          })
          if (!res.ok) throw new Error(`ASIN ${r.asin}: 再分析に失敗`)
        })
      )

      // レポート再取得
      setLoading(true)
      const freshResults = await Promise.all(
        asins.map((asin) =>
          fetch(`/api/reports?asin=${encodeURIComponent(asin)}`)
            .then((r) => r.json())
            .then((data) => ({
              asin,
              report: data.report as CompareReport | null,
              reviewContext: data.reviewContext as ReviewContext | null,
              error: null,
            }))
            .catch((err) => ({ asin, report: null, reviewContext: null, error: (err as Error).message }))
        )
      )
      setResults(freshResults)
      setLoading(false)
      setEditingCategories(false)
    } catch {
      setUnifyError('再分析に失敗しました')
    } finally {
      setReanalyzing(false)
    }
  }

  // 観点統一 テンプレ再分析
  const handleUnify = async (templateAsin: string) => {
    const templateReport = reports.find((r) => r.asin === templateAsin)?.report
    if (!templateReport) return

    const categories = (templateReport.categoryFramework || templateReport.categoryBreakdown.map((c) => ({ name: c.category })))
    const targetAsins = reports.filter((r) => r.asin !== templateAsin).map((r) => r.asin)

    setUnifyError(null)
    setUnifyingAsins(new Set(targetAsins))

    try {
      const apiKey = localStorage.getItem('reviewai_api_key') || ''
      const results = await Promise.allSettled(
        targetAsins.map(async (asin) => {
          const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asin,
              apiKey,
              customCategories: categories,
            }),
          })
          if (!res.ok) throw new Error(`ASIN ${asin}: 再分析に失敗`)
          setUnifyingAsins((prev) => {
            const next = new Set(prev)
            next.delete(asin)
            return next
          })
          return res.json()
        })
      )

      const failures = results.filter((r) => r.status === 'rejected')
      if (failures.length > 0) {
        setUnifyError(`${failures.length}件の再分析に失敗しました`)
      }

      // レポート再取得
      setLoading(true)
      const freshResults = await Promise.all(
        asins.map((asin) =>
          fetch(`/api/reports?asin=${encodeURIComponent(asin)}`)
            .then((r) => r.json())
            .then((data) => ({
              asin,
              report: data.report as CompareReport | null,
              reviewContext: data.reviewContext as ReviewContext | null,
              error: null,
            }))
            .catch((err) => ({ asin, report: null, reviewContext: null, error: (err as Error).message }))
        )
      )
      setResults(freshResults)
      setLoading(false)
      setUnifyOpen(false)
    } catch {
      setUnifyError('再分析に失敗しました')
    } finally {
      setUnifyingAsins(new Set())
    }
  }

  // 共有
  const handleShare = async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch {
      // fallback
      const ta = document.createElement('textarea')
      ta.value = url
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    }
  }

  // PDF出力
  const handlePdfExport = () => {
    window.print()
  }

  // APIキー取得（未設定なら入力UI表示）
  const getApiKey = (): string | null => {
    const key = localStorage.getItem('reviewai_api_key') || ''
    if (!key) {
      setShowApiKeyInput(true)
      return null
    }
    return key
  }

  const saveApiKey = (key: string) => {
    localStorage.setItem('reviewai_api_key', key)
    setApiKeyInput(key)
    setShowApiKeyInput(false)
  }

  // 単一商品をAIで再分析
  const handleReanalyzeSingle = async (asin: string) => {
    const apiKey = getApiKey()
    if (!apiKey) return

    setReanalyzingAsin(asin)
    setAnalyzeError(null)
    try {
      const targetReport = reports.find((r) => r.asin === asin)?.report
      const customCats = targetReport?.categoryFramework?.map((c) => ({ name: c.name }))
        || targetReport?.categoryBreakdown.map((c) => ({ name: c.category }))

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin, apiKey, customCategories: customCats }),
      })
      if (!res.ok) throw new Error('再分析に失敗')

      // レポート再取得
      const freshReport = await fetch(`/api/reports?asin=${encodeURIComponent(asin)}`).then((r) => r.json())
      setResults((prev) =>
        prev.map((r) =>
          r.asin === asin
            ? { ...r, report: freshReport.report, reviewContext: freshReport.reviewContext, error: null }
            : r
        )
      )
    } catch {
      setAnalyzeError(`${asin} の再分析に失敗しました。APIキーを確認してください。`)
    } finally {
      setReanalyzingAsin(null)
    }
  }

  if (asins.length < 2) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-500">比較するには2商品以上を選択してください</p>
          <button onClick={() => router.push('/dashboard')} className="mt-4 text-blue-600 hover:underline">
            商品一覧に戻る
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur print:static print:border-none">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">レポート比較</h1>
            <p className="text-xs text-gray-500">{reports.length}商品を比較中</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              className="inline-flex items-center rounded-full border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 transition-colors print:hidden"
            >
              {copySuccess ? '✓ コピー済み' : '共有リンクをコピー'}
            </button>
            <button
              onClick={handlePdfExport}
              className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors print:hidden"
            >
              印刷 / PDF保存
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors print:hidden"
            >
              商品一覧に戻る
            </button>
          </div>
        </div>
      </header>

      <main ref={printRef} className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <p className="text-sm text-gray-500">レポートを読み込んでいます...</p>
            </div>
          </div>
        ) : (
          <>
            {/* エラー表示 */}
            {results.filter((r) => r.error).length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {results.filter((r) => r.error).map((r) => (
                  <p key={r.asin}>ASIN {r.asin}: レポートの取得に失敗しました</p>
                ))}
              </div>
            )}

            {/* 商品一覧バー */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className={`grid gap-3 ${
                reports.length <= 2 ? 'grid-cols-2' :
                reports.length <= 3 ? 'grid-cols-3' :
                reports.length <= 4 ? 'grid-cols-2 lg:grid-cols-4' :
                'grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
              }`}>
                {reports.map((r, i) => (
                  <div key={r.asin} className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5 min-w-0">
                    <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${PRODUCT_COLORS[i]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 line-clamp-2 leading-tight">{r.report.productName}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        <span className="font-mono text-gray-300">{r.asin}</span>
                        <span className="mx-1">·</span>
                        {r.report.totalReviewsAnalyzed}件分析
                        {r.report.isMock && <span className="ml-1.5 inline-block rounded bg-orange-100 px-1 py-0.5 text-[10px] text-orange-600">デモ</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── 評価数・価格比較 ── */}
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-gray-900">評価・価格比較</h2>
              <p className="mb-4 text-xs text-gray-500">
                各商品の評価数・平均評価・価格を横断比較します。
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="py-2 pr-4 text-left font-medium text-gray-500">項目</th>
                      {reports.map((r, i) => (
                        <th key={r.asin} className="min-w-[140px] px-2 py-2 text-left">
                          <div className="flex items-center gap-1.5">
                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PRODUCT_COLORS[i]}`} />
                            <span className="truncate font-medium text-gray-700">{r.report.productName.slice(0, 20)}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* 平均評価 */}
                    <tr className="border-b border-gray-50">
                      <td className="py-2.5 pr-4 text-gray-700 whitespace-nowrap">平均評価</td>
                      {reports.map((r) => {
                        const ctx = r.reviewContext
                        return (
                          <td key={r.asin} className="px-2 py-2.5">
                            {ctx?.averageRating != null ? (
                              <span className="text-sm text-amber-600 font-medium">{renderStars(ctx.averageRating)}</span>
                            ) : (
                              <span className="text-xs text-gray-300">-</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                    {/* 評価数 */}
                    <tr className="border-b border-gray-50">
                      <td className="py-2.5 pr-4 text-gray-700 whitespace-nowrap">総評価数</td>
                      {reports.map((r) => {
                        const ctx = r.reviewContext
                        return (
                          <td key={r.asin} className="px-2 py-2.5">
                            {ctx?.totalReviews != null ? (
                              <span className="text-sm font-medium text-gray-900">{ctx.totalReviews.toLocaleString()}件</span>
                            ) : (
                              <span className="text-xs text-gray-300">-</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                    {/* 分析済み件数 */}
                    <tr className="border-b border-gray-50">
                      <td className="py-2.5 pr-4 text-gray-700 whitespace-nowrap">分析済み</td>
                      {reports.map((r) => (
                        <td key={r.asin} className="px-2 py-2.5">
                          <span className="text-sm text-gray-600">{r.report.totalReviewsAnalyzed}件</span>
                        </td>
                      ))}
                    </tr>
                    {/* 価格 */}
                    <tr className="border-b border-gray-50">
                      <td className="py-2.5 pr-4 text-gray-700 whitespace-nowrap">価格</td>
                      {reports.map((r) => {
                        const price = r.reviewContext?.price
                        return (
                          <td key={r.asin} className="px-2 py-2.5">
                            <span className={`text-sm font-medium ${price != null ? 'text-gray-900' : 'text-gray-300'}`}>
                              {formatPrice(price)}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                    {/* 価格感 */}
                    {reports.some((r) => r.report.priceSentiment) && (
                      <tr className="border-b border-gray-50">
                        <td className="py-2.5 pr-4 text-gray-700 whitespace-nowrap">価格感</td>
                        {reports.map((r) => {
                          const ps = r.report.priceSentiment
                          return (
                            <td key={r.asin} className="px-2 py-2.5">
                              {ps ? (
                                <div className="space-y-1">
                                  <div className="flex h-2 w-full max-w-[120px] overflow-hidden rounded-full">
                                    <div className="bg-red-400" style={{ width: `${ps.expensive}%` }} />
                                    <div className="bg-yellow-400" style={{ width: `${ps.reasonable}%` }} />
                                    <div className="bg-green-400" style={{ width: `${ps.goodValue}%` }} />
                                  </div>
                                  <div className="flex gap-2 text-[10px]">
                                    <span className="text-red-500">高 {ps.expensive}%</span>
                                    <span className="text-yellow-600">妥当 {ps.reasonable}%</span>
                                    <span className="text-green-600">安 {ps.goodValue}%</span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-300">-</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )}
                    {/* 評価分布 */}
                    <tr>
                      <td className="py-2.5 pr-4 text-gray-700 whitespace-nowrap align-top">評価分布</td>
                      {reports.map((r) => {
                        const bd = r.reviewContext?.ratingBreakdown
                        if (!bd) return <td key={r.asin} className="px-2 py-2.5"><span className="text-xs text-gray-300">-</span></td>
                        const total = Object.values(bd).reduce((a, b) => a + b, 0) || 1
                        return (
                          <td key={r.asin} className="px-2 py-2.5">
                            <div className="space-y-0.5">
                              {[5, 4, 3, 2, 1].map((star) => {
                                const count = bd[star] || 0
                                const pct = Math.round((count / total) * 100)
                                return (
                                  <div key={star} className="flex items-center gap-1">
                                    <span className="w-4 text-right text-[10px] text-gray-400">{star}</span>
                                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-gray-100">
                                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="text-[10px] text-gray-400">{pct}%</span>
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* カテゴリ言及率比較 */}
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">カテゴリ言及率比較</h2>
                  <p className="text-xs text-gray-500">
                    各商品のレビューがどの観点に集中しているかを横断比較します。
                  </p>
                </div>
                {!editingCategories && (
                  <button
                    onClick={startEditCategories}
                    className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors print:hidden"
                  >
                    観点を編集
                  </button>
                )}
              </div>

              {/* カテゴリ編集パネル */}
              {editingCategories && (
                <div className="mb-4 mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4 print:hidden">
                  <p className="mb-2 text-xs font-medium text-blue-800">分析観点を編集して全商品を再分析します</p>
                  <div className="space-y-1.5">
                    {editedCategories.map((cat, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-5 text-right text-[10px] text-blue-400">{i + 1}</span>
                        <input
                          type="text"
                          value={cat}
                          onChange={(e) => updateEditedCategory(i, e.target.value)}
                          placeholder="カテゴリ名..."
                          className="flex-1 rounded-md border border-blue-200 bg-white px-3 py-1.5 text-sm text-gray-800 placeholder:text-gray-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
                        />
                        {editedCategories.length > 1 && (
                          <button
                            onClick={() => removeEditedCategory(i)}
                            className="rounded p-1 text-blue-400 hover:bg-blue-100 hover:text-red-500 transition-colors"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {editedCategories.length < 7 && (
                    <button
                      onClick={addEditedCategory}
                      className="mt-2 text-xs text-blue-600 hover:underline"
                    >
                      + 観点を追加
                    </button>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      disabled={reanalyzing || editedCategories.filter((c) => c.trim()).length === 0}
                      onClick={handleReanalyzeAll}
                      className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-40"
                    >
                      {reanalyzing ? '再分析中...' : 'この観点で全商品を再分析'}
                    </button>
                    <button
                      onClick={() => setEditingCategories(false)}
                      className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 transition-colors"
                    >
                      キャンセル
                    </button>
                    {reanalyzing && (
                      <div className="flex items-center gap-1.5 text-xs text-blue-600">
                        <div className="h-3 w-3 animate-spin rounded-full border border-blue-600 border-t-transparent" />
                        <span>{reports.length}商品を分析中...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!categoriesMatch && reports.length > 1 && (
                <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-3 text-xs text-amber-700">
                  <div className="flex items-center justify-between gap-2">
                    <span>分析観点が商品ごとに異なります。1商品の観点をテンプレートにして、他の商品を同じ観点で再分析できます。</span>
                    <button
                      onClick={() => { setUnifyOpen(!unifyOpen); setUnifySelectedAsin(null) }}
                      className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
                    >
                      {unifyOpen ? '閉じる' : '観点を揃える'}
                    </button>
                  </div>
                  {unifyOpen && (
                    <div className="mt-3 border-t border-amber-200 pt-3">
                      <p className="mb-2 text-amber-800 font-medium">どの商品の観点に揃えますか？</p>
                      <div className="space-y-1.5">
                        {reports.map((r, i) => {
                          const cats = r.report.categoryBreakdown.map((c) => c.category)
                          const isSelected = unifySelectedAsin === r.asin
                          const isUnifying = unifyingAsins.size > 0
                          return (
                            <label
                              key={r.asin}
                              className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-all ${
                                isSelected
                                  ? 'border-amber-400 bg-white shadow-sm'
                                  : 'border-amber-100 bg-amber-50/50 hover:border-amber-300 hover:bg-white'
                              } ${isUnifying ? 'opacity-50 pointer-events-none' : ''}`}
                            >
                              <input
                                type="radio"
                                name="unify-template"
                                checked={isSelected}
                                onChange={() => setUnifySelectedAsin(r.asin)}
                                className="accent-amber-600"
                              />
                              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PRODUCT_COLORS[i]}`} />
                              <div className="min-w-0 flex-1">
                                <span className="text-xs font-medium text-gray-800 truncate block">{r.report.productName.slice(0, 40)}</span>
                                <span className="text-[10px] text-gray-400">{cats.join(' / ')}</span>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                      {/* 実行ボタン */}
                      <div className="mt-3 flex items-center gap-3">
                        <button
                          disabled={!unifySelectedAsin || unifyingAsins.size > 0}
                          onClick={() => unifySelectedAsin && handleUnify(unifySelectedAsin)}
                          className="rounded-md bg-amber-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          この観点で他の商品を再分析する
                        </button>
                        {unifyingAsins.size > 0 && (
                          <div className="flex items-center gap-2 text-amber-800">
                            <div className="h-3 w-3 animate-spin rounded-full border border-amber-600 border-t-transparent" />
                            <span>残り {unifyingAsins.size}商品を再分析中...</span>
                          </div>
                        )}
                      </div>
                      {unifyError && (
                        <p className="mt-2 text-red-600">{unifyError}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="py-2 pr-4 text-left font-medium text-gray-500">観点</th>
                      {reports.map((r, i) => (
                        <th key={r.asin} className="min-w-[140px] px-2 py-2 text-left">
                          <div className="flex items-center gap-1.5">
                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PRODUCT_COLORS[i]}`} />
                            <span className="truncate font-medium text-gray-700">{r.report.productName.slice(0, 20)}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allCategories.map((category) => (
                      <tr key={category} className="border-b border-gray-50">
                        <td className="py-2.5 pr-4 text-gray-700 whitespace-nowrap">{category}</td>
                        {reports.map((r, i) => {
                          const cat = r.report.categoryBreakdown.find((c) => c.category === category)
                          return (
                            <td key={r.asin} className="px-2 py-2.5">
                              {cat ? (
                                <div className="flex items-center gap-2">
                                  <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-100">
                                    <div
                                      className={`h-full rounded-full ${PRODUCT_COLORS[i]}`}
                                      style={{ width: `${cat.mentionRate}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-medium text-gray-600">{cat.mentionRate}%</span>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-300">-</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* POX比較 */}
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-gray-900">POD / POP / POF 比較</h2>
              <p className="mb-4 text-xs text-gray-500">
                各商品の独自優位性・必須機能・妥協候補を横断比較します。自社のPODが競合のPOFになっていないか等を確認できます。
              </p>
              {/* サブタブ */}
              <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 print:flex">
                {([
                  { key: 'pod' as const, label: 'POD', sub: '独自優位性', color: 'bg-blue-600' },
                  { key: 'pop' as const, label: 'POP', sub: '必須機能', color: 'bg-gray-600' },
                  { key: 'pof' as const, label: 'POF', sub: '妥協候補', color: 'bg-orange-500' },
                ]).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setPoxTab(tab.key)}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      poxTab === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <span className="font-bold">{tab.label}</span>
                    <span className="ml-1 text-xs text-gray-400">{tab.sub}</span>
                  </button>
                ))}
              </div>
              {/* POX カード横並び */}
              {(() => {
                const allMock = reports.every((r) => r.report.isMock === true)
                const mockCount = reports.filter((r) => r.report.isMock === true).length

                // 全商品がモック → 一括案内
                if (allMock) {
                  const hasApiKey = !!localStorage.getItem('reviewai_api_key')
                  return (
                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-6 text-center print:hidden">
                      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-orange-100">
                        <svg className="h-6 w-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                      </div>
                      <p className="text-sm font-medium text-orange-800">AI分析が未実行のため、全商品が同じデモデータになっています</p>
                      <p className="mt-1 text-xs text-orange-600">APIキーを設定してAI分析を実行すると、商品ごとの具体的な違いが表示されます。</p>

                      {/* APIキー入力 */}
                      {(!hasApiKey || showApiKeyInput) && (
                        <div className="mx-auto mt-4 max-w-md">
                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              value={apiKeyInput}
                              onChange={(e) => setApiKeyInput(e.target.value)}
                              placeholder="sk-ant-..."
                              className="flex-1 rounded-lg border border-orange-300 bg-white px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-300"
                            />
                            <button
                              disabled={!apiKeyInput.trim()}
                              onClick={() => saveApiKey(apiKeyInput.trim())}
                              className="shrink-0 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-40"
                            >
                              保存
                            </button>
                          </div>
                          <p className="mt-1.5 text-[11px] text-orange-400">Anthropic APIキーを入力してください</p>
                        </div>
                      )}

                      {analyzeError && (
                        <p className="mt-3 text-xs text-red-600">{analyzeError}</p>
                      )}

                      <button
                        disabled={reanalyzingAsin !== null || !localStorage.getItem('reviewai_api_key')}
                        onClick={async () => {
                          const apiKey = getApiKey()
                          if (!apiKey) return
                          setReanalyzingAsin('__all__')
                          setAnalyzeError(null)
                          try {
                            await Promise.allSettled(
                              reports.map(async (r) => {
                                const customCats = r.report.categoryFramework?.map((c) => ({ name: c.name }))
                                  || r.report.categoryBreakdown.map((c) => ({ name: c.category }))
                                const res = await fetch('/api/analyze', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ asin: r.asin, apiKey, customCategories: customCats }),
                                })
                                if (!res.ok) throw new Error('fail')
                              })
                            )
                            setLoading(true)
                            const freshResults = await Promise.all(
                              asins.map((asin) =>
                                fetch(`/api/reports?asin=${encodeURIComponent(asin)}`)
                                  .then((resp) => resp.json())
                                  .then((data) => ({ asin, report: data.report as CompareReport | null, reviewContext: data.reviewContext as ReviewContext | null, error: null }))
                                  .catch((err) => ({ asin, report: null, reviewContext: null, error: (err as Error).message }))
                              )
                            )
                            setResults(freshResults)
                            setLoading(false)
                          } catch {
                            setAnalyzeError('一括分析に失敗しました。APIキーを確認してください。')
                          } finally {
                            setReanalyzingAsin(null)
                          }
                        }}
                        className="mt-4 inline-flex items-center gap-2 rounded-full bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
                      >
                        {reanalyzingAsin === '__all__' ? (
                          <>
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            全商品をAI分析中...
                          </>
                        ) : `全${reports.length}商品をAI分析する`}
                      </button>
                    </div>
                  )
                }

                // 一部モック or 全部実分析 → 通常表示
                return (
                  <>
                    {mockCount > 0 && (
                      <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-xs text-orange-700 print:hidden">
                        {mockCount}商品がAI未分析（デモデータ）です。AI分析を実行すると正確な比較ができます。
                      </div>
                    )}
                    <div className={`grid gap-4 ${
                      reports.length <= 2 ? 'md:grid-cols-2' :
                      reports.length <= 3 ? 'md:grid-cols-3' :
                      reports.length <= 4 ? 'md:grid-cols-2 lg:grid-cols-4' :
                      'md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
                    }`}>
                      {reports.map((r, i) => {
                        const items = r.report.poxAnalysis[poxTab] || []
                        const isMock = r.report.isMock === true
                        const isReanalyzing = reanalyzingAsin === r.asin
                        return (
                          <div key={r.asin} className={`rounded-lg border p-4 ${isMock ? 'border-orange-200 bg-orange-50/50' : 'border-gray-100 bg-gray-50'}`}>
                            <div className="mb-3 flex items-center gap-2">
                              <span className={`h-3 w-3 shrink-0 rounded-full ${PRODUCT_COLORS[i]}`} />
                              <h3 className="truncate text-sm font-semibold text-gray-900">{r.report.productName.slice(0, 25)}</h3>
                              {isMock && (
                                <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-600">デモ</span>
                              )}
                            </div>
                            {isMock && (
                              <div className="mb-3 rounded-md bg-orange-100/60 px-3 py-2 print:hidden">
                                <p className="text-[11px] text-orange-700">AI未分析のデモデータです。AI分析で正確な比較ができます。</p>
                                <button
                                  disabled={isReanalyzing}
                                  onClick={() => handleReanalyzeSingle(r.asin)}
                                  className="mt-1.5 rounded-md bg-orange-500 px-3 py-1 text-[11px] font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
                                >
                                  {isReanalyzing ? (
                                    <span className="flex items-center gap-1.5">
                                      <span className="inline-block h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
                                      分析中...
                                    </span>
                                  ) : 'AI分析を実行'}
                                </button>
                              </div>
                            )}
                            {items.length > 0 ? (
                              <div className="space-y-2">
                                {items.map((item, j) => (
                                  <PoxCard key={j} item={item} />
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400">該当なし</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )
              })()}
            </div>

            {/* ── メモ ── */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 print:break-before-page">
              <h2 className="text-lg font-semibold text-gray-900">メモ</h2>
              <p className="mb-4 text-xs text-gray-500">
                商品ごとにメモを残せます。この比較セッションに紐づいてブラウザに保存されます。
              </p>
              {/* 全体メモ（上部） */}
              <div className="mb-4">
                <textarea
                  value={memos['_general'] || ''}
                  onChange={(e) => saveMemo('_general', e.target.value)}
                  placeholder="比較結果から得られた総合的な考察、次のアクションなど..."
                  className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 print:border-none print:p-0"
                  rows={3}
                />
              </div>
              {/* 商品別メモ */}
              <div className="space-y-0 divide-y divide-gray-100">
                {reports.map((r, i) => (
                  <div key={r.asin} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2 pt-2 shrink-0 w-[180px]">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PRODUCT_COLORS[i]}`} />
                      <span className="truncate text-xs font-medium text-gray-600">{r.report.productName.slice(0, 20)}</span>
                    </div>
                    <textarea
                      value={memos[r.asin] || ''}
                      onChange={(e) => saveMemo(r.asin, e.target.value)}
                      placeholder="メモを入力..."
                      className="flex-1 resize-none rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-gray-700 placeholder:text-gray-300 hover:border-gray-200 hover:bg-gray-50 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 print:border-none print:p-0"
                      rows={1}
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>

      {/* 印刷用スタイル */}
      <style jsx global>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:static { position: static !important; }
          .print\\:border-none { border: none !important; }
          .print\\:break-before-page { break-before: page; }
          .print\\:p-0 { padding: 0 !important; }
        }
      `}</style>
    </div>
  )
}

// ── POXカード ──

function PoxCard({ item }: { item: PoxElement }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
      <div className="flex items-start gap-1.5">
        <span className={`mt-0.5 shrink-0 whitespace-nowrap rounded px-1 py-0.5 text-[10px] ${confidenceStyles[item.confidence]}`}>
          {confidenceLabels[item.confidence]}
        </span>
        <p className="text-xs font-medium text-gray-900">{item.title}</p>
        {item.reviewCount != null && item.reviewCount > 0 && (
          <span className="mt-0.5 shrink-0 text-[10px] text-gray-400">{item.reviewCount}件</span>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-4 text-gray-500">{item.description}</p>
      {item.evidence && item.evidence.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 text-[10px] text-blue-500 hover:underline print:hidden"
          >
            {expanded ? '根拠を閉じる' : `根拠を見る (${item.evidence.length}件)`}
          </button>
          {expanded && (
            <div className="mt-1 space-y-1">
              {item.evidence.map((ev, i) => (
                <p key={i} className="text-[10px] italic text-gray-400">&ldquo;{ev}&rdquo;</p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── ページエクスポート ──

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    }>
      <CompareContent />
    </Suspense>
  )
}

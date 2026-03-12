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
  const printRef = useRef<HTMLDivElement>(null)

  const asins = (searchParams.get('asins') || '').split(',').filter(Boolean)
  const memoKey = `compare-memo:${asins.sort().join(',')}`

  // メモ読み込み
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
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors print:hidden"
            >
              {copySuccess ? '✓ コピー済み' : '共有リンクをコピー'}
            </button>
            <button
              onClick={handlePdfExport}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors print:hidden"
            >
              印刷 / PDF保存
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 transition-colors print:hidden"
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
              <div className="flex flex-wrap gap-3">
                {reports.map((r, i) => (
                  <div key={r.asin} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                    <span className={`h-3 w-3 shrink-0 rounded-full ${PRODUCT_COLORS[i]}`} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{r.report.productName}</p>
                      <p className="text-xs text-gray-400">{r.report.totalReviewsAnalyzed}件分析</p>
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
                                <div className="flex items-center gap-1">
                                  <div className="flex h-2 w-20 overflow-hidden rounded-full">
                                    <div className="bg-red-400" style={{ width: `${ps.expensive}%` }} />
                                    <div className="bg-yellow-400" style={{ width: `${ps.reasonable}%` }} />
                                    <div className="bg-green-400" style={{ width: `${ps.goodValue}%` }} />
                                  </div>
                                  <span className="text-[10px] text-gray-400">
                                    高{ps.expensive}% 妥当{ps.reasonable}% 安{ps.goodValue}%
                                  </span>
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
              <h2 className="text-lg font-semibold text-gray-900">カテゴリ言及率比較</h2>
              <p className="mb-4 text-xs text-gray-500">
                各商品のレビューがどの観点に集中しているかを横断比較します。
              </p>
              {!categoriesMatch && reports.length > 1 && (
                <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  分析観点が商品ごとに異なります。各商品の個別レポートで同じ観点に揃えて再分析すると、より正確に比較できます。
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
              <div className={`grid gap-4 ${
                reports.length <= 2 ? 'md:grid-cols-2' :
                reports.length <= 3 ? 'md:grid-cols-3' :
                reports.length <= 4 ? 'md:grid-cols-2 lg:grid-cols-4' :
                'md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
              }`}>
                {reports.map((r, i) => {
                  const items = r.report.poxAnalysis[poxTab] || []
                  return (
                    <div key={r.asin} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <span className={`h-3 w-3 shrink-0 rounded-full ${PRODUCT_COLORS[i]}`} />
                        <h3 className="truncate text-sm font-semibold text-gray-900">{r.report.productName.slice(0, 25)}</h3>
                      </div>
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
            </div>

            {/* ── メモ ── */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 print:break-before-page">
              <h2 className="text-lg font-semibold text-gray-900">メモ</h2>
              <p className="mb-4 text-xs text-gray-500">
                商品ごとにメモを残せます。この比較セッションに紐づいてブラウザに保存されます。
              </p>
              <div className={`grid gap-4 ${
                reports.length <= 2 ? 'md:grid-cols-2' :
                reports.length <= 3 ? 'md:grid-cols-3' :
                'md:grid-cols-2 lg:grid-cols-4'
              }`}>
                {reports.map((r, i) => (
                  <div key={r.asin} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PRODUCT_COLORS[i]}`} />
                      <span className="truncate text-sm font-medium text-gray-700">{r.report.productName.slice(0, 25)}</span>
                    </div>
                    <textarea
                      value={memos[r.asin] || ''}
                      onChange={(e) => saveMemo(r.asin, e.target.value)}
                      placeholder="気づいたこと、検討メモなど..."
                      className="w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-300 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300 print:border-none print:p-0"
                      rows={3}
                    />
                    {/* 印刷時はtextareaの代わりにテキスト表示 */}
                  </div>
                ))}
              </div>
              {/* 全体メモ */}
              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="mb-2 text-sm font-medium text-gray-700">全体メモ</p>
                <textarea
                  value={memos['_general'] || ''}
                  onChange={(e) => saveMemo('_general', e.target.value)}
                  placeholder="比較結果から得られた総合的な考察、次のアクションなど..."
                  className="w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-300 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300 print:border-none print:p-0"
                  rows={4}
                />
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

'use client'

import { useState, useEffect } from 'react'

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

const severityStyles = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-green-100 text-green-800',
}

const confidenceLabels = { high: '確度高', medium: '確度中', low: '確度低' }

export default function Dashboard() {
  const [products, setProducts] = useState<Product[]>([])
  const [newAsin, setNewAsin] = useState('')
  const [newName, setNewName] = useState('')
  const [analyzing, setAnalyzing] = useState<string | null>(null)
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [activeTab, setActiveTab] = useState<'products' | 'report'>('products')
  const [error, setError] = useState<string | null>(null)
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

  const addProduct = async () => {
    if (!newAsin) return
    setError(null)
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asin: newAsin, name: newName || undefined }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error)
      return
    }
    setProducts(prev => [...prev, data.product])
    setNewAsin('')
    setNewName('')
  }

  const analyzeProduct = async (product: Product) => {
    setAnalyzing(product.id)
    setReport(null)
    setError(null)
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: product.asin, apiKey: userApiKey || undefined }),
      })
      const data = await res.json()
      if (data.success) {
        setReport(data.report)
        setActiveTab('report')
      }
    } catch (err) {
      console.error('Analysis failed:', err)
      setError('分析に失敗しました')
    }
    setAnalyzing(null)
  }

  const deleteProduct = async (id: string) => {
    await fetch(`/api/products/${id}`, { method: 'DELETE' })
    setProducts(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div className="min-h-screen bg-gray-50">
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
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
          <button
            onClick={() => setActiveTab('products')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'products' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            商品管理 ({products.length})
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
            {/* Add Product Form */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">分析する商品を追加</h2>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="商品名（任意）"
                  className="flex-1 max-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={newAsin}
                  onChange={e => setNewAsin(e.target.value)}
                  placeholder="ASIN（例: B0DEMO12345）またはAmazon URL"
                  className="flex-2 min-w-0 flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={e => e.key === 'Enter' && addProduct()}
                />
                <button
                  onClick={addProduct}
                  className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  追加
                </button>
              </div>
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
                        onClick={() => analyzeProduct(product)}
                        disabled={analyzing === product.id}
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                      >
                        {analyzing === product.id ? '分析中...' : 'POX分析'}
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
                  <p className="text-lg mb-1">商品が登録されていません</p>
                  <p className="text-sm">ASINを入力して商品を追加してください</p>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'report' && report && (
          <div className="space-y-6">
            {/* Report Header */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold text-gray-900">{report.productName}</h2>
                <span className="text-xs text-gray-400">
                  {new Date(report.analyzedAt).toLocaleString('ja-JP')} / {report.totalReviewsAnalyzed}件分析
                </span>
              </div>
              <p className="text-sm text-gray-500 font-mono">ASIN: {report.asin}</p>
            </div>

            {/* Category Breakdown (Step A) */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Step A: レビュー構造化分析</h3>
              <div className="grid md:grid-cols-2 gap-4">
                {report.categoryBreakdown.map((cat, i) => (
                  <div key={i} className="border border-gray-100 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{cat.category}</span>
                      <span className="text-sm font-bold text-blue-600">{cat.mentionRate}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${cat.mentionRate}%` }}
                      />
                    </div>
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
            <div className="bg-white rounded-xl border border-gray-200 p-6">
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
              <div className="bg-white rounded-xl border border-gray-200 p-6">
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
              <div className="bg-white rounded-xl border border-gray-200 p-6">
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
              <div className="bg-white rounded-xl border border-gray-200 p-6">
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
              <div className="bg-white rounded-xl border border-gray-200 p-6">
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
            <div className="bg-white rounded-xl border border-gray-200 p-6">
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

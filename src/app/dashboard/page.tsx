'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { CategoryDefinition } from '@/lib/services/pox-analyzer'

interface Product {
  id: string
  asin: string
  name: string
  lastAnalyzedAt: string | null
  averageRating: number | null
  totalReviews: number | null
  price?: number | null
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

interface ReviewExcerpt {
  title: string
  body: string
  rating: number
  date: string
}

interface ReviewContext {
  averageRating: number
  ratingBreakdown: Record<number, number>
  totalReviews: number
  reviewListCount: number
  starFetchStats?: Partial<Record<'five_star' | 'four_star' | 'three_star' | 'two_star' | 'one_star', {
    available: number
    fetched: number
  }>>
  reviews: ReviewExcerpt[]
  lowRatingReviews: ReviewExcerpt[]
  highRatingReviews: ReviewExcerpt[]
}

interface AnalysisReport {
  asin: string
  productName: string
  analyzedAt: string
  categoryFramework: CategoryDefinition[]
  poxGuidance?: string
  analysisDepth?: 'focused' | 'standard' | 'deep'
  notes?: string
  totalReviewsAnalyzed: number
  categoryBreakdown: CategoryBreakdown[]
  poxAnalysis: {
    pod: PoxElement[]
    pop: PoxElement[]
    pof: PoxElement[]
  }
  painPoints: { title: string; count: number; severity: 'high' | 'medium' | 'low' }[]
  satisfactionPoints: { title: string; count: number }[]
  unmetNeeds: { need: string; evidence: string; importance: 'high' | 'medium' | 'low' }[]
  priceSentiment: { expensive: number; reasonable: number; goodValue: number }
  actionRecommendations: { category: string; action: string; reason: string }[]
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

type UnmetNeedItem = { need: string; evidence: string; importance: 'high' | 'medium' | 'low' }

type ActionItem = { category: string; action: string; reason: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeActions(raw: any[]): ActionItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) =>
    typeof item === 'string'
      ? { category: '改善施策', action: item, reason: '' }
      : { category: item.category || '改善施策', action: item.action || '', reason: item.reason || '' }
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeMentionRate(val: unknown): number {
  if (typeof val === 'number') return val
  const str = String(val).replace(/[^0-9.]/g, '')
  return parseInt(str, 10) || 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeReport(report: any) {
  if (!report) return report
  return {
    ...report,
    categoryBreakdown: (report.categoryBreakdown || []).map((cat: CategoryBreakdown) => ({
      ...cat,
      mentionRate: sanitizeMentionRate(cat.mentionRate),
      mentionCount: sanitizeMentionRate(cat.mentionCount),
    })),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeUnmetNeeds(raw: any[]): UnmetNeedItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) =>
    typeof item === 'string'
      ? { need: item, evidence: '', importance: 'medium' as const }
      : { need: item.need || '', evidence: item.evidence || '', importance: item.importance || 'medium' }
  )
}

function getDisplayEvidence(evidence: string[]): string[] {
  const cleaned = evidence.filter((item) => {
    const normalized = item.replace(/\s+/g, '').toLowerCase()
    if (!normalized) return false
    if (normalized.includes('つ星のうち')) return false
    if (/^\d+(\.\d+)?$/.test(normalized)) return false
    if (['5.0', '4.0', '3.0', '2.0', '1.0'].includes(normalized)) return false
    return item.trim().length >= 8
  })

  return cleaned.length > 0 ? cleaned : ['代表的なレビュー引用は再分析時に補強されます']
}

function getDisplayTopicLabel(value: string): string {
  const normalized = value.replace(/\s+/g, '').toLowerCase()
  if (!value || normalized.includes('つ星のうち') || /^\d+(\.\d+)?$/.test(normalized)) {
    return '抽出語の精度不足'
  }
  return value
}

function getReviewCardHeading(review: ReviewExcerpt, fallbackLabel: string): string {
  const title = (review.title || '').trim()
  const normalized = title.replace(/\s+/g, '').toLowerCase()
  if (title && !normalized.includes('つ星のうち') && !/^\d+(\.\d+)?$/.test(normalized)) {
    return title
  }

  const body = (review.body || '').trim()
  if (body) {
    return body.length > 28 ? `${body.slice(0, 28)}...` : body
  }

  return `${fallbackLabel}（★${review.rating}）`
}

function extractSearchPhrases(source: string): string[] {
  const noiseWords = new Set(['レビュー', 'カスタマーレビュー', 'コメント'])
  const seen = new Set<string>()
  return source
    .split(/[、,。・/\n\s]+/)
    .map((v) => v.trim())
    .filter((v) => {
      const n = v.replace(/\s+/g, '').toLowerCase()
      if (!n || n.length <= 1) return false
      if (n.includes('つ星のうち') || /^\d+(\.\d+)?$/.test(n)) return false
      if (noiseWords.has(v)) return false
      if (seen.has(n)) return false
      seen.add(n)
      return true
    })
}

function getCategoryEvidenceReviews(
  reviews: ReviewExcerpt[],
  category: string,
  fallbackDescription: string | undefined,
  mentions: string[],
  excludeKeys?: Set<string>
): ReviewExcerpt[] {
  // topMentions（AIが実際にレビューから抽出したキーワード）を最優先
  const mentionPhrases = extractSearchPhrases(mentions.join('、'))
  // カテゴリ名・説明文は補助キーワード（重み低め）
  const auxPhrases = extractSearchPhrases(`${category} ${fallbackDescription || ''}`)
  // 全検索キーワードを結合（部分一致用に2文字以上の語を抽出）
  const allKeywords = [...mentionPhrases, ...auxPhrases]
    .flatMap((p) => {
      const parts = p.match(/[一-龠ぁ-んァ-ヶー]{2,}|[A-Za-z0-9]{2,}/g) || []
      return [p, ...parts]
    })
    .map((k) => k.toLowerCase())
    .filter((k, i, arr) => k.length >= 2 && arr.indexOf(k) === i)

  const scored = reviews
    .map((review) => {
      const key = `${review.date}|${review.title}|${review.body?.slice(0, 50)}`
      const text = `${review.title || ''} ${review.body || ''}`.toLowerCase()
      // topMentionsマッチ（重み高）
      let score = mentionPhrases.reduce((sum, phrase) => {
        const n = phrase.toLowerCase()
        return text.includes(n) ? sum + Math.max(3, n.length * 2) : sum
      }, 0)
      // カテゴリ名/説明マッチ（重み低）
      score += auxPhrases.reduce((sum, phrase) => {
        const n = phrase.toLowerCase()
        return text.includes(n) ? sum + 1 : sum
      }, 0)
      // 部分語マッチ（重み最低 = 0.5）: 上記で0点でもキーワードの部分語が含まれていればスコア加算
      if (score === 0) {
        score += allKeywords.reduce((sum, kw) => {
          return text.includes(kw) ? sum + 0.5 : sum
        }, 0)
      }
      const used = excludeKeys?.has(key) ?? false
      return { review, score, key, used }
    })
    .filter((item) => item.score > 0)

  // 未使用マッチが十分あれば未使用優先、少なければ重複も許容
  const unused = scored.filter((item) => !item.used)
  const sorted = unused.length >= 3
    ? [...unused.sort((a, b) => b.score - a.score), ...scored.filter((item) => item.used).sort((a, b) => b.score - a.score)]
    : scored.sort((a, b) => b.score - a.score)

  const matched = sorted.slice(0, 10).map((item) => item.review)

  // マッチが少ない場合、未使用レビューで補完して最低5件は返す
  const MIN_EVIDENCE = 5
  if (matched.length < MIN_EVIDENCE) {
    const matchedKeys = new Set(sorted.slice(0, 10).map((item) => item.key))
    const allUsedKeys = new Set([...matchedKeys, ...(excludeKeys || [])])
    const supplement = reviews
      .filter((r) => {
        const key = `${r.date}|${r.title}|${r.body?.slice(0, 50)}`
        return !allUsedKeys.has(key)
      })
    // 星評価を分散させて補完
    const highRated = supplement.filter((r) => r.rating >= 4)
    const lowRated = supplement.filter((r) => r.rating <= 2)
    const midRated = supplement.filter((r) => r.rating === 3)
    const padPool = [...highRated, ...midRated, ...lowRated]
    const pad = (padPool.length > 0 ? padPool : supplement).slice(0, MIN_EVIDENCE - matched.length)
    return [...matched, ...pad]
  }

  return matched
}


function PoxItemCard({ item, borderColor, reviews }: {
  item: { title: string; description: string; evidence: string[]; confidence: 'high' | 'medium' | 'low'; reviewCount?: number }
  borderColor: string
  reviews: ReviewExcerpt[]
}) {
  const [showReviews, setShowReviews] = useState(false)
  const [expandedReviews, setExpandedReviews] = useState(false)

  const matchingReviews = showReviews ? (() => {
    const evidenceTexts = getDisplayEvidence(item.evidence)
    const matched = new Map<string, ReviewExcerpt>()
    for (const ev of evidenceTexts) {
      const evNorm = ev.toLowerCase().replace(/\s+/g, '')
      for (const review of reviews) {
        const key = `${review.date}|${review.title}`
        if (matched.has(key)) continue
        const text = `${review.title || ''} ${review.body || ''}`.toLowerCase().replace(/\s+/g, '')
        if (text.includes(evNorm.slice(0, 20)) || evNorm.includes(text.slice(0, 20))) {
          matched.set(key, review)
        }
      }
    }
    // フォールバック: evidenceでマッチしない場合、title/descriptionのキーワードで検索
    if (matched.size === 0) {
      const keywords = `${item.title} ${item.description}`.toLowerCase().split(/[\s、,。・]+/).filter((w) => w.length > 2).slice(0, 3)
      for (const review of reviews) {
        const text = `${review.title || ''} ${review.body || ''}`.toLowerCase()
        if (keywords.some((kw) => text.includes(kw))) {
          const key = `${review.date}|${review.title}`
          if (!matched.has(key)) matched.set(key, review)
          if (matched.size >= 8) break
        }
      }
    }
    return Array.from(matched.values()).slice(0, 8)
  })() : []

  return (
    <div className={`ml-4 border-l-2 ${borderColor} pl-4`}>
      <div className="flex items-center gap-2">
        <h4 className="font-medium text-sm">{item.title}</h4>
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          item.confidence === 'high' ? 'bg-red-100 text-red-800' :
          item.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
          'bg-green-100 text-green-800'
        }`}>
          {item.confidence === 'high' ? '確度高' : item.confidence === 'medium' ? '確度中' : '確度低'}
        </span>
        {item.reviewCount != null && item.reviewCount > 0 && (
          <span className="text-xs text-gray-400">{item.reviewCount}件が該当</span>
        )}
      </div>
      <p className="text-sm text-gray-600 mt-1">{item.description}</p>
      <p className="mt-2 text-[11px] text-gray-400">
        {item.reviewCount != null && item.reviewCount > 0
          ? `${item.reviewCount}件のレビューに基づく分析（代表的な根拠を表示）`
          : '代表的な根拠を表示'}
      </p>
      <div className="mt-1 space-y-1">
        {getDisplayEvidence(item.evidence).map((ev, j) => (
          <p key={j} className="text-xs text-gray-400 italic">&ldquo;{ev}&rdquo;</p>
        ))}
      </div>
      {reviews.length > 0 && (
        <button
          onClick={() => setShowReviews(!showReviews)}
          className="mt-2 text-xs text-blue-500 hover:underline"
        >
          {showReviews ? '根拠レビューを閉じる' : '根拠レビューを確認'}
        </button>
      )}
      {showReviews && matchingReviews.length > 0 && (
        <div className="mt-2 space-y-2">
          {matchingReviews.slice(0, expandedReviews ? matchingReviews.length : 3).map((review, idx) => (
            <div key={idx} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                <span>{review.date || '日付不明'}</span>
                <span>★{review.rating.toFixed(1)}</span>
              </div>
              {review.title && <div className="mt-1 text-sm font-medium text-gray-900">{review.title}</div>}
              <p className="mt-1 text-xs leading-5 text-gray-600">
                {review.body.length > 200 ? `${review.body.slice(0, 200)}...` : review.body}
              </p>
            </div>
          ))}
          {matchingReviews.length > 3 && (
            <button
              onClick={() => setExpandedReviews(!expandedReviews)}
              className="text-xs text-blue-500 hover:underline"
            >
              {expandedReviews ? '閉じる' : `他 ${matchingReviews.length - 3}件を見る`}
            </button>
          )}
        </div>
      )}
      {showReviews && matchingReviews.length === 0 && (
        <p className="mt-2 text-xs text-gray-400">該当するレビューが見つかりませんでした。</p>
      )}
    </div>
  )
}

export default function Dashboard() {
  const searchParams = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [loadingReportId, setLoadingReportId] = useState<string | null>(null)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [reviewContext, setReviewContext] = useState<ReviewContext | null>(null)
  const [activeTab, setActiveTab] = useState<'products' | 'report'>('products')
  const [editingCategories, setEditingCategories] = useState(false)
  const [editingPoxGuidance, setEditingPoxGuidance] = useState(false)
  const [analysisDepth, setAnalysisDepth] = useState<'focused' | 'standard' | 'deep'>('standard')
  const [categoryEditorValues, setCategoryEditorValues] = useState<CategoryEditorValue[]>([])
  const [poxGuidanceInput, setPoxGuidanceInput] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('custom')
  const [notesInput, setNotesInput] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesMessage, setNotesMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [selectedAsins, setSelectedAsins] = useState<Set<string>>(new Set())
  const router = useRouter()
  const [expandedEvidenceCategories, setExpandedEvidenceCategories] = useState<Set<number>>(new Set())
  const [selectedReviewStar, setSelectedReviewStar] = useState<'all' | 5 | 4 | 3 | 2 | 1>('all')
  const [visibleReviewCount, setVisibleReviewCount] = useState(5)
  const [userApiKey, setUserApiKey] = useState('')
  const [apiKeyStatus, setApiKeyStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const [showSettings, setShowSettings] = useState(false)
  const [userInfo, setUserInfo] = useState<{
    user: { id: string; email: string; plan: 'free' | 'standard'; hasStripe: boolean }
    usage: { current: number; limit: number }
    planConfig: { compareLimit: number; byokAllowed: boolean; depths: string[] }
  } | null>(null)

  // ユーザー情報・使用量取得
  useEffect(() => {
    fetch('/api/user').then(r => r.ok ? r.json() : null).then(d => {
      if (d) setUserInfo(d)
    })
  }, [])

  // localStorageからAPIキーを復元
  useEffect(() => {
    const saved = localStorage.getItem('reviewai_api_key')
    if (saved) {
      setUserApiKey(saved)
      validateApiKey(saved)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const validateApiKey = async (key: string) => {
    if (!key || !key.startsWith('sk-ant-')) {
      setApiKeyStatus('invalid')
      return
    }
    setApiKeyStatus('checking')
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      })
      setApiKeyStatus(res.ok ? 'valid' : 'invalid')
    } catch {
      setApiKeyStatus('invalid')
    }
  }

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(d => setProducts(d.products))
  }, [])

  const prevReportAsinRef = useRef<string | null>(null)
  useEffect(() => {
    if (!report) return
    // 同じASINのreport更新（カテゴリ名変更等）ではエディタをリセットしない
    if (prevReportAsinRef.current === report.asin) {
      setPoxGuidanceInput(report.poxGuidance || '')
      setAnalysisDepth(report.analysisDepth || 'standard')
      setNotesInput(report.notes || '')
      return
    }
    prevReportAsinRef.current = report.asin
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
    setPoxGuidanceInput(report.poxGuidance || '')
    setAnalysisDepth(report.analysisDepth || 'standard')
    setNotesInput(report.notes || '')
  }, [report])

  useEffect(() => {
    setVisibleReviewCount(5)
  }, [selectedReviewStar, report?.asin])

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
          setReviewContext(reportData.reviewContext || null)
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
      setReport(normalizeReport(data.report))
      setReviewContext(data.reviewContext || null)
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
  const totalRatingsCount = reviewContext?.totalReviews || currentReportProduct?.totalReviews || 0
  const reviewListCount = reviewContext?.reviewListCount || 0
  const averageRating = reviewContext?.averageRating || currentReportProduct?.averageRating || 0
  const reviewCoverageRate = reviewListCount > 0 && report
    ? ((report.totalReviewsAnalyzed / reviewListCount) * 100).toFixed(1)
    : null
  const ratingBreakdown = reviewContext?.ratingBreakdown || {}
  const starFetchStats = reviewContext?.starFetchStats || {}
  const fetchedReviews = reviewContext?.reviews || []
  const hasRatingDistribution = Object.values(ratingBreakdown).some((value) => Number(value) > 0)
  const ratingDistribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    percent: totalRatingsCount > 0 ? Math.round(((ratingBreakdown[star] || 0) / totalRatingsCount) * 100) : 0,
  }))
  const negativeRate = ratingDistribution
    .filter((item) => item.star <= 3)
    .reduce((sum, item) => sum + item.percent, 0)
  const ratingSummary = totalRatingsCount > 0 && hasRatingDistribution
    ? (
      ratingDistribution[0].percent >= 50 && negativeRate < 30
        ? '高評価が過半で、全体としては好意的に受け止められています。'
        : negativeRate >= 35
          ? '高評価だけでなく低評価も一定数あり、評価はやや割れています。'
          : '高評価が優勢ですが、一部に不満もあり評価は中程度に安定しています。'
    )
    : '評価分布データが不足しています。'
  const displayPainPoints = report
    ? report.painPoints
      .map((pain) => ({ ...pain, displayTitle: getDisplayTopicLabel(pain.title) }))
      .filter((pain) => pain.displayTitle !== '抽出語の精度不足')
    : []
  const displaySatisfactionPoints = report
    ? report.satisfactionPoints
      .map((sat) => ({ ...sat, displayTitle: getDisplayTopicLabel(sat.title) }))
      .filter((sat) => sat.displayTitle !== '抽出語の精度不足')
    : []
  const reviewBrowserTabs: Array<{ key: 'all' | 5 | 4 | 3 | 2 | 1; label: string; count: number }> = [
    { key: 'all', label: 'すべて', count: fetchedReviews.length },
    { key: 5, label: '★5', count: fetchedReviews.filter((review) => review.rating >= 4.5).length },
    { key: 4, label: '★4', count: fetchedReviews.filter((review) => review.rating >= 3.5 && review.rating < 4.5).length },
    { key: 3, label: '★3', count: fetchedReviews.filter((review) => review.rating >= 2.5 && review.rating < 3.5).length },
    { key: 2, label: '★2', count: fetchedReviews.filter((review) => review.rating >= 1.5 && review.rating < 2.5).length },
    { key: 1, label: '★1', count: fetchedReviews.filter((review) => review.rating < 1.5).length },
  ]
  const filteredFetchedReviews = fetchedReviews.filter((review) => {
    if (selectedReviewStar === 'all') return true
    if (selectedReviewStar === 5) return review.rating >= 4.5
    if (selectedReviewStar === 4) return review.rating >= 3.5 && review.rating < 4.5
    if (selectedReviewStar === 3) return review.rating >= 2.5 && review.rating < 3.5
    if (selectedReviewStar === 2) return review.rating >= 1.5 && review.rating < 2.5
    return review.rating < 1.5
  })
  const visibleFetchedReviews = filteredFetchedReviews.slice(0, visibleReviewCount)
  const starCoverageRows: Array<{ key: 'five_star' | 'four_star' | 'three_star' | 'two_star' | 'one_star'; label: string }> = [
    { key: 'five_star', label: '★5' },
    { key: 'four_star', label: '★4' },
    { key: 'three_star', label: '★3' },
    { key: 'two_star', label: '★2' },
    { key: 'one_star', label: '★1' },
  ]

  const exportFetchedReviewsCsv = () => {
    if (!filteredFetchedReviews.length || !report) return

    const rows = [
      ['rating', 'date', 'title', 'body'],
      ...filteredFetchedReviews.map((review) => [
        String(review.rating),
        review.date || '',
        review.title || '',
        review.body || '',
      ]),
    ]

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${report.asin}-${selectedReviewStar === 'all' ? 'all' : `star-${selectedReviewStar}`}-reviews.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const categoryNameSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveCategoryNames = useCallback(async (asin: string, values: CategoryEditorValue[]) => {
    try {
      await fetch('/api/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin,
          categoryNames: values.map((v, i) => ({ index: i, name: v.name })),
        }),
      })
    } catch {
      // サイレントに失敗（次回の保存で上書き）
    }
  }, [])

  const updateCategoryName = (index: number, category: string) => {
    setCategoryEditorValues((current) => {
      const updated = current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, name: category } : item
      )

      // debounce付きでAPI保存
      if (report) {
        if (categoryNameSaveTimer.current) clearTimeout(categoryNameSaveTimer.current)
        categoryNameSaveTimer.current = setTimeout(() => {
          saveCategoryNames(report.asin, updated)
        }, 800)
      }

      return updated
    })

    // reportのcategoryBreakdownも即座に更新（表示に反映）
    if (report) {
      setReport((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          categoryBreakdown: prev.categoryBreakdown.map((item, i) =>
            i === index ? { ...item, category } : item
          ),
          categoryFramework: (prev.categoryFramework || []).map((item, i) =>
            i === index ? { ...item, name: category } : item
          ),
        }
      })
    }
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
          poxGuidance: poxGuidanceInput,
          analysisDepth,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '再分析に失敗しました')
      }
      prevReportAsinRef.current = null // 再分析後はエディタもリセット
      setReport(normalizeReport(data.report))
      setEditingCategories(false)
      setEditingPoxGuidance(false)
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

  const saveNotes = async () => {
    if (!report) return

    setSavingNotes(true)
    setNotesMessage(null)
    try {
      const res = await fetch('/api/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: report.asin,
          notes: notesInput,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'メモの保存に失敗しました')
      }
      setReport(normalizeReport(data.report))
      setNotesMessage('メモを保存しました')
      window.setTimeout(() => setNotesMessage(null), 2000)
    } catch (err) {
      setNotesMessage(err instanceof Error ? err.message : 'メモの保存に失敗しました')
      window.setTimeout(() => setNotesMessage(null), 2500)
    }
    setSavingNotes(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 text-[15px]">
      <style jsx global>{`
        .text-xs { font-size: 13px !important; line-height: 1.5 !important; }
        .text-sm { font-size: 14.5px !important; line-height: 1.6 !important; }
        .text-\\[11px\\] { font-size: 12.5px !important; line-height: 1.5 !important; }
        .text-\\[10px\\] { font-size: 12px !important; line-height: 1.5 !important; }
        @page {
          size: A4;
          margin: 12mm;
        }

        @media print {
          html,
          body {
            background: white !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
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

          .print-report-header {
            padding: 14pt !important;
            border-color: #d1d5db !important;
          }

          .print-kpi-grid {
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 8pt !important;
            margin-top: 12pt !important;
          }

          .print-kpi-grid > div,
          .print-rating-overview > div {
            background: white !important;
            border-color: #d1d5db !important;
          }

          .print-rating-overview {
            display: grid !important;
            grid-template-columns: 200pt 1fr !important;
            gap: 10pt !important;
            margin-top: 12pt !important;
          }

          .print-section-card {
            padding: 14pt !important;
          }

          .print-pox-section {
            padding: 14pt !important;
            break-before: auto;
          }

          .print-pox-group {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .print-section-title {
            font-size: 15pt !important;
            line-height: 1.3 !important;
          }

          .print-subtle {
            color: #6b7280 !important;
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
            <h1 className="text-2xl font-bold text-gray-900">Amazon Voice Lab</h1>
            <p className="text-sm text-gray-500">Amazonレビューを、商品企画と訴求設計に活かす</p>
          </div>
          <div className="flex items-center gap-3">
            {userInfo && (
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 text-xs font-medium rounded-full ${userInfo.user.plan === 'standard' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-600'}`}>
                  {userInfo.user.plan === 'standard' ? 'Standard' : 'Free'}
                </span>
                <div className="flex items-center gap-1.5" title={`今月 ${userInfo.usage.current}/${userInfo.usage.limit} 回使用`}>
                  <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${userInfo.usage.current >= userInfo.usage.limit ? 'bg-red-500' : userInfo.usage.current >= userInfo.usage.limit * 0.8 ? 'bg-amber-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.min(100, (userInfo.usage.current / userInfo.usage.limit) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">{userInfo.usage.current}/{userInfo.usage.limit}</span>
                </div>
              </div>
            )}
            {!userInfo && (
              <span className="px-3 py-1 bg-gray-100 text-gray-500 text-xs font-medium rounded-full">
                読込中...
              </span>
            )}
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
                    const val = e.target.value
                    setUserApiKey(val)
                    if (val) {
                      localStorage.setItem('reviewai_api_key', val)
                      setApiKeyStatus('idle')
                    } else {
                      localStorage.removeItem('reviewai_api_key')
                      setApiKeyStatus('idle')
                    }
                  }}
                  onBlur={() => { if (userApiKey) validateApiKey(userApiKey) }}
                  placeholder="sk-ant-... (入力するとBYOKモード: 自分のキーで無制限分析)"
                  className={`flex-1 px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    apiKeyStatus === 'invalid' ? 'border-red-300 bg-red-50' :
                    apiKeyStatus === 'valid' ? 'border-green-300' : 'border-gray-300'
                  }`}
                />
                {userApiKey && (
                  <span className={`text-xs font-medium whitespace-nowrap ${
                    apiKeyStatus === 'checking' ? 'text-gray-400' :
                    apiKeyStatus === 'valid' ? 'text-green-600' :
                    apiKeyStatus === 'invalid' ? 'text-red-500' : 'text-gray-400'
                  }`}>
                    {apiKeyStatus === 'checking' ? '確認中...' :
                     apiKeyStatus === 'valid' ? '有効' :
                     apiKeyStatus === 'invalid' ? '無効なキーです' : '未確認'}
                  </span>
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
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-gray-900">収集済みレポート</h2>
                {products.filter((p) => p.lastAnalyzedAt).length > 1 && (
                  <button
                    onClick={() => {
                      const analyzedAsins = products.filter((p) => p.lastAnalyzedAt).map((p) => p.asin)
                      const allSelected = analyzedAsins.every((a) => selectedAsins.has(a))
                      if (allSelected) {
                        setSelectedAsins(new Set())
                      } else {
                        setSelectedAsins(new Set(analyzedAsins))
                      }
                    }}
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                  >
                    {products.filter((p) => p.lastAnalyzedAt).every((p) => selectedAsins.has(p.asin))
                      ? '全解除'
                      : '全選択'}
                  </button>
                )}
              </div>
              <p className="text-sm text-gray-500">
                Amazon 上でレビュー取得と分析を完了した商品だけがここに表示されます。
              </p>
            </div>

            {/* Product List */}
            <div className="space-y-3">
              {products.map(product => {
                const isSelected = selectedAsins.has(product.asin)
                const canSelect = !!product.lastAnalyzedAt
                return (
                <div key={product.id} className={`bg-white rounded-xl border p-5 ${isSelected ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!canSelect}
                        onChange={() => {
                          setSelectedAsins(prev => {
                            const next = new Set(prev)
                            if (next.has(product.asin)) {
                              next.delete(product.asin)
                            } else {
                              next.add(product.asin)
                            }
                            return next
                          })
                        }}
                        title={!canSelect ? '先に分析を実行してください' : ''}
                        className="h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-30"
                      />
                      <div className="min-w-0">
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
                        {product.price && (
                          <span className="text-xs text-gray-500">¥{product.price.toLocaleString()}</span>
                        )}
                        {product.lastAnalyzedAt && (
                          <span className="text-xs text-gray-400">
                            最終分析: {new Date(product.lastAnalyzedAt).toLocaleDateString('ja-JP')}
                          </span>
                        )}
                      </div>
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
                )
              })}
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
            <div className="print-report-header bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
              <div className="mb-2">
                <h2 className="print-section-title text-xl font-bold text-gray-900">{report.productName}</h2>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="print-subtle text-sm text-gray-500 font-mono">ASIN: {report.asin}</p>
                <span className="print-subtle text-xs text-gray-400">
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
              <div className="print-kpi-grid grid gap-3 md:grid-cols-4 mt-4">
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs text-gray-500 mb-1">販売価格</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {currentReportProduct?.price ? `¥${currentReportProduct.price.toLocaleString()}` : '未取得'}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs text-gray-500 mb-1">総評価数（星のみ含む）</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {totalRatingsCount > 0 ? `${totalRatingsCount}件` : '不明'}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs text-gray-500 mb-1">レビュー一覧件数</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {reviewListCount > 0 ? `${reviewListCount}件` : '未取得'}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs text-gray-500 mb-1">今回分析したレビュー</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {report.totalReviewsAnalyzed}件
                  </div>
                  {reviewCoverageRate && (
                    <div className="mt-1 text-xs text-gray-500">一覧に対して {reviewCoverageRate}% を分析</div>
                  )}
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="font-medium">取得上限の注意</div>
                <p className="mt-1">
                  Amazon の仕様上、各星評価フィルタごとに最大約 100 件を上限として収集しています。分析はその範囲で取得できたレビューに基づいています。
                </p>
                {starCoverageRows.some(({ key }) => (starFetchStats[key]?.available || 0) > 0) && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    {starCoverageRows.map(({ key, label }) => {
                      const stat = starFetchStats[key]
                      if (!stat || stat.available <= 0) return null
                      return (
                        <div key={key} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-gray-700">
                          <div className="font-medium text-gray-900">{label}</div>
                          <div className="mt-1">{stat.fetched} / {stat.available}件を取得</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="print-rating-overview mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs text-gray-500 mb-1">平均評価</div>
                  <div className="flex items-end gap-2">
                    <div className="text-3xl font-bold text-gray-900">
                      {averageRating > 0 ? averageRating.toFixed(1) : '-'}
                    </div>
                    <div className="pb-1 text-sm text-gray-500">/ 5.0</div>
                  </div>
                  <div className="mt-2 text-sm text-amber-500">
                    {'★'.repeat(Math.round(averageRating || 0))}
                    <span className="ml-2 text-gray-500">{totalRatingsCount > 0 ? `${totalRatingsCount}件の評価` : '評価件数不明'}</span>
                  </div>
                  <p className="mt-3 text-xs text-gray-500">
                    {ratingSummary}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">星評価の分布</h3>
                    <span className="text-xs text-gray-400">Amazon上の全評価ベース</span>
                  </div>
                  {hasRatingDistribution ? (
                    <div className="space-y-3">
                      {ratingDistribution.map((item) => (
                        <div key={item.star} className="grid grid-cols-[56px_1fr_44px] items-center gap-3">
                          <div className="text-sm text-gray-600">星{item.star}</div>
                          <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                              style={{ width: `${item.percent}%` }}
                            />
                          </div>
                          <div className="text-right text-sm font-medium text-gray-700">{item.percent}%</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                      星評価の分布データを取得できていません。再取得後に反映されます。
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="print:hidden bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">取得済みレビュー</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    実際に収集できたレビュー本文を星別に確認できます。全件はCSVでダウンロードできます。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-sm text-gray-500">
                    {filteredFetchedReviews.length}件表示対象
                  </div>
                  <button
                    onClick={exportFetchedReviewsCsv}
                    disabled={filteredFetchedReviews.length === 0}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    CSV出力
                  </button>
                </div>
              </div>
              <div className="mb-4 flex flex-wrap gap-2">
                {reviewBrowserTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setSelectedReviewStar(tab.key)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      selectedReviewStar === tab.key
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>
              {visibleFetchedReviews.length > 0 ? (
                <div className="space-y-3">
                  {visibleFetchedReviews.map((review, index) => {
                    const reviewKey = `${review.date}-${review.title}-${index}`
                    const bodyPreview = review.body.length > 90 ? `${review.body.slice(0, 90)}...` : review.body

                    return (
                      <div key={reviewKey} className="rounded-lg border border-gray-200 px-4 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-900">
                            {getReviewCardHeading(review, '取得済みレビュー')}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                            <span>{review.date || '日付不明'}</span>
                            <span>★{review.rating.toFixed(1)}</span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                            {bodyPreview}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                  {visibleFetchedReviews.length < filteredFetchedReviews.length && (
                    <p className="pt-2 text-xs text-gray-400">
                      他 {filteredFetchedReviews.length - visibleFetchedReviews.length}件はCSVでダウンロードできます
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                  この条件に該当する取得済みレビューはありません。
                </div>
              )}
            </div>

            {/* Category Breakdown */}
            <div className="print-section-card print-pox-section bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
              <div className="mb-4">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-lg font-semibold text-gray-900">レビュー構造化分析</h3>
                  <div className="flex shrink-0 items-center gap-2">
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
                      className="whitespace-nowrap rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      {editingCategories ? '観点調整を閉じる' : '分析観点を調整'}
                    </button>
                    {editingCategories && (
                      <button
                        onClick={rerunAnalysisWithCategories}
                        disabled={reanalyzing}
                        className="whitespace-nowrap rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                      >
                        {reanalyzing ? '再分析中...' : 'この観点で再分析'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 rounded-lg bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-600">
                  <p>購入者がこの商品のどこに注目しているかを、4つの観点に分けて可視化しています。言及率が高い観点ほど、商品ページの訴求や改善で優先すべき領域です。</p>
                  <p className="mt-1"><strong>観点名</strong>はそのまま編集・保存できます。<strong>AIへの指示</strong>を変更した場合は「分析観点を調整」→「この観点で再分析」を押すと、新しい指示でAIが分析し直します。</p>
                </div>
              </div>
              <div className="mb-6 rounded-xl border border-gray-100 bg-gradient-to-br from-slate-50 to-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">レビュー論点の分布</h4>
                    <p className="text-xs text-gray-500">どの観点に言及が集まっているかを比較</p>
                    <p className="mt-1 text-[11px] text-gray-400">
                      言及割合 = 分析対象レビューのうち、この観点に触れているレビューの割合
                    </p>
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
                {(() => {
                  const usedKeys = new Set<string>()
                  return report.categoryBreakdown.map((cat, i) => {
                  const categoryDescription = report.categoryFramework[i]?.description
                  const evidenceReviews = getCategoryEvidenceReviews(
                    fetchedReviews,
                    cat.category,
                    categoryDescription,
                    cat.topMentions,
                    usedKeys
                  )
                  evidenceReviews.forEach((r) => usedKeys.add(`${r.date}|${r.title}|${r.body?.slice(0, 50)}`))

                  return (
                  <div key={i} className="border border-gray-100 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      {editingCategories ? (
                        <div className="flex-1 pr-3">
                          <label className="mb-1 block text-[11px] font-semibold text-gray-400">観点名（変更可）</label>
                          <input
                            type="text"
                            value={categoryEditorValues[i]?.name ?? cat.category}
                            onChange={(e) => updateCategoryName(i, e.target.value)}
                            className="w-full max-w-full rounded border border-gray-300 px-2 py-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      ) : (
                        <span className="font-medium text-sm">{cat.category}</span>
                      )}
                      <span className="text-sm font-bold text-blue-600">{cat.mentionRate}%</span>
                    </div>
                    <p className="mb-3 text-xs text-gray-500">
                      分析した {report.totalReviewsAnalyzed} 件中、{cat.mentionCount} 件のレビューでこの観点への言及がありました。
                    </p>
                    {editingCategories && (
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-gray-400">AIへの指示（この観点で何を分析するか）</label>
                        <textarea
                          value={categoryEditorValues[i]?.description || ''}
                          onChange={(e) => updateCategoryDescription(i, e.target.value)}
                          placeholder="例: サイズ・素材・対応機種など購入前に確認する仕様情報"
                          className="mb-3 min-h-16 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}
                    <div>
                      <div className="mb-2 text-[11px] font-semibold tracking-wide text-gray-500">根拠として拾ったレビュー例</div>
                      {evidenceReviews.length > 0 ? (
                        <div className="space-y-2">
                          {evidenceReviews.slice(0, expandedEvidenceCategories.has(i) ? evidenceReviews.length : 3).map((review, reviewIndex) => {
                            const bodyPreview = review.body.length > 88 ? `${review.body.slice(0, 88)}...` : review.body

                            return (
                              <div key={`${review.date}-${reviewIndex}`} className="rounded-lg border border-gray-100 bg-white px-3 py-2">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                                  <span>{review.date || '日付不明'}</span>
                                  <span>★{review.rating.toFixed(1)}</span>
                                </div>
                                <div className="mt-1 text-sm font-medium text-gray-900">
                                  {getReviewCardHeading(review, 'レビュー抜粋')}
                                </div>
                                <p className="mt-1 text-sm leading-6 text-gray-700">
                                  {bodyPreview}
                                </p>
                              </div>
                            )
                          })}
                          {evidenceReviews.length > 3 && (
                            <button
                              onClick={() => setExpandedEvidenceCategories((prev) => {
                                const next = new Set(prev)
                                if (next.has(i)) { next.delete(i) } else { next.add(i) }
                                return next
                              })}
                              className="text-xs text-blue-500 hover:underline"
                            >
                              {expandedEvidenceCategories.has(i) ? '閉じる' : `他 ${evidenceReviews.length - 3}件を見る`}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
                          この観点に対応づけた代表レビューを表示できませんでした。
                        </div>
                      )}
                    </div>
                  </div>
                  )
                })
                  })()}
              </div>
            </div>

            {/* POX Analysis */}
            <div className="print-section-card bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
              <div className="mb-4">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-lg font-semibold text-gray-900">POX分析</h3>
                  <button
                    onClick={() => setEditingPoxGuidance((prev) => !prev)}
                    className="shrink-0 whitespace-nowrap rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    {editingPoxGuidance ? 'POX調整を閉じる' : 'POX観点を調整'}
                  </button>
                </div>
                <div className="mt-2 rounded-lg bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-600">
                  <p><strong>POD（差別化ポイント）</strong>＝ 競合にない、この商品ならではの強み。ここを伸ばすと選ばれる理由になります。</p>
                  <p className="mt-1"><strong>POP（必須ポイント）</strong>＝ 買い手が当然あると期待する機能・品質。欠けると即マイナス評価につながります。</p>
                  <p className="mt-1"><strong>POF（許容ポイント）</strong>＝ なくても購入判断に大きく影響しない要素。コスト削減や仕様簡素化の候補です。</p>
                  <p className="mt-2 text-gray-500">「POX観点を調整」から、ご自身の視点でAIに再分類させることもできます。</p>
                </div>
              </div>
              {editingPoxGuidance && (
                <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                  <label className="mb-2 block text-sm font-medium text-gray-800">
                    POX分析への追加指示
                  </label>
                  <textarea
                    value={poxGuidanceInput}
                    onChange={(e) => setPoxGuidanceInput(e.target.value)}
                    placeholder="例: POFはコストカット候補ではなく、購入障壁になりにくい要素として見たい。PODは競合比較を強めに評価したい。"
                    className="min-h-24 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={rerunAnalysisWithCategories}
                      disabled={reanalyzing}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {reanalyzing ? '再分析中...' : 'このPOX観点で再分析'}
                    </button>
                  </div>
                </div>
              )}
              <div className="space-y-6">
                {/* POD */}
                <div className="print-pox-group">
                  <div className="mb-3">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-blue-600 text-white text-xs font-bold rounded">POD</span>
                      <span className="text-sm font-medium text-gray-700">Point of Difference - 独自優位性候補</span>
                    </div>
                    <p className="mt-1 ml-10 text-xs text-gray-400">競合の不満を解決できれば差別化になる要素。ここに開発リソースを集中させる</p>
                  </div>
                  <div className="space-y-3">
                    {report.poxAnalysis.pod.map((item, i) => (
                      <PoxItemCard key={i} item={item} borderColor="border-blue-300" reviews={fetchedReviews} />
                    ))}
                  </div>
                </div>

                {/* POP */}
                <div className="print-pox-group">
                  <div className="mb-3">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-gray-600 text-white text-xs font-bold rounded">POP</span>
                      <span className="text-sm font-medium text-gray-700">Point of Parity - カテゴリ必須機能</span>
                    </div>
                    <p className="mt-1 ml-10 text-xs text-gray-400">このカテゴリで当然あるべき機能。欠けると即離脱されるため確実に押さえる</p>
                  </div>
                  <div className="space-y-3">
                    {report.poxAnalysis.pop.map((item, i) => (
                      <PoxItemCard key={i} item={item} borderColor="border-gray-300" reviews={fetchedReviews} />
                    ))}
                  </div>
                </div>

                {/* POF */}
                <div className="print-pox-group">
                  <div className="mb-3">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-orange-500 text-white text-xs font-bold rounded">POF</span>
                      <span className="text-sm font-medium text-gray-700">Point of Failure - 戦略的妥協候補</span>
                    </div>
                    <p className="mt-1 ml-10 text-xs text-gray-400">顧客がそこまで重視していない要素。コストカットや仕様簡素化の判断材料になる</p>
                  </div>
                  <div className="space-y-3">
                    {report.poxAnalysis.pof.map((item, i) => (
                      <PoxItemCard key={i} item={item} borderColor="border-orange-300" reviews={fetchedReviews} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

              {/* 商品改善のヒント - 全幅 */}
              <div className="print-section-card bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
                <h3 className="text-lg font-semibold text-gray-900">商品改善のヒント</h3>
                <p className="mb-4 text-xs text-gray-500">
                  「〜があれば」「〜だったら」というレビュー中の要望から、改善につながる顧客の声を抽出しています。商品開発や機能追加の優先度付けに活用できます。
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  {normalizeUnmetNeeds(report.unmetNeeds).map((item, i) => (
                    <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`shrink-0 whitespace-nowrap text-xs px-1.5 py-0.5 rounded ${severityStyles[item.importance]}`}>
                          {item.importance === 'high' ? '重要度 高' : item.importance === 'medium' ? '重要度 中' : '重要度 低'}
                        </span>
                        <p className="text-sm font-medium text-gray-900">{item.need}</p>
                      </div>
                      {item.evidence && (
                        <p className="mt-2 text-xs leading-5 text-gray-500">{item.evidence}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 満足・不満・価格 3列 */}
              <div className="grid md:grid-cols-3 gap-6">
              {/* Satisfaction Points */}
              <div className="print-section-card bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
                <h3 className="text-base font-semibold text-gray-900">満足 TOP5</h3>
                <p className="mb-3 text-xs text-gray-500">
                  高評価レビューで繰り返し出た満足テーマです。
                </p>
                {displaySatisfactionPoints.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-400">抽出された満足テーマ</div>
                    {displaySatisfactionPoints.map((sat, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500 w-5">{i + 1}.</span>
                          <span className="text-sm">{sat.displayTitle}</span>
                        </div>
                        <span className="shrink-0 text-xs text-gray-400">{sat.count}件</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-500">
                      満足テーマを安定して抽出できていません。代わりに代表的な高評価レビューを表示しています。
                    </div>
                    {(reviewContext?.highRatingReviews || []).length > 0 ? (
                      <div className="space-y-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-gray-400">代表的な高評価レビュー</div>
                        {(reviewContext?.highRatingReviews || []).slice(0, 3).map((review, i) => (
                          <div key={i} className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-gray-900">{getReviewCardHeading(review, '高評価レビュー')}</span>
                              <span className="text-xs text-emerald-600">★{review.rating}</span>
                            </div>
                            <p className="text-sm text-gray-600">
                              {review.body.length > 110 ? `${review.body.slice(0, 110)}...` : review.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/30 px-4 py-3 text-sm text-gray-500">
                        高評価レビューが十分に見つかっていません。
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Pain Points */}
              <div className="print-section-card bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
                <h3 className="text-base font-semibold text-gray-900">不満 TOP5</h3>
                <p className="mb-3 text-xs text-gray-500">
                  低評価レビューで繰り返し出た不満テーマです。
                </p>
                {displayPainPoints.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-400">抽出された不満テーマ</div>
                    {displayPainPoints.map((pain, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500 w-5">{i + 1}.</span>
                          <span className="text-sm">{pain.displayTitle}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-gray-400">{pain.count}件</span>
                          <span className={`whitespace-nowrap text-xs px-1.5 py-0.5 rounded ${severityStyles[pain.severity]}`}>
                            {pain.severity === 'high' ? '深刻' : pain.severity === 'medium' ? '中程度' : '軽微'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-500">
                      不満テーマを安定して抽出できていません。代わりに代表的な低評価レビューを表示しています。
                    </div>
                    {(reviewContext?.lowRatingReviews || []).length > 0 ? (
                      <div className="space-y-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-gray-400">代表的な低評価レビュー</div>
                        {(reviewContext?.lowRatingReviews || []).slice(0, 3).map((review, i) => (
                          <div key={i} className="rounded-lg border border-red-100 bg-red-50/40 p-3">
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-gray-900">{getReviewCardHeading(review, '低評価レビュー')}</span>
                              <span className="text-xs text-red-600">★{review.rating}</span>
                            </div>
                            <p className="text-sm text-gray-600">
                              {review.body.length > 110 ? `${review.body.slice(0, 110)}...` : review.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-red-200 bg-red-50/30 px-4 py-3 text-sm text-gray-500">
                        低評価レビューがほとんど見つかっていません。
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Price Sentiment */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
                <h3 className="text-base font-semibold text-gray-900">価格に対する印象</h3>
                <p className="mb-3 text-xs text-gray-500">
                  価格に触れているレビューを3方向に整理した目安です。
                </p>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-red-600">割高に感じる</span>
                      <span className="font-medium">{report.priceSentiment.expensive}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="bg-red-400 h-2 rounded-full" style={{ width: `${report.priceSentiment.expensive}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-yellow-600">おおむね妥当</span>
                      <span className="font-medium">{report.priceSentiment.reasonable}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="bg-yellow-400 h-2 rounded-full" style={{ width: `${report.priceSentiment.reasonable}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-green-600">コスパが良い</span>
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
            <div className="print-section-card bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
              <h3 className="text-lg font-semibold text-gray-900">レビューから導く改善施策</h3>
              <p className="mb-4 text-xs text-gray-500">
                分析結果をもとに、商品ページ・商品設計・訴求の観点から具体的な改善施策を提案しています。
              </p>
              <div className="space-y-3">
                {normalizeActions(report.actionRecommendations).slice(0, 3).map((item, i) => (
                  <div key={i} className="flex gap-3 items-start rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                    <span className="flex-shrink-0 mt-0.5 w-6 h-6 bg-blue-100 text-blue-700 text-xs font-bold rounded-full flex items-center justify-center">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {item.category && item.category !== '改善施策' && (
                          <span className="shrink-0 whitespace-nowrap rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">{item.category}</span>
                        )}
                        <p className="text-sm font-medium text-gray-900">{item.action}</p>
                      </div>
                      {item.reason && (
                        <p className="mt-1.5 text-xs leading-5 text-gray-500">{item.reason}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="print-section-card bg-white rounded-xl border border-gray-200 p-6 break-inside-avoid">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">メモ</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    レポートを見ながら、仮説や次の確認事項を商品ごとに残せます。
                  </p>
                </div>
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="print:hidden rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {savingNotes ? '保存中...' : 'メモを保存'}
                </button>
              </div>
              <textarea
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                placeholder="例: 装着時の不安レビューがある。商品ページに図解を入れる余地あり。競合比較では8cm対応の明確さを強めたい。"
                className="min-h-32 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  レポートごとに保存され、次回開いたときも復元されます。
                </span>
                {notesMessage && <span className="text-xs text-gray-500">{notesMessage}</span>}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'report' && !report && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-1">分析レポートがありません</p>
            <p className="text-sm">レポート一覧から商品を選ぶと、分析結果を表示できます。</p>
          </div>
        )}
      </main>

      {/* フローティング比較バー */}
      {selectedAsins.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-50 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-3 shadow-lg">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <span className="text-sm text-gray-700">
              <span className="font-semibold text-blue-600">{selectedAsins.size}</span> 商品を選択中
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedAsins(new Set())}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 transition-colors"
              >
                クリア
              </button>
              <button
                onClick={async () => {
                  if (!confirm(`${selectedAsins.size}件のレポートを削除しますか？この操作は取り消せません。`)) return
                  const idsToDelete = products
                    .filter((p) => selectedAsins.has(p.asin))
                    .map((p) => p.id)
                  await Promise.all(idsToDelete.map((id) => fetch(`/api/products/${id}`, { method: 'DELETE' })))
                  setProducts((prev) => prev.filter((p) => !selectedAsins.has(p.asin)))
                  setSelectedAsins(new Set())
                }}
                className="rounded-lg bg-red-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 transition-colors"
              >
                まとめて削除
              </button>
              <button
                onClick={() => router.push(`/dashboard/compare?asins=${Array.from(selectedAsins).join(',')}`)}
                disabled={selectedAsins.size < 2 || selectedAsins.size > (userInfo?.planConfig.compareLimit ?? 5)}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-40"
              >
                {selectedAsins.size > (userInfo?.planConfig.compareLimit ?? 5) ? `比較は最大${userInfo?.planConfig.compareLimit ?? 5}商品` : '比較する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

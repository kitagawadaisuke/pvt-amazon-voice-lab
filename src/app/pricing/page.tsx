'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface UserInfo {
  user: { plan: 'free' | 'standard' } | null
}

const FEATURES = [
  {
    label: '月間分析回数',
    free: '3回',
    standard: '30回',
  },
  {
    label: '上限超過後',
    free: '分析不可',
    standard: '自分のAPIキーで無制限',
  },
  {
    label: '同時比較商品数',
    free: '2商品',
    standard: '5商品',
  },
  {
    label: '分析モード',
    free: '標準のみ',
    standard: '標準・詳細・深掘り全モード',
  },
  {
    label: '自分のAPIキーで利用',
    free: false,
    standard: true,
  },
]

export default function PricingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [userInfo, setUserInfo] = useState<UserInfo>({ user: null })

  useEffect(() => {
    fetch('/api/user').then(r => r.ok ? r.json() : { user: null }).then(setUserInfo)
  }, [])

  const handleUpgrade = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      setLoading(false)
    }
  }

  const currentPlan = userInfo.user?.plan || null

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">料金プラン</h1>
          <p className="mt-3 text-zinc-500 dark:text-zinc-400">
            まずは無料で試して、必要になったらアップグレード
          </p>
        </div>

        {/* Comparison Table */}
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {/* Header */}
          <div className="grid grid-cols-3 border-b border-zinc-200 dark:border-zinc-800">
            <div className="px-6 py-5" />
            <div className={`px-6 py-5 text-center ${currentPlan === 'free' ? 'bg-blue-50/60 dark:bg-blue-950/20' : ''}`}>
              <div className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Free</div>
              <div className="mt-1">
                <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">¥0</span>
                <span className="text-sm text-zinc-500">/月</span>
              </div>
              {currentPlan === 'free' && (
                <span className="mt-2 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
                  現在のプラン
                </span>
              )}
            </div>
            <div className={`relative px-6 py-5 text-center ${currentPlan === 'standard' ? 'bg-purple-50/60 dark:bg-purple-950/20' : 'bg-purple-50/30 dark:bg-purple-950/10'}`}>
              <div className="absolute -top-px left-0 right-0 h-0.5 bg-purple-500" />
              <div className="text-sm font-medium text-purple-600 dark:text-purple-400">Standard</div>
              <div className="mt-1">
                <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">¥980</span>
                <span className="text-sm text-zinc-500">/月</span>
              </div>
              {currentPlan === 'standard' ? (
                <span className="mt-2 inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-600 dark:bg-purple-900/40 dark:text-purple-400">
                  現在のプラン
                </span>
              ) : (
                <span className="mt-2 inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-600 dark:bg-purple-900/40 dark:text-purple-400">
                  おすすめ
                </span>
              )}
            </div>
          </div>

          {/* Feature Rows */}
          {FEATURES.map((feature, i) => (
            <div
              key={feature.label}
              className={`grid grid-cols-3 border-b border-zinc-100 dark:border-zinc-800/60 ${i === FEATURES.length - 1 ? 'border-b-0' : ''}`}
            >
              <div className="px-6 py-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {feature.label}
              </div>
              <div className={`px-6 py-4 text-center text-sm ${currentPlan === 'free' ? 'bg-blue-50/40 dark:bg-blue-950/10' : ''}`}>
                {typeof feature.free === 'boolean' ? (
                  feature.free
                    ? <span className="text-green-500">&#10003;</span>
                    : <span className="text-zinc-300 dark:text-zinc-600">&#10007;</span>
                ) : (
                  <span className="text-zinc-600 dark:text-zinc-400">{feature.free}</span>
                )}
              </div>
              <div className={`px-6 py-4 text-center text-sm ${currentPlan === 'standard' ? 'bg-purple-50/40 dark:bg-purple-950/10' : 'bg-purple-50/20 dark:bg-purple-950/5'}`}>
                {typeof feature.standard === 'boolean' ? (
                  feature.standard
                    ? <span className="text-green-500">&#10003;</span>
                    : <span className="text-zinc-300 dark:text-zinc-600">&#10007;</span>
                ) : (
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{feature.standard}</span>
                )}
              </div>
            </div>
          ))}

          {/* CTA Row */}
          <div className="grid grid-cols-3 border-t border-zinc-200 dark:border-zinc-800">
            <div className="px-6 py-5" />
            <div className={`px-6 py-5 ${currentPlan === 'free' ? 'bg-blue-50/40 dark:bg-blue-950/10' : ''}`}>
              {currentPlan !== 'free' && (
                <div className="text-center text-xs text-zinc-400">ログインして利用開始</div>
              )}
            </div>
            <div className={`px-6 py-5 ${currentPlan === 'standard' ? 'bg-purple-50/40 dark:bg-purple-950/10' : 'bg-purple-50/20 dark:bg-purple-950/5'}`}>
              {currentPlan === 'standard' ? (
                <span className="block w-full rounded-lg border border-purple-300 bg-purple-100 py-2.5 text-center text-sm font-medium text-purple-600 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                  現在のプラン
                </span>
              ) : (
                <button
                  onClick={handleUpgrade}
                  disabled={loading || !currentPlan}
                  className="block w-full rounded-lg bg-purple-600 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                >
                  {loading ? '処理中...' : !currentPlan ? 'ログインしてアップグレード' : 'Standard にアップグレード'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-sm text-zinc-500 transition-colors hover:text-zinc-700"
          >
            ダッシュボードに戻る
          </button>
        </div>
      </div>
    </div>
  )
}

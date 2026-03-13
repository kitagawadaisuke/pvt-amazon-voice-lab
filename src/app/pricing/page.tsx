'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface UserInfo {
  user: { plan: 'free' | 'standard' } | null
}

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
      <div className="mx-auto max-w-4xl px-4 py-16">
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">料金プラン</h1>
          <p className="mt-3 text-zinc-500 dark:text-zinc-400">
            Amazonレビュー分析を、あなたのペースで
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          {/* Free */}
          <div className={`rounded-2xl border p-8 ${currentPlan === 'free' ? 'border-blue-300 bg-blue-50/50' : 'border-zinc-200 bg-white'} dark:border-zinc-800 dark:bg-zinc-900`}>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Free</h2>
            <div className="mt-4">
              <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">¥0</span>
              <span className="text-zinc-500">/月</span>
            </div>
            <ul className="mt-6 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-green-500">&#10003;</span>
                月3回までAI分析（サービス側キー）
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-green-500">&#10003;</span>
                2商品まで比較
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-green-500">&#10003;</span>
                標準分析（standard）
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-zinc-300">&#10007;</span>
                <span className="text-zinc-400">BYOK（自分のAPIキー）不可</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-zinc-300">&#10007;</span>
                <span className="text-zinc-400">深掘り分析（focused / deep）</span>
              </li>
            </ul>
            {currentPlan === 'free' && (
              <div className="mt-8">
                <span className="block w-full rounded-lg border border-zinc-300 bg-zinc-100 py-2.5 text-center text-sm font-medium text-zinc-500">
                  現在のプラン
                </span>
              </div>
            )}
          </div>

          {/* Standard */}
          <div className={`rounded-2xl border-2 p-8 ${currentPlan === 'standard' ? 'border-purple-400 bg-purple-50/50' : 'border-purple-300 bg-white'} dark:border-purple-700 dark:bg-zinc-900 relative`}>
            <div className="absolute -top-3 left-6 rounded-full bg-purple-600 px-3 py-0.5 text-xs font-medium text-white">
              おすすめ
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Standard</h2>
            <div className="mt-4">
              <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">¥980</span>
              <span className="text-zinc-500">/月</span>
            </div>
            <ul className="mt-6 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-green-500">&#10003;</span>
                月30回までAI分析（サービス側キー）
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-green-500">&#10003;</span>
                30回超過後はBYOKで無制限継続
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-green-500">&#10003;</span>
                5商品まで比較
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-green-500">&#10003;</span>
                全分析深度（standard / focused / deep）
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-green-500">&#10003;</span>
                BYOK対応（自分のAPIキーで分析）
              </li>
            </ul>
            <div className="mt-8">
              {currentPlan === 'standard' ? (
                <span className="block w-full rounded-lg border border-purple-300 bg-purple-100 py-2.5 text-center text-sm font-medium text-purple-600">
                  現在のプラン
                </span>
              ) : (
                <button
                  onClick={handleUpgrade}
                  disabled={loading || !currentPlan}
                  className="block w-full rounded-lg bg-purple-600 py-2.5 text-center text-sm font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
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
            className="text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
          >
            ダッシュボードに戻る
          </button>
        </div>
      </div>
    </div>
  )
}

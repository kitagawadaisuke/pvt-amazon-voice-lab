'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface UserData {
  user: { id: string; email: string; plan: 'free' | 'standard'; hasStripe: boolean }
  usage: { current: number; limit: number }
  planConfig: { compareLimit: number; byokAllowed: boolean; depths: string[] }
}

export default function SettingsPage() {
  const router = useRouter()
  const [userData, setUserData] = useState<UserData | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    fetch('/api/user').then(r => r.ok ? r.json() : null).then(setUserData)
  }, [])

  const handleManageSubscription = async () => {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch {
      setPortalLoading(false)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (!userData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <p className="text-zinc-500">読込中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <button
          onClick={() => router.push('/dashboard')}
          className="mb-6 text-sm text-zinc-500 hover:text-zinc-700"
        >
          &larr; ダッシュボードに戻る
        </button>

        <h1 className="mb-8 text-2xl font-bold text-zinc-900 dark:text-zinc-50">アカウント設定</h1>

        {/* アカウント情報 */}
        <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">アカウント</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">メール</span>
              <span className="text-zinc-900 dark:text-zinc-50">{userData.user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">プラン</span>
              <span className={`font-medium ${userData.user.plan === 'standard' ? 'text-purple-600' : 'text-zinc-600'}`}>
                {userData.user.plan === 'standard' ? 'Standard' : 'Free'}
              </span>
            </div>
          </div>
        </section>

        {/* 使用量 */}
        <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">今月の使用量</h2>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-zinc-500">AI分析回数</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {userData.usage.current} / {userData.usage.limit}
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-zinc-200">
                <div
                  className={`h-full rounded-full transition-all ${
                    userData.usage.current >= userData.usage.limit
                      ? 'bg-red-500'
                      : userData.usage.current >= userData.usage.limit * 0.8
                        ? 'bg-amber-500'
                        : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(100, (userData.usage.current / userData.usage.limit) * 100)}%` }}
                />
              </div>
            </div>
          </div>
          {userData.user.plan === 'standard' && userData.usage.current >= userData.usage.limit && (
            <p className="mt-3 text-sm text-amber-600">
              サービス側キーの上限に達しました。APIキー（BYOK）を設定すると無制限に分析を続行できます。
            </p>
          )}
          {userData.user.plan === 'free' && userData.usage.current >= userData.usage.limit && (
            <p className="mt-3 text-sm text-red-600">
              今月の無料枠を使い切りました。
              <button onClick={() => router.push('/pricing')} className="ml-1 font-medium underline">
                アップグレード
              </button>
            </p>
          )}
        </section>

        {/* プラン管理 */}
        <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">プラン管理</h2>
          {userData.user.plan === 'standard' && userData.user.hasStripe ? (
            <button
              onClick={handleManageSubscription}
              disabled={portalLoading}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50"
            >
              {portalLoading ? '処理中...' : 'サブスクリプション管理（Stripe）'}
            </button>
          ) : (
            <div>
              <p className="mb-3 text-sm text-zinc-500">
                Standardプランにアップグレードして、月30回のAI分析とBYOK対応を利用しましょう。
              </p>
              <button
                onClick={() => router.push('/pricing')}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors"
              >
                プラン・料金を見る
              </button>
            </div>
          )}
        </section>

        {/* ログアウト */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {loggingOut ? 'ログアウト中...' : 'ログアウト'}
          </button>
        </section>
      </div>
    </div>
  )
}

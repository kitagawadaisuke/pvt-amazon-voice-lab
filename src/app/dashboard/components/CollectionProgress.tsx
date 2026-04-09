'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface CollectionJob {
  id: string
  asin: string
  product_name: string | null
  status: 'pending' | 'collecting' | 'analyzing' | 'completed' | 'blocked' | 'cancelled'
  phase: string | null
  current_page: number
  total_collected: number
  text_review_count: number
  display_total_pages: number
  completed_filters: string[]
  block_reason: string | null
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

const FILTER_LABELS: Record<string, string> = {
  five_star: '★5',
  four_star: '★4',
  three_star: '★3',
  two_star: '★2',
  one_star: '★1',
}

const ALL_FILTERS = ['five_star', 'four_star', 'three_star', 'two_star', 'one_star']

function formatElapsedTime(startedAt: string | null): string {
  if (!startedAt) return '--:--'
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const min = Math.floor(elapsed / 60)
  const sec = elapsed % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}

export function CollectionProgress({
  userId,
  onComplete,
  onStop,
}: {
  userId: string
  onComplete?: (asin: string) => void
  onStop?: () => void
}) {
  const [jobs, setJobs] = useState<CollectionJob[]>([])
  const [elapsed, setElapsed] = useState('')
  const completedRef = useRef(new Set<string>())

  // アクティブジョブの初期読み込み
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/collection-jobs')
      if (res.ok) {
        const data = await res.json()
        setJobs(data.jobs || [])
      }
    } catch {
      // サイレント
    }
  }, [])

  // Supabase Realtime サブスクリプション
  useEffect(() => {
    fetchJobs()

    const supabase = createClient()
    const channel = supabase
      .channel('collection-jobs-progress')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collection_jobs',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as CollectionJob
          setJobs((prev) => {
            const idx = prev.findIndex((j) => j.id === updated.id)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = updated
              return next
            }
            return [updated, ...prev]
          })

          // 完了通知
          if (
            (updated.status === 'completed' || updated.status === 'analyzing') &&
            !completedRef.current.has(updated.id)
          ) {
            completedRef.current.add(updated.id)
            onComplete?.(updated.asin)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, fetchJobs, onComplete])

  // 画面復帰時に最新状態を取得
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') fetchJobs()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [fetchJobs])

  // 経過時間の更新
  useEffect(() => {
    const activeJob = jobs.find((j) => j.status === 'collecting' || j.status === 'analyzing')
    if (!activeJob) {
      setElapsed('')
      return
    }

    setElapsed(formatElapsedTime(activeJob.started_at))
    const timer = setInterval(() => {
      setElapsed(formatElapsedTime(activeJob.started_at))
    }, 1000)

    return () => clearInterval(timer)
  }, [jobs])

  const activeJobs = jobs.filter(
    (j) => j.status === 'pending' || j.status === 'collecting' || j.status === 'analyzing' || j.status === 'blocked'
  )

  if (activeJobs.length === 0) return null

  async function handleCancel(asin: string) {
    onStop?.()
    await fetch('/api/collection-jobs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asin }),
    })
    fetchJobs()
  }

  return (
    <div className="space-y-3">
      {activeJobs.map((job) => (
        <div
          key={job.id}
          className="border border-blue-200 rounded-lg bg-blue-50 p-4"
        >
          {/* ヘッダー */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={job.status} />
              <span className="font-medium text-sm">
                {job.product_name || job.asin}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {elapsed && <span>{elapsed}</span>}
              {(job.status === 'collecting' || job.status === 'blocked') && (
                <button
                  onClick={() => handleCancel(job.asin)}
                  className="text-red-500 hover:text-red-700 font-medium"
                >
                  中止
                </button>
              )}
            </div>
          </div>

          {/* フェーズ進捗 */}
          {job.status === 'collecting' && (
            <>
              <div className="flex gap-1 mb-2">
                {ALL_FILTERS.map((f) => {
                  const isCompleted = job.completed_filters?.includes(f)
                  const isCurrent = job.phase === f
                  return (
                    <div
                      key={f}
                      className={`flex-1 h-2 rounded-full transition-colors ${
                        isCompleted
                          ? 'bg-blue-500'
                          : isCurrent
                            ? 'bg-blue-300 animate-pulse'
                            : 'bg-gray-200'
                      }`}
                      title={FILTER_LABELS[f]}
                    />
                  )
                })}
              </div>

              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>
                  {job.phase ? FILTER_LABELS[job.phase] || job.phase : '--'} /
                  p.{job.current_page}
                  {job.display_total_pages > 0 && `/${job.display_total_pages}`}
                </span>
                <span className="font-medium">
                  {job.total_collected} 件取得済み
                </span>
              </div>
            </>
          )}

          {/* 分析中 */}
          {job.status === 'analyzing' && (
            <div className="flex items-center gap-2 text-sm text-blue-700">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {job.total_collected} 件のレビューを分析中...
            </div>
          )}

          {/* ブロック */}
          {job.status === 'blocked' && (
            <div className="text-sm text-red-600 bg-red-50 rounded p-2 mt-1">
              {job.block_reason || 'アクセス制限が検出されました'}
            </div>
          )}

          {/* 待機中 */}
          {job.status === 'pending' && (
            <div className="text-sm text-gray-500">
              拡張機能からの応答を待っています...
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    collecting: 'bg-blue-100 text-blue-700',
    analyzing: 'bg-purple-100 text-purple-700',
    blocked: 'bg-red-100 text-red-700',
  }

  const labels: Record<string, string> = {
    pending: '待機中',
    collecting: '収集中',
    analyzing: '分析中',
    blocked: 'ブロック',
  }

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] || 'bg-gray-100'}`}>
      {labels[status] || status}
    </span>
  )
}

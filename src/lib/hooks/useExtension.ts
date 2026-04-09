'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

// Extension ID: 環境変数 → localStorage → null
function getExtensionId(): string | null {
  if (typeof window === 'undefined') return null
  return (
    process.env.NEXT_PUBLIC_EXTENSION_ID ||
    localStorage.getItem('extensionId') ||
    null
  )
}

function canSendMessage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage
}

async function sendToExtension<T = unknown>(
  extensionId: string,
  message: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(extensionId, message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response)
    })
  })
}

export interface ExtensionStatus {
  installed: boolean | null // null = 未チェック
  version: string | null
}

export interface CollectionState {
  collecting: boolean
  blocked: boolean
  analyzing: boolean
  asin: string
  reviews: unknown[]
  phase: string
  currentPage: number
  textReviewCount: number
  displayTotalPages: number
  completedFilters: string[]
  blockReason?: string
  startedAt?: string
  completedAt?: string
}

export function useExtension() {
  const [status, setStatus] = useState<ExtensionStatus>({
    installed: null,
    version: null,
  })
  const extensionIdRef = useRef(getExtensionId())

  // 拡張のインストール確認
  const checkInstalled = useCallback(async (): Promise<boolean> => {
    const extId = extensionIdRef.current
    if (!extId || !canSendMessage()) {
      setStatus({ installed: false, version: null })
      return false
    }

    try {
      const res = await sendToExtension<{ installed: boolean; version: string }>(
        extId,
        { type: 'PING' }
      )
      setStatus({ installed: res.installed, version: res.version })
      return res.installed
    } catch {
      setStatus({ installed: false, version: null })
      return false
    }
  }, [])

  // 認証情報を拡張に送信
  const syncAuth = useCallback(
    async (params: {
      accessToken: string
      refreshToken: string
      email: string
      serverUrl: string
    }): Promise<boolean> => {
      const extId = extensionIdRef.current
      if (!extId || !canSendMessage()) return false

      try {
        const res = await sendToExtension<{ ok: boolean }>(extId, {
          type: 'SET_AUTH',
          ...params,
        })
        return res.ok
      } catch {
        return false
      }
    },
    []
  )

  // 収集開始
  const startCollection = useCallback(
    async (params: {
      asin: string
      accessToken: string
      refreshToken: string
      email: string
      serverUrl: string
    }): Promise<{ started?: boolean; error?: string }> => {
      const extId = extensionIdRef.current
      if (!extId || !canSendMessage()) {
        return { error: 'Chrome拡張が検出されません' }
      }

      try {
        return await sendToExtension(extId, {
          type: 'START_COLLECTION_FROM_WEB',
          ...params,
        })
      } catch (err) {
        return { error: err instanceof Error ? err.message : '通信エラー' }
      }
    },
    []
  )

  // 収集停止
  const stopCollection = useCallback(async (): Promise<boolean> => {
    const extId = extensionIdRef.current
    if (!extId || !canSendMessage()) return false

    try {
      await sendToExtension(extId, { type: 'STOP_COLLECTION_FROM_WEB' })
      return true
    } catch {
      return false
    }
  }, [])

  // 現在の収集状態を取得
  const getStatus = useCallback(async (): Promise<CollectionState | null> => {
    const extId = extensionIdRef.current
    if (!extId || !canSendMessage()) return null

    try {
      const res = await sendToExtension<{ state: CollectionState | null }>(
        extId,
        { type: 'GET_STATUS' }
      )
      return res.state
    } catch {
      return null
    }
  }, [])

  // Extension ID を設定（設定画面から入力用）
  const setExtensionId = useCallback((id: string) => {
    localStorage.setItem('extensionId', id)
    extensionIdRef.current = id
  }, [])

  // マウント時に自動チェック
  useEffect(() => {
    checkInstalled()
  }, [checkInstalled])

  return {
    ...status,
    extensionId: extensionIdRef.current,
    checkInstalled,
    syncAuth,
    startCollection,
    stopCollection,
    getStatus,
    setExtensionId,
  }
}

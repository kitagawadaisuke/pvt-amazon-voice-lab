// Amazon Voice Lab Service Worker (Background Script)
// Webダッシュボードと content.js の中継ハブ

// content.js からの内部メッセージを受信（Amazon AJAX プロキシ用）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AMAZON_AJAX_FETCH') {
    handleAmazonAjaxFetch(message).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message })
    })
    return true // 非同期応答のため
  }
})

async function handleAmazonAjaxFetch({ url, options }) {
  try {
    const response = await fetch(url, options)
    const text = await response.text()
    return { ok: true, status: response.status, text }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

// Webダッシュボードからの外部メッセージを受信（externally_connectable）
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ installed: true, version: chrome.runtime.getManifest().version })
    return true
  }

  if (message.type === 'SET_AUTH') {
    chrome.storage.local.set({
      accessToken: message.accessToken,
      refreshToken: message.refreshToken,
      userEmail: message.email,
      serverUrl: message.serverUrl,
    })
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'START_COLLECTION_FROM_WEB') {
    handleStartCollectionFromWeb(message).then(sendResponse).catch((err) => {
      sendResponse({ error: err.message })
    })
    return true
  }

  if (message.type === 'STOP_COLLECTION_FROM_WEB') {
    handleStopCollection().then(sendResponse).catch((err) => {
      sendResponse({ error: err.message })
    })
    return true
  }

  if (message.type === 'GET_STATUS') {
    chrome.storage.local.get(['reviewai_state'], (result) => {
      sendResponse({ state: result.reviewai_state || null })
    })
    return true
  }
})

async function handleStartCollectionFromWeb(message) {
  const { asin, accessToken, refreshToken, email, serverUrl } = message
  if (!asin) {
    return { error: 'ASINが指定されていません' }
  }

  // 認証情報を保存
  if (accessToken) {
    await chrome.storage.local.set({
      accessToken,
      refreshToken: refreshToken || '',
      userEmail: email || '',
      serverUrl: serverUrl || 'http://localhost:3000',
    })
  }

  // 既存のAmazonタブを検索
  const amazonTabs = await chrome.tabs.query({
    url: ['https://www.amazon.co.jp/*', 'https://www.amazon.com/*'],
  })

  // 商品ページURLを構築
  const productUrl = `https://www.amazon.co.jp/dp/${asin}`

  let targetTab
  if (amazonTabs.length > 0) {
    // 既存タブを使用
    targetTab = amazonTabs[0]
    await chrome.tabs.update(targetTab.id, { url: productUrl, active: false })
  } else {
    // 新しいタブを作成（バックグラウンド）
    targetTab = await chrome.tabs.create({ url: productUrl, active: false })
  }

  // ページロード完了を待ってから content.js にメッセージ送信
  await waitForTabLoad(targetTab.id)

  // content.js に収集開始を指示
  try {
    const result = await chrome.tabs.sendMessage(targetTab.id, {
      type: 'START_COLLECTION',
      asin,
    })
    return { started: true, tabId: targetTab.id, ...result }
  } catch (err) {
    return { error: `content.js への通信に失敗: ${err.message}` }
  }
}

async function handleStopCollection() {
  const amazonTabs = await chrome.tabs.query({
    url: ['https://www.amazon.co.jp/*', 'https://www.amazon.com/*'],
  })

  for (const tab of amazonTabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'STOP_COLLECTION' })
    } catch {
      // content.js が応答しない場合は無視
    }
  }

  return { stopped: true }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('タブの読み込みがタイムアウトしました'))
    }, 30000)

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout)
        chrome.tabs.onUpdated.removeListener(listener)
        // DOMが安定するまで少し待つ
        setTimeout(resolve, 1500)
      }
    }

    chrome.tabs.onUpdated.addListener(listener)
  })
}

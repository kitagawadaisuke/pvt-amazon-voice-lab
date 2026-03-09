// ReviewAI Popup Script

const statusBox = document.getElementById('statusBox');
const productInfoDiv = document.getElementById('productInfo');
const productTitle = document.getElementById('productTitle');
const productAsin = document.getElementById('productAsin');
const progressSection = document.getElementById('progressSection');
const reviewCount = document.getElementById('reviewCount');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const serverUrlInput = document.getElementById('serverUrl');

let currentTabId = null;
let currentProductInfo = null;
let currentCollectedReviews = [];

// 設定を読み込み
chrome.storage.local.get(['serverUrl'], (result) => {
  serverUrlInput.value = result.serverUrl || 'http://localhost:3000';
});

serverUrlInput.addEventListener('change', () => {
  chrome.storage.local.set({ serverUrl: serverUrlInput.value });
});

// コレクション状態を確認
async function checkCollectionStatus() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['reviewai_state'], (result) => {
      resolve(result.reviewai_state || null);
    });
  });
}

// 現在のタブの情報を取得
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;

  // まずコレクション状態を確認
  const state = await checkCollectionStatus();
  if (state && state.blocked) {
    currentProductInfo = state.productInfo;
    currentCollectedReviews = state.reviews || [];
    if (state.productInfo) showProductInfo(state.productInfo);
    progressSection.style.display = 'block';
    reviewCount.textContent = `${currentCollectedReviews.length}件`;
    progressFill.style.width = '100%';
    progressText.textContent = '取得停止';
    setStatus(state.blockReason || 'Amazon側のブロックを検知しました', 'error');
    analyzeBtn.style.display = currentCollectedReviews.length > 0 ? 'block' : 'none';
    resetBtn.style.display = 'block';
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    return;
  }

  if (state && state.collecting) {
    // 収集中
    currentProductInfo = state.productInfo;
    currentCollectedReviews = state.reviews || [];
    if (state.productInfo) showProductInfo(state.productInfo);
    progressSection.style.display = 'block';
    reviewCount.textContent = `${currentCollectedReviews.length}件`;
    const pct = Math.min((state.reviews.length / (state.productInfo?.totalReviews || 100)) * 100, 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${state.phase === 'all' ? '全て' : state.phase} - ページ${state.currentPage} 取得中...`;
    setStatus(`レビュー取得中... (${state.reviews.length}件)`, 'collecting');
    stopBtn.style.display = 'block';
    return;
  }

  if (state && !state.collecting && state.reviews && state.reviews.length > 0) {
    // 収集完了済み
    currentProductInfo = state.productInfo;
    currentCollectedReviews = state.reviews || [];
    if (state.productInfo) showProductInfo(state.productInfo);
    progressSection.style.display = 'block';
    reviewCount.textContent = `${currentCollectedReviews.length}件`;
    progressFill.style.width = '100%';
    progressText.textContent = '取得完了';
    setStatus(`${state.reviews.length}件のレビューを取得しました`, 'success');
    analyzeBtn.style.display = 'block';
    resetBtn.style.display = 'block';
    return;
  }

  if (!tab.url || (!tab.url.includes('amazon.co.jp') && !tab.url.includes('amazon.com'))) {
    setStatus('Amazon商品ページを開いてください', 'info');
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(currentTabId, { type: 'GET_PAGE_INFO' });

    if (response.productInfo) {
      currentProductInfo = response.productInfo;
      showProductInfo(response.productInfo);

      if (response.productInfo.totalReviews > 0) {
        setStatus(`レビュー ${response.productInfo.totalReviews}件 取得可能`, 'info');
        startBtn.style.display = 'block';
      } else {
        setStatus('この商品にはレビューがありません', 'info');
      }
    } else {
      setStatus('Amazon商品ページを開いてください', 'info');
    }
  } catch {
    setStatus('ページを再読み込みしてからお試しください', 'error');
  }
}

function setStatus(text, type) {
  statusBox.textContent = text;
  statusBox.className = `status ${type}`;
}

function showProductInfo(info) {
  productInfoDiv.style.display = 'block';
  productTitle.textContent = info.title.substring(0, 60) + (info.title.length > 60 ? '...' : '');
  productAsin.textContent = `ASIN: ${info.asin} | ★${info.rating}`;

  // 評価数の内訳を表示
  const breakdownDiv = document.getElementById('reviewBreakdown');
  const totalRatingsEl = document.getElementById('totalRatings');
  breakdownDiv.style.display = 'block';
  totalRatingsEl.textContent = `${info.totalReviews}件`;
}

// レビュー取得開始
startBtn.addEventListener('click', async () => {
  startBtn.style.display = 'none';
  stopBtn.style.display = 'block';
  progressSection.style.display = 'block';
  setStatus('レビューページに移動中...', 'collecting');

  try {
    await chrome.tabs.sendMessage(currentTabId, { type: 'START_COLLECTION' });
  } catch {
    setStatus('取得に失敗しました。ページを再読み込みしてください', 'error');
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
  }
});

// 取得中止
stopBtn.addEventListener('click', async () => {
  try {
    await chrome.tabs.sendMessage(currentTabId, { type: 'STOP_COLLECTION' });
  } catch {
    // タブが遷移中の場合はstorageを直接クリア
    chrome.storage.local.remove(['reviewai_state']);
  }
  stopBtn.style.display = 'none';
  setStatus('取得を中止しました', 'info');
  startBtn.style.display = 'block';
});

// 進捗メッセージを受信
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'COLLECTION_PROGRESS') {
    reviewCount.textContent = `${msg.total}件`;
    const pct = Math.min((msg.total / (currentProductInfo?.totalReviews || 100)) * 100, 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${msg.currentFilter} - ページ${msg.currentPage} 取得中...`;
    setStatus(`レビュー取得中... (${msg.total}件)`, 'collecting');
  }

  if (msg.type === 'TEXT_REVIEW_COUNT') {
    const textReviewsEl = document.getElementById('textReviews');
    textReviewsEl.textContent = `${msg.textReviewCount}件`;
    textReviewsEl.style.color = msg.textReviewCount < 10 ? '#ef4444' : '#3b82f6';
    if (msg.textReviewCount < 10) {
      setStatus(`コメント付きレビューが${msg.textReviewCount}件しかありません。分析精度が低くなる可能性があります`, 'error');
    }
  }

  if (msg.type === 'COLLECTION_COMPLETE') {
    currentCollectedReviews = msg.reviews || [];
    stopBtn.style.display = 'none';
    reviewCount.textContent = `${currentCollectedReviews.length}件`;
    progressFill.style.width = '100%';
    progressText.textContent = '取得完了';
    setStatus(`${currentCollectedReviews.length}件のレビューを取得しました`, 'success');
    analyzeBtn.style.display = 'block';
    resetBtn.style.display = 'block';
    currentProductInfo = msg.productInfo;
  }

  if (msg.type === 'COLLECTION_BLOCKED') {
    stopBtn.style.display = 'none';
    resetBtn.style.display = 'block';
    startBtn.style.display = 'block';
    setStatus(msg.reason || 'Amazon側のアクセス制限を検知しました', 'error');
  }
});

// POX分析を実行
analyzeBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.replace(/\/$/, '');
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = '分析中...';
  setStatus('ReviewAIサーバーにデータを送信中...', 'collecting');

  // storageから最新データを取得
  const state = await checkCollectionStatus();
  const collected = state?.reviews || currentCollectedReviews;
  const pInfo = state?.productInfo || currentProductInfo;

  // 低評価・高評価に分類
  const lowRating = collected.filter((r) => r.rating <= 2);
  const highRating = collected.filter((r) => r.rating >= 4);

  const payload = {
    asin: pInfo?.asin,
    source: 'chrome_extension',
    reviews: {
      asin: pInfo?.asin,
      productName: pInfo?.title,
      totalReviews: pInfo?.totalReviews || collected.length,
      averageRating: pInfo?.rating || 0,
      reviews: collected,
      lowRatingReviews: lowRating,
      highRatingReviews: highRating,
      fetchedAt: new Date().toISOString(),
    },
  };

  try {
    const response = await fetch(`${serverUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    await response.json();
    setStatus('分析完了！ダッシュボードで結果を確認してください', 'success');
    analyzeBtn.textContent = '分析完了 ✓';

    // storageをクリア
    chrome.storage.local.remove(['reviewai_state']);

    // ダッシュボードを開く
    chrome.tabs.create({ url: `${serverUrl}/dashboard?asin=${pInfo?.asin}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    setStatus(`サーバー接続エラー: ${message}`, 'error');
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'POX分析を実行する';
  }
});

// データリセット
const resetBtn = document.getElementById('resetBtn');
resetBtn.addEventListener('click', () => {
  chrome.storage.local.remove(['reviewai_state'], () => {
    setStatus('データをリセットしました', 'info');
    progressSection.style.display = 'none';
    analyzeBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    resetBtn.style.display = 'none';
    startBtn.style.display = 'block';
  });
});

init();

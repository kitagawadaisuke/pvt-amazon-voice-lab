// Amazon Voice Lab Popup Script

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
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');

let currentTabId = null;
let currentProductInfo = null;
let currentCollectedReviews = [];

function isAmazonPage(url) {
  return !!url && (url.includes('amazon.co.jp') || url.includes('amazon.com'));
}

function isSameProduct(left, right) {
  return !!left?.asin && !!right?.asin && left.asin === right.asin;
}

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
  const onAmazonPage = isAmazonPage(tab.url);
  let currentPageInfo = null;

  if (onAmazonPage) {
    try {
      const response = await chrome.tabs.sendMessage(currentTabId, { type: 'GET_PAGE_INFO' });
      currentPageInfo = response?.productInfo || null;
      if (currentPageInfo) {
        currentProductInfo = currentPageInfo;
        showProductInfo(currentPageInfo);
      }
    } catch {
      currentPageInfo = null;
    }
  }

  const state = await checkCollectionStatus();
  const stateMatchesCurrentPage = isSameProduct(state?.productInfo, currentPageInfo);

  if (state && state.blocked && (!onAmazonPage || stateMatchesCurrentPage)) {
    currentProductInfo = state.productInfo;
    currentCollectedReviews = state.reviews || [];
    if (state.productInfo) showProductInfo(state.productInfo);
    progressSection.style.display = 'block';
    reviewCount.textContent = `${currentCollectedReviews.length}件`;
    progressFill.style.width = '100%';
    progressText.textContent = '取得停止';
    setStatus(state.blockReason || 'Amazon側のブロックを検知しました', 'error');
    resetBtn.style.display = 'block';
    startBtn.style.display = 'block';
    downloadBtn.style.display = currentCollectedReviews.length > 0 ? 'block' : 'none';
    stopBtn.style.display = 'none';
    return;
  }

  if (state && state.collecting && (!onAmazonPage || stateMatchesCurrentPage)) {
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

  if (state && !state.collecting && state.reviews && state.reviews.length > 0 && (!onAmazonPage || stateMatchesCurrentPage)) {
    currentProductInfo = state.productInfo;
    currentCollectedReviews = state.reviews || [];
    if (state.productInfo) showProductInfo(state.productInfo);
    progressSection.style.display = 'block';
    reviewCount.textContent = `${currentCollectedReviews.length}件`;
    progressFill.style.width = '100%';
    progressText.textContent = 'レビュー取得完了';
    setStatus(`${state.reviews.length}件のレビューを取得しました`, 'success');
    downloadBtn.style.display = 'block';
    resetBtn.style.display = 'block';
    return;
  }

  if (state && state.reviews && state.reviews.length > 0 && onAmazonPage && currentPageInfo && !stateMatchesCurrentPage) {
    progressSection.style.display = 'none';
    resetBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    downloadBtn.style.display = 'none';
    if (currentPageInfo.totalReviews > 0) {
      setStatus(`レビュー ${currentPageInfo.totalReviews}件 取得可能`, 'info');
      startBtn.style.display = 'block';
    } else {
      setStatus('この商品にはレビューがありません', 'info');
    }
    return;
  }

  if (!onAmazonPage) {
    setStatus('Amazon商品ページを開いてください', 'info');
    return;
  }

  if (currentPageInfo) {
    if (currentPageInfo.totalReviews > 0) {
      setStatus(`レビュー ${currentPageInfo.totalReviews}件 取得可能`, 'info');
      startBtn.style.display = 'block';
    } else {
      setStatus('この商品にはレビューがありません', 'info');
    }
  } else {
    setStatus('Amazon商品ページを開いてください', 'info');
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

  const breakdownDiv = document.getElementById('reviewBreakdown');
  const totalRatingsEl = document.getElementById('totalRatings');
  breakdownDiv.style.display = 'flex';
  totalRatingsEl.textContent = `${info.totalReviews}件`;
}

// レビュー取得開始
startBtn.addEventListener('click', async () => {
  startBtn.style.display = 'none';
  stopBtn.style.display = 'block';
  resetBtn.style.display = 'none';
  downloadBtn.style.display = 'none';
  progressSection.style.display = 'block';
  setStatus('レビュー取得中...', 'collecting');

  try {
    await chrome.storage.local.remove(['reviewai_state']);
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
    chrome.storage.local.remove(['reviewai_state']);
  }
  stopBtn.style.display = 'none';
  setStatus('取得を中止しました', 'info');
  startBtn.style.display = 'block';
});

// CSVダウンロード
downloadBtn.addEventListener('click', async () => {
  const state = await checkCollectionStatus();
  if (!state || !state.reviews || state.reviews.length === 0) {
    setStatus('ダウンロードするレビューがありません', 'error');
    return;
  }

  const asin = state.productInfo?.asin || 'unknown';
  const reviews = state.reviews;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // CSV ヘッダー
  const headers = [
    'ASIN', 'タイトル', '内容', '星評価', '日付', 'レビューアー', '認証購入者',
    '役に立つ数', 'レビューID',
  ];

  // CSV 行を生成
  const rows = reviews.map((r) => [
    asin,
    csvEscape(r.title || ''),
    csvEscape(r.body || ''),
    r.rating || '',
    r.date || '',
    csvEscape(r.author || ''),
    r.verified ? 'Yes' : 'No',
    r.helpfulVotes || 0,
    r.id || '',
  ]);

  // BOM 付き UTF-8 CSV を生成（Excel で日本語が文字化けしないよう）
  const bom = '\uFEFF';
  const csvContent = bom + [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

  // ダウンロード
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${asin}-JP-Reviews-${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  setStatus(`${reviews.length}件のレビューをCSVでダウンロードしました`, 'success');
});

function csvEscape(str) {
  if (!str) return '""';
  const escaped = str.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  return `"${escaped}"`;
}

// storage変更を監視して状態を同期
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.reviewai_state) return;
  const state = changes.reviewai_state.newValue;
  if (!state) return;

  if (state.collecting) {
    const pct = Math.min((state.reviews.length / (state.productInfo?.totalReviews || 100)) * 100, 100);
    reviewCount.textContent = `${state.reviews.length}件`;
    progressFill.style.width = `${pct}%`;
    progressSection.style.display = 'block';
  } else if (!state.collecting && state.reviews?.length > 0) {
    reviewCount.textContent = `${state.reviews.length}件`;
    progressFill.style.width = '100%';
  }
});

// 進捗メッセージを受信
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'COLLECTION_PROGRESS') {
    reviewCount.textContent = `${msg.total}件`;
    const progressBase = msg.targetReviewCount || msg.textReviewCount || currentProductInfo?.totalReviews || 100;
    const pct = Math.min((msg.total / progressBase) * 100, 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${msg.currentFilter} - ページ${msg.currentPage}/${msg.maxPages}`;
    setStatus('レビュー取得中...', 'collecting');
  }

  if (msg.type === 'TEXT_REVIEW_COUNT') {
    const textReviewsEl = document.getElementById('textReviews');
    textReviewsEl.textContent = `${msg.textReviewCount}件`;
    textReviewsEl.style.color = msg.textReviewCount < 10 ? '#ef4444' : '#3b82f6';
  }

  if (msg.type === 'COLLECTION_COMPLETE') {
    currentCollectedReviews = msg.reviews || [];
    stopBtn.style.display = 'none';
    reviewCount.textContent = `${currentCollectedReviews.length}件`;
    progressFill.style.width = '100%';
    progressText.textContent = 'レビュー取得完了';
    setStatus(`${currentCollectedReviews.length}件のレビューを取得しました`, 'success');
    downloadBtn.style.display = 'block';
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

// データリセット
resetBtn.addEventListener('click', () => {
  chrome.storage.local.remove(['reviewai_state'], () => {
    setStatus('データをリセットしました', 'info');
    progressSection.style.display = 'none';
    stopBtn.style.display = 'none';
    downloadBtn.style.display = 'none';
    resetBtn.style.display = 'none';
    startBtn.style.display = 'block';
  });
});

init();

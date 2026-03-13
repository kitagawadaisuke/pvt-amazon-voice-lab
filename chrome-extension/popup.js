// ReviewAI Popup Script

const statusBox = document.getElementById('statusBox');
const productInfoDiv = document.getElementById('productInfo');
const productTitle = document.getElementById('productTitle');
const productAsin = document.getElementById('productAsin');
const progressSection = document.getElementById('progressSection');
const reviewCount = document.getElementById('reviewCount');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const currentPageMeta = document.getElementById('currentPageMeta');
const captureRateMeta = document.getElementById('captureRateMeta');
const textReviewMeta = document.getElementById('textReviewMeta');
const addedCountMeta = document.getElementById('addedCountMeta');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const serverUrlInput = document.getElementById('serverUrl');

const SUPABASE_URL = 'https://ajujveerddffossdrwmr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqdWp2ZWVyZGRmZm9zc2Ryd21yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjYwMjUsImV4cCI6MjA4ODk0MjAyNX0.CVJEqxgFpoW8D87zq8dYpWUYISvAKAKZUphFJ2YUy3Q';

let currentTabId = null;
let currentProductInfo = null;
let currentCollectedReviews = [];

function isAmazonPage(url) {
  return !!url && (url.includes('amazon.co.jp') || url.includes('amazon.com'));
}

function isSameProduct(left, right) {
  return !!left?.asin && !!right?.asin && left.asin === right.asin;
}

// 設定を読み込み
chrome.storage.local.get(['serverUrl'], (result) => {
  serverUrlInput.value = result.serverUrl || 'http://localhost:3000';
});

serverUrlInput.addEventListener('change', () => {
  chrome.storage.local.set({ serverUrl: serverUrlInput.value });
});

// --- Google認証 ---
function showAuthUI(state) {
  const loading = document.getElementById('authLoading');
  const loggedOut = document.getElementById('authLoggedOut');
  const loggedIn = document.getElementById('authLoggedIn');
  if (state === 'loading') {
    loading.style.display = 'block';
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'none';
  } else if (state === 'loggedout') {
    loading.style.display = 'none';
    loggedOut.style.display = 'block';
    loggedIn.style.display = 'none';
  } else if (state === 'loggedin') {
    loading.style.display = 'none';
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'block';
  }
}

async function checkAuthState() {
  showAuthUI('loading');
  const { accessToken, refreshToken, userEmail } = await new Promise((resolve) =>
    chrome.storage.local.get(['accessToken', 'refreshToken', 'userEmail'], resolve)
  );
  if (accessToken && refreshToken) {
    document.getElementById('authEmail').textContent = userEmail || '';
    showAuthUI('loggedin');
  } else {
    showAuthUI('loggedout');
  }
}

document.getElementById('googleLoginBtn').addEventListener('click', async () => {
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
  chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (responseUrl) => {
    if (chrome.runtime.lastError || !responseUrl) {
      setStatus('ログインに失敗しました', 'error');
      showAuthUI('loggedout');
      return;
    }
    const hash = responseUrl.split('#')[1] || '';
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) {
      setStatus('トークン取得に失敗しました', 'error');
      showAuthUI('loggedout');
      return;
    }
    // メールアドレス取得
    let userEmail = '';
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
      });
      const data = await res.json();
      userEmail = data.email || '';
    } catch {}
    chrome.storage.local.set({ accessToken, refreshToken, userEmail });
    document.getElementById('authEmail').textContent = userEmail;
    showAuthUI('loggedin');
    setStatus('ログインしました', 'success');
  });
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  chrome.storage.local.remove(['accessToken', 'refreshToken', 'userEmail']);
  showAuthUI('loggedout');
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

  // まずコレクション状態を確認
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
    renderProgressMeta({
      total: currentCollectedReviews.length,
      currentPage: state.currentPage || 0,
      maxPages: state.maxPages || '-',
      textReviewCount: state.textReviewCount || 0,
      targetReviewCount: state.targetReviewCount || 0,
      addedCount: 0,
    });
    setStatus(state.blockReason || 'Amazon側のブロックを検知しました', 'error');
    resetBtn.style.display = 'block';
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    return;
  }

  if (state && state.analyzing && (!onAmazonPage || stateMatchesCurrentPage)) {
    currentProductInfo = state.productInfo;
    currentCollectedReviews = state.reviews || [];
    if (state.productInfo) showProductInfo(state.productInfo);
    progressSection.style.display = 'block';
    reviewCount.textContent = `${currentCollectedReviews.length}件`;
    progressFill.style.width = '100%';
    progressText.textContent = 'レビュー取得完了 / POX分析を自動実行中';
    renderProgressMeta({
      total: currentCollectedReviews.length,
      currentPage: state.currentPage || '-',
      maxPages: state.currentPage || '-',
      textReviewCount: state.textReviewCount || currentCollectedReviews.length,
      targetReviewCount: state.targetReviewCount || 0,
      addedCount: 0,
    });
    setStatus('POX分析を自動で実行しています。しばらくお待ちください', 'collecting');
    resetBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    return;
  }

  if (state && state.collecting && (!onAmazonPage || stateMatchesCurrentPage)) {
    // 収集中
    currentProductInfo = state.productInfo;
    currentCollectedReviews = state.reviews || [];
    if (state.productInfo) showProductInfo(state.productInfo);
    progressSection.style.display = 'block';
    reviewCount.textContent = `${currentCollectedReviews.length}件`;
    const pct = Math.min((state.reviews.length / (state.productInfo?.totalReviews || 100)) * 100, 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${state.phase === 'all' ? '全て' : state.phase} - ページ${state.currentPage} 取得中...`;
    renderProgressMeta({
      total: state.reviews.length,
      currentPage: state.currentPage,
      maxPages: state.phase === 'all' ? 10 : 3,
      textReviewCount: state.textReviewCount || 0,
      targetReviewCount: state.targetReviewCount || 0,
      addedCount: 0,
    });
    setStatus(`レビュー取得中... (${state.reviews.length}件)`, 'collecting');
    stopBtn.style.display = 'block';
    return;
  }

  if (state && !state.collecting && state.reviews && state.reviews.length > 0 && (!onAmazonPage || stateMatchesCurrentPage)) {
    // 収集完了済み
    currentProductInfo = state.productInfo;
    currentCollectedReviews = state.reviews || [];
    if (state.productInfo) showProductInfo(state.productInfo);
    progressSection.style.display = 'block';
    reviewCount.textContent = `${currentCollectedReviews.length}件`;
    progressFill.style.width = '100%';
    progressText.textContent = 'レビュー取得完了 / レポート確認可能';
    renderProgressMeta({
      total: currentCollectedReviews.length,
      currentPage: state.currentPage || '-',
      maxPages: state.currentPage || '-',
      textReviewCount: state.textReviewCount || currentCollectedReviews.length,
      targetReviewCount: state.targetReviewCount || 0,
      addedCount: 0,
    });
    setStatus(`${state.reviews.length}件のレビュー取得とPOX分析が完了しています`, 'success');
    resetBtn.style.display = 'block';
    return;
  }

  if (state && state.reviews && state.reviews.length > 0 && onAmazonPage && currentPageInfo && !stateMatchesCurrentPage) {
    progressSection.style.display = 'none';
    resetBtn.style.display = 'none';
    stopBtn.style.display = 'none';
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

  try {
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

function renderProgressMeta({
  total = 0,
  currentPage = 0,
  maxPages = '-',
  textReviewCount = 0,
  targetReviewCount = 0,
  addedCount = 0,
}) {
  currentPageMeta.textContent = `${currentPage}/${maxPages}`;

  const denominator = textReviewCount || currentProductInfo?.totalReviews || 0;
  const captureRate = denominator > 0 ? `${Math.min((total / denominator) * 100, 100).toFixed(0)}%` : '-';
  captureRateMeta.textContent = captureRate;

  if (textReviewCount > 0 && targetReviewCount > 0) {
    textReviewMeta.textContent = `${total}/${targetReviewCount}目標`;
  } else if (textReviewCount > 0) {
    textReviewMeta.textContent = `${textReviewCount}件`;
  } else {
    textReviewMeta.textContent = '測定中';
  }

  addedCountMeta.textContent = addedCount > 0 ? `+${addedCount}件` : '-';
}

// レビュー取得開始
  startBtn.addEventListener('click', async () => {
  startBtn.style.display = 'none';
  stopBtn.style.display = 'block';
  resetBtn.style.display = 'none';
  progressSection.style.display = 'block';
  setStatus('レビューページに移動中...', 'collecting');

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
    const progressBase = msg.targetReviewCount || msg.textReviewCount || currentProductInfo?.totalReviews || 100;
    const pct = Math.min((msg.total / progressBase) * 100, 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${msg.currentFilter} - ページ${msg.currentPage}/${msg.maxPages} 取得中...`;
    renderProgressMeta({
      total: msg.total,
      currentPage: msg.currentPage,
      maxPages: msg.maxPages || '-',
      textReviewCount: msg.textReviewCount || 0,
      targetReviewCount: msg.targetReviewCount || 0,
      addedCount: msg.addedCount || 0,
    });
    const targetSuffix = msg.targetReviewCount ? ` / 目標${msg.targetReviewCount}件` : '';
    setStatus(`レビュー取得中... (${msg.total}件${targetSuffix})`, 'collecting');
  }

  if (msg.type === 'TEXT_REVIEW_COUNT') {
    const textReviewsEl = document.getElementById('textReviews');
    textReviewsEl.textContent = `${msg.textReviewCount}件`;
    textReviewsEl.style.color = msg.textReviewCount < 10 ? '#ef4444' : '#3b82f6';
    renderProgressMeta({
      total: currentCollectedReviews.length,
      currentPage: currentPageMeta.textContent.split('/')[0] || 0,
      maxPages: currentPageMeta.textContent.split('/')[1] || '-',
      textReviewCount: msg.textReviewCount,
      targetReviewCount: msg.targetReviewCount || 0,
      addedCount: 0,
    });
    if (msg.textReviewCount < 10) {
      setStatus(`コメント付きレビューが${msg.textReviewCount}件しかありません。分析精度が低くなる可能性があります`, 'error');
    }
  }

  if (msg.type === 'COLLECTION_COMPLETE') {
    currentCollectedReviews = msg.reviews || [];
    stopBtn.style.display = 'none';
    reviewCount.textContent = `${currentCollectedReviews.length}件`;
    progressFill.style.width = '100%';
    progressText.textContent = 'レビュー取得完了 / POX分析を自動実行中';
    renderProgressMeta({
      total: currentCollectedReviews.length,
      currentPage: currentPageMeta.textContent.split('/')[0] || '-',
      maxPages: currentPageMeta.textContent.split('/')[1] || '-',
      textReviewCount: currentCollectedReviews.length,
      targetReviewCount: 0,
      addedCount: 0,
    });
    setStatus(`${currentCollectedReviews.length}件のレビューを取得しました。自動でPOX分析を開始しています`, 'collecting');
    resetBtn.style.display = 'none';
    currentProductInfo = msg.productInfo;
  }

  if (msg.type === 'COLLECTION_BLOCKED') {
    stopBtn.style.display = 'none';
    resetBtn.style.display = 'block';
    startBtn.style.display = 'block';
    setStatus(msg.reason || 'Amazon側のアクセス制限を検知しました', 'error');
  }
  if (msg.type === 'ANALYSIS_STARTED') {
    progressText.textContent = 'レビュー取得完了 / POX分析を自動実行中';
    setStatus('POX分析を自動で実行しています。しばらくお待ちください', 'collecting');
    stopBtn.style.display = 'none';
    resetBtn.style.display = 'none';
  }

  if (msg.type === 'ANALYSIS_COMPLETE') {
    progressText.textContent = 'POX分析完了 / レポートを表示しました';
    setStatus('POX分析が完了しました。ダッシュボードを開いています', 'success');
    resetBtn.style.display = 'block';
  }

  if (msg.type === 'ANALYSIS_FAILED') {
    progressText.textContent = 'POX分析に失敗';
    setStatus(`POX分析に失敗しました: ${msg.error || 'unknown error'}`, 'error');
    resetBtn.style.display = 'block';
  }
});

// データリセット
const resetBtn = document.getElementById('resetBtn');
resetBtn.addEventListener('click', () => {
  chrome.storage.local.remove(['reviewai_state'], () => {
    setStatus('データをリセットしました', 'info');
    progressSection.style.display = 'none';
    stopBtn.style.display = 'none';
    resetBtn.style.display = 'none';
    startBtn.style.display = 'block';
  });
});

checkAuthState();
init();

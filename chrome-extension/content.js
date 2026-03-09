// ReviewAI Content Script
// Amazon商品ページ・レビューページからレビューを自動取得する
// 方式: 実際にページ遷移してDOMから直接取得（fetchだとpageNumberが無視されるため）

(function () {
  'use strict';

  const MAX_PAGES_PER_FILTER = 10;
  const ZERO_NEW_PAGE_LIMIT = 2;
  const ALL_FILTER_TARGET_RATE = 0.8;
  const DOM_UPDATE_TIMEOUT_MS = 8000;
  const BLOCKED_TEXT_PATTERNS = [
    'ご迷惑をおかけしています',
    '入力された文字を読み取ってください',
    'Enter the characters you see below',
  ];
  const REVIEW_PAGE_ERROR_PATTERNS = [
    'レビューのフィルタリング中にエラーが発生しました',
    'ページを再読み込みしてください',
    'There was a problem filtering reviews right now',
  ];

  // ページの種類を判定
  function getPageType() {
    const url = window.location.href;
    if (url.includes('/product-reviews/') || url.includes('/customer-reviews/')) {
      return 'reviews';
    }
    if (url.includes('/dp/') || url.includes('/gp/product/')) {
      return 'product';
    }
    return 'other';
  }

  // ASINを抽出
  function extractAsin() {
    const url = window.location.href;
    const match = url.match(/\/(?:dp|product|product-reviews|customer-reviews)\/([A-Z0-9]{10})/);
    if (match) return match[1];
    const asinMeta = document.querySelector('[data-asin]');
    if (asinMeta) return asinMeta.dataset.asin;
    return null;
  }

  // 商品情報を取得
  function getProductInfo() {
    const asin = extractAsin();
    if (!asin) return null;

    const titleEl = document.querySelector('#productTitle, #title, .product-title-word-break, [data-hook="product-link"]');
    const ratingEl = document.querySelector('#acrPopover .a-icon-alt, .averageStarRatingNumerical, [data-hook="rating-out-of-text"]');
    const reviewCountEl = document.querySelector('#acrCustomerReviewText, #acrCustomerReviewLink, [data-hook="total-review-count"]');

    let totalReviews = 0;
    if (reviewCountEl) {
      const countMatch = reviewCountEl.textContent.match(/[\d,]+/);
      if (countMatch) totalReviews = parseInt(countMatch[0].replace(/,/g, ''));
    }

    let rating = 0;
    if (ratingEl) {
      const ratingMatch = ratingEl.textContent.match(/[\d.]+/);
      if (ratingMatch) rating = parseFloat(ratingMatch[0]);
    }

    return {
      asin,
      title: titleEl ? titleEl.textContent.trim() : `Amazon商品 ${asin}`,
      rating,
      totalReviews,
    };
  }

  // 現在のページからレビューを抽出（DOM直接読み取り）
  function extractReviewsFromCurrentPage() {
    const reviews = [];
    const reviewEls = document.querySelectorAll('[data-hook="review"]');

    reviewEls.forEach((el) => {
      const titleEl = el.querySelector('[data-hook="review-title"] span, .review-title-content span');
      const bodyEl = el.querySelector('[data-hook="review-body"] span, .review-text-content span');
      const ratingEl = el.querySelector('[data-hook="review-star-rating"] .a-icon-alt, .review-rating .a-icon-alt');
      const dateEl = el.querySelector('[data-hook="review-date"]');
      const verifiedEl = el.querySelector('[data-hook="avp-badge"]');
      const helpfulEl = el.querySelector('[data-hook="helpful-vote-statement"]');
      const reviewId = el.id || el.getAttribute('id') || '';

      let rating = 3;
      if (ratingEl) {
        const match = ratingEl.textContent.match(/[\d.]+/);
        if (match) rating = parseFloat(match[0]);
      }

      let helpfulVotes = 0;
      if (helpfulEl) {
        const match = helpfulEl.textContent.match(/(\d+)/);
        if (match) helpfulVotes = parseInt(match[1]);
      }

      const body = bodyEl ? bodyEl.textContent.trim() : '';
      if (!body) return;

      reviews.push({
        id: reviewId,
        title: titleEl ? titleEl.textContent.trim() : '(タイトルなし)',
        body,
        rating,
        date: dateEl ? dateEl.textContent.trim() : '',
        verified: !!verifiedEl,
        helpfulVotes,
      });
    });

    return reviews;
  }

  // レビューページかどうか
  function isReviewsPage() {
    return window.location.href.includes('/product-reviews/');
  }

  function getCurrentPageNumber() {
    const url = new URL(window.location.href);
    return parseInt(url.searchParams.get('pageNumber') || '1', 10);
  }

  function getCurrentFilter() {
    const url = new URL(window.location.href);
    return url.searchParams.get('filterByStar') || 'all';
  }

  function buildReviewPageUrl(asin, pageNumber, filterByStar) {
    const url = new URL(`https://${window.location.hostname}/product-reviews/${asin}`);
    url.searchParams.set('pageNumber', String(pageNumber));
    url.searchParams.set('sortBy', 'recent');
    if (filterByStar && filterByStar !== 'all') {
      url.searchParams.set('filterByStar', filterByStar);
    }
    return url.toString();
  }

  function getNextPageLink() {
    const selectors = [
      '.a-pagination .a-last:not(.a-disabled) a',
      'li.a-last:not(.a-disabled) a',
      '.a-pagination li.a-last a[href]',
      'ul.a-pagination li:last-child a[href]',
    ];

    for (const selector of selectors) {
      const link = document.querySelector(selector);
      if (link && link.href) {
        return link;
      }
    }

    return null;
  }

  async function goToNextReviewPage(state, nextPageNum, fallbackUrl) {
    const waitTime = randomDelay(5000, 8000);
    console.log(`[ReviewAI] Waiting ${Math.round(waitTime / 1000)}s before next page...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    const nextLink = getNextPageLink();
    const beforeUrl = window.location.href;
    const beforeIds = getCurrentReviewIds();
    if (nextLink) {
      console.log(`[ReviewAI] Clicking next pagination link for page ${nextPageNum}: ${nextLink.href}`);
      state.currentPage = nextPageNum;
      await saveCollectionState(state);
      nextLink.click();

      await new Promise((resolve) => setTimeout(resolve, 2500));
      const afterUrl = window.location.href;
      if (afterUrl !== beforeUrl) {
        console.log(`[ReviewAI] URL changed after click: ${afterUrl}`);
        const domResult = await waitForReviewDomUpdate(beforeIds, nextPageNum);
        if (domResult.status === 'updated') {
          console.log(`[ReviewAI] Review DOM updated for page ${nextPageNum}: ${domResult.ids}`);
          await handleReviewsPageArrival({ fromDomUpdate: true });
          return true;
        }
        if (domResult.status === 'error') {
          console.warn(`[ReviewAI] Review page error detected after click. Reloading current URL: ${afterUrl}`);
          window.location.assign(afterUrl);
          return true;
        }
        console.warn(`[ReviewAI] Review DOM did not update after click. Falling back to assign(): ${nextLink.href}`);
        window.location.assign(nextLink.href);
        return true;
      }

      console.warn(`[ReviewAI] URL did not change after click. Falling back to assign(): ${nextLink.href}`);
      window.location.assign(nextLink.href);
      return true;
    }

    console.warn(`[ReviewAI] Next pagination link not found. Falling back to URL navigation: ${fallbackUrl}`);
    state.currentPage = nextPageNum;
    await saveCollectionState(state);
    window.location.href = fallbackUrl;
    return true;
  }

  function randomDelay(minMs, maxMs) {
    return minMs + Math.random() * (maxMs - minMs);
  }

  function getFilterLabel(filter) {
    const labels = {
      all: '全て',
      one_star: '★1',
      two_star: '★2',
      three_star: '★3',
      four_star: '★4',
      five_star: '★5',
    };
    return labels[filter] || filter;
  }

  function isBlockedPage() {
    const text = document.body?.innerText || '';
    return BLOCKED_TEXT_PATTERNS.some((pattern) => text.includes(pattern));
  }

  function hasReviewPageError() {
    const text = document.body?.innerText || '';
    return REVIEW_PAGE_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
  }

  function getRatingBreakdownFromPage() {
    const breakdown = {};
    const rows = document.querySelectorAll('[data-hook="cr-filter-info-section"] .a-row, #histogramTable tr');
    rows.forEach((row) => {
      const text = row.textContent || '';
      const starMatch = text.match(/([1-5])\s*つ星|([1-5])\s*star/i);
      const countMatch = text.match(/([\d,]+)\s*(件|global ratings|ratings|reviews)/i);
      const star = starMatch ? parseInt(starMatch[1] || starMatch[2], 10) : null;
      const count = countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : null;
      if (star && count) {
        breakdown[star] = count;
      }
    });
    return breakdown;
  }

  function getReviewKey(review) {
    return [
      review.id || '',
      review.title || '',
      review.body.substring(0, 120),
      review.rating || 0,
      review.date || '',
    ].join('::');
  }

  function getCurrentReviewIds(limit = 3) {
    return extractReviewsFromCurrentPage()
      .slice(0, limit)
      .map((review) => review.id || '(no-id)')
      .join(', ');
  }

  async function waitForReviewDomUpdate(previousIds, expectedPage) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < DOM_UPDATE_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (hasReviewPageError()) {
        return { status: 'error', ids: getCurrentReviewIds() };
      }

      const currentPage = getCurrentPageNumber();
      const currentIds = getCurrentReviewIds();
      if (currentPage === expectedPage && currentIds && currentIds !== previousIds) {
        return { status: 'updated', ids: currentIds };
      }
    }

    return { status: 'timeout', ids: getCurrentReviewIds() };
  }

  function chooseSupplementalFilters(state) {
    const textReviewCount = state.textReviewCount || 0;
    if (!textReviewCount) return [];

    const currentBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    state.reviews.forEach((review) => {
      const rounded = Math.max(1, Math.min(5, Math.round(review.rating || 0)));
      currentBreakdown[rounded] += 1;
    });

    const expectedBreakdown = state.ratingBreakdown || {};
    return Object.entries(expectedBreakdown)
      .map(([star, expected]) => {
        const starNum = parseInt(star, 10);
        const actual = currentBreakdown[starNum] || 0;
        return { starNum, gap: Math.max(0, expected - actual), expected };
      })
      .filter(({ gap, expected }) => expected >= 5 && gap >= 5)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 3)
      .map(({ starNum }) => ({
        1: 'one_star',
        2: 'two_star',
        3: 'three_star',
        4: 'four_star',
        5: 'five_star',
      }[starNum]));
  }

  async function markCollectionBlocked(state, reason) {
    const nextState = {
      ...state,
      collecting: false,
      blocked: true,
      blockReason: reason,
      blockedAt: new Date().toISOString(),
    };
    await saveCollectionState(nextState);
    chrome.runtime.sendMessage({
      type: 'COLLECTION_BLOCKED',
      reason,
      total: nextState.reviews.length,
    }).catch(() => {});
  }

  async function finalizeCollection(state) {
    const nextState = {
      ...state,
      collecting: false,
      completedAt: new Date().toISOString(),
    };
    await saveCollectionState(nextState);
    chrome.runtime.sendMessage({
      type: 'COLLECTION_COMPLETE',
      reviews: nextState.reviews,
      productInfo: nextState.productInfo,
      textReviewCount: nextState.textReviewCount || 0,
      phase: nextState.phase,
    }).catch(() => {});
  }

  // storageからコレクション状態を読み込み
  async function loadCollectionState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['reviewai_state'], (result) => {
        resolve(result.reviewai_state || null);
      });
    });
  }

  // storageにコレクション状態を保存
  async function saveCollectionState(state) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ reviewai_state: state }, resolve);
    });
  }

  // storageのコレクション状態をクリア
  async function clearCollectionState() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['reviewai_state'], resolve);
    });
  }

  // レビューページからテキスト付きレビュー総数を取得
  function getTextReviewCount() {
    const selectors = [
      '[data-hook="cr-filter-info-review-rating-count"]',
      '#filter-info-section',
      '.a-row.a-spacing-base .a-size-base',
      '#cm_cr-review_list',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) continue;

      const text = (element.textContent || '').trim();
      if (!text) continue;

      console.log(`[ReviewAI] textReviewCount candidate (${selector}): ${text.slice(0, 200)}`);
      const match = text.match(/([\d,]+)\s*件中/)
        || text.match(/of\s+([\d,]+)/i)
        || text.match(/([\d,]+)\s*件のカスタマーレビュー/)
        || text.match(/([\d,]+)\s*件のレビュー/)
        || text.match(/([\d,]+)\s*件/)
        || text.match(/([\d,]+)\s*global ratings/i);

      if (match) {
        return parseInt(match[1].replace(/,/g, ''), 10);
      }
    }

    // ページネーションの最後のページ番号 × 10 で概算
    const lastPage = document.querySelector('.a-pagination li:nth-last-child(2) a');
    if (lastPage) {
      const pageNum = parseInt(lastPage.textContent);
      if (!isNaN(pageNum)) return pageNum * 10;
    }
    return null;
  }

  // レビューページに到着した時の処理（自動巡回モード）
  async function handleReviewsPageArrival(options = {}) {
    const state = await loadCollectionState();
    if (!state || !state.collecting) return;
    const { fromDomUpdate = false } = options;

    const actualPage = getCurrentPageNumber();
    const actualFilter = getCurrentFilter();
    console.log(
      `[ReviewAI] Arrived at reviews page. phase=${state.phase}, expectedPage=${state.currentPage}, actualPage=${actualPage}, expectedFilter=${state.phase}, actualFilter=${actualFilter}, collected=${state.reviews.length}, fromDomUpdate=${fromDomUpdate}`
    );

    // 少し待ってDOMが完全にロードされるのを待つ
    await new Promise((resolve) => setTimeout(resolve, fromDomUpdate ? 500 : 1500));

    if (isBlockedPage()) {
      console.warn('[ReviewAI] Block page detected. Collection stopped.');
      await markCollectionBlocked(state, 'Amazon側でアクセス制限が検出されました。しばらく待ってから再開してください。');
      return;
    }

    if (actualPage !== (state.currentPage || 1)) {
      console.warn(`[ReviewAI] Page number mismatch. state=${state.currentPage}, actual=${actualPage}`);
      state.currentPage = actualPage;
    }

    if (actualFilter !== (state.phase || 'all')) {
      console.warn(`[ReviewAI] Filter mismatch. state=${state.phase}, actual=${actualFilter}`);
      state.phase = actualFilter;
    }

    // 初回ページでテキスト付きレビュー数を取得
    if (state.phase === 'all' && state.currentPage === 1 && !state.textReviewCount) {
      const textCount = getTextReviewCount();
      if (textCount !== null) {
        state.textReviewCount = textCount;
        state.targetReviewCount = Math.ceil(textCount * ALL_FILTER_TARGET_RATE);
        state.ratingBreakdown = getRatingBreakdownFromPage();
        console.log(`[ReviewAI] Text reviews (with comments): ${textCount}, target=${state.targetReviewCount}, Total ratings: ${state.productInfo?.totalReviews || '?'}`);
        chrome.runtime.sendMessage({
          type: 'TEXT_REVIEW_COUNT',
          textReviewCount: textCount,
          totalRatings: state.productInfo?.totalReviews || 0,
        }).catch(() => {});
      }
    }

    // 現在のページからレビューを取得
    const pageReviews = extractReviewsFromCurrentPage();
    console.log(`[ReviewAI] Found ${pageReviews.length} reviews on this page`);
    console.log(
      '[ReviewAI] Sample reviews:',
      pageReviews.slice(0, 3).map((review) => ({
        id: review.id || '',
        title: review.title,
        body: review.body.slice(0, 60),
      }))
    );
    console.log(
      `[ReviewAI] Review IDs page=${actualPage}: ${pageReviews.slice(0, 3).map((review) => review.id || '(no-id)').join(', ')}`
    );

    // 重複除去して追加
    const seenKeys = new Set(state.reviews.map((r) => getReviewKey(r)));
    let addedCount = 0;
    for (const review of pageReviews) {
      const key = getReviewKey(review);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        state.reviews.push(review);
        addedCount++;
      }
    }

    state.zeroNewPages = addedCount === 0 ? (state.zeroNewPages || 0) + 1 : 0;
    console.log(`[ReviewAI] Added ${addedCount} new reviews, total: ${state.reviews.length}`);

    // 進捗を通知
    chrome.runtime.sendMessage({
      type: 'COLLECTION_PROGRESS',
      total: state.reviews.length,
      currentPage: state.currentPage,
      currentFilter: getFilterLabel(state.phase),
    }).catch(() => {});

    // 次のページへ進むか判定
    const maxPages = state.phase === 'all' ? MAX_PAGES_PER_FILTER : 3;
    const hasNextPage = !!document.querySelector('.a-pagination .a-last:not(.a-disabled) a, li.a-last:not(.a-disabled) a');
    const asin = extractAsin();
    const nextPageNum = (state.currentPage || 1) + 1;
    const nextUrl = buildReviewPageUrl(asin, nextPageNum, state.phase);
    const shouldContinuePaging = hasNextPage
      && nextPageNum <= maxPages
      && state.zeroNewPages < ZERO_NEW_PAGE_LIMIT;

    console.log(
      `[ReviewAI] Pagination check: hasNext=${hasNextPage}, nextPage=${nextPageNum}, maxPages=${maxPages}, addedCount=${addedCount}, zeroNewPages=${state.zeroNewPages}, target=${state.targetReviewCount || 0}`
    );

    if (shouldContinuePaging) {
      console.log(`[ReviewAI] Navigating to page ${nextPageNum}: ${nextUrl}`);
      await goToNextReviewPage(state, nextPageNum, nextUrl);
      return;
    }

    const shouldSupplement = state.phase === 'all'
      && state.textReviewCount
      && state.reviews.length < (state.targetReviewCount || 0)
      && !state.supplementAttempted;

    if (shouldSupplement) {
      const supplementalFilters = chooseSupplementalFilters(state);
      if (supplementalFilters.length > 0) {
        state.supplementAttempted = true;
        state.pendingFilters = supplementalFilters;
        console.log(`[ReviewAI] Supplemental filters selected: ${supplementalFilters.join(', ')}`);
      }
    }

    if (state.pendingFilters && state.pendingFilters.length > 0) {
      const nextFilter = state.pendingFilters.shift();
      state.phase = nextFilter;
      state.currentPage = 1;
      state.zeroNewPages = 0;
      await saveCollectionState(state);

      const waitTime = randomDelay(8000, 12000);
      const filterUrl = buildReviewPageUrl(asin, 1, nextFilter);
      console.log(`[ReviewAI] Moving to supplemental filter ${nextFilter} after ${Math.round(waitTime / 1000)}s: ${filterUrl}`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      window.location.href = filterUrl;
      return;
    }

    if (state.phase !== 'all' && state.pendingFilters && state.pendingFilters.length === 0) {
      state.phase = 'all';
    }

    console.log(`[ReviewAI] Collection complete. Total unique reviews: ${state.reviews.length}`);
    await finalizeCollection(state);
  }

  function createInitialState(asin, info) {
    return {
      collecting: true,
      blocked: false,
      asin,
      productInfo: info,
      reviews: [],
      phase: 'all',
      currentPage: 1,
      zeroNewPages: 0,
      pendingFilters: [],
      supplementAttempted: false,
      startedAt: new Date().toISOString(),
    };
  }

  async function stopCollection() {
    const state = await loadCollectionState();
    if (!state) {
      await clearCollectionState();
      return;
    }

    await saveCollectionState({
      ...state,
      collecting: false,
      stoppedAt: new Date().toISOString(),
    });
  }

  // popup.jsからのメッセージを受信
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_PAGE_INFO') {
      const pageType = getPageType();
      const info = getProductInfo();
      sendResponse({ pageType, productInfo: info });
      return true;
    }

    if (msg.type === 'START_COLLECTION') {
      const asin = extractAsin();
      if (!asin) {
        sendResponse({ error: 'ASINが見つかりません' });
        return true;
      }

      const info = getProductInfo();
      console.log(`[ReviewAI] Starting collection for ASIN: ${asin}`);

      // コレクション状態を初期化してレビューページに遷移
      const state = createInitialState(asin, info);

      saveCollectionState(state).then(() => {
        const url = buildReviewPageUrl(asin, 1, 'all');
        window.location.href = url;
      });

      sendResponse({ started: true });
      return true;
    }

    if (msg.type === 'STOP_COLLECTION') {
      stopCollection().then(() => {
        sendResponse({ stopped: true });
      });
      return true;
    }

    if (msg.type === 'GET_COLLECTED_REVIEWS') {
      loadCollectionState().then((state) => {
        const reviews = state ? state.reviews : [];
        sendResponse({ reviews, productInfo: state?.productInfo || getProductInfo() });
      });
      return true;
    }

    if (msg.type === 'GET_COLLECTION_STATUS') {
      loadCollectionState().then((state) => {
        sendResponse({
          collecting: state?.collecting || false,
          total: state?.reviews?.length || 0,
          phase: state?.phase || 'none',
          currentPage: state?.currentPage || 0,
        });
      });
      return true;
    }
  });

  // ページロード時：レビューページなら自動巡回を継続
  if (isReviewsPage()) {
    handleReviewsPageArrival();
  }
})();

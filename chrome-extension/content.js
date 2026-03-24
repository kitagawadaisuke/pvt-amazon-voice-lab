// Amazon Voice Lab Content Script
// Amazon商品ページ・レビューページからレビューを自動取得する
// 方式: 実際にページ遷移してDOMから直接取得（fetchだとpageNumberが無視されるため）

(function () {
  'use strict';

  const HARD_PAGE_LIMIT_ALL = 1200;
  const HARD_PAGE_LIMIT_SUPPLEMENTAL = 200;
  const AMAZON_REVIEW_UI_PAGE_CAP = 10;
  const ZERO_NEW_PAGE_LIMIT_SUPPLEMENTAL = 2;
  const ALL_FILTER_TARGET_RATE = 1.0;
  const DOM_UPDATE_TIMEOUT_MS = 8000;
  const SUPPLEMENTAL_FILTER_SEQUENCE = [
    'five_star',
    'four_star',
    'three_star',
    'two_star',
    'one_star',
  ];
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
  function parseAmazonRatingText(text) {
    if (!text) return 0;

    const normalized = text.replace(/,/g, '.');
    const explicitMatch = normalized.match(/うち\s*([\d.]+)/)
      || normalized.match(/out of\s*([\d.]+)/i)
      || normalized.match(/([\d.]+)\s*out of/i);
    if (explicitMatch) {
      return parseFloat(explicitMatch[1]);
    }

    const matches = normalized.match(/[\d.]+/g);
    if (!matches || matches.length === 0) return 0;
    return parseFloat(matches[matches.length - 1]);
  }

  function parseHistogramRows(rows, totalReviews) {
    const breakdown = {};

    rows.forEach((row) => {
      const ariaText = row.getAttribute('aria-label')
        || row.querySelector('[aria-label]')?.getAttribute('aria-label')
        || '';
      const text = `${ariaText} ${(row.textContent || '')}`.replace(/\s+/g, ' ').trim();
      if (!text) return;

      const starMatch = text.match(/星\s*([1-5])|([1-5])\s*つ星|([1-5])\s*star/i);
      const star = starMatch
        ? parseInt(starMatch[1] || starMatch[2] || starMatch[3], 10)
        : null;
      if (!star) return;

      const countMatch = text.match(/([\d,]+)\s*(件|global ratings|ratings|reviews)/i);
      if (countMatch) {
        breakdown[star] = parseInt(countMatch[1].replace(/,/g, ''), 10);
        return;
      }

      const percentMatch = text.match(/(\d{1,3})\s*%/);
      if (percentMatch && totalReviews > 0) {
        breakdown[star] = Math.round((totalReviews * parseInt(percentMatch[1], 10)) / 100);
      }
    });

    return breakdown;
  }

  function getRatingBreakdownFromDom(totalReviews = 0) {
    const selectors = [
      '#histogramTable tr',
      '[data-hook="cr-ratings-histogram"] .a-histogram-row',
      '.a-popover-content #histogramTable tr',
      '#cm_cr_dp_d_rating_histogram .a-link-normal',
      '#cm_cr_dp_d_rating_histogram .a-histogram-row',
      '#cm_cr_dp_d_rating_histogram li',
      '[data-hook="cr-filter-info-section"] ~ div .a-link-normal[aria-label*="%"]',
    ];

    for (const selector of selectors) {
      const rows = Array.from(document.querySelectorAll(selector));
      if (rows.length === 0) continue;

      const breakdown = parseHistogramRows(rows, totalReviews);
      if (Object.keys(breakdown).length > 0) {
        return breakdown;
      }
    }

    return {};
  }

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
      rating = parseAmazonRatingText(ratingEl.textContent || '');
    }

    const ratingBreakdown = getRatingBreakdownFromDom(totalReviews);

    // 価格取得
    let price = null;
    const priceEl = document.querySelector(
      '.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .a-price-whole, #corePrice_feature_div .a-offscreen, #tp_price_block_total_price_ww .a-offscreen'
    );
    if (priceEl) {
      const priceText = priceEl.textContent.trim();
      const priceMatch = priceText.replace(/[,，]/g, '').match(/[\d]+/);
      if (priceMatch) {
        price = parseInt(priceMatch[0], 10);
      }
    }

    return {
      asin,
      title: titleEl ? titleEl.textContent.trim() : `Amazon商品 ${asin}`,
      rating,
      totalReviews,
      ratingBreakdown,
      price,
    };
  }

  // 現在のページからレビューを抽出（DOM直接読み取り）
  function extractReviewsFromCurrentPage() {
    const reviews = [];
    const reviewEls = document.querySelectorAll('[data-hook="review"]');

    reviewEls.forEach((el) => {
      const title = extractReviewTitle(el);
      const bodyEl = el.querySelector('[data-hook="review-body"] span, .review-text-content span');
      const ratingEl = el.querySelector('[data-hook="review-star-rating"] .a-icon-alt, .review-rating .a-icon-alt');
      const dateEl = el.querySelector('[data-hook="review-date"]');
      const verifiedEl = el.querySelector('[data-hook="avp-badge"]');
      const helpfulEl = el.querySelector('[data-hook="helpful-vote-statement"]');
      const reviewId = el.id || el.getAttribute('id') || '';

      let rating = 3;
      if (ratingEl) {
        rating = parseAmazonRatingText(ratingEl.textContent || '') || 3;
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
        title,
        body,
        rating,
        date: dateEl ? dateEl.textContent.trim() : '',
        verified: !!verifiedEl,
        helpfulVotes,
      });
    });

    return reviews;
  }

  function extractReviewTitle(reviewEl) {
    const titleSpans = Array.from(
      reviewEl.querySelectorAll('[data-hook="review-title"] span, .review-title-content span')
    )
      .map((span) => (span.textContent || '').trim())
      .filter(Boolean)
      .filter((text) => !text.includes('つ星のうち'));

    if (titleSpans.length > 0) {
      return titleSpans[titleSpans.length - 1];
    }

    const titleContainer = reviewEl.querySelector('[data-hook="review-title"], .review-title-content');
    const fallback = titleContainer ? (titleContainer.textContent || '').trim() : '';
    return fallback && !fallback.includes('つ星のうち') ? fallback : '(タイトルなし)';
  }

  // レビューページかどうか
  function isReviewsPage() {
    return window.location.href.includes('/product-reviews/');
  }

  function getCurrentPageNumber() {
    const url = new URL(window.location.href);
    return parseInt(url.searchParams.get('pageNumber') || '1', 10);
  }

  function getPaginationTotalPages() {
    const pageCandidates = Array.from(document.querySelectorAll('.a-pagination li, .a-pagination a, .a-pagination span'))
      .map((element) => parseInt((element.textContent || '').trim(), 10))
      .filter((value) => !Number.isNaN(value) && value > 0);

    if (pageCandidates.length === 0) {
      return null;
    }

    return Math.max(...pageCandidates);
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

  async function getServerUrl() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['serverUrl'], (result) => {
        resolve((result.serverUrl || 'http://localhost:3000').replace(/\/$/, ''));
      });
    });
  }

  async function runAnalyzeFlow(state) {
    if (!state || !state.reviews || state.reviews.length === 0) {
      return;
    }

    const serverUrl = await getServerUrl();
    const payload = {
      asin: state.productInfo?.asin,
      source: 'chrome_extension',
      reviews: {
        asin: state.productInfo?.asin,
        productName: state.productInfo?.title,
        totalReviews: state.productInfo?.totalReviews || state.reviews.length,
        reviewListCount: state.textReviewCount || state.reviews.length,
        averageRating: state.productInfo?.rating || 0,
        ratingBreakdown: state.ratingBreakdown || state.productInfo?.ratingBreakdown || {},
        starFetchStats: buildStarFetchStats(state),
        reviews: state.reviews,
        lowRatingReviews: state.reviews.filter((review) => review.rating <= 2),
        highRatingReviews: state.reviews.filter((review) => review.rating >= 4),
        fetchedAt: new Date().toISOString(),
        price: state.productInfo?.price || null,
      },
    };

    const analyzingState = {
      ...state,
      collecting: false,
      analyzing: true,
      blocked: false,
    };
    await saveCollectionState(analyzingState);
    chrome.runtime.sendMessage({
      type: 'ANALYSIS_STARTED',
      total: state.reviews.length,
      productInfo: state.productInfo,
    }).catch(() => {});

    try {
      let { accessToken, refreshToken } = await new Promise((resolve) =>
        chrome.storage.local.get(['accessToken', 'refreshToken'], resolve)
      );
      // アクセストークンが切れていた場合はリフレッシュ
      if (!accessToken && refreshToken) {
        try {
          const refreshRes = await fetch(
            'https://ajujveerddffossdrwmr.supabase.co/auth/v1/token?grant_type=refresh_token',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqdWp2ZWVyZGRmZm9zc2Ryd21yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjYwMjUsImV4cCI6MjA4ODk0MjAyNX0.CVJEqxgFpoW8D87zq8dYpWUYISvAKAKZUphFJ2YUy3Q',
              },
              body: JSON.stringify({ refresh_token: refreshToken }),
            }
          );
          const refreshData = await refreshRes.json();
          if (refreshData.access_token) {
            accessToken = refreshData.access_token;
            chrome.storage.local.set({
              accessToken: refreshData.access_token,
              refreshToken: refreshData.refresh_token || refreshToken,
            });
          }
        } catch {}
      }
      const reqHeaders = { 'Content-Type': 'application/json' };
      if (accessToken) reqHeaders['Authorization'] = `Bearer ${accessToken}`;
      const response = await fetch(`${serverUrl}/api/analyze`, {
        method: 'POST',
        headers: reqHeaders,
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      // 401のときはリフレッシュして1回だけ再試行
      if (response.status === 401 && refreshToken) {
        try {
          const refreshRes = await fetch(
            'https://ajujveerddffossdrwmr.supabase.co/auth/v1/token?grant_type=refresh_token',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqdWp2ZWVyZGRmZm9zc2Ryd21yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjYwMjUsImV4cCI6MjA4ODk0MjAyNX0.CVJEqxgFpoW8D87zq8dYpWUYISvAKAKZUphFJ2YUy3Q',
              },
              body: JSON.stringify({ refresh_token: refreshToken }),
            }
          );
          const refreshData = await refreshRes.json();
          if (refreshData.access_token) {
            chrome.storage.local.set({
              accessToken: refreshData.access_token,
              refreshToken: refreshData.refresh_token || refreshToken,
            });
            const retryHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${refreshData.access_token}` };
            const retryRes = await fetch(`${serverUrl}/api/analyze`, {
              method: 'POST',
              headers: retryHeaders,
              credentials: 'include',
              body: JSON.stringify(payload),
            });
            if (!retryRes.ok) throw new Error(`Server error: ${retryRes.status}`);
            await retryRes.json();
          } else {
            throw new Error('再ログインが必要です。拡張のポップアップからGoogleでログインしてください');
          }
        } catch (retryErr) {
          throw retryErr;
        }
      } else if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      } else {
        await response.json();
        const completedState = {
          ...analyzingState,
          analyzing: false,
          analyzedAt: new Date().toISOString(),
        };
        await saveCollectionState(completedState);
        chrome.runtime.sendMessage({
          type: 'ANALYSIS_COMPLETE',
          total: state.reviews.length,
          productInfo: state.productInfo,
        }).catch(() => {});
        window.open(`${serverUrl}/dashboard?asin=${state.productInfo?.asin}`, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      const failedState = {
        ...analyzingState,
        analyzing: false,
        blocked: true,
        blockReason: message,
      };
      await saveCollectionState(failedState);
      chrome.runtime.sendMessage({
        type: 'ANALYSIS_FAILED',
        error: message,
        total: state.reviews.length,
      }).catch(() => {});
    }
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

  function buildStarFetchStats(state) {
    const phaseKeys = ['five_star', 'four_star', 'three_star', 'two_star', 'one_star'];
    const stats = {};

    for (const phaseKey of phaseKeys) {
      const available = state?.filterReviewCounts?.[phaseKey] || 0;
      const fetched = (state?.reviews || []).filter((review) => {
        if (phaseKey === 'five_star') return review.rating >= 4.5;
        if (phaseKey === 'four_star') return review.rating >= 3.5 && review.rating < 4.5;
        if (phaseKey === 'three_star') return review.rating >= 2.5 && review.rating < 3.5;
        if (phaseKey === 'two_star') return review.rating >= 1.5 && review.rating < 2.5;
        return review.rating < 1.5;
      }).length;

      if (available > 0 || fetched > 0) {
        stats[phaseKey] = { available, fetched };
      }
    }

    return stats;
  }

  function getEstimatedTotalPages(state, currentPageReviewCount = 10) {
    const paginationTotalPages = getPaginationTotalPages();
    if (paginationTotalPages) {
      return paginationTotalPages;
    }

    const reviewCountBase = state?.phase && state.phase !== 'all'
      ? (state?.filterReviewCounts?.[state.phase] || 0)
      : (state?.textReviewCount || state?.productInfo?.totalReviews || 0);
    if (!reviewCountBase) {
      return null;
    }

    const pageSize = Math.max(currentPageReviewCount || 0, 10);
    return Math.max(1, Math.ceil(reviewCountBase / pageSize));
  }

  function getCollectionPageLimit(state, currentPageReviewCount = 10) {
    const estimatedTotalPages = getEstimatedTotalPages(state, currentPageReviewCount);
    const hardLimit = state?.phase === 'all' ? HARD_PAGE_LIMIT_ALL : HARD_PAGE_LIMIT_SUPPLEMENTAL;
    const uiCap = AMAZON_REVIEW_UI_PAGE_CAP;

    if (!estimatedTotalPages) {
      return Math.min(hardLimit, uiCap);
    }

    return Math.min(Math.max(estimatedTotalPages, state?.currentPage || 1), hardLimit, uiCap);
  }

  function isBlockedPage() {
    const text = document.body?.innerText || '';
    return BLOCKED_TEXT_PATTERNS.some((pattern) => text.includes(pattern));
  }

  function hasReviewPageError() {
    const text = document.body?.innerText || '';
    return REVIEW_PAGE_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
  }

  function getRatingBreakdownFromPage(totalReviews = 0) {
    return getRatingBreakdownFromDom(totalReviews);
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

    await runAnalyzeFlow(nextState);
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
        || text.match(/([\d,]+)\s*一致するカスタマーレビュー/)
        || text.match(/([\d,]+)\s*matching customer reviews/i)
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

    // 各フェーズの1ページ目で、現在フィルタのレビュー件数を取得
    if (state.currentPage === 1) {
      const textCount = getTextReviewCount();
      if (textCount !== null) {
        state.filterReviewCounts = {
          ...(state.filterReviewCounts || {}),
          [state.phase]: textCount,
        };
        state.textReviewCount = Object.values(state.filterReviewCounts).reduce((sum, count) => sum + (count || 0), 0);
        state.targetReviewCount = Math.ceil((state.textReviewCount || 0) * ALL_FILTER_TARGET_RATE);
        state.ratingBreakdown = getRatingBreakdownFromPage(state.productInfo?.totalReviews || 0);
        if ((!state.ratingBreakdown || Object.keys(state.ratingBreakdown).length === 0) && state.productInfo?.ratingBreakdown) {
          state.ratingBreakdown = state.productInfo.ratingBreakdown;
        }
        console.log(`[ReviewAI] Filter review count (${state.phase}): ${textCount}, accumulatedTextReviews=${state.textReviewCount}`);
        chrome.runtime.sendMessage({
          type: 'TEXT_REVIEW_COUNT',
          textReviewCount: state.textReviewCount,
          totalRatings: state.productInfo?.totalReviews || 0,
          targetReviewCount: state.targetReviewCount,
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
    state.displayTotalPages = getCollectionPageLimit(state, pageReviews.length) || state.displayTotalPages || state.currentPage || 1;
    console.log(`[ReviewAI] Added ${addedCount} new reviews, total: ${state.reviews.length}`);

    // 次のページへ進むか判定
    const maxPages = getCollectionPageLimit(state, pageReviews.length);
    const hasNextPage = !!document.querySelector('.a-pagination .a-last:not(.a-disabled) a, li.a-last:not(.a-disabled) a');
    const asin = extractAsin();
    const nextPageNum = (state.currentPage || 1) + 1;
    const nextUrl = buildReviewPageUrl(asin, nextPageNum, state.phase);
    const zeroNewPageLimit = ZERO_NEW_PAGE_LIMIT_SUPPLEMENTAL;
    const shouldContinuePaging = hasNextPage
      && nextPageNum <= maxPages
      && state.zeroNewPages < zeroNewPageLimit;

    // 進捗を通知
    chrome.runtime.sendMessage({
      type: 'COLLECTION_PROGRESS',
      total: state.reviews.length,
      currentPage: state.currentPage,
      currentFilter: getFilterLabel(state.phase),
      currentFilterKey: state.phase,
      textReviewCount: state.textReviewCount || 0,
      targetReviewCount: state.targetReviewCount || 0,
      totalRatings: state.productInfo?.totalReviews || 0,
      addedCount,
      maxPages: state.displayTotalPages || maxPages,
      zeroNewPages: state.zeroNewPages,
    }).catch(() => {});

    console.log(
      `[ReviewAI] Pagination check: hasNext=${hasNextPage}, nextPage=${nextPageNum}, maxPages=${maxPages}, addedCount=${addedCount}, zeroNewPages=${state.zeroNewPages}, zeroNewLimit=${zeroNewPageLimit}, target=${state.targetReviewCount || 0}`
    );

    if (shouldContinuePaging) {
      console.log(`[ReviewAI] Navigating to page ${nextPageNum}: ${nextUrl}`);
      await goToNextReviewPage(state, nextPageNum, nextUrl);
      return;
    }

    state.completedFilters = Array.from(new Set([...(state.completedFilters || []), state.phase]));

    if (state.pendingFilters && state.pendingFilters.length > 0) {
      const nextFilter = state.pendingFilters.shift();
      state.phase = nextFilter;
      state.currentPage = 1;
      state.zeroNewPages = 0;
      state.displayTotalPages = 1;
      state.phaseStartTotal = state.reviews.length;
      await saveCollectionState(state);

      const waitTime = randomDelay(8000, 12000);
      const filterUrl = buildReviewPageUrl(asin, 1, nextFilter);
      console.log(`[ReviewAI] Moving to next star filter ${nextFilter} after ${Math.round(waitTime / 1000)}s: ${filterUrl}`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      window.location.href = filterUrl;
      return;
    }

    console.log(`[ReviewAI] Collection complete. Total unique reviews: ${state.reviews.length}`);
    await finalizeCollection(state);
  }

  function createInitialState(asin, info) {
    const [firstFilter, ...remainingFilters] = SUPPLEMENTAL_FILTER_SEQUENCE;
    return {
      collecting: true,
      blocked: false,
      asin,
      productInfo: info,
      reviews: [],
      phase: firstFilter,
      phaseStartTotal: 0,
      currentPage: 1,
      zeroNewPages: 0,
      pendingFilters: remainingFilters,
      completedFilters: [],
      filterReviewCounts: {},
      supplementAttempted: false,
      displayTotalPages: 1,
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
        const url = buildReviewPageUrl(asin, 1, state.phase);
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

    if (msg.type === 'START_ANALYSIS') {
      loadCollectionState().then(async (state) => {
        if (!state || !state.reviews || state.reviews.length === 0) {
          sendResponse({ error: '分析できるレビューがありません' });
          return;
        }
        sendResponse({ started: true });
        await runAnalyzeFlow(state);
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

// ReviewAI Content Script
// Amazon商品ページ・レビューページからレビューを自動取得する
// 方式: 実際にページ遷移してDOMから直接取得（fetchだとpageNumberが無視されるため）

(function () {
  'use strict';

  let collectedReviews = [];
  let productInfo = null;

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

  // 次のページのURLを取得
  function getNextPageUrl() {
    // 複数のセレクタを試す
    const selectors = [
      '.a-pagination .a-last:not(.a-disabled) a',
      'li.a-last:not(.a-disabled) a',
      '.a-pagination li.a-last a',
      'ul.a-pagination li:last-child a',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.href) {
        console.log(`[ReviewAI] Next page found via: ${sel} -> ${el.href}`);
        return el.href;
      }
    }
    // デバッグ: ページネーション要素の状態を出力
    const pagination = document.querySelector('.a-pagination, ul.a-pagination');
    if (pagination) {
      console.log(`[ReviewAI] Pagination HTML:`, pagination.innerHTML.substring(0, 500));
      const lastLi = pagination.querySelector('li.a-last, li:last-child');
      if (lastLi) {
        console.log(`[ReviewAI] Last li classes: ${lastLi.className}, disabled: ${lastLi.classList.contains('a-disabled')}`);
      }
    } else {
      console.log('[ReviewAI] No pagination element found on page');
    }
    return null;
  }

  // レビューページかどうか
  function isReviewsPage() {
    return window.location.href.includes('/product-reviews/');
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
    // "○○件中1-10件のレビューを表示" or "Showing 1-10 of ○○ reviews"
    const filterInfo = document.querySelector('[data-hook="cr-filter-info-review-rating-count"], .a-row.a-spacing-base .a-size-base');
    if (filterInfo) {
      // 日本語: "1,234件中" / 英語: "of 1,234 reviews"
      const text = filterInfo.textContent;
      const match = text.match(/([\d,]+)\s*件中/) || text.match(/of\s+([\d,]+)/);
      if (match) return parseInt(match[1].replace(/,/g, ''));
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
  async function handleReviewsPageArrival() {
    const state = await loadCollectionState();
    if (!state || !state.collecting) return;

    console.log(`[ReviewAI] Arrived at reviews page. Phase: ${state.phase}, collected so far: ${state.reviews.length}`);

    // 少し待ってDOMが完全にロードされるのを待つ
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 初回ページでテキスト付きレビュー数を取得
    if (state.phase === 'all' && state.currentPage === 1 && !state.textReviewCount) {
      const textCount = getTextReviewCount();
      if (textCount !== null) {
        state.textReviewCount = textCount;
        console.log(`[ReviewAI] Text reviews (with comments): ${textCount}, Total ratings: ${state.productInfo?.totalReviews || '?'}`);
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

    // 重複除去して追加
    const seenBodies = new Set(state.reviews.map((r) => r.body.substring(0, 100)));
    let addedCount = 0;
    for (const review of pageReviews) {
      const key = review.body.substring(0, 100);
      if (!seenBodies.has(key)) {
        seenBodies.add(key);
        state.reviews.push(review);
        addedCount++;
      }
    }

    state.currentPage = (state.currentPage || 1) + 1;
    console.log(`[ReviewAI] Added ${addedCount} new reviews, total: ${state.reviews.length}`);

    // 進捗を通知
    chrome.runtime.sendMessage({
      type: 'COLLECTION_PROGRESS',
      total: state.reviews.length,
      currentPage: state.currentPage - 1,
      currentFilter: state.phase === 'all' ? '全て' : state.phase,
    }).catch(() => {});

    // 次のページへ進むか判定
    const maxPages = 10;
    const hasNextPage = !!document.querySelector('.a-pagination .a-last:not(.a-disabled) a, li.a-last:not(.a-disabled) a');
    const nextPageNum = state.currentPage; // currentPageは既にインクリメント済み（=次のページ番号）
    const asin = extractAsin();
    const domain = window.location.hostname;
    const filterParam = state.phase === 'all' ? '' : `&filterByStar=${state.phase}`;
    const nextUrl = `https://${domain}/product-reviews/${asin}?pageNumber=${nextPageNum}&sortBy=recent${filterParam}`;

    console.log(`[ReviewAI] Pagination check: hasNext=${hasNextPage}, nextPage=${nextPageNum}, maxPages=${maxPages}, pageReviews=${pageReviews.length}, newReviews=${addedCount}`);
    if (hasNextPage && nextPageNum <= maxPages && addedCount > 0) {
      // 次のページへ遷移（URLを自前構築）
      await saveCollectionState(state);
      console.log(`[ReviewAI] Navigating to page ${nextPageNum}: ${nextUrl}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));
      window.location.href = nextUrl;
    } else {
      // 現在のフィルタが終了。次の星フィルタへ
      console.log(`[ReviewAI] Finished phase: ${state.phase}. Reviews so far: ${state.reviews.length}`);

      const starFilters = ['all', 'one_star', 'two_star', 'three_star', 'four_star', 'five_star'];
      const currentIndex = starFilters.indexOf(state.phase);
      const nextFilter = starFilters[currentIndex + 1];

      // all_starsで十分取れた場合はスキップ
      if (state.phase === 'all' && state.reviews.length >= 80) {
        // 十分取れたので星フィルタも試す
      }

      if (nextFilter && state.reviews.length < 500) {
        // 次のフィルタへ
        state.phase = nextFilter;
        state.currentPage = 1;
        await saveCollectionState(state);

        const asin = extractAsin();
        const domain = window.location.hostname;
        const url = `https://${domain}/product-reviews/${asin}?pageNumber=1&sortBy=recent&filterByStar=${nextFilter}`;
        console.log(`[ReviewAI] Moving to filter: ${nextFilter}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        window.location.href = url;
      } else {
        // 全て完了
        console.log(`[ReviewAI] Collection complete! Total: ${state.reviews.length} reviews`);

        const finalReviews = state.reviews;
        const productInfoData = state.productInfo;
        await clearCollectionState();

        chrome.runtime.sendMessage({
          type: 'COLLECTION_COMPLETE',
          reviews: finalReviews,
          productInfo: productInfoData,
        }).catch(() => {});
      }
    }
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
      const state = {
        collecting: true,
        asin,
        productInfo: info,
        reviews: [],
        phase: 'all',
        currentPage: 1,
        startedAt: new Date().toISOString(),
      };

      saveCollectionState(state).then(() => {
        const domain = window.location.hostname;
        const url = `https://${domain}/product-reviews/${asin}?pageNumber=1&sortBy=recent`;
        window.location.href = url;
      });

      sendResponse({ started: true });
      return true;
    }

    if (msg.type === 'STOP_COLLECTION') {
      clearCollectionState().then(() => {
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

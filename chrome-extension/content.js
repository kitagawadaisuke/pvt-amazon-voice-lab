// Amazon Voice Lab Content Script
// Amazon商品ページ・レビューページからレビューを自動取得する
// 方式: レビューページ HTML を fetch で直接取得してページネーション

(function () {
  'use strict';

  const ALL_FILTER_TARGET_RATE = 1.0;
  const BLOCKED_TEXT_PATTERNS = [
    'ご迷惑をおかけしています',
    '入力された文字を読み取ってください',
    'Enter the characters you see below',
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
  function extractReviewsFromContainer(root) {
    const reviews = [];
    const reviewEls = root.querySelectorAll('[data-hook="review"]');

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

  function extractReviewsFromCurrentPage() {
    return extractReviewsFromContainer(document);
  }

  function parseHtmlFragment(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
    return doc.body;
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

  function buildReviewPageUrl(asin, pageNumber, filterByStar) {
    // Amazon は pageNumber クエリを無視することがあるため、/ref=.../ 付きパスを使う
    const refPath = pageNumber > 1
      ? `/ref=cm_cr_arp_d_paging_btm_next_${pageNumber}`
      : `/ref=cm_cr_arp_d_paging_btm_prev_1`;
    const url = new URL(`https://${window.location.hostname}/product-reviews/${asin}${refPath}`);
    url.searchParams.set('ie', 'UTF8');
    url.searchParams.set('pageNumber', String(pageNumber));
    url.searchParams.set('pageSize', '10');
    url.searchParams.set('sortBy', 'recent');
    url.searchParams.set('reviewerType', 'all_reviews');
    if (filterByStar && filterByStar !== 'all') {
      url.searchParams.set('filterByStar', filterByStar);
    }
    return url.toString();
  }

  // SellerSprite と完全に同じ方式:
  // Step1: /product-reviews/{ASIN}/ref=cm_cr_getr_d_show_all を fetch
  //   → HTML内の #cr-state-object[data-state] から reviewsCsrfToken を取得
  // Step2: 各ページを /portal/customer-reviews/ajax/reviews/get/ref=... に POST
  //   → nextPageToken を使ってカーソル式ページネーション
  //   → XMLHttpRequest を使用（fetch ではない！）

  // 商品レビューページ HTML を fetch して初期情報を抽出
  async function fetchReviewsPage1(asin, filterByStar) {
    // SellerSprite と同じ URL 構築
    const star = filterByStar || 'all_stars';
    const url = `https://${window.location.hostname}/product-reviews/${asin}/ref=cm_cr_getr_d_show_all?ie=UTF8&showViewpoints=1&pageNumber=1&reviewerType=all_reviews&filterByStar=${star}&sortBy=recent`;

    const response = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'text/html' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from reviews page`);
    const html = await response.text();
    if (BLOCKED_TEXT_PATTERNS.some((p) => html.includes(p))) {
      throw new Error('Amazon robot check detected');
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // CSRF トークン抽出: #cr-state-object の data-state 属性から
    let csrfToken = null;
    const stateEl = doc.querySelector('#cr-state-object');
    if (stateEl) {
      const dataState = stateEl.getAttribute('data-state');
      if (dataState) {
        try {
          const parsed = JSON.parse(dataState);
          csrfToken = parsed.reviewsCsrfToken || null;
        } catch (e) {
          console.warn('[ReviewAI] Failed to parse cr-state-object:', e);
        }
      }
    }

    // レビュー総数を抽出
    const ratingCountText = doc.querySelector('[data-hook="cr-filter-info-review-rating-count"]')?.textContent || '';
    const parts = ratingCountText.split(/\||, |、/);
    let totalReviews = 0;
    if (parts.length === 1) {
      totalReviews = parseInt(parts[0].replace(/[\s\t,]/g, '').match(/\d+/)?.[0] || '0', 10);
    } else if (parts.length === 2) {
      totalReviews = parseInt(parts[1].replace(/[\s\t,]/g, '').match(/\d+/)?.[0] || '0', 10);
    }

    return { doc, csrfToken, totalReviews, html };
  }

  // background script (service worker) 経由で fetch を実行
  // content.js の fetch だと Amazon に CORS/oriフンで弾かれるが、
  // background は extension の権限で動くので制限を受けない
  async function fetchInPageContext(url, options) {
    const response = await chrome.runtime.sendMessage({
      type: 'AMAZON_AJAX_FETCH',
      url,
      options,
    });
    if (!response || !response.ok) {
      throw new Error(response?.error || 'background fetch failed');
    }
    return { status: response.status, text: response.text };
  }

  // SellerSprite の fPost を完全再現: XMLHttpRequest でシンプルに POST
  function amazonXhrPost(url, body, headers) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
      if (headers) {
        for (const key in headers) {
          xhr.setRequestHeader(key, headers[key]);
        }
      }
      xhr.withCredentials = true;
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          resolve({ status: xhr.status, text: xhr.responseText });
        }
      };
      xhr.onerror = () => reject(new Error('XHR network error'));
      try {
        xhr.send(body);
      } catch (e) {
        reject(e);
      }
    });
  }

  // AJAX でページを取得（SellerSprite と完全同形式）
  // page 1: ref = cm_cr_arp_d_viewopt_sr
  // page 2+: ref = cm_cr_getr_d_paging_btm
  async function fetchReviewsAjaxPage(asin, filterByStar, pageNumber, nextPageToken, csrfToken) {
    const refTag = pageNumber === 1 ? 'cm_cr_arp_d_viewopt_sr' : 'cm_cr_getr_d_paging_btm';
    const url = `https://${window.location.hostname}/portal/customer-reviews/ajax/reviews/get/ref=${refTag}`;

    // SellerSprite と完全同形式の URLSearchParams
    const formData = new URLSearchParams();
    formData.append('sortBy', 'recent');
    formData.append('reviewerType', '');
    formData.append('formatType', '');
    formData.append('mediaType', '');
    formData.append('filterByStar', filterByStar || 'all_stars');
    formData.append('filterByAge', '');
    formData.append('pageNumber', String(pageNumber));
    formData.append('filterByLanguage', '');
    formData.append('filterByKeyword', '');
    formData.append('shouldAppend', 'undefined');
    formData.append('deviceType', 'desktop');
    formData.append('canShowIntHeader', 'undefined');
    formData.append('reviewsShown', 'undefined');
    formData.append('reftag', refTag);
    formData.append('pageSize', '10');
    formData.append('asin', asin);
    formData.append('scope', 'reviewsAjax' + (pageNumber - 1));
    if (pageNumber !== 1 && nextPageToken) {
      formData.append('nextPageToken', nextPageToken);
    }

    const result = await amazonXhrPost(url, formData, {
      'anti-csrftoken-a2z': csrfToken,
    });

    if (result.status < 200 || result.status >= 300) {
      console.warn(`[ReviewAI] AJAX ${result.status} body(200): ${result.text.substring(0, 200)}`);
      throw new Error(`HTTP ${result.status} from AJAX`);
    }

    const text = result.text;
    if (BLOCKED_TEXT_PATTERNS.some((p) => text.includes(p))) {
      throw new Error('Amazon robot check detected');
    }

    // SellerSprite と同じパース方式
    // レスポンスは `&&&[...]&&&[...]` 形式
    const parsed = text
      .replace(/\n/g, '')
      .split('&&&')
      .filter((e) => e != null && e.length !== 0)
      .map((e) => {
        try { return JSON.parse(e); } catch { return null; }
      })
      .filter((e) => e != null);

    // append + #cm_cr-review_list でレビューHTML
    const reviewChunks = parsed
      .filter((e) => Array.isArray(e) && e.length === 3 && e[0] === 'append' && e[1] === '#cm_cr-review_list' && typeof e[2] === 'string' && e[2].indexOf('data-hook="review"') !== -1)
      .map((e) => e[2]);

    // update + #cm_cr-pagination_bar で次ページトークン
    const paginationChunks = parsed
      .filter((e) => Array.isArray(e) && e.length === 3 && e[0] === 'update' && e[1] === '#cm_cr-pagination_bar' && typeof e[2] === 'string' && e[2].indexOf('data-hook="show-more-button"') !== -1)
      .map((e) => e[2]);

    // レビューHTMLをパース
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<!DOCTYPE html><html><body>${reviewChunks.join('')}</body></html>`, 'text/html');

    // nextPageToken: show-more-button の data-reviews-state-param から取得
    let nextToken = null;
    if (paginationChunks.length > 0) {
      const pagDoc = parser.parseFromString(`<!DOCTYPE html><html><body>${paginationChunks.join('')}</body></html>`, 'text/html');
      const btn = pagDoc.querySelector('a[data-hook="show-more-button"]');
      const stateParam = btn?.getAttribute('data-reviews-state-param');
      if (stateParam) {
        try {
          const parsedState = JSON.parse(stateParam);
          nextToken = parsedState.nextPageToken || null;
        } catch (e) {
          console.warn('[ReviewAI] Failed to parse show-more-button state:', e);
        }
      }
    }

    return { doc, nextPageToken: nextToken };
  }

  function getAntiCsrfToken() {
    // 1) meta タグ
    const meta = document.querySelector('meta[name="anti-csrftoken-a2z"]');
    if (meta) {
      const v = meta.getAttribute('content');
      if (v) {
        console.log('[ReviewAI] CSRF token from meta tag');
        return v;
      }
    }

    // 2) input[name="anti-csrftoken-a2z"]
    const input = document.querySelector('input[name="anti-csrftoken-a2z"]');
    if (input?.value) {
      console.log('[ReviewAI] CSRF token from input');
      return input.value;
    }

    // 3) script 内の様々なパターン
    const scripts = document.querySelectorAll('script');
    const patterns = [
      /["']anti-csrftoken-a2z["']\s*:\s*["']([^"']+)["']/,
      /anti-csrftoken-a2z=([A-Za-z0-9%+/=_-]+)/,
      /CSRF_TOKEN["'\s:=]+["']([^"']+)["']/,
    ];
    for (const s of scripts) {
      const text = s.textContent || '';
      for (const re of patterns) {
        const m = text.match(re);
        if (m && m[1]) {
          console.log('[ReviewAI] CSRF token from script');
          return m[1];
        }
      }
    }

    // 4) 全リンク・要素のdata属性から探す
    const dataEls = document.querySelectorAll('[data-anti-csrftoken-a2z]');
    if (dataEls.length > 0) {
      const v = dataEls[0].getAttribute('data-anti-csrftoken-a2z');
      if (v) {
        console.log('[ReviewAI] CSRF token from data attribute');
        return v;
      }
    }

    console.warn('[ReviewAI] CSRF token NOT FOUND. The 403 will likely occur.');
    return null;
  }

  // 非表示 iframe を生成し、指定 URL をロードする
  // 既存 iframe を再利用する場合は iframe を渡す
  async function loadIframeUrl(iframe, url, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const onLoad = () => {
        if (settled) return;
        // load 後、JS で DOM が組み立てられるまで少し待つ
        setTimeout(() => {
          if (settled) return;
          settled = true;
          iframe.removeEventListener('load', onLoad);
          try {
            const doc = iframe.contentDocument;
            if (!doc) {
              reject(new Error('iframe contentDocument is null'));
              return;
            }
            resolve(doc);
          } catch (err) {
            reject(err);
          }
        }, 1500);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        iframe.removeEventListener('load', onLoad);
        reject(new Error(`iframe load timeout: ${url}`));
      }, timeoutMs);

      iframe.addEventListener('load', () => {
        clearTimeout(timer);
        onLoad();
      });

      iframe.src = url;
    });
  }

  function createHiddenIframe() {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1280px;height:900px;visibility:hidden;border:0;';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    document.body.appendChild(iframe);
    return iframe;
  }

  function findNextPageLinkInDoc(doc) {
    return doc.querySelector('.a-pagination .a-last:not(.a-disabled) a, li.a-last:not(.a-disabled) a');
  }

  // 指定フィルタのレビューを iframe 内で実際にナビゲートしながら取得
  // Amazon の URL 直 fetch では pageNumber が無視されるため、
  // ページ内の「次へ」リンクを実際にクリックして次ページに遷移する
  async function fetchReviewsForFilter(asin, filterByStar, onPage) {
    // SellerSprite と完全同一の方式:
    // Step1: /product-reviews/ を HTML で取得 → #cr-state-object からトークンを取得
    // Step2: page 1 から AJAX で取得（ref=cm_cr_arp_d_viewopt_sr）
    // Step3: page 2+ は ref=cm_cr_getr_d_paging_btm + nextPageToken で取得
    const collected = [];
    const MAX_PAGES = 10;

    // Step1: HTMLからトークン取得
    let csrfToken = null;
    let totalReviews = 0;
    try {
      const page1Info = await fetchReviewsPage1(asin, filterByStar);
      csrfToken = page1Info.csrfToken;
      totalReviews = page1Info.totalReviews;
      console.log(`[ReviewAI] filter=${filterByStar || 'all'} init: csrf=${csrfToken ? 'yes' : 'no'}, totalReviews=${totalReviews}`);
    } catch (err) {
      console.warn(`[ReviewAI] filter=${filterByStar || 'all'} init failed: ${err.message}`);
      return collected;
    }

    if (!csrfToken) {
      console.warn(`[ReviewAI] filter=${filterByStar || 'all'} no csrf token found, skip`);
      return collected;
    }

    if (totalReviews === 0) {
      console.log(`[ReviewAI] filter=${filterByStar || 'all'} has 0 reviews. Skip.`);
      return collected;
    }

    // Step2+3: ページ1から順に AJAX で取得
    let nextPageToken = null;
    const maxPages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(totalReviews / 10)));

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
      let result;
      try {
        result = await fetchReviewsAjaxPage(asin, filterByStar, pageNumber, nextPageToken, csrfToken);
      } catch (err) {
        console.warn(`[ReviewAI] filter=${filterByStar || 'all'} page ${pageNumber} failed: ${err.message}`);
        break;
      }

      const pageReviews = extractReviewsFromContainer(result.doc.body);
      console.log(`[ReviewAI] filter=${filterByStar || 'all'} page ${pageNumber}: extracted ${pageReviews.length} reviews (nextToken=${result.nextPageToken ? 'yes' : 'no'})`);

      if (pageReviews.length === 0) {
        console.log(`[ReviewAI] No reviews on filter=${filterByStar || 'all'} page ${pageNumber}. Done.`);
        break;
      }

      collected.push(...pageReviews);

      if (typeof onPage === 'function') {
        const shouldStop = await onPage({ pageNumber, pageReviews, total: collected.length, filterByStar });
        if (shouldStop) break;
      }

      if (!result.nextPageToken) {
        console.log(`[ReviewAI] No nextPageToken on filter=${filterByStar || 'all'} page ${pageNumber}. Done.`);
        break;
      }
      nextPageToken = result.nextPageToken;

      // ブロック回避のためのランダムウェイト
      await new Promise((resolve) => setTimeout(resolve, 1200 + Math.random() * 800));
    }

    return collected;
  }

  // 全フィルタ (★1〜★5) を順番に取得して合算
  // SellerSprite と同じ方式: Amazon の "全件" モードは100件制限なので、
  // ★ごとに取得して合計最大500件取得する
  async function fetchAllReviewsByStar(asin, onProgress) {
    const STAR_FILTERS = ['five_star', 'four_star', 'three_star', 'two_star', 'one_star'];
    const allCollected = [];
    const seenKeys = new Set();

    for (const filter of STAR_FILTERS) {
      console.log(`[ReviewAI] Fetching filter: ${filter}`);
      await fetchReviewsForFilter(asin, filter, async ({ pageNumber, pageReviews }) => {
        const newReviews = [];
        for (const review of pageReviews) {
          const key = getReviewKey(review);
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allCollected.push(review);
            newReviews.push(review);
          }
        }
        if (typeof onProgress === 'function') {
          return await onProgress({
            filter,
            pageNumber,
            newReviews,
            addedCount: newReviews.length,
            total: allCollected.length,
          });
        }
        return false;
      });
    }

    return allCollected;
  }

  async function getServerUrl() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['serverUrl'], (result) => {
        resolve((result.serverUrl || 'http://localhost:3000').replace(/\/$/, ''));
      });
    });
  }

  // サーバーへ収集進捗を報告（Supabase Realtime 経由でダッシュボードに配信）
  async function reportProgressToServer(state) {
    try {
      const { accessToken, serverUrl } = await new Promise((resolve) =>
        chrome.storage.local.get(['accessToken', 'serverUrl'], resolve)
      );
      if (!accessToken || !serverUrl) return;

      await fetch(`${serverUrl.replace(/\/$/, '')}/api/collection-progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          asin: state.asin || state.productInfo?.asin,
          productName: state.productInfo?.title,
          phase: state.phase,
          currentPage: state.currentPage,
          totalReviews: state.reviews?.length || 0,
          textReviewCount: state.textReviewCount || 0,
          status: state.collecting ? 'collecting' : state.analyzing ? 'analyzing' : state.blocked ? 'blocked' : 'completed',
          displayTotalPages: state.displayTotalPages || 0,
          completedFilters: state.completedFilters || [],
          blockReason: state.blockReason || null,
        }),
      });
    } catch {
      // サイレント失敗（レビュー収集は継続）
    }
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

  function isBlockedPage() {
    const text = document.body?.innerText || '';
    return BLOCKED_TEXT_PATTERNS.some((pattern) => text.includes(pattern));
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
    reportProgressToServer(nextState);
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
    reportProgressToServer(nextState);

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

  // レビューページに到着した時の処理
  // 新方式: AJAX エンドポイントを直接叩いて全フィルタ・全ページを一気に取得
  async function handleReviewsPageArrival() {
    const state = await loadCollectionState();
    if (!state || !state.collecting) return;

    const asin = extractAsin();
    console.log(`[ReviewAI] Arrived at reviews page. Starting HTML-fetch collection for ${asin}`);

    // 少し待って DOM が完全にロードされるのを待つ（Cookie 設定のため）
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (isBlockedPage()) {
      console.warn('[ReviewAI] Block page detected. Collection stopped.');
      await markCollectionBlocked(state, 'Amazon側でアクセス制限が検出されました。しばらく待ってから再開してください。');
      return;
    }

    // 合計レビュー数を DOM から取得（UI 表示用）
    const textCount = getTextReviewCount();
    if (textCount !== null) {
      state.textReviewCount = textCount;
      state.targetReviewCount = Math.ceil(textCount * ALL_FILTER_TARGET_RATE);
      state.filterReviewCounts = { ...(state.filterReviewCounts || {}), all: textCount };
      state.ratingBreakdown = getRatingBreakdownFromPage(state.productInfo?.totalReviews || 0);
      if ((!state.ratingBreakdown || Object.keys(state.ratingBreakdown).length === 0) && state.productInfo?.ratingBreakdown) {
        state.ratingBreakdown = state.productInfo.ratingBreakdown;
      }
      chrome.runtime.sendMessage({
        type: 'TEXT_REVIEW_COUNT',
        textReviewCount: state.textReviewCount,
        totalRatings: state.productInfo?.totalReviews || 0,
        targetReviewCount: state.targetReviewCount,
      }).catch(() => {});
      await saveCollectionState(state);
    }

    // SellerSprite 方式: ★1〜★5を順番に取得して合算
    // Amazon の "全件" モードは100件制限があるため、フィルタごとに取得が必須
    state.currentPage = 1;
    await saveCollectionState(state);
    console.log(`[ReviewAI] Fetching reviews by star filter (SellerSprite-style)...`);

    try {
      await fetchAllReviewsByStar(asin, async ({ filter, pageNumber, newReviews, addedCount, total }) => {
        // ユーザーが停止ボタンを押した場合
        const freshState = await loadCollectionState();
        if (!freshState?.collecting) {
          console.log('[ReviewAI] Stop requested. Halting collection.');
          return true;
        }

        for (const review of newReviews) {
          state.reviews.push(review);
        }

        state.phase = filter;
        state.currentPage = pageNumber;
        state.displayTotalPages = Math.max(state.displayTotalPages || 1, pageNumber);
        await saveCollectionState(state);

        console.log(`[ReviewAI] filter=${filter} page ${pageNumber}: added ${addedCount} (total ${state.reviews.length})`);

        chrome.runtime.sendMessage({
          type: 'COLLECTION_PROGRESS',
          total: state.reviews.length,
          currentPage: pageNumber,
          currentFilter: getFilterLabel(filter),
          currentFilterKey: filter,
          textReviewCount: state.textReviewCount || 0,
          targetReviewCount: state.targetReviewCount || 0,
          totalRatings: state.productInfo?.totalReviews || 0,
          addedCount,
          maxPages: 10,
        }).catch(() => {});
        reportProgressToServer(state);
        return false;
      });
    } catch (err) {
      console.error(`[ReviewAI] Collection failed:`, err);
    }

    console.log(`[ReviewAI] Collection complete. Total unique reviews: ${state.reviews.length}`);
    await finalizeCollection(state);
  }

  // ページ遷移せず、商品ページのまま fetch でレビューを取得
  // SellerSprite と同じ方式: バックグラウンドで HTML を fetch するだけ
  async function collectReviewsInPlace(state) {
    const asin = state.asin;
    console.log(`[ReviewAI] In-place collection started for ${asin}`);

    try {
      await fetchAllReviewsByStar(asin, async ({ filter, pageNumber, newReviews, addedCount }) => {
        const freshState = await loadCollectionState();
        if (!freshState?.collecting) {
          console.log('[ReviewAI] Stop requested. Halting collection.');
          return true;
        }

        for (const review of newReviews) {
          state.reviews.push(review);
        }

        state.phase = filter;
        state.currentPage = pageNumber;
        state.displayTotalPages = Math.max(state.displayTotalPages || 1, pageNumber);
        await saveCollectionState(state);

        console.log(`[ReviewAI] filter=${filter} page ${pageNumber}: added ${addedCount} (total ${state.reviews.length})`);

        chrome.runtime.sendMessage({
          type: 'COLLECTION_PROGRESS',
          total: state.reviews.length,
          currentPage: pageNumber,
          currentFilter: getFilterLabel(filter),
          currentFilterKey: filter,
          textReviewCount: state.textReviewCount || 0,
          targetReviewCount: state.targetReviewCount || 0,
          totalRatings: state.productInfo?.totalReviews || 0,
          addedCount,
          maxPages: 10,
        }).catch(() => {});
        reportProgressToServer(state);
        return false;
      });
    } catch (err) {
      console.error('[ReviewAI] In-place collection failed:', err);
    }

    console.log(`[ReviewAI] In-place collection complete. Total: ${state.reviews.length}`);
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
      completedFilters: [],
      filterReviewCounts: {},
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
      console.log(`[ReviewAI] Starting collection for ASIN: ${asin} (in-place fetch)`);

      // ページ遷移せず、現在のページのまま fetch でレビューを取得
      const state = createInitialState(asin, info);
      saveCollectionState(state).then(() => {
        collectReviewsInPlace(state);
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

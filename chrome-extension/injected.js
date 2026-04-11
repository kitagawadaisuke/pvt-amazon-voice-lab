// ページ本体のコンテキストで動作する fetch プロキシ
// content.js から postMessage で呼び出される
(function () {
  'use strict';

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'REVIEWAI_FETCH_REQUEST') return;

    const { requestId, url, options } = data;
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      window.postMessage({
        type: 'REVIEWAI_FETCH_RESULT',
        requestId,
        ok: true,
        status: response.status,
        text,
      }, '*');
    } catch (err) {
      window.postMessage({
        type: 'REVIEWAI_FETCH_RESULT',
        requestId,
        ok: false,
        error: (err && err.message) || String(err),
      }, '*');
    }
  });

  // 準備完了を通知
  window.postMessage({ type: 'REVIEWAI_INJECTED_READY' }, '*');
})();

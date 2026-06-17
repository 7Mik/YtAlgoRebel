// inject.js - Runs in main world

(function () {
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0] && args[0].url ? args[0].url : '';

    if (url.includes('/youtubei/v1/browse') || url.includes('/youtubei/v1/next')) {
      try {
        const clonedResponse = response.clone();
        clonedResponse
          .json()
          .then((data) => {
            window.postMessage(
              {
                type: 'YT_ALGO_REBEL_INTERCEPT',
                url: url,
                data: data,
              },
              '*'
            );
          })
          .catch((err) => console.error('YtAlgoRebel: Error parsing fetch JSON', err));
      } catch (e) {
        console.error('YtAlgoRebel: Error cloning fetch response', e);
      }
    }
    return response;
  };

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener('load', function () {
      if (
        this._url &&
        (this._url.includes('/youtubei/v1/browse') || this._url.includes('/youtubei/v1/next'))
      ) {
        try {
          const data = JSON.parse(this.responseText);
          window.postMessage(
            {
              type: 'YT_ALGO_REBEL_INTERCEPT',
              url: this._url,
              data: data,
            },
            '*'
          );
        } catch (e) {
          // Could not parse JSON, ignore or log
          // console.error('YtAlgoRebel: Error parsing XHR JSON', e);
        }
      }
    });
    return originalXHRSend.apply(this, [body]);
  };

  // Listen for config requests from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'YT_ALGO_REBEL_GET_CONFIG') {
      let apiKey = '';
      let clientVersion = '';
      let idToken = '';

      try {
        if (window.ytcfg) {
          apiKey =
            window.ytcfg.data_?.INNERTUBE_API_KEY || window.ytcfg.get?.('INNERTUBE_API_KEY') || '';
          clientVersion =
            window.ytcfg.data_?.INNERTUBE_CLIENT_VERSION ||
            window.ytcfg.get?.('INNERTUBE_CLIENT_VERSION') ||
            '';
          idToken = window.ytcfg.data_?.ID_TOKEN || window.ytcfg.get?.('ID_TOKEN') || '';
        }
      } catch (e) {
        console.error('YtAlgoRebel: Error reading ytcfg', e);
      }

      window.postMessage(
        {
          type: 'YT_ALGO_REBEL_SEND_CONFIG',
          config: { apiKey, clientVersion, idToken },
        },
        '*'
      );
    }
  });
})();

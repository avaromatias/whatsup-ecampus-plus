(() => {
  if (window.__wuepLaunchBridge) return;
  window.__wuepLaunchBridge = true;

  const STORAGE_PREFIX = 'wuep_helpers:';

  function helpersKeyFromLaunch(launch) {
    const snackId = launch?.snackExercises?.snackId || launch?.snackExercises?.snackID || '';
    return snackId ? `${STORAGE_PREFIX}${snackId}` : '';
  }

  function persistLaunch(launch) {
    const extract = window.__wuepExtractSnackHelpers;
    if (typeof extract !== 'function' || !launch) return;

    const helpers = extract(launch);
    const key = helpersKeyFromLaunch(launch);
    if (!key) return;

    try {
      sessionStorage.setItem(key, JSON.stringify(helpers));
    } catch {
      // ignore quota / private-mode failures
    }

    window.__wuepLastHelpers = helpers;
    window.postMessage(
      {
        source: 'wuep-ecampus-plus',
        type: 'snack-helpers',
        key,
        helpers
      },
      '*'
    );
  }

  function captureLaunchPayload(url, bodyText) {
    if (!url || !/OnlineCourseLaunch/i.test(String(url))) return;
    try {
      persistLaunch(JSON.parse(bodyText));
    } catch {
      // ignore non-JSON launch payloads
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(...args) {
    return originalFetch.apply(this, args).then((response) => {
      try {
        const request = args[0];
        const url = typeof request === 'string' ? request : request?.url;
        if (url && /OnlineCourseLaunch/i.test(String(url))) {
          response
            .clone()
            .text()
            .then((text) => captureLaunchPayload(url, text))
            .catch(() => {});
        }
      } catch {
        // never break native fetch
      }
      return response;
    });
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__wuepUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    this.addEventListener('load', () => {
      try {
        captureLaunchPayload(this.__wuepUrl, this.responseText);
      } catch {
        // ignore
      }
    });
    return originalSend.apply(this, args);
  };
})();

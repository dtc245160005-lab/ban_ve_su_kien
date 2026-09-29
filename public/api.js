(function (global) {
  function safeNext(next) {
    if (typeof next !== 'string' || !next) {
      return '/app.html';
    }
    const trimmed = next.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
      return '/app.html';
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      return '/app.html';
    }
    return trimmed;
  }

  function buildLoginRedirect(currentPath) {
    const target = currentPath ? currentPath : '/app.html';
    return `/login.html?next=${encodeURIComponent(target)}`;
  }

  function handleResponse(res, location) {
    if (res && res.status === 401 && location) {
      // Multiple requests can return 401 while the first redirect is in progress.
      if (location.pathname === '/login.html') {
        return res;
      }
      let currentPath = '/app.html';
      if (location.pathname) {
        currentPath = location.pathname + (location.search || '');
      } else if (typeof location.href === 'string' && location.href.startsWith('/')) {
        currentPath = location.href;
      }
      location.href = buildLoginRedirect(currentPath);
    }
    return res;
  }

  async function apiFetch(url, options = {}) {
    const config = {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body && !(options.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options.headers,
      },
    };

    const response = await fetch(url, config);

    if (typeof window !== 'undefined' && window.location) {
      handleResponse(response, window.location);
    }

    return response;
  }

  global.safeNext = safeNext;
  global.buildLoginRedirect = buildLoginRedirect;
  global.handleResponse = handleResponse;
  global.apiFetch = apiFetch;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      safeNext,
      buildLoginRedirect,
      handleResponse,
      apiFetch,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);

(function (global) {
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

    if (response.status === 401) {
      const currentPath = window.location.pathname + window.location.search;
      if (!currentPath.startsWith('/login.html')) {
        const nextParam = encodeURIComponent(currentPath);
        window.location.replace(`/login.html?next=${nextParam}`);
      }
    }

    return response;
  }

  global.apiFetch = apiFetch;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { apiFetch };
  }
})(typeof window !== 'undefined' ? window : globalThis);

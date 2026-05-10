(() => {
  const csrfCache = new Map();

  class ApiError extends Error {
    constructor(message, status = 500, details = null) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.details = details;
    }
  }

  function getAuthToken() {
    return localStorage.getItem('authToken') || '';
  }

  function redirectToLogin() {
    window.location.href = 'my-account.html';
  }

  async function fetchCsrfToken(token) {
    if (!token) {
      throw new ApiError('Please sign in to continue.', 401);
    }
    if (csrfCache.has(token)) {
      return csrfCache.get(token);
    }

    const response = await fetch('/api/auth/csrf', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch (err) {
        payload = text;
      }
      const message = typeof payload === 'object' && payload
        ? payload.error || payload.message || 'Failed to load a security token.'
        : 'Failed to load a security token.';
      if (response.status === 401 || response.status === 403) {
        csrfCache.delete(token);
        throw new ApiError(message, response.status, payload);
      }
      throw new ApiError(message, response.status, payload);
    }

    const payload = await response.json();
    const csrfToken = payload.csrfToken;
    csrfCache.set(token, csrfToken);
    return csrfToken;
  }

  async function request(path, options = {}) {
    const {
      method = 'GET',
      body,
      headers = {},
      timeoutMs = 15000,
      requiresAuth = true,
      requiresCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase())
    } = options;

    const token = getAuthToken();
    if (requiresAuth && !token) {
      redirectToLogin();
      throw new ApiError('Please sign in to continue.', 401);
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const requestHeaders = {
        Accept: 'application/json',
        ...headers
      };

      if (requiresAuth && token) {
        requestHeaders.Authorization = `Bearer ${token}`;
      }

      if (body !== undefined && !(body instanceof FormData) && !requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/json';
      }

      if (requiresCsrf && requiresAuth && token) {
        requestHeaders['X-CSRF-Token'] = await fetchCsrfToken(token);
      }

      const response = await fetch(path, {
        method,
        headers: requestHeaders,
        body: body === undefined
          ? undefined
          : (body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body)),
        signal: controller.signal
      });

      const text = await response.text();
      const payload = text ? (() => {
        try {
          return JSON.parse(text);
        } catch (err) {
          return text;
        }
      })() : null;

      const responseMessage = typeof payload === 'object' && payload
        ? payload.error || payload.message || ''
        : '';

      if (response.status === 401) {
        if (requiresAuth) {
          redirectToLogin();
        }
        throw new ApiError('Your session expired. Please sign in again.', response.status, payload);
      }

      if (response.status === 403 && requiresAuth && /invalid token|access token required|token expired|jwt/i.test(responseMessage)) {
        redirectToLogin();
        throw new ApiError('Your session expired. Please sign in again.', response.status, payload);
      }

      if (!response.ok) {
        const message = typeof payload === 'object' && payload
          ? payload.error || payload.message || `Request failed with status ${response.status}`
          : `Request failed with status ${response.status}`;
        throw new ApiError(message, response.status, payload);
      }

      return payload;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ApiError('The request timed out. Please try again.', 408);
      }
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('Unable to reach the server right now. Please try again.', 500, error);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  window.Host1TopApi = {
    ApiError,
    fetchCsrfToken,
    request,
    get: (path, options = {}) => request(path, { ...options, method: 'GET', requiresCsrf: false }),
    post: (path, body, options = {}) => request(path, { ...options, method: 'POST', body }),
    put: (path, body, options = {}) => request(path, { ...options, method: 'PUT', body }),
    delete: (path, options = {}) => request(path, { ...options, method: 'DELETE' })
  };
})();

(function () {
  const THEME_KEY = 'host1top-theme';
  const NOTIFICATION_CACHE_KEY = 'host1top-notification-cache';
  const AI_HISTORY_KEY = 'host1top-ai-history';
  const POLL_INTERVAL_MS = 15000;
  const STREAM_RETRY_MS = 5000;
  const notificationState = {
    items: [],
    unreadCount: 0,
    seenIds: new Set(),
    preferences: null,
    intervalHandle: null,
    hydrated: false,
    lastError: null,
    stream: null,
    streamRetryHandle: null,
    refreshHandle: null,
    channel: null,
    panelOpen: false
  };
  const aiState = {
    messages: [],
    ready: false
  };
  let bootstrapped = false;

  function getSessionToken() {
    return localStorage.getItem('adminToken') || localStorage.getItem('authToken') || '';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderMarkdown(markdown) {
    const lines = String(markdown || '').split(/\r?\n/);
    const html = [];
    let listItems = [];

    const flushList = () => {
      if (!listItems.length) return;
      html.push(`<ul>${listItems.join('')}</ul>`);
      listItems = [];
    };

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        return;
      }
      if (trimmed.startsWith('## ')) {
        flushList();
        html.push(`<h4>${escapeHtml(trimmed.slice(3))}</h4>`);
        return;
      }
      if (trimmed.startsWith('- ')) {
        listItems.push(`<li>${escapeHtml(trimmed.slice(2))}</li>`);
        return;
      }
      flushList();
      html.push(`<p>${escapeHtml(trimmed)}</p>`);
    });

    flushList();
    return html.join('');
  }

  function injectExperienceStyles() {
    if (document.getElementById('site-experience-styles')) return;
    const style = document.createElement('style');
    style.id = 'site-experience-styles';
    style.textContent = `
      .header-shell-tools {
        display: inline-flex;
        align-items: center;
        gap: 0.625rem;
      }
      .header-icon-button {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
        background: color-mix(in srgb, var(--surface) 88%, transparent);
        color: var(--text);
        box-shadow: 0 18px 36px color-mix(in srgb, var(--shadow) 85%, transparent);
        transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
      }
      .header-icon-button:hover,
      .header-icon-button:focus-visible {
        transform: translateY(-1px);
        border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
      }
      .theme-icon--moon,
      html[data-theme="dark"] .theme-icon--sun {
        display: none;
      }
      html[data-theme="dark"] .theme-icon--moon {
        display: inline-flex;
      }
      .notification-shell {
        position: relative;
        isolation: isolate;
      }
      .notification-shell.is-hidden {
        display: none;
      }
      .notification-badge {
        position: absolute;
        top: -0.2rem;
        right: -0.15rem;
        min-width: 1.25rem;
        height: 1.25rem;
        padding: 0 0.32rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: #dc2626;
        color: #ffffff;
        font-size: 0.68rem;
        font-weight: 800;
        line-height: 1;
        border: 2px solid var(--surface);
      }
      .notification-panel {
        position: absolute;
        top: calc(100% + 0.8rem);
        right: 0;
        width: min(27rem, calc(100vw - 1.5rem));
        display: grid;
        grid-template-rows: auto 1fr auto;
        background: color-mix(in srgb, var(--surface) 94%, transparent);
        border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
        border-radius: 1.25rem;
        box-shadow: 0 30px 80px rgba(2, 6, 23, 0.22);
        overflow: hidden;
        z-index: 320;
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }
      .notification-panel[hidden] {
        display: none !important;
      }
      .notification-backdrop {
        position: fixed;
        inset: 0;
        background: transparent;
        z-index: 319;
      }
      .notification-backdrop[hidden] {
        display: none;
      }
      .notification-panel__header,
      .notification-panel__footer {
        padding: 1rem 1.1rem;
        background: color-mix(in srgb, var(--surface-alt, var(--surface)) 92%, transparent);
      }
      .notification-panel__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        border-bottom: 1px solid var(--border);
      }
      .notification-panel__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border-top: 1px solid var(--border);
      }
      .notification-panel__header strong {
        display: block;
        margin-bottom: 0.2rem;
        font-size: 1rem;
      }
      .notification-panel__header p,
      .notification-panel__status,
      .notification-panel__hint,
      .notification-item__message,
      .notification-item__time,
      .notification-empty {
        margin: 0;
        color: var(--muted);
        font-size: 0.84rem;
      }
      .notification-panel__status[data-tone="error"] {
        color: #dc2626;
      }
      .notification-panel__status[data-tone="success"] {
        color: #15803d;
      }
      .notification-panel__action {
        border: none;
        background: transparent;
        color: var(--accent-dark);
        font-weight: 800;
        font-size: 0.84rem;
      }
      .notification-panel__close {
        width: 2rem;
        height: 2rem;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--surface);
        color: var(--text);
        font-size: 1rem;
        font-weight: 800;
        line-height: 1;
      }
      .notification-panel__action[disabled] {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .notification-list {
        max-height: min(26rem, 60vh);
        overflow: auto;
        background: var(--surface);
      }
      .notification-item {
        width: 100%;
        border: none;
        background: var(--surface);
        color: inherit;
        text-align: left;
        padding: 1rem 1.1rem;
        border-bottom: 1px solid var(--border);
        display: grid;
        gap: 0.35rem;
      }
      .notification-item:hover,
      .notification-item:focus-visible {
        background: var(--surface-alt, var(--surface));
      }
      .notification-item--unread {
        background: color-mix(in srgb, var(--accent) 10%, var(--surface));
      }
      .notification-item__title {
        font-weight: 800;
        font-size: 0.92rem;
        color: var(--text);
      }
      .notification-empty {
        padding: 1.4rem 1.1rem;
      }
      .host1top-fab-stack {
        position: fixed;
        right: 1rem;
        bottom: 1rem;
        z-index: 240;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.75rem;
      }
      .ai-assistant-launcher {
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        border-radius: 999px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        backdrop-filter: blur(14px);
        width: 56px;
        height: 56px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s, background 0.2s;
      }
      .ai-assistant-launcher:hover {
        transform: scale(1.05);
        background: var(--accent);
        color: #000;
      }

      .ai-assistant-drawer {
        position: fixed;
        right: 1rem;
        bottom: 5.3rem;
        width: min(24rem, calc(100vw - 1.5rem));
        max-height: min(42rem, calc(100vh - 7rem));
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        background: color-mix(in srgb, var(--surface) 95%, transparent);
        border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
        border-radius: 1.35rem;
        box-shadow: 0 35px 90px rgba(2, 6, 23, 0.24);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        z-index: 250;
        overflow: hidden;
      }
      .ai-assistant-drawer[hidden] {
        display: none;
      }
      .ai-assistant-drawer__header,
      .ai-assistant-drawer__footer {
        padding: 1rem;
        border-bottom: 1px solid var(--border);
        background: color-mix(in srgb, var(--surface-alt, var(--surface)) 92%, transparent);
      }
      .ai-assistant-drawer__footer {
        border-bottom: none;
        border-top: 1px solid var(--border);
      }
      .ai-assistant-drawer__header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
      }
      .ai-assistant-drawer__title {
        margin: 0;
        font-size: 1rem;
      }
      .ai-assistant-drawer__subtitle,
      .ai-assistant-status {
        margin: 0.2rem 0 0;
        color: var(--muted);
        font-size: 0.82rem;
      }
      .ai-assistant-close {
        border: none;
        background: transparent;
        color: var(--muted);
        font-size: 1.1rem;
        font-weight: 700;
      }
      .ai-assistant-prompts {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
        padding: 0.8rem 1rem;
        border-bottom: 1px solid var(--border);
        background: color-mix(in srgb, var(--surface) 96%, transparent);
      }
      .ai-assistant-prompts button {
        border: 1px solid var(--border);
        background: var(--surface-alt, var(--surface));
        color: var(--text);
        border-radius: 999px;
        padding: 0.58rem 0.78rem;
        font-size: 0.78rem;
        font-weight: 700;
      }
      .ai-assistant-messages {
        overflow: auto;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        background: color-mix(in srgb, var(--surface) 96%, #0f172a 4%);
      }
      .ai-assistant-message {
        max-width: 92%;
        border-radius: 1rem;
        padding: 0.9rem 1rem;
        border: 1px solid var(--border);
        box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06);
      }
      .ai-assistant-message--assistant {
        align-self: flex-start;
        background: var(--surface);
      }
      .ai-assistant-message--user {
        align-self: flex-end;
        background: color-mix(in srgb, var(--accent) 15%, var(--surface));
      }
      .ai-assistant-message__meta {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 0.5rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-size: 0.72rem;
        font-weight: 800;
        color: var(--muted);
      }
      .ai-assistant-message__body {
        line-height: 1.65;
      }
      .ai-assistant-message__body h4 {
        margin: 0.85rem 0 0.4rem;
        font-size: 0.96rem;
      }
      .ai-assistant-message__body p {
        margin: 0.3rem 0;
      }
      .ai-assistant-message__body ul {
        margin: 0.4rem 0 0.4rem 1rem;
      }
      .ai-assistant-message__body li + li {
        margin-top: 0.3rem;
      }
      .ai-assistant-form {
        display: grid;
        gap: 0.75rem;
      }
      .ai-assistant-form textarea {
        width: 100%;
        min-height: 90px;
        resize: vertical;
        border-radius: 1rem;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        padding: 0.85rem 1rem;
        font: inherit;
      }
      .ai-assistant-form__actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .ai-assistant-submit {
        border: none;
        border-radius: 999px;
        background: var(--accent);
        color: #09111f;
        padding: 0.75rem 1rem;
        font-weight: 800;
      }
      .ai-assistant-submit[disabled] {
        opacity: 0.65;
        cursor: wait;
      }
      html[data-theme="dark"] body,
      html[data-theme="dark"] .utility-bar,
      html[data-theme="dark"] .site-header,
      html[data-theme="dark"] .site-footer,
      html[data-theme="dark"] .dash-sidebar,
      html[data-theme="dark"] .dash-content,
      html[data-theme="dark"] .data-table-wrap,
      html[data-theme="dark"] .data-table th,
      html[data-theme="dark"] .ticket-header,
      html[data-theme="dark"] .reply-box,
      html[data-theme="dark"] .message-bubble,
      html[data-theme="dark"] .message-bubble--admin,
      html[data-theme="dark"] .two-factor-card,
      html[data-theme="dark"] .auth-container,
      html[data-theme="dark"] .google-auth,
      html[data-theme="dark"] .about-card,
      html[data-theme="dark"] .principles-card {
        background: var(--surface);
        border-color: var(--border);
        color: var(--text);
      }
      html[data-theme="dark"] .message-bubble--admin,
      html[data-theme="dark"] .principles-card,
      html[data-theme="dark"] .data-table tr:hover td {
        background: var(--surface-alt, var(--surface));
      }
      html[data-theme="dark"] input,
      html[data-theme="dark"] textarea,
      html[data-theme="dark"] select {
        background: var(--surface);
        border-color: var(--border);
        color: var(--text);
      }
      @media (max-width: 720px) {
        .notification-panel {
          position: fixed;
          top: 4.75rem;
          left: 0.75rem;
          right: 0.75rem;
          width: auto;
          max-height: calc(100vh - 6rem);
        }
        .host1top-fab-stack {
          right: 0.75rem;
          bottom: 0.75rem;
        }
        .ai-assistant-drawer {
          right: 0.75rem;
          left: 0.75rem;
          width: auto;
          bottom: 5rem;
          max-height: calc(100vh - 6.25rem);
        }
        .ai-assistant-message {
          max-width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function getStoredTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function getFabStack() {
    let stack = document.getElementById('host1top-fab-stack');
    if (stack) return stack;
    stack = document.createElement('div');
    stack.id = 'host1top-fab-stack';
    stack.className = 'host1top-fab-stack';
    document.body.appendChild(stack);
    return stack;
  }

  function applyTheme(theme) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.classList.add('theme-ready');
    localStorage.setItem(THEME_KEY, nextTheme);
    [document.getElementById('theme-toggle'), document.getElementById('floating-theme-toggle')]
      .filter(Boolean)
      .forEach((toggle) => {
        toggle.setAttribute('aria-pressed', String(nextTheme === 'dark'));
        toggle.setAttribute('title', nextTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      });
  }



  function initThemeToggle() {
    // Theme toggle removed from floating stack as requested.
    applyTheme(getStoredTheme());
  }

  async function safeJson(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (error) {
      return {};
    }
  }

  async function apiFetch(path, options = {}) {
    const token = getSessionToken();
    if (!token) throw new Error('Authentication required');
    const response = await fetch(path, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await safeJson(response);
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  }

  async function publicFetch(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await safeJson(response);
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  }

  function persistNotificationState() {
    localStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify({
      unreadCount: notificationState.unreadCount,
      items: notificationState.items.slice(0, 12)
    }));
    if (notificationState.channel) {
      notificationState.channel.postMessage({
        type: 'notification-sync',
        unreadCount: notificationState.unreadCount,
        items: notificationState.items.slice(0, 12)
      });
    }
  }

  function hydrateNotificationState() {
    try {
      const cached = JSON.parse(localStorage.getItem(NOTIFICATION_CACHE_KEY) || '{}');
      if (!Array.isArray(cached.items)) return;
      notificationState.items = cached.items;
      notificationState.unreadCount = Number(cached.unreadCount || 0);
      cached.items.forEach((item) => {
        if (item?.id) notificationState.seenIds.add(item.id);
      });
      updateNotificationBadge(notificationState.unreadCount);
      renderNotificationList(notificationState.items, notificationState.unreadCount);
    } catch (error) {
      // Ignore corrupt caches.
    }
  }

  function initNotificationSyncChannel() {
    if (notificationState.channel || typeof BroadcastChannel === 'undefined') return;
    notificationState.channel = new BroadcastChannel('host1top-notifications');
    notificationState.channel.addEventListener('message', (event) => {
      if (event.data?.type !== 'notification-sync') return;
      notificationState.items = event.data.items || [];
      notificationState.unreadCount = Number(event.data.unreadCount || 0);
      updateNotificationBadge(notificationState.unreadCount);
      renderNotificationList(notificationState.items, notificationState.unreadCount);
    });
  }

  async function fetchNotificationPreferences() {
    try {
      const result = await apiFetch('/api/notifications/preferences');
      notificationState.preferences = result.preferences;
      if (notificationState.preferences?.browser_enabled && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      return result.preferences;
    } catch (error) {
      return null;
    }
  }

  async function saveNotificationPreferences(preferences) {
    const result = await apiFetch('/api/notifications/preferences', {
      method: 'POST',
      body: JSON.stringify(preferences)
    });
    notificationState.preferences = result.preferences;
    return result.preferences;
  }

  function updateNotificationBadge(unreadCount) {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    badge.hidden = unreadCount <= 0;
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
  }

  function syncNotificationPanelVisibility() {
    const button = document.getElementById('notification-button');
    const panel = document.getElementById('notification-panel');
    const backdrop = document.getElementById('notification-backdrop');
    if (!button || !panel) return;
    panel.hidden = !notificationState.panelOpen;
    if (backdrop) {
      backdrop.hidden = !notificationState.panelOpen;
    }
    button.setAttribute('aria-expanded', String(notificationState.panelOpen));
  }

  function setNotificationPanelOpen(isOpen) {
    notificationState.panelOpen = Boolean(isOpen);
    syncNotificationPanelVisibility();
  }

  function normalizeNotificationDom() {
    const duplicateSelectors = [
      '#notification-shell',
      '#notification-button',
      '#notification-panel',
      '#notification-summary',
      '#notification-panel-status',
      '#notification-mark-all',
      '#notification-close',
      '#notification-list',
      '#notification-badge'
    ];

    duplicateSelectors.forEach((selector) => {
      const nodes = document.querySelectorAll(selector);
      nodes.forEach((node, index) => {
        if (index > 0) {
          node.remove();
        }
      });
    });
  }

  function ensureNotificationBackdrop() {
    let backdrop = document.getElementById('notification-backdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.id = 'notification-backdrop';
    backdrop.className = 'notification-backdrop';
    backdrop.hidden = true;
    backdrop.setAttribute('aria-label', 'Close notifications');
    backdrop.addEventListener('click', () => {
      setNotificationPanelOpen(false);
    });
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function setNotificationStatus(message, tone = 'default') {
    const node = document.getElementById('notification-panel-status');
    if (!node) return;
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';
    node.hidden = !normalizedMessage;
    node.textContent = normalizedMessage;
    node.dataset.tone = tone;
  }

  function renderNotificationList(items, unreadCount) {
    const shell = document.getElementById('notification-shell');
    const list = document.getElementById('notification-list');
    const summary = document.getElementById('notification-summary');
    const markAllButton = document.getElementById('notification-mark-all');
    if (!shell || !list || !summary) return;

    shell.classList.toggle('is-hidden', !getSessionToken());
    summary.textContent = unreadCount > 0 ? `${unreadCount} unread alert${unreadCount === 1 ? '' : 's'}` : 'No unread alerts';
    if (markAllButton) markAllButton.disabled = unreadCount <= 0;
    syncNotificationPanelVisibility();

    if (!items.length) {
      list.innerHTML = '<div class="notification-empty">No notification history yet.</div>';
      return;
    }

    list.innerHTML = items.map((item) => `
      <button type="button" class="notification-item ${item.read_at ? '' : 'notification-item--unread'}" data-id="${item.id}" data-link="${escapeHtml(item.link || '')}">
        <span class="notification-item__title">${escapeHtml(item.title)}</span>
        <span class="notification-item__message">${escapeHtml(item.message)}</span>
        <span class="notification-item__time">${new Date(item.created_at).toLocaleString()}</span>
      </button>
    `).join('');

    list.querySelectorAll('.notification-item').forEach((button) => {
      button.addEventListener('click', async () => {
        const notificationId = button.dataset.id;
        try {
          await apiFetch(`/api/notifications/${notificationId}/read`, { method: 'POST' });
          await fetchNotifications({ source: 'mark-read' });
        } catch (error) {
          setNotificationStatus(error.message || 'Could not update the notification state.', 'error');
        }

        if (button.dataset.link) {
          window.location.href = button.dataset.link;
        }
      });
    });
  }

  function showBrowserNotifications(items) {
    if (!notificationState.preferences?.browser_enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    items.forEach((item) => {
      if (notificationState.seenIds.has(item.id)) return;
      const notification = new Notification(item.title, {
        body: item.message,
        tag: `host1top-notification-${item.id}`
      });
      notification.onclick = () => {
        window.focus();
        if (item.link) window.location.href = item.link;
        notification.close();
      };
    });
  }

  async function fetchNotifications({ source = 'manual' } = {}) {
    if (!getSessionToken()) return null;
    try {
      const result = await apiFetch('/api/notifications?limit=12');
      const items = result.notifications || [];
      const unreadCount = result.unread_count || 0;
      updateNotificationBadge(unreadCount);
      renderNotificationList(items, unreadCount);
      if (notificationState.hydrated) {
        showBrowserNotifications(items.filter((item) => !item.read_at));
      }
      notificationState.items = items;
      notificationState.unreadCount = unreadCount;
      notificationState.lastError = null;
      items.forEach((item) => notificationState.seenIds.add(item.id));
      notificationState.hydrated = true;
      persistNotificationState();
      setNotificationStatus('', 'default');
      return result;
    } catch (error) {
      notificationState.lastError = error.message;
      setNotificationStatus(error.message || 'Notification sync failed. Showing the last cached state.', 'error');
      renderNotificationList(notificationState.items, notificationState.unreadCount);
      return null;
    }
  }

  function scheduleNotificationRefresh(delay = 500) {
    clearTimeout(notificationState.refreshHandle);
    notificationState.refreshHandle = setTimeout(() => {
      fetchNotifications({ source: 'stream' }).catch(() => {});
    }, delay);
  }

  function stopNotificationStream() {
    if (notificationState.stream) {
      notificationState.stream.close();
      notificationState.stream = null;
    }
    clearTimeout(notificationState.streamRetryHandle);
  }

  function startNotificationStream() {
    const token = getSessionToken();
    if (!token || typeof EventSource === 'undefined') return;
    stopNotificationStream();
    try {
      const stream = new EventSource(`/api/notifications/stream?token=${encodeURIComponent(token)}`);
      notificationState.stream = stream;

      stream.addEventListener('ready', () => {
        if (!notificationState.lastError) {
          setNotificationStatus('', 'default');
        }
      });
      stream.addEventListener('notification', () => {
        scheduleNotificationRefresh(650);
      });
      stream.addEventListener('ping', () => {});
      stream.onerror = () => {
        notificationState.lastError = null;
        setNotificationStatus('', 'default');
        stopNotificationStream();
        notificationState.streamRetryHandle = setTimeout(startNotificationStream, STREAM_RETRY_MS);
      };
    } catch (error) {
      notificationState.lastError = null;
      setNotificationStatus('', 'default');
    }
  }

  function startNotificationPolling() {
    if (notificationState.intervalHandle) clearInterval(notificationState.intervalHandle);
    notificationState.intervalHandle = setInterval(() => {
      fetchNotifications({ source: 'poll' }).catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  function initNotificationDropdown() {
    normalizeNotificationDom();
    ensureNotificationBackdrop();
    const shell = document.getElementById('notification-shell');
    const button = document.getElementById('notification-button');
    const panel = document.getElementById('notification-panel');
    const markAllButton = document.getElementById('notification-mark-all');
    const closeButton = document.getElementById('notification-close');
    if (!shell || !button || !panel) return;

    if (!getSessionToken()) {
      shell.classList.add('is-hidden');
      setNotificationPanelOpen(false);
      syncNotificationPanelVisibility();
      return;
    }

    shell.classList.remove('is-hidden');
    setNotificationPanelOpen(false);
    syncNotificationPanelVisibility();
    if (button.dataset.notificationBound === 'true') return;
    button.dataset.notificationBound = 'true';

    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const nextOpen = !notificationState.panelOpen;
      setNotificationPanelOpen(nextOpen);
      if (nextOpen) {
        await fetchNotifications({ source: 'panel-open' });
      }
    });

    panel.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    if (document.body.dataset.notificationPointerBound !== 'true') {
      document.body.dataset.notificationPointerBound = 'true';
      document.addEventListener('pointerdown', (event) => {
        const currentShell = document.getElementById('notification-shell');
        if (!currentShell) return;
        if (!currentShell.contains(event.target)) {
          setNotificationPanelOpen(false);
        }
      });
    }

    if (document.body.dataset.notificationEscapeBound !== 'true') {
      document.body.dataset.notificationEscapeBound = 'true';
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          setNotificationPanelOpen(false);
        }
      });
    }

    if (document.body.dataset.notificationResizeBound !== 'true') {
      document.body.dataset.notificationResizeBound = 'true';
      window.addEventListener('resize', () => {
        setNotificationPanelOpen(false);
      });
    }

    if (markAllButton && markAllButton.dataset.notificationBound !== 'true') {
      markAllButton.dataset.notificationBound = 'true';
      markAllButton.addEventListener('click', async () => {
        try {
          await apiFetch('/api/notifications/read-all', { method: 'POST' });
          await fetchNotifications({ source: 'mark-all' });
          setNotificationPanelOpen(false);
        } catch (error) {
          setNotificationStatus(error.message || 'Could not mark all notifications as read.', 'error');
        }
      });
    }

    if (closeButton && closeButton.dataset.notificationBound !== 'true') {
      closeButton.dataset.notificationBound = 'true';
      closeButton.addEventListener('click', () => {
        setNotificationPanelOpen(false);
      });
    }
  }

  function restoreAiHistory() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(AI_HISTORY_KEY) || '[]');
      aiState.messages = Array.isArray(cached) ? cached.filter((entry) => entry && entry.role && entry.content) : [];
    } catch (error) {
      aiState.messages = [];
    }
    if (!aiState.messages.length) {
      aiState.messages = [{
        role: 'assistant',
        content: '## HOST1TOP AI Assistant\n- Ask me about our VPS, RDP, and Game Hosting plans.\n- I can help with panel troubleshooting and server configuration.',
        meta: { provider: 'Deepseek' }
      }];
    }
  }

  function persistAiHistory() {
    sessionStorage.setItem(AI_HISTORY_KEY, JSON.stringify(aiState.messages.slice(-10)));
  }

  function ensureAiAssistant() {
    if (document.getElementById('ai-assistant-launcher')) return;
    restoreAiHistory();
    const stack = getFabStack();

    const launcher = document.createElement('button');
    launcher.id = 'ai-assistant-launcher';
    launcher.type = 'button';
    launcher.className = 'ai-assistant-launcher';
    launcher.innerHTML = `
      <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4M8 16h.01M16 16h.01" />
      </svg>
    `;
    stack.appendChild(launcher);

    const drawer = document.createElement('section');
    drawer.id = 'ai-assistant-drawer';
    drawer.className = 'ai-assistant-drawer';
    drawer.hidden = true;
    drawer.setAttribute('aria-label', 'AI assistant');
    drawer.innerHTML = `
      <div class="ai-assistant-drawer__header">
        <div>
          <h3 class="ai-assistant-drawer__title">HOST1TOP AI</h3>
          <p class="ai-assistant-drawer__subtitle">Quick FiveM sizing and optimization help.</p>
        </div>
        <button type="button" class="ai-assistant-close" id="ai-assistant-close" aria-label="Close AI assistant">×</button>
      </div>
      <div class="ai-assistant-prompts">
        <button type="button" data-ai-prompt="My FiveM server has 64 players, 8 GB RAM, 4 vCPU, and hitch spikes during peak hours. What should I upgrade first?">64-player lag</button>
        <button type="button" data-ai-prompt="Recommend hardware and network settings for a heavy ESX or QBCore server with custom cars and MLOs.">Heavy ESX/QBCore</button>
      </div>
      <div id="ai-assistant-messages" class="ai-assistant-messages" aria-live="polite"></div>
      <div class="ai-assistant-drawer__footer">
        <form id="ai-assistant-form" class="ai-assistant-form">
          <textarea id="ai-assistant-input" placeholder="Ask about lag, desync, CPU, RAM, network routing, txAdmin, or script-heavy servers."></textarea>
          <div class="ai-assistant-form__actions">
            <p id="ai-assistant-status" class="ai-assistant-status">Ready to help.</p>
            <button type="submit" id="ai-assistant-submit" class="ai-assistant-submit">Send</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(drawer);

    const messagesNode = drawer.querySelector('#ai-assistant-messages');
    const statusNode = drawer.querySelector('#ai-assistant-status');
    const input = drawer.querySelector('#ai-assistant-input');
    const submit = drawer.querySelector('#ai-assistant-submit');

    const renderMessages = () => {
      messagesNode.innerHTML = aiState.messages.map((entry) => `
        <article class="ai-assistant-message ai-assistant-message--${entry.role === 'assistant' ? 'assistant' : 'user'}">
          <div class="ai-assistant-message__meta">
            <span>${entry.role === 'assistant' ? 'HOST1TOP AI' : 'You'}</span>
            <span>${escapeHtml(entry.meta?.provider || '')}</span>
          </div>
          <div class="ai-assistant-message__body">${entry.role === 'assistant' ? renderMarkdown(entry.content) : escapeHtml(entry.content).replace(/\n/g, '<br>')}</div>
        </article>
      `).join('');
      messagesNode.scrollTop = messagesNode.scrollHeight;
    };

    renderMessages();

    launcher.addEventListener('click', () => {
      drawer.hidden = !drawer.hidden;
      if (!drawer.hidden) {
        input.focus();
        messagesNode.scrollTop = messagesNode.scrollHeight;
      }
    });
    drawer.querySelector('#ai-assistant-close').addEventListener('click', () => {
      drawer.hidden = true;
    });
    drawer.querySelectorAll('[data-ai-prompt]').forEach((button) => {
      button.addEventListener('click', () => {
        input.value = button.dataset.aiPrompt || '';
        input.focus();
      });
    });

    drawer.querySelector('#ai-assistant-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = input.value.trim();
      if (!message) {
        statusNode.textContent = 'Describe the issue first.';
        return;
      }

      aiState.messages.push({ role: 'user', content: message });
      aiState.messages = aiState.messages.slice(-10);
      renderMessages();
      persistAiHistory();
      submit.disabled = true;
      statusNode.textContent = 'Analyzing hardware, scripts, and lag signals...';

      try {
        const payload = await publicFetch('/api/ai/chat', {
          method: 'POST',
          body: JSON.stringify({
            messages: aiState.messages
          })
        });

        aiState.messages.push({
          role: 'assistant',
          content: payload.reply || 'No response returned.',
          meta: payload.meta || {}
        });
        aiState.messages = aiState.messages.slice(-10);
        renderMessages();
        persistAiHistory();
        input.value = '';
        statusNode.textContent = payload.meta?.usedFallback ? 'Delivered by the built-in advisor.' : 'Delivered with live AI reasoning.';
      } catch (error) {
        aiState.messages.push({
          role: 'assistant',
          content: '## Temporary Error\n- The AI assistant could not process that request.\n- Please retry in a few seconds with the main lag symptoms and hardware details.',
          meta: { provider: 'error' }
        });
        aiState.messages = aiState.messages.slice(-10);
        renderMessages();
        persistAiHistory();
        statusNode.textContent = error.message || 'AI assistant unavailable.';
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function initNotifications() {
    hydrateNotificationState();
    initNotificationSyncChannel();
    syncNotificationPanelVisibility();

    if (!getSessionToken()) return;

    await fetchNotificationPreferences();
    initNotificationDropdown();
    await fetchNotifications({ source: 'bootstrap' });
    startNotificationPolling();
    startNotificationStream();

    if (document.body.dataset.notificationVisibilityBound !== 'true') {
      document.body.dataset.notificationVisibilityBound = 'true';
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          fetchNotifications({ source: 'visibility' }).catch(() => {});
          startNotificationStream();
        }
      });
      window.addEventListener('online', () => {
        fetchNotifications({ source: 'online' }).catch(() => {});
        startNotificationStream();
      });
      window.addEventListener('storage', (event) => {
        if (event.key === NOTIFICATION_CACHE_KEY) {
          hydrateNotificationState();
        }
      });
    }
  }

  async function bootstrapExperience() {
    if (bootstrapped) {
      initThemeToggle();
      ensureAiAssistant();
      await initNotifications();
      return;
    }
    bootstrapped = true;
    injectExperienceStyles();
    initThemeToggle();
    ensureAiAssistant();
    await initNotifications();
  }

  window.Host1TopExperience = {
    applyTheme,
    fetchNotifications,
    fetchNotificationPreferences,
    saveNotificationPreferences,
    init: bootstrapExperience
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bootstrapExperience().catch((error) => console.error('Experience bootstrap failed:', error));
    }, { once: true });
  } else {
    bootstrapExperience().catch((error) => console.error('Experience bootstrap failed:', error));
  }
})();

/**
 * Host1Top Unified Header & Footer Loader
 * Ensures consistent design across all pages.
 */



const HEADER_HTML = `
  <div class="utility-bar">
    <div class="utility-bar__inner container">
      <div class="utility-bar__links">
        <a href="/about.html" data-i18n="about">About us</a>
        <a href="/index.html#support" data-i18n="help_hub">Hosting Help Hub</a>
      </div>
      <p class="utility-bar__tagline" data-i18n="tagline">HOST1TOP — Premium RDP, VPS &amp; Game Servers</p>
      <div class="utility-bar__links utility-bar__links--end">
        <a href="/tos.html" data-i18n="terms">Terms</a>
        <a href="/plans/index.html" data-i18n="all_plans">All plans</a>
      </div>
    </div>
  </div>
  <input type="checkbox" id="mobile-menu-cb" class="mobile-menu-cb" aria-hidden="true" style="display:none;" />
  <header class="site-header">
    <div class="site-header__row container">
      <a class="logo" href="/index.html" aria-label="HOST1TOP home">
        <span class="logo__mark" aria-hidden="true"></span>
        <span class="logo__text">HOST1TOP</span>
      </a>

      <label for="mobile-menu-cb" class="mobile-menu-btn" aria-label="Toggle mobile menu">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </label>

      <div class="header-actions mobile-collapse">

        <div class="notification-wrapper">
          <button class="header-actions__link notification-trigger" id="notification-trigger" aria-label="Notifications" title="Notifications">
            <svg class="icon-use" width="20" height="20" aria-hidden="true"><use href="#i-bell"/></svg>
            <span class="notification-badge" id="notification-badge"></span>
          </button>
          <div class="notification-dropdown" id="notification-dropdown">
            <div class="notification-dropdown__header">
              <span data-i18n="notifications">Notifications</span>
              <button class="mark-all-read" id="mark-all-read" data-i18n="mark_all_read">Mark all as read</button>
            </div>
            <div class="notification-dropdown__list" id="notification-list">
              <!-- Notifications will be injected here -->
              <div class="notification-empty" data-i18n="no_notifications">No new notifications</div>
            </div>
            <div class="notification-dropdown__footer">
              <a href="/notifications.html" data-i18n="view_all_notifications">View all notifications</a>
            </div>
          </div>
        </div>
        <a class="header-actions__link" href="/index.html#support">
          <svg class="icon-use" width="20" height="20" aria-hidden="true"><use href="#i-support"/></svg>
          <span data-i18n="support">Support</span>
        </a>
        <a class="header-actions__link" href="https://discord.gg/5db3SFqcFd" target="_blank">
          <svg class="icon-use" width="20" height="20" aria-hidden="true" style="fill: currentColor; stroke: none;"><use href="#i-discord"/></svg>
          <span data-i18n="discord">Discord</span>
        </a>
        <div id="header-auth-buttons" class="header-actions">
          <!-- Will be populated by JS based on auth state -->
          <a class="btn btn--header-accent" href="/my-account.html" style="gap: 0.35rem;">
            <svg class="icon-use" width="18" height="18" aria-hidden="true"><use href="#i-users"/></svg>
            <span data-i18n="client_area">Client Area</span>
          </a>
        </div>
      </div>
    </div>

    <nav class="nav-bar container mobile-collapse" aria-label="Primary">
      <div class="nav-bar__scroll">
        <ul class="nav-bar__list">
          <li class="has-dropdown">
            <button type="button" class="nav-dropdown-trigger" aria-expanded="false" aria-haspopup="menu" id="rdp-menu-btn">
              <span>CLOUD HOSTING</span> <span class="caret" aria-hidden="true"></span>
            </button>
            <div class="nav-dropdown-menu" id="rdp-menu" role="menu">
              <a href="/plans/order-vps-rdp.html?tier=budget" role="menuitem">Budget VPS/RDP</a>
              <a href="/plans/order-vps-rdp.html?tier=extreme" role="menuitem">Extreme VPS/RDP</a>
            </div>
          </li>
          <li class="has-dropdown">
            <button type="button" class="nav-dropdown-trigger" aria-expanded="false" aria-haspopup="menu" id="game-menu-btn">
              <span>GAME HOSTING</span> <span class="caret" aria-hidden="true"></span>
            </button>
            <div class="nav-dropdown-menu" id="game-menu" role="menu">
              <a href="/plans/order-game.html" role="menuitem">Configure Game Server</a>
            </div>
          </li>
          <li class="has-dropdown">
            <button type="button" class="nav-dropdown-trigger" aria-expanded="false" aria-haspopup="menu" id="info-menu-btn">
              <span data-i18n="info">Info</span> <span class="caret" aria-hidden="true"></span>
            </button>
            <div class="nav-dropdown-menu" id="info-menu" role="menu">
              <a href="/antiddos.html" role="menuitem" data-i18n="antiddos">Anti-DDoS</a>
              <a href="/tos.html" role="menuitem" data-i18n="terms">Terms</a>
              <a href="/about.html" role="menuitem" data-i18n="about">About us</a>
            </div>
          </li>
        </ul>
      </div>
      <div class="lang-select">
        <label class="visually-hidden" for="lang">Language</label>
        <select id="lang" name="lang" onchange="changeLanguage(this.value)">
          <option value="en">English</option>
          <option value="fr">Français</option>
          <option value="ar">العربية</option>
        </select>
      </div>
    </nav>
  </header>
`;

const FOOTER_HTML = `
  <footer class="site-footer" id="support">
    <div class="container">
      <div class="footer-grid">
        <!-- Brand Column -->
        <div class="footer-brand">
          <a href="/index.html" class="logo" style="margin-bottom: 1.5rem;">
            <div class="logo__mark"></div>
            <span>HOST1TOP</span>
          </a>
          <p class="footer-tagline" data-i18n="footer_tagline">The most reliable hosting for your projects, games, and infrastructure.</p>
          <div class="footer-socials">
             <a href="https://discord.gg/5db3SFqcFd" target="_blank" aria-label="Discord">
               <svg width="20" height="20" fill="currentColor"><use href="#i-discord"/></svg>
             </a>
             <a href="#" target="_blank" aria-label="Instagram">
               <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><use href="#i-instagram"/></svg>
             </a>
             <a href="#" target="_blank" aria-label="YouTube">
               <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><use href="#i-youtube"/></svg>
             </a>
          </div>
        </div>

        <!-- Services Column -->
        <div class="footer-links-col">
          <h4 data-i18n="services">Services</h4>
          <ul>
            <li><a href="/plans/index.html" data-i18n="rdp">RDP</a></li>
            <li><a href="/plans/index.html" data-i18n="vps">VPS</a></li>
            <li><a href="/plans/index.html" data-i18n="game_servers">Game Servers</a></li>
          </ul>
        </div>

        <!-- Resources Column -->
        <div class="footer-links-col">
          <h4 data-i18n="resources">Resources</h4>
          <ul>
            <li><a href="/antiddos.html" data-i18n="antiddos">Anti-DDoS</a></li>
            <li><a href="/about.html" data-i18n="about">About us</a></li>
            <li><a href="/tos.html" data-i18n="terms">Terms</a></li>
          </ul>
        </div>

        <!-- Account Column -->
        <div class="footer-links-col">
          <h4 data-i18n="account">Account</h4>
          <ul>
            <li><a href="/my-account.html" data-i18n="login">Login</a></li>
            <li><a href="/my-account.html" data-i18n="register">Register</a></li>
            <li><a href="/tickets.html" data-i18n="support">Support</a></li>
          </ul>
        </div>
      </div>

      <div class="footer-bottom">
        <div class="footer-contact-info">
          <a href="mailto:support@host1top.com">support@host1top.com</a>
        </div>
        <div class="footer-payments">
          <img src="img/payment_methods.png" alt="Payment Methods" style="height: 28px; opacity: 0.5; filter: grayscale(1);">
        </div>
      </div>
    </div>
  </footer>
`;

const SVG_SYMBOLS = `
  <svg xmlns="http://www.w3.org/2000/svg" class="svg-symbols" aria-hidden="true" style="display: none;">
    <symbol id="i-instagram" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
    </symbol>
    <symbol id="i-youtube" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.42a2.78 2.78 0 0 0-1.94 2C1 8.14 1 12 1 12s0 3.86.46 5.58a2.78 2.78 0 0 0 1.94 2c1.72.42 8.6.42 8.6.42s6.88 0 8.6-.42a2.78 2.78 0 0 0 1.94-2C23 15.86 23 12 23 12s0-3.86-.46-5.58z"></path>
      <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"></polygon>
    </symbol>
    <symbol id="i-discord" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.23 10.23 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </symbol>
    <symbol id="i-users" viewBox="0 0 24 24" fill="none">
      <path d="M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
      <circle cx="10" cy="7" r="3.5" stroke="currentColor" stroke-width="1.75"/>
      <path d="M21 21v-1.6a5 5 0 00-4-5M17.75 6a4 4 0 010 7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
    </symbol>
    <symbol id="i-support" viewBox="0 0 24 24" fill="none">
      <path d="M9 10.5h6M9 14h3.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
      <path d="M5.5 19 7 16.5h10.5A3.5 3.5 0 0 0 21 13V8.5A4.5 4.5 0 0 0 16.5 4h-9A4.5 4.5 0 0 0 3 8.5V18l2.5-1z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-chevron-left" viewBox="0 0 24 24" fill="none">
      <path d="m14.5 7.5-5 4.5 5 4.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-chevron-right" viewBox="0 0 24 24" fill="none">
      <path d="m9.5 7.5 5 4.5-5 4.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-monitor" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.75"/>
      <path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
    </symbol>
    <symbol id="i-server" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="5" rx="1.5" stroke="currentColor" stroke-width="1.75"/>
      <rect x="4" y="9.5" width="16" height="5" rx="1.5" stroke="currentColor" stroke-width="1.75"/>
      <rect x="4" y="15" width="16" height="5" rx="1.5" stroke="currentColor" stroke-width="1.75"/>
      <circle cx="7.5" cy="6.5" r=".9" fill="currentColor"/><circle cx="7.5" cy="12" r=".9" fill="currentColor"/><circle cx="7.5" cy="17.5" r=".9" fill="currentColor"/>
    </symbol>
    <symbol id="i-layers" viewBox="0 0 24 24" fill="none">
      <path d="M12 3 4 8l8 5 8-5-8-5zM4 13l8 5 8-5M4 18l8 5 8-5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-gauge" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="15" r="8" stroke="currentColor" stroke-width="1.75"/>
      <path d="M12 15V10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
      <path d="m16 11.5-4 3.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-cube" viewBox="0 0 24 24" fill="none">
      <path d="M12 3 4 8v8l8 5 8-5V8l-8-5zM4 8l8 5 8-5M12 13v11" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-activity" viewBox="0 0 24 24" fill="none">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-globe" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.75"/>
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-refresh-cw" viewBox="0 0 24 24" fill="none">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8 16H3v5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-terminal" viewBox="0 0 24 24" fill="none">
      <polyline points="4 17 10 11 4 5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="12" y1="19" x2="20" y2="19" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
    </symbol>
    <symbol id="i-settings" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.75"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-calendar" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-bell" viewBox="0 0 24 24" fill="none">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-moon" viewBox="0 0 24 24" fill="none">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="i-sun" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.75"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
    </symbol>
  </svg>
`;

function initHeaderFooter() {
  // Inject SVG symbols
  if (!document.querySelector('.svg-symbols')) {
    document.body.insertAdjacentHTML('afterbegin', SVG_SYMBOLS);
  }

  // Inject Header
  const headerContainer = document.getElementById('main-header') ||
    document.getElementById('header-root') ||
    document.getElementById('header-placeholder');

  if (headerContainer) {
    headerContainer.innerHTML = HEADER_HTML;
  } else if (!document.querySelector('.site-header')) {
    document.body.insertAdjacentHTML('afterbegin', HEADER_HTML);
  }

  // Inject Footer
  const noFooter = document.body.hasAttribute('data-no-footer');
  if (!noFooter) {
    const footerContainer = document.getElementById('main-footer') ||
      document.getElementById('footer-root') ||
      document.getElementById('footer-placeholder');

    if (footerContainer) {
      footerContainer.innerHTML = FOOTER_HTML;
    } else if (!document.querySelector('.site-footer')) {
      document.body.insertAdjacentHTML('beforeend', FOOTER_HTML);
    }
  }

  updateAuthUI();
  loadSharedExperienceScript();
  initNotifications();

  // Load translations and apply
  loadTranslations();

  // Initialize dropdown toggles
  setupDropdownToggles();
}

function loadSharedExperienceScript() {
  if (window.Host1TopExperience?.init) {
    window.Host1TopExperience.init().catch((error) => console.error('Shared experience init error:', error));
    return;
  }
  if (document.querySelector('script[data-site-experience="true"]')) return;
  const script = document.createElement('script');
  script.src = '/site-experience.js';
  script.defer = true;
  script.dataset.siteExperience = 'true';
  script.onload = () => {
    window.Host1TopExperience?.init?.().catch((error) => console.error('Shared experience init error:', error));
  };
  document.head.appendChild(script);
}

function setupDropdownToggles() {
  const dropdowns = document.querySelectorAll('.has-dropdown');

  dropdowns.forEach(dropdown => {
    const trigger = dropdown.querySelector('.nav-dropdown-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Close other dropdowns
      dropdowns.forEach(other => {
        if (other !== dropdown) other.classList.remove('is-active');
      });

      // Toggle current
      dropdown.classList.toggle('is-active');
    });
  });

  // Close on click outside
  document.addEventListener('click', () => {
    dropdowns.forEach(d => d.classList.remove('is-active'));
  });
}





function initNotifications() {
  const trigger = document.getElementById('notification-trigger');
  const dropdown = document.getElementById('notification-dropdown');
  if (!trigger || !dropdown) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('is-active');
    
    // If opening, fetch fresh
    if (dropdown.classList.contains('is-active')) {
      fetchNotifications();
    }
  });

  const markAllBtn = document.getElementById('mark-all-read');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      markAllRead();
    });
  }

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
      dropdown.classList.remove('is-active');
    }
  });

  // Initial check
  checkNotifications();
  // Poll every 60s
  setInterval(checkNotifications, 60000);
}

async function checkNotifications() {
  const token = localStorage.getItem('authToken');
  if (!token) return;

  try {
    const res = await fetch('/api/notifications', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    if (data.notifications) {
      const unreadCount = data.notifications.filter(n => !n.read_at).length;
      const badge = document.getElementById('notification-badge');
      if (badge) {
        badge.textContent = unreadCount > 0 ? unreadCount : '';
        badge.style.display = unreadCount > 0 ? 'flex' : 'none';
      }
      renderNotifications(data.notifications);
    }
  } catch (err) {
    console.warn('Failed to check notifications:', err);
  }
}

async function fetchNotifications() {
  const token = localStorage.getItem('authToken');
  if (!token) return;

  const list = document.getElementById('notification-list');
  if (!list) return;

  try {
    const res = await fetch('/api/notifications', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    renderNotifications(data.notifications);
  } catch (err) {
    list.innerHTML = '<div class="notification-error">Failed to load notifications</div>';
  }
}

function renderNotifications(notifications) {
  const list = document.getElementById('notification-list');
  if (!list) return;

  if (!notifications || notifications.length === 0) {
    list.innerHTML = '<div class="notification-empty" data-i18n="no_notifications">No new notifications</div>';
    return;
  }

  list.innerHTML = notifications.map(n => `
    <div class="notification-item ${n.read_at ? 'is-read' : 'is-unread'}" onclick="markAsRead(${n.id}, '${n.link || '#'}')">
      <div class="notification-item__icon type-${n.type || 'info'}"></div>
      <div class="notification-item__content">
        <div class="notification-item__title">${n.title}</div>
        <div class="notification-item__message">${n.message}</div>
        <div class="notification-item__time">${formatTime(n.created_at)}</div>
      </div>
    </div>
  `).join('');
  
  applyTranslations();
}

async function markAsRead(id, link) {
  const token = localStorage.getItem('authToken');
  if (!token) {
    if (link !== '#') window.location.href = link;
    return;
  }

  try {
    await fetch(`/api/notifications/${id}/read`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    checkNotifications();
    if (link !== '#') window.location.href = link;
  } catch (err) {
    console.error('Failed to mark read:', err);
    if (link !== '#') window.location.href = link;
  }
}

async function markAllRead() {
  const token = localStorage.getItem('authToken');
  if (!token) return;

  try {
    await fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    checkNotifications();
  } catch (err) {
    console.error('Failed to mark all read:', err);
  }
}

function formatTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return date.toLocaleDateString();
}

function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

function updateAuthUI() {
  const token = localStorage.getItem('authToken');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const authContainer = document.getElementById('header-auth-buttons');

  if (!authContainer) return;

  if (token && user) {
    authContainer.innerHTML = `
      <span class="user-welcome" style="font-size: 0.85rem; font-weight: 600; color: var(--muted); margin-right: 0.5rem;">
        Hi, ${user.username}
      </span>
      <a class="btn btn--header-accent" href="${user.role === 'admin' ? '/admin.html' : '/client-area.html'}" style="gap: 0.35rem;">
        <svg class="icon-use" width="18" height="18" aria-hidden="true"><use href="#i-layers"/></svg>
        <span data-i18n="dashboard">Dashboard</span>
      </a>
      <button onclick="logout()" class="btn btn--header-outline" style="padding: 0.4rem 1rem; font-size: 0.8rem; border-radius: 999px; margin-left: 0.5rem;">
        Logout
      </button>
    `;
  } else {
    authContainer.innerHTML = `
      <a class="btn btn--header-accent" href="/my-account.html" style="gap: 0.35rem;">
        <svg class="icon-use" width="18" height="18" aria-hidden="true"><use href="#i-users"/></svg>
        <span data-i18n="client_area">Client Area</span>
      </a>
    `;
  }

  applyTranslations();

  const sidebarBalance = document.getElementById('sidebar-balance-amount');
  if (sidebarBalance && token) {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.balance !== undefined) {
      sidebarBalance.textContent = '$' + (user.balance || '0.00') + ' USD';
    }

    fetch('/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    })
      .then(res => res.json())
      .then(data => {
        if (data.user && data.user.balance !== undefined) {
          sidebarBalance.textContent = '$' + data.user.balance + ' USD';
          const updatedUser = { ...user, ...data.user };
          localStorage.setItem('user', JSON.stringify(updatedUser));
        }
      })
      .catch(err => console.error('Balance sync error:', err));
  }
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('user');
  window.location.href = '/index.html';
}

function loadTranslations() {
  const scripts = document.getElementsByTagName('script');
  let basePath = '';
  for (let s of scripts) {
    if (s.src.includes('header-loader.js')) {
      basePath = s.src.replace('header-loader.js', '');
      break;
    }
  }

  const script = document.createElement('script');
  script.src = basePath + 'translations.js';
  script.onload = () => {
    const savedLang = localStorage.getItem('selectedLanguage') || 'en';
    const langSelect = document.getElementById('lang');
    if (langSelect) langSelect.value = savedLang;
    applyTranslations(savedLang);
  };
  document.head.appendChild(script);
}

function changeLanguage(lang) {
  localStorage.setItem('selectedLanguage', lang);
  applyTranslations(lang);
}

function applyTranslations(lang) {
  const currentLang = lang || localStorage.getItem('selectedLanguage') || 'en';
  const data = window.translations ? window.translations[currentLang] : null;

  if (!data) return;

  document.documentElement.lang = currentLang;
  document.documentElement.dir = (currentLang === 'ar') ? 'rtl' : 'ltr';

  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (data[key]) {
      el.textContent = data[key];
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHeaderFooter);
} else {
  initHeaderFooter();
}

window.logout = logout;
window.changeLanguage = changeLanguage;

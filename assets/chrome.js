/* Matrix LMS — single source of truth for site chrome.
 *
 * On every page chrome.js builds the SAME DOM shell:
 *
 *   <div class="app-shell">
 *     <header class="site-header" id="site-header"></header>
 *     <div class="app-body">
 *       <aside class="ms-sidebar" id="sidebar"></aside>
 *       <div class="app-main">
 *         ...page-specific content (moved here from <body> on load)...
 *         <footer class="site-footer" id="site-footer"></footer>
 *       </div>
 *     </div>
 *   </div>
 *
 * Pages need to provide nothing — they just write their content directly into
 * <body>. chrome.js wraps it, injects the header / sidebar / footer, and
 * highlights the active nav item by filename.
 *
 * Public API:
 *   window.MatrixChrome.setCourse(course, currentScreenId)  → re-render sidebar
 *                                                              in course mode
 *   window.MatrixChrome.refreshProgress(currentScreenId)    → cheap update
 *   window.MatrixChrome.getCurrentCourse()                  → last course set
 *
 * Pages can opt out of the sidebar with <body data-no-sidebar> (e.g. cert
 * print page).
 */
(function () {
  'use strict';

  const NAV_LINKS = [
    { href: 'index.html',   label: 'Catalog',    match: ['index.html', ''] },
    { href: 'account.html', label: 'My Account', match: ['account.html', 'stats.html'] },
    { href: 'files.html',   label: 'Tools',      match: ['files.html', 'preview.html', 'tools.html'] },
    { href: 'support.html', label: 'Support',    match: ['support.html'] },
    { href: 'admin.html',   label: 'Admin',      match: ['admin.html'] }
  ];

  const FOOTER_LINKS = [
    { href: 'index.html',   label: 'Catalog' },
    { href: 'account.html', label: 'My Account' },
    { href: 'files.html',   label: 'Tools' },
    { href: 'support.html', label: 'Support' },
    { href: 'admin.html',   label: 'Admin' },
    { href: 'https://www.matrixtsl.com', label: 'matrixtsl.com', external: true },
    { href: 'https://www.flowcode.co.uk', label: 'flowcode.co.uk', external: true }
  ];

  /* Pages where the sidebar should track a specific course taken from ?id= */
  const COURSE_AWARE_PAGES = new Set(['dashboard.html', 'course.html', 'certificate.html']);

  let _course = null;
  let _currentScreenId = null;

  function currentFile() {
    return location.pathname.split('/').pop() || 'index.html';
  }

  function isActive(matches, file) {
    return matches.some((m) => m === file);
  }

  /* ---------- DOM shell ---------- */
  function buildShell() {
    if (document.querySelector('.app-shell')) return; /* idempotent */
    const body = document.body;
    const noSidebar = body.hasAttribute('data-no-sidebar');

    /* Collect existing children — everything except scripts / templates / the
       old chrome placeholders becomes the page's main content. */
    const oldHeader = document.getElementById('site-header');
    const oldFooter = document.getElementById('site-footer');
    const toMove = [];
    for (const node of Array.from(body.children)) {
      if (node === oldHeader || node === oldFooter) continue;
      if (node.tagName === 'SCRIPT' || node.tagName === 'TEMPLATE' || node.tagName === 'NOSCRIPT') continue;
      toMove.push(node);
    }

    const shell = document.createElement('div');
    shell.className = 'app-shell' + (noSidebar ? ' app-shell-bare' : '');

    const header = document.createElement('header');
    header.className = 'site-header';
    header.id = 'site-header';
    /* Preserve data-extras-id from a placeholder if the page used one. */
    if (oldHeader && oldHeader.dataset.extrasId) {
      header.dataset.extrasId = oldHeader.dataset.extrasId;
    }

    const appBody = document.createElement('div');
    appBody.className = 'app-body';

    let sidebar = null;
    if (!noSidebar) {
      sidebar = document.createElement('aside');
      sidebar.className = 'ms-sidebar';
      sidebar.id = 'sidebar';
    }

    const main = document.createElement('div');
    main.className = 'app-main';

    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.id = 'site-footer';

    /* Move the existing page content into main, then append the footer */
    for (const n of toMove) main.appendChild(n);
    main.appendChild(footer);

    if (sidebar) appBody.appendChild(sidebar);
    appBody.appendChild(main);
    shell.appendChild(header);
    shell.appendChild(appBody);

    /* Replace old chrome placeholders */
    if (oldHeader) oldHeader.remove();
    if (oldFooter) oldFooter.remove();

    body.insertBefore(shell, body.firstChild);
  }

  /* ---------- Header + footer renderers ---------- */
  function renderHeader() {
    const root = document.getElementById('site-header');
    if (!root) return;
    const file = currentFile();

    let extrasHtml = '';
    const extrasId = root.dataset.extrasId;
    if (extrasId) {
      const tpl = document.getElementById(extrasId);
      if (tpl && tpl.content) extrasHtml = tpl.innerHTML;
      else if (tpl) extrasHtml = tpl.innerHTML;
    }

    const navHtml = NAV_LINKS
      .map((l) => `<a href="${l.href}"${isActive(l.match, file) ? ' class="active"' : ''}>${l.label}</a>`)
      .join('');

    const noSidebar = document.body.hasAttribute('data-no-sidebar');
    const sidebarToggle = noSidebar ? '' : `
      <button type="button" class="site-header-sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar" title="Show / hide sidebar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2"/>
          <line x1="9" y1="4" x2="9" y2="20"/>
        </svg>
      </button>
    `;

    /* Mobile hamburger — appears <=720px via CSS; toggles the nav into
       a full-screen drop-down panel so every nav item is reachable. */
    const hamburger = `
      <button type="button" class="site-header-hamburger" id="nav-hamburger" aria-label="Open menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    `;

    root.innerHTML = `
      ${sidebarToggle}
      <a href="index.html" class="brand">
        <img src="assets/matrix-logo.svg" alt="Matrix TSL" class="brand-logo">
        <span class="brand-divider">|</span>
        <span class="brand-sub">Course Viewer</span>
      </a>
      <nav id="site-header-nav">${navHtml}${extrasHtml}</nav>
      <a class="site-header-account" href="account.html" aria-label="My Account" title="My Account">
        <span class="site-header-account-ico" aria-hidden="true">👤</span>
        <span class="site-header-account-label">My Account</span>
      </a>
      ${hamburger}
    `;

    /* Apply persisted state + wire the toggles. */
    const SIDEBAR_KEY = 'matrix-lms:sidebar-collapsed';
    const shell = document.querySelector('.app-shell');
    if (shell) {
      try {
        if (localStorage.getItem(SIDEBAR_KEY) === '1') shell.classList.add('sidebar-collapsed');
      } catch (_) {}
    }
    const toggle = document.getElementById('sidebar-toggle');
    if (toggle && shell) {
      toggle.addEventListener('click', () => {
        const collapsed = shell.classList.toggle('sidebar-collapsed');
        try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch (_) {}
      });
    }
    /* Hamburger drives a body-level class so the nav slides down and any
       open page-shell content scrolls underneath. */
    const burger = document.getElementById('nav-hamburger');
    if (burger) {
      burger.addEventListener('click', () => {
        const open = document.body.classList.toggle('nav-open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      /* Close when a nav link is followed so the panel doesn't linger. */
      const nav = document.getElementById('site-header-nav');
      if (nav) {
        nav.addEventListener('click', (ev) => {
          if (ev.target.closest('a')) {
            document.body.classList.remove('nav-open');
            burger.setAttribute('aria-expanded', 'false');
          }
        });
      }
    }
  }

  function renderFooter() {
    const root = document.getElementById('site-footer');
    if (!root) return;
    const linksHtml = FOOTER_LINKS
      .map((l) => l.external
        ? `<a href="${l.href}" target="_blank" rel="noopener">${l.label}</a>`
        : `<a href="${l.href}">${l.label}</a>`)
      .join('');
    root.innerHTML = `
      <div class="footer-inner">
        <div class="footer-brand">
          <strong>Matrix Course Viewer</strong>
          <span>© Matrix TSL · Engineering education resources</span>
        </div>
        <div class="footer-links">${linksHtml}</div>
      </div>
    `;
  }

  /* ---------- Sidebar bootstrap ---------- */
  async function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !window.MatrixSidebar) return;
    const file = currentFile();

    if (COURSE_AWARE_PAGES.has(file)) {
      const id = new URLSearchParams(location.search).get('id');
      if (id) {
        try {
          const data = await fetch('data/courses.json').then((r) => r.json());
          let course = (data.courses || []).find((c) => c.id === id);
          if (course && window.MatrixCMS && window.MatrixCMS.applyOverrides) {
            course = window.MatrixCMS.applyOverrides(course);
          }
          if (course) {
            _course = course;
            const mode = file === 'dashboard.html' ? 'dashboard' : 'course';
            window.MatrixSidebar.render(sidebar, course, mode, _currentScreenId);
            /* Visiting any course-aware page counts as opening that course —
               needed for 'Explorer' (open >1) and 'Multi-Discipline'. We wait
               until Gamify is ready in case the page hasn't initialised it. */
            const trackVisit = () => {
              if (window.Gamify && typeof window.Gamify.trackCourseVisit === 'function') {
                window.Gamify.trackCourseVisit(course.id);
              }
            };
            if (window.Gamify) trackVisit();
            else window.addEventListener('load', trackVisit);
            return;
          }
        } catch (_) { /* fall through to catalog mode */ }
      }
    }

    /* Default for every other page: last-visited course in catalog mode. */
    window.MatrixSidebar.renderCatalog(sidebar);
  }

  /* ---------- Public API ---------- */
  function setCourse(course, currentScreenId) {
    _course = course;
    _currentScreenId = currentScreenId || null;
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !course || !window.MatrixSidebar) return;
    const file = currentFile();
    const mode = file === 'dashboard.html' ? 'dashboard' : 'course';
    window.MatrixSidebar.render(sidebar, course, mode, _currentScreenId);
  }

  function refreshProgress(currentScreenId) {
    if (currentScreenId) _currentScreenId = currentScreenId;
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !_course || !window.MatrixSidebar) return;
    window.MatrixSidebar.refreshProgress(sidebar, _course, _currentScreenId);
  }

  function getCurrentCourse() { return _course; }

  function render() {
    buildShell();
    renderHeader();
    renderFooter();
    initSidebar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  window.MatrixChrome = { setCourse, refreshProgress, getCurrentCourse };
})();

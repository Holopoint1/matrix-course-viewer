/* Matrix LMS — shared header + footer renderer
 *
 * Every page is supposed to have identical chrome. To avoid drift between
 * pages, the header and footer are rendered from this single source of truth.
 *
 * Each page just needs:
 *   <header class="site-header" id="site-header"></header>
 *   ...
 *   <footer class="site-footer" id="site-footer"></footer>
 *
 * Optionally, a page can add right-hand nav extras (e.g. a 'Back to course'
 * link on the certificate page) by putting:
 *   <header class="site-header" id="site-header" data-extras-id="my-extras"></header>
 *   <template id="my-extras"><a id="back-link" href="#">Back to course</a></template>
 *
 * Auto-highlights the current page's nav link by matching the file name.
 */
(function () {
  'use strict';

  const NAV_LINKS = [
    { href: 'index.html',     label: 'Catalog',  match: ['index.html', ''] },
    { href: 'stats.html',     label: 'My Stats', match: ['stats.html'] },
    { href: 'files.html',     label: 'Files',    match: ['files.html', 'preview.html'] },
    { href: 'admin.html',     label: 'Admin',    match: ['admin.html'] }
  ];

  const FOOTER_LINKS = [
    { href: 'index.html', label: 'Catalog' },
    { href: 'stats.html', label: 'My Stats' },
    { href: 'files.html', label: 'Files' },
    { href: 'admin.html', label: 'Admin' },
    { href: 'https://www.matrixtsl.com', label: 'matrixtsl.com', external: true },
    { href: 'https://www.flowcode.co.uk', label: 'flowcode.co.uk', external: true }
  ];

  function currentFile() {
    let p = location.pathname.split('/').pop() || 'index.html';
    /* Treat dashboard / course / certificate as part of the Catalog "section"
       (no dedicated nav link). */
    return p;
  }

  function isActive(matches, file) {
    return matches.some((m) => m === file);
  }

  function renderHeader() {
    const root = document.getElementById('site-header');
    if (!root) return;
    root.classList.add('site-header');
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

    root.innerHTML = `
      <a href="index.html" class="brand">
        <img src="assets/matrix-logo.svg" alt="Matrix TSL" class="brand-logo">
        <span class="brand-divider">|</span>
        <span class="brand-sub">Course Viewer</span>
      </a>
      <nav>${navHtml}${extrasHtml}</nav>
    `;
  }

  function renderFooter() {
    const root = document.getElementById('site-footer');
    if (!root) return;
    root.classList.add('site-footer');
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

  function render() {
    renderHeader();
    renderFooter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();

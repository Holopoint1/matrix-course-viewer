/* Matrix LMS — shared sidebar renderer
 * Used by dashboard.html and course.html so they share one source of truth
 * for what appears in the left rail.
 */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function tierLabel(t) {
    return ({ bronze: 'Bronze', silver: 'Silver', gold: 'Gold' })[t] || (t || '').toUpperCase();
  }

  function render(root, course, currentPage) {
    if (!root || !course) return;

    const progress = JSON.parse(localStorage.getItem('matrix-lms:progress:' + course.id) || '{}');
    const completed = course.screens.filter((s) => progress[s.id]).length;
    const total = course.screens.length;
    const pct = total ? Math.round((completed / total) * 100) : 0;

    /* Group screens by tier (only document-type ones for the worksheet rail). */
    const worksheets = course.screens.filter((s) => s.type === 'document');
    const grouped = { bronze: [], silver: [], gold: [], other: [] };
    for (const s of worksheets) {
      const t = (window.Gamify && window.Gamify.inferTier(s)) || 'other';
      grouped[t].push(s);
    }

    const courseUrl = 'course.html?id=' + encodeURIComponent(course.id);
    const dashUrl = 'dashboard.html?id=' + encodeURIComponent(course.id);

    let worksheetNum = 0;
    let html = `
      <div class="viewer-course-info">
        <span class="code">${escapeHtml(course.code)}</span>
        <h1>${escapeHtml(course.title)}</h1>
        <div class="progress"><span style="width:${pct}%;"></span></div>
        <div class="progress-label">
          <span><strong>${completed}</strong> of <strong>${total}</strong> complete</span>
          <span id="progress-percent">${pct}%</span>
        </div>
      </div>
      <div class="sidebar-nav">
        <a class="sidebar-nav-item ${currentPage === 'dashboard' ? 'active' : ''}" href="${dashUrl}">
          <span class="sidebar-nav-ico">▦</span><span>Dashboard</span>
        </a>
        <a class="sidebar-nav-item" href="index.html">
          <span class="sidebar-nav-ico">▥</span><span>All Courses</span>
        </a>
      </div>
      <ul class="screen-list" id="screen-list">
    `;

    for (const tier of ['bronze', 'silver', 'gold', 'other']) {
      const items = grouped[tier];
      if (!items.length) continue;
      html += `<li class="section-header section-${tier}">
        <span class="section-dot"></span>
        <span class="section-label">${escapeHtml(tierLabel(tier))}</span>
      </li>`;
      for (const s of items) {
        worksheetNum += 1;
        const done = Boolean(progress[s.id]);
        const url = courseUrl + '&screen=' + encodeURIComponent(s.id);
        html += `
          <li class="screen-item ${done ? 'completed' : ''} ${s.missing ? 'missing' : ''}">
            <a href="${url}" style="display:contents;color:inherit;text-decoration:none;">
              <span class="screen-checkbox" aria-hidden="true"></span>
              <span class="screen-title">
                <span class="screen-num">${worksheetNum}</span>
                <span class="screen-title-text">${escapeHtml(s.title)}</span>
              </span>
              <span class="screen-type-dot ${s.type}" title="${escapeHtml(s.type)}"></span>
            </a>
          </li>
        `;
      }
    }
    html += '</ul>';

    /* Footer actions — learner-facing only.
       Admin / Files / SCORM access lives in the top nav. */
    html += `
      <div class="sidebar-actions">
        <button type="button" class="sidebar-foot-link sidebar-foot-danger" id="sidebar-reset">
          <span>↺</span><span>Reset all progress</span>
        </button>
      </div>
    `;

    root.innerHTML = html;

    /* Wire reset */
    const resetBtn = root.querySelector('#sidebar-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!confirm('Reset all progress? This will wipe completion, time tracking, achievements and streak — across every course. Cannot be undone.')) return;
        if (window.Gamify) window.Gamify.resetAll();
        location.reload();
      });
    }
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  window.MatrixSidebar = { render };
})();

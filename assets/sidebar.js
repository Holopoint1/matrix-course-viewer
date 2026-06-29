/* Matrix LMS — shared sidebar renderer
 *
 * Renders the persistent left rail used on every page. Three render modes:
 *
 *   1. Course mode    — render(root, course, 'dashboard' | 'course')
 *                       Shows course header, overall-progress for that course,
 *                       Dashboard + All Courses nav, expandable course card
 *                       with tier-grouped worksheets, footer tools.
 *
 *   2. Catalog mode   — renderCatalog(root)
 *                       Loads last-visited course from localStorage and renders
 *                       course mode for it (so the rail stays consistent). If no
 *                       course has been visited, just renders the top nav.
 *
 *   3. Refresh        — refreshProgress(root, course) updates only the % bar
 *                       and tick states without re-rendering the whole rail.
 *
 * Active-item highlighting:
 *   - 'dashboard'              → Dashboard nav item highlighted
 *   - 'course'                 → No top-nav highlight; active worksheet inside
 *                                the course-card body gets .active (caller can
 *                                pass currentScreenId via the 4th arg).
 */
(function () {
  'use strict';

  const LAST_COURSE_KEY = 'matrix-lms:last-course';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function tierLabel(t) {
    return ({ bronze: 'Bronze', silver: 'Silver', gold: 'Gold' })[t] || (t || 'Additional');
  }

  function getProgress(courseId) {
    try { return JSON.parse(localStorage.getItem('matrix-lms:progress:' + courseId) || '{}'); }
    catch (_) { return {}; }
  }

  function getExpanded() {
    try { return new Set(JSON.parse(localStorage.getItem('matrix-lms:sidebar-expanded') || '[]')); }
    catch (_) { return new Set(); }
  }
  function setExpanded(set) {
    localStorage.setItem('matrix-lms:sidebar-expanded', JSON.stringify(Array.from(set)));
  }

  function setLastCourse(courseId) {
    try { localStorage.setItem(LAST_COURSE_KEY, courseId); } catch (_) {}
  }
  function getLastCourse() {
    try { return localStorage.getItem(LAST_COURSE_KEY); } catch (_) { return null; }
  }

  /* A course is "in progress" if the learner has ticked at least one screen
     complete OR has logged any time against it. Visiting alone does not
     count as in-progress. */
  function isCourseInProgress(courseId) {
    try {
      const progress = JSON.parse(localStorage.getItem('matrix-lms:progress:' + courseId) || '{}');
      if (Object.keys(progress).length > 0) return true;
      const time = JSON.parse(localStorage.getItem('matrix-lms:time:' + courseId) || '{}');
      for (const k of Object.keys(time)) {
        if (Number(time[k]) > 0) return true;
      }
    } catch (_) {}
    return false;
  }

  /* SVG icon factory — kept inline so the sidebar has no asset dependencies. */
  const ICONS = {
    home:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    grid:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    check:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>',
    doc:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    chevron: '<svg class="course-nav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    reset:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>'
  };

  function buildTopNav(/* currentPage */) {
    /* Intentionally empty: the old sidebar "Dashboard / All Courses" block
       was redundant — Courses is in the top header nav, and the course card
       below already exposes the dashboard. Kept as a no-op so the single
       call site and the null-guarded #ms-dashboard-link handler stay valid. */
    return '';
  }

  function buildFooterTools() {
    /* Authoring tools (SCORM export, splitter, etc.) now live under the
       top-nav TOOLS screen, not the sidebar. The sidebar is purely
       course navigation for the currently-selected course. */
    return '';
  }

  function buildResetBar() {
    return `
      <div class="ms-reset-bar">
        <button type="button" class="ms-reset-btn" id="ms-reset">Reset All Progress</button>
      </div>
    `;
  }

  function buildHeader(course) {
    /* The Matrix logo lives in the top header (chrome.js); the sidebar
       skips its own logo to avoid the duplicate brand. The header still
       carries an eyebrow + course code/title for context. */
    if (!course) {
      return `
        <div class="ms-header ms-header-empty">
          <span class="ms-brand-eyebrow">Matrix Learning</span>
        </div>
      `;
    }
    /* The code/title is a link back to the course dashboard — from inside
       a worksheet there was previously no way back to it. */
    const dashHref = 'dashboard.html?id=' + encodeURIComponent(course.id);
    return `
      <div class="ms-header">
        <span class="ms-brand-eyebrow">Matrix Learning</span>
        <a class="ms-header-link" href="${dashHref}" title="Back to the ${escapeHtml(course.code || 'course')} dashboard">
          <span class="ms-course-code">${escapeHtml(course.code || '')}</span>
          <span class="ms-course-title">${escapeHtml(course.title || '')}</span>
          <span class="ms-header-dash">⌂ Course dashboard</span>
        </a>
      </div>
    `;
  }

  function buildProgressBlock(pct) {
    return `
      <div class="ms-overall">
        <div class="ms-overall-row">
          <span class="ms-overall-label">Overall Progress</span>
          <span class="ms-overall-pct" data-role="overall-pct">${pct}%</span>
        </div>
        <div class="ms-bar"><span class="ms-bar-fill" data-role="overall-bar" style="width:${pct}%;"></span></div>
      </div>
    `;
  }

  function buildCourseCard(course, expanded, currentScreenId, isCourseOpen) {
    /* Show EVERY screen — image, HTML, YouTube, PDF, document, PowerPoint —
       so the sidebar is a faithful map of the course and the user always
       knows where they are. Progress percentage is based on the screens
       that have been ticked complete. Each row carries a type dot so the
       learner can distinguish a video from a worksheet at a glance. */
    const allScreens = course.screens || [];
    const total = allScreens.length;
    const progress = getProgress(course.id);
    const done = allScreens.filter((s) => progress[s.id]).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    /* Type-dot CSS class — colours match .screen-type-dot in styles.css */
    function typeClass(t) {
      switch (t) {
        case 'document':   return 'document';
        case 'html':       return 'html';
        case 'pdf':        return 'pdf';
        case 'youtube':    return 'youtube';
        case 'image':      return 'image';
        case 'powerpoint': return 'powerpoint';
        case 'spreadsheet':return 'document';
        default:           return 'document';
      }
    }
    /* Short, human label so learners know what each screen IS at a glance
       (worksheet vs video vs slides vs PDF…). */
    function typeLabel(t) {
      switch (t) {
        case 'document':   return 'Worksheet';
        case 'html':       return 'Page';
        case 'pdf':        return 'PDF';
        case 'youtube':    return 'Video';
        case 'image':      return 'Image';
        case 'powerpoint': return 'Slides';
        case 'spreadsheet':return 'Sheet';
        default:           return (t || 'Screen');
      }
    }
    /* Flat, in-authoring-order list. No tier / homework / assessment grouping —
       the course-structure spec doesn't define those buckets and the Bronze /
       Silver / Gold tiers are specific to one Microcontrollers pack, not a
       site-wide concept. Simpler is better. */
    let body = '<div class="ms-tier ms-tier-flat">';
    let n = 0;
    for (const s of allScreens) {
      n += 1;
      const isDone = Boolean(progress[s.id]);
      const isActive = s.id === currentScreenId;
      const isMissing = Boolean(s.missing);
      const href = 'course.html?id=' + encodeURIComponent(course.id) + '&screen=' + encodeURIComponent(s.id);
      const titleAttr = isMissing
        ? 'Resource pending — file not yet uploaded'
        : escapeHtml(s.type);
      /* Per-screen completion toggle. role=checkbox + tabindex keeps it
         keyboard-operable and valid inside the row anchor; the click/keydown
         handler stops the anchor from navigating. Not offered for screens
         whose file hasn't been uploaded yet (nothing to complete). */
      const tick = isMissing ? '' : `
          <span class="ms-ws-tick" role="checkbox" tabindex="0"
                aria-checked="${isDone ? 'true' : 'false'}"
                data-screen="${escapeHtml(s.id)}"
                aria-label="Mark this page ${isDone ? 'incomplete' : 'complete'}"
                title="${isDone ? 'Completed — click to mark incomplete' : 'Mark this page complete'}"></span>`;
      body += `
        <a class="ms-ws-item${isDone ? ' done' : ''}${isActive ? ' active' : ''}${isMissing ? ' missing' : ''}" href="${href}" title="${titleAttr}">
          <span class="ms-ws-num">${n}</span>
          <span class="ms-ws-main">
            <span class="ms-ws-title">${escapeHtml(s.title)}</span>
            <span class="ms-ws-type-badge ${typeClass(s.type)}">${escapeHtml(typeLabel(s.type))}${isMissing ? ' · pending' : ''}</span>
          </span>${tick}
        </a>
      `;
    }
    body += '</div>';

    const kindLabel = course.kind === 'pack' ? 'PACK' : escapeHtml(course.code || '');
    const isPack = course.kind === 'pack';
    /* When the course is NOT currently open, the card acts as a 'return to
       course' shortcut — title chip becomes a "Continue" eyebrow and the
       progress chip swaps for an explicit CTA. Clicking anywhere on the
       head jumps to the dashboard; the chevron toggles the worksheet list. */
    const continueHref = 'dashboard.html?id=' + encodeURIComponent(course.id);
    const eyebrow = isCourseOpen
      ? (kindLabel + (isPack ? ' &middot; ' + escapeHtml(course.code || '') : ''))
      : ('CONTINUE &middot; ' + escapeHtml(course.code || ''));
    const returnAttr = ' data-return-href="' + escapeHtml(continueHref) + '"';
    return `
      <div class="ms-section">
        <div class="ms-course-group expanded${isPack ? ' ms-course-group-pack' : ''}${isCourseOpen ? '' : ' ms-course-group-return'}" data-role="course-group">
          <button type="button" class="ms-course-head ms-course-head-textonly" id="ms-course-toggle"${returnAttr}>
            <span class="ms-course-info">
              <span class="ms-course-info-code">${eyebrow}</span>
              <span class="ms-course-info-title">${escapeHtml(course.title || '')}</span>
              <span class="ms-course-info-progress">${pct}% &middot; ${done}/${total}</span>
            </span>
          </button>
          <div class="ms-course-body">
            ${body}
          </div>
        </div>
      </div>
    `;
  }

  /* Reflect a persisted progress map onto the rendered screen rows: the
     .done class, each tick toggle's a11y state, and the overall % bar.
     Reads each row's own data-screen so it never depends on list order.
     Denominator is every rendered row (incl. 'missing' ones, which have
     no tick and can never be done) — matching the app-wide pct definition. */
  function syncSidebarProgress(root, progress) {
    const rows = root.querySelectorAll('.ms-ws-item');
    const total = rows.length;
    let done = 0;
    rows.forEach((row) => {
      const t = row.querySelector('.ms-ws-tick');
      const isDone = t ? Boolean(progress[t.dataset.screen]) : false;
      if (t) {
        row.classList.toggle('done', isDone);
        t.setAttribute('aria-checked', isDone ? 'true' : 'false');
        t.setAttribute('aria-label', 'Mark this page ' + (isDone ? 'incomplete' : 'complete'));
        t.setAttribute('title', isDone ? 'Completed — click to mark incomplete' : 'Mark this page complete');
      }
      if (isDone) done += 1;
    });
    const pct = total ? Math.round((done / total) * 100) : 0;
    const pctEl = root.querySelector('[data-role="overall-pct"]');
    const barEl = root.querySelector('[data-role="overall-bar"]');
    if (pctEl) pctEl.textContent = pct + '%';
    if (barEl) barEl.style.width = pct + '%';
  }

  function wireExpanderAndReset(root, courseId) {
    /* The course head links to the course dashboard. The old chevron that
       collapsed the whole screen list has been removed — the list is always shown. */
    const toggle = root.querySelector('#ms-course-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const returnHref = toggle.dataset.returnHref;
        if (returnHref) location.href = returnHref;
      });
    }
    const resetBtn = root.querySelector('#ms-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!confirm('Reset all progress? Completion, time tracking, achievements and streak will be wiped across every course. Cannot be undone.')) return;
        if (window.Gamify && typeof window.Gamify.resetAll === 'function') window.Gamify.resetAll();
        else {
          /* Fallback: nuke just the LMS keys we own. */
          Object.keys(localStorage).filter((k) => k.indexOf('matrix-lms:') === 0).forEach((k) => localStorage.removeItem(k));
        }
        location.reload();
      });
    }
    /* Dashboard link target is course-aware. */
    const dashLink = root.querySelector('#ms-dashboard-link');
    if (dashLink && courseId) {
      dashLink.href = 'dashboard.html?id=' + encodeURIComponent(courseId);
    } else if (dashLink) {
      dashLink.href = 'index.html';
    }

    /* Per-screen tick toggle. The sidebar root (#sidebar) persists across
       re-renders while only its innerHTML is replaced, so bind the delegated
       handler exactly once and read the live course id from a data attr
       (re-set on every render). */
    root.dataset.tickCourse = courseId || '';
    if (root.dataset.tickWired !== '1') {
      root.dataset.tickWired = '1';
      const onTick = (ev) => {
        const t = ev.target.closest && ev.target.closest('.ms-ws-tick');
        if (!t || !root.contains(t)) return;
        if (ev.type === 'keydown' &&
            ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
        ev.preventDefault();
        ev.stopPropagation();              /* don't let the row anchor navigate */
        const cid = root.dataset.tickCourse;
        const screenId = t.dataset.screen;
        if (!cid || !screenId) return;
        if (window.MatrixCourse &&
            typeof window.MatrixCourse.toggleComplete === 'function' &&
            typeof window.MatrixCourse.getCourseId === 'function' &&
            window.MatrixCourse.getCourseId() === cid) {
          /* On the course player: route through app.js so gamify, SCORM and
             the certificate gate update too. It calls back into
             MatrixSidebar.refreshProgress, which re-syncs these rows. */
          window.MatrixCourse.toggleComplete(screenId);
        } else {
          /* Elsewhere (e.g. the dashboard): toggle persisted progress
             directly and reflect it on the rows locally. */
          const key = 'matrix-lms:progress:' + cid;
          let p;
          try { p = JSON.parse(localStorage.getItem(key) || '{}'); }
          catch (_) { p = {}; }
          if (p[screenId]) delete p[screenId];
          else p[screenId] = { ts: Date.now() };
          localStorage.setItem(key, JSON.stringify(p));
          syncSidebarProgress(root, p);
        }
      };
      root.addEventListener('click', onTick);
      root.addEventListener('keydown', onTick);
    }
  }

  function render(root, course, currentPage, currentScreenId) {
    if (!root) return;
    if (course) setLastCourse(course.id);

    /* "Course open" = the learner is currently INSIDE the course at any
       level — either the worksheet viewer (course.html) or its dashboard
       page (dashboard.html). Both auto-expand the worksheet list so the
       learner can see every screen and jump anywhere in the course.
       Off-course pages (catalog / account / files / etc.) collapse to
       a 'Continue · CO000x' chip instead. */
    const isCourseOpen = currentPage === 'course' || currentPage === 'dashboard';

    let pct = 0;
    if (course) {
      const screens = course.screens || [];
      const progress = getProgress(course.id);
      const done = screens.filter((s) => progress[s.id]).length;
      pct = screens.length ? Math.round((done / screens.length) * 100) : 0;
    }

    /* Default expand state: ALWAYS expanded when the card is shown,
       unless the user has explicitly collapsed it via the chevron.
       The chevron toggle is persisted to localStorage so manual choice
       sticks across navigations. */
    let expanded = true;
    if (course) {
      /* If the user has explicitly collapsed this course's card, respect
         that. Otherwise default-open everywhere the card appears. */
      const stored = getExpanded();
      if (stored.has('collapsed:' + course.id)) expanded = false;
    }

    /* Show the course card when:
       - currently viewing a worksheet (course.html)      OR
       - on the dashboard for that course                 OR
       - on any other page but the course is in-progress  */
    const showCourseCard = course && (isCourseOpen || isCourseInProgress(course.id));

    /* Certificate quick-access in the sidebar — only when the course is
       100% AND has a certificate enabled. Sits right under the progress
       bar so it's the very next thing the learner sees on completion. */
    const showCertCta = showCourseCard && pct === 100 &&
      course && course.certificate && course.certificate.enabled;
    const certCtaHtml = showCertCta
      ? '<a class="ms-cert-cta" href="certificate.html?id=' + encodeURIComponent(course.id) +
        '" title="Download your certificate">' +
        '<span class="ms-cert-cta-ico" aria-hidden="true">🎓</span>' +
        '<span class="ms-cert-cta-body"><strong>Certificate ready</strong>' +
        '<span>Download your certificate</span></span>' +
        '<span class="ms-cert-cta-arrow" aria-hidden="true">→</span></a>'
      : '';

    const html = `
      ${buildHeader(showCourseCard ? course : null)}
      ${showCourseCard ? buildProgressBlock(pct) : ''}
      ${certCtaHtml}
      <nav class="ms-nav">
        ${buildTopNav(currentPage)}
        ${showCourseCard ? buildCourseCard(course, expanded, currentScreenId, isCourseOpen) : ''}
      </nav>
      ${buildFooterTools(showCourseCard ? course : null)}
      ${showCourseCard ? buildResetBar() : ''}
    `;
    root.innerHTML = html;
    root.classList.add('ms-sidebar');

    wireExpanderAndReset(root, showCourseCard ? course.id : null);
  }

  async function renderCatalog(root) {
    if (!root) return;
    /* Pass the last-visited course in so the renderer can decide whether to
       show its "return to" dropdown. render() will gate the card on
       isCourseInProgress() internally — so if the learner has only browsed
       the course without ticking anything complete, nothing course-related
       shows in the sidebar. */
    const lastId = getLastCourse();
    if (!lastId || !isCourseInProgress(lastId)) {
      render(root, null, 'catalog');
      return;
    }
    try {
      const data = await fetch('data/courses.json').then((r) => r.json());
      let course = (data.courses || []).find((c) => c.id === lastId);
      if (course && window.MatrixCMS && window.MatrixCMS.applyOverrides) {
        course = window.MatrixCMS.applyOverrides(course);
      }
      render(root, course || null, 'catalog');
    } catch (_) {
      render(root, null, 'catalog');
    }
  }

  function refreshProgress(root, course, currentScreenId) {
    /* Cheap-update only the progress bar + tick states without nuking listeners. */
    if (!root || !course) return;
    const screens = course.screens || [];
    const progress = getProgress(course.id);
    const total = screens.length;
    const done = screens.filter((s) => progress[s.id]).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    const pctEl = root.querySelector('[data-role="overall-pct"]');
    const barEl = root.querySelector('[data-role="overall-bar"]');
    if (pctEl) pctEl.textContent = pct + '%';
    if (barEl) barEl.style.width = pct + '%';

    /* Mark every screen row's done/active state. Walks the full screen
       list in authoring order — same order the renderer emits — so the
       DOM positions match index-for-index. */
    const items = root.querySelectorAll('.ms-ws-item');
    items.forEach((el, i) => {
      const s = screens[i];
      if (!s) return;
      const isDone = Boolean(progress[s.id]);
      el.classList.toggle('done', isDone);
      el.classList.toggle('active', s.id === currentScreenId);
      const t = el.querySelector('.ms-ws-tick');
      if (t) {
        t.setAttribute('aria-checked', isDone ? 'true' : 'false');
        t.setAttribute('aria-label', 'Mark this page ' + (isDone ? 'incomplete' : 'complete'));
        t.setAttribute('title', isDone ? 'Completed — click to mark incomplete' : 'Mark this page complete');
      }
    });
  }

  window.MatrixSidebar = { render, renderCatalog, refreshProgress, setLastCourse, getLastCourse };
})();

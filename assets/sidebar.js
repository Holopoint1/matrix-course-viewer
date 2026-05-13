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

  function thumbForCourse(course) {
    /* Mirrors the catalog's thumbnail picker so the rail matches the cards. */
    const firstImage = (course.screens || []).find((s) => s.type === 'image');
    if (firstImage && (firstImage.thumbnail || (!firstImage.missing && firstImage.src))) {
      return firstImage.thumbnail || firstImage.src;
    }
    return 'content/' + course.id + '/opening.svg';
  }

  function buildTopNav(currentPage) {
    /* Render Dashboard + All Courses entries.  When viewing a worksheet,
       neither is highlighted (the active worksheet inside the course-card
       gets the highlight instead). */
    const dashActive = currentPage === 'dashboard' ? ' active' : '';
    const catalogActive = currentPage === 'catalog' ? ' active' : '';
    return `
      <div class="ms-section">
        <a class="ms-nav-item${dashActive}" data-nav="dashboard" href="#" id="ms-dashboard-link">
          <span class="ms-nav-ico ms-nav-ico-primary">${ICONS.home}</span>
          <span class="ms-nav-label">Dashboard</span>
        </a>
        <a class="ms-nav-item${catalogActive}" data-nav="catalog" href="index.html">
          <span class="ms-nav-ico ms-nav-ico-mute">${ICONS.grid}</span>
          <span class="ms-nav-label">All Courses</span>
        </a>
      </div>
    `;
  }

  function buildFooterTools(course) {
    /* When a course is in scope, pass its id through to the SCORM page so
       its Live Status table shows that course's worksheets. */
    const scormHref = course && course.id
      ? `scorm.html?id=${encodeURIComponent(course.id)}`
      : 'scorm.html';
    return `
      <div class="ms-section ms-section-tools">
        <a class="ms-nav-item" href="${scormHref}">
          <span class="ms-nav-ico ms-nav-ico-blue">${ICONS.check}</span>
          <span class="ms-nav-label">SCORM Compliance</span>
        </a>
      </div>
    `;
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
    return `
      <div class="ms-header">
        <span class="ms-brand-eyebrow">Matrix Learning</span>
        <div class="ms-course-code">${escapeHtml(course.code || '')}</div>
        <div class="ms-course-title">${escapeHtml(course.title || '')}</div>
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
    const thumb = thumbForCourse(course);

    /* Classify each screen into a section. Tier inference (bronze/silver/
       gold) wins for document worksheets that match the CP*-N pattern.
       Otherwise we use a contextual section name based on title +/ type. */
    function sectionFor(s) {
      const tier = (window.Gamify && window.Gamify.inferTier && window.Gamify.inferTier(s));
      if (tier) return tier;
      const t = (s.title || '').toLowerCase();
      if (/homework/i.test(t)) return 'homework';
      if (/assessment/i.test(t)) return 'assessment';
      if (/certificate/i.test(t)) return 'certificate';
      return 'intro';
    }
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
    /* Walk screens in order, emitting a section header whenever the
       section changes. This preserves authoring order so users navigate
       the course linearly. */
    let body = '';
    let lastSection = null;
    let n = 0;
    const sectionLabels = {
      intro: 'Intro & welcome',
      bronze: 'Bronze',
      silver: 'Silver',
      gold: 'Gold',
      homework: 'Homework',
      assessment: 'Assessment',
      certificate: 'Certificate',
      other: 'Additional'
    };
    for (const s of allScreens) {
      n += 1;
      const sec = sectionFor(s);
      if (sec !== lastSection) {
        if (lastSection !== null) body += '</div>';
        body += `
          <div class="ms-tier">
            <div class="ms-tier-label tier-${sec}"><span class="ms-tier-dot"></span>${escapeHtml(sectionLabels[sec] || sec)}</div>
        `;
        lastSection = sec;
      }
      const isDone = Boolean(progress[s.id]);
      const isActive = s.id === currentScreenId;
      const isMissing = Boolean(s.missing);
      /* Missing screens still navigate — they just show the friendly
         "Resource missing — please send X" panel in the viewer instead
         of being completely un-clickable. */
      const href = 'course.html?id=' + encodeURIComponent(course.id) + '&screen=' + encodeURIComponent(s.id);
      const titleAttr = isMissing
        ? 'Resource pending — file not yet uploaded'
        : escapeHtml(s.type);
      body += `
        <a class="ms-ws-item${isDone ? ' done' : ''}${isActive ? ' active' : ''}${isMissing ? ' missing' : ''}" href="${href}" title="${titleAttr}">
          <span class="ms-ws-num">${n}</span>
          <span class="ms-ws-title">${escapeHtml(s.title)}</span>
          <span class="ms-ws-type-dot ${typeClass(s.type)}" title="${escapeHtml(s.type)}"></span>
        </a>
      `;
    }
    if (lastSection !== null) body += '</div>';

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
    const returnAttr = isCourseOpen ? '' : ' data-return-href="' + escapeHtml(continueHref) + '"';
    return `
      <div class="ms-section">
        <div class="ms-course-group${expanded ? ' expanded' : ''}${isPack ? ' ms-course-group-pack' : ''}${isCourseOpen ? '' : ' ms-course-group-return'}" data-role="course-group">
          <button type="button" class="ms-course-head" id="ms-course-toggle"${returnAttr}>
            <img class="ms-course-thumb" src="${escapeHtml(thumb)}" alt="">
            <span class="ms-course-info">
              <span class="ms-course-info-code">${eyebrow}</span>
              <span class="ms-course-info-title">${escapeHtml(course.title || '')}</span>
              <span class="ms-course-info-progress">${pct}% &middot; ${done}/${total}</span>
            </span>
            ${ICONS.chevron}
          </button>
          <div class="ms-course-body">
            ${body}
          </div>
        </div>
      </div>
    `;
  }

  function wireExpanderAndReset(root, courseId) {
    const toggle = root.querySelector('#ms-course-toggle');
    const group = root.querySelector('[data-role="course-group"]');
    if (toggle && group) {
      toggle.addEventListener('click', (ev) => {
        /* If this is a "return to course" card (user is on a non-course page),
           clicking the body of the head jumps back to the course dashboard.
           Only the chevron toggles the worksheet list. */
        const returnHref = toggle.dataset.returnHref;
        const chev = ev.target.closest('.course-nav-arrow');
        if (returnHref && !chev) {
          location.href = returnHref;
          return;
        }
        const isOpen = group.classList.toggle('expanded');
        const set = getExpanded();
        if (isOpen) set.add(courseId); else set.delete(courseId);
        setExpanded(set);
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

    const html = `
      ${buildHeader(showCourseCard ? course : null)}
      ${showCourseCard ? buildProgressBlock(pct) : ''}
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
      el.classList.toggle('done', Boolean(progress[s.id]));
      el.classList.toggle('active', s.id === currentScreenId);
    });
  }

  window.MatrixSidebar = { render, renderCatalog, refreshProgress, setLastCourse, getLastCourse };
})();

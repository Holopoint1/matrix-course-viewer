(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const courseId = params.get('id');

  if (!courseId) {
    location.replace('index.html');
    return;
  }

  const els = {
    certificateCta: document.getElementById('certificate-cta'),
    certificateLink: document.getElementById('certificate-link'),
    screenTitle: document.getElementById('screen-title'),
    screenMeta: document.getElementById('screen-meta'),
    screenStage: document.getElementById('screen-stage'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    printBtn: document.getElementById('print-btn'),
    downloadBtn: document.getElementById('download-btn'),
    openGoogleBtn: document.getElementById('open-google-btn'),
    downloadWorksheetsBtn: document.getElementById('download-worksheets-btn'),
    downloadCourseBtn: document.getElementById('download-course-btn'),
    optionsBtn: document.getElementById('options-btn'),
    optionsDropdown: document.getElementById('options-dropdown'),
    completeBtn: document.getElementById('complete-btn')
  };

  let course = null;
  let currentIndex = 0;
  const docCache = new Map();
  let _docFit = null;   /* current docx scale-to-fit resize handler (replaced per render) */

  /* ---------- Time tracker ---------- */
  const timeTracker = (function () {
    const SAVE_INTERVAL_MS = 15000;
    /* Only count time when the learner is actually present. If there's been
       no mouse / key / scroll / touch for IDLE_LIMIT_MS we treat the segment
       as idle and stop accruing — fixes hours being logged because a tab was
       left open in a focused window. */
    const IDLE_LIMIT_MS = 90 * 1000;
    /* Hard cap on what a single flush can add. Protects against laptop sleep
       / clock jumps / debugger pauses dumping a huge delta in one go. */
    const MAX_SEGMENT_MS = SAVE_INTERVAL_MS * 2;
    const KEY_PREFIX = 'matrix-lms:time:';
    let trackingCourseId = null;
    let trackingScreenId = null;
    let segmentStartedAt = null;
    let intervalId = null;
    let lastActivityAt = Date.now();

    function markActivity() {
      const wasIdle = (Date.now() - lastActivityAt) > IDLE_LIMIT_MS;
      lastActivityAt = Date.now();
      /* Coming back from idle: restart the segment clock so the idle gap
         isn't billed retroactively. */
      if (wasIdle && trackingCourseId && document.visibilityState === 'visible') {
        segmentStartedAt = Date.now();
      }
    }
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach((ev) => {
      window.addEventListener(ev, markActivity, { passive: true });
    });

    function start(cId, sId) {
      stop();
      trackingCourseId = cId;
      trackingScreenId = sId;
      lastActivityAt = Date.now();
      if (document.visibilityState === 'visible') {
        segmentStartedAt = Date.now();
      }
      intervalId = setInterval(flush, SAVE_INTERVAL_MS);
    }
    function stop() {
      if (intervalId) clearInterval(intervalId);
      flush();
      trackingCourseId = trackingScreenId = segmentStartedAt = intervalId = null;
    }
    function flush() {
      if (!segmentStartedAt || !trackingCourseId || !trackingScreenId) return;
      const now = Date.now();
      /* Don't bill idle time. If the learner has been inactive past the
         limit, drop this segment and re-anchor so we resume cleanly when
         they come back. */
      if (now - lastActivityAt > IDLE_LIMIT_MS) {
        segmentStartedAt = now;
        return;
      }
      let elapsedMs = now - segmentStartedAt;
      if (elapsedMs > MAX_SEGMENT_MS) elapsedMs = MAX_SEGMENT_MS; /* clamp */
      const elapsedSec = Math.floor(elapsedMs / 1000);
      if (elapsedSec < 1) return;
      addSeconds(trackingCourseId, trackingScreenId, elapsedSec);
      segmentStartedAt = now;
    }
    function addSeconds(cId, sId, secs) {
      try {
        const key = KEY_PREFIX + cId;
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        data[sId] = (data[sId] || 0) + secs;
        localStorage.setItem(key, JSON.stringify(data));
      } catch (_) {}
    }
    document.addEventListener('visibilitychange', () => {
      if (!trackingCourseId) return;
      if (document.visibilityState === 'visible') {
        segmentStartedAt = Date.now();
        lastActivityAt = Date.now();
      } else {
        flush();
        segmentStartedAt = null;
      }
    });
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return { start, stop, flush };
  })();

  init();

  async function init() {
    try {
      const res = await fetch('data/courses.json?t=' + Date.now());
      const data = await res.json();
      /* Course content is Drive-only now. Ignore any stale admin/Supabase content
         edit saved locally in a browser — those overrode the real file and could
         show outdated text (e.g. an old worksheet). Always render the synced file. */
      if (window.MatrixCMS) window.MatrixCMS.getHtmlOverride = function () { return null; };
      /* Include courses that live only in Supabase (added via Admin). */
      const courseList = (window.MatrixCMS && window.MatrixCMS.mergeCourses)
        ? window.MatrixCMS.mergeCourses(data.courses) : data.courses;
      course = courseList.find((c) => c.id === courseId);
      if (!course) throw new Error('Course not found: ' + courseId);
      if (window.MatrixCMS) course = window.MatrixCMS.applyOverrides(course);
      if (window.Gamify) {
        await window.Gamify.init();
        window.Gamify.trackCourseVisit(courseId);
      }
    } catch (err) {
      els.screenStage.innerHTML = '<p class="stage-loading">Could not load course. ' + err.message + '</p>';
      return;
    }

    document.title = course.title + ' | Matrix Course Viewer';

    if (course.certificate && course.certificate.enabled) {
      els.certificateLink.href = 'certificate.html?id=' + encodeURIComponent(course.id);
      els.certificateCta.hidden = false;
    } else if (els.certificateCta) {
      els.certificateCta.remove();
    }

    renderSidebar();
    renderProgress();

    /* Deep-link via ?screen=<id> takes priority over the saved last-viewed index */
    const screenIdParam = params.get('screen');
    let startIndex;
    if (screenIdParam) {
      const idx = course.screens.findIndex((s) => s.id === screenIdParam);
      startIndex = idx >= 0 ? idx : restoreLastIndex();
    } else {
      startIndex = restoreLastIndex();
    }
    showScreen(startIndex);

    els.prevBtn.addEventListener('click', () => {
      if (currentIndex > 0) showScreen(currentIndex - 1);
    });
    if (els.nextBtn) {
      els.nextBtn.addEventListener('click', () => {
        if (currentIndex < course.screens.length - 1) showScreen(currentIndex + 1);
      });
    }
    if (els.nextBtnBottom) {
      els.nextBtnBottom.addEventListener('click', () => {
        if (currentIndex < course.screens.length - 1) {
          showScreen(currentIndex + 1);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }

    /* Header action bar — Print / Download (this file) / Download course (zip).
       These act on whatever the current screen is, so every screen type gets the
       same controls in one place (no more per-stage, type-specific buttons). */
    if (els.printBtn) {
      els.printBtn.addEventListener('click', () => printCurrentScreen());
    }
    if (els.downloadBtn) {
      els.downloadBtn.addEventListener('click', () => {
        const screen = course.screens[currentIndex];
        if (screen && screen.src && !/^https?:/i.test(screen.src)) {
          downloadScreenFile(screen);
        }
      });
    }
    if (els.downloadCourseBtn) {
      /* Hide the whole-course download when there's literally nothing local to zip
         (e.g. a course made entirely of YouTube/external links). */
      const anyLocal = course.screens.some((s) => s.src && !/^https?:/i.test(s.src) && !s.missing);
      if (!anyLocal) {
        els.downloadCourseBtn.hidden = true;
      } else {
        els.downloadCourseBtn.addEventListener('click', () => downloadCourseZip(course, els.downloadCourseBtn));
      }
    }
    if (els.downloadWorksheetsBtn) {
      /* Compile the course's documents (.docx + .htm text screens) into ONE .docx.
         Needs at least one Word file as the skeleton (a .docx screen, or a text
         screen that has a matching Word version) — hidden otherwise. */
      const hasSkeleton = course.screens.some((s) => !s.missing && !/^https?:/i.test(s.src || '') &&
        (effectiveType(s) === 'document' || (effectiveType(s) === 'html' && s.wordUrl)));
      if (!hasSkeleton) {
        els.downloadWorksheetsBtn.hidden = true;
      } else {
        els.downloadWorksheetsBtn.addEventListener('click', () => downloadAllWorksheets(course, els.downloadWorksheetsBtn));
      }
    }
    /* "Options" dropdown — collapses the secondary actions (open in viewer,
       download screen, print, download course) into one menu, leaving the bar
       to Options · Previous · Next · Mark complete. */
    if (els.optionsBtn && els.optionsDropdown) {
      const menu = els.optionsDropdown;
      const closeMenu = () => { menu.hidden = true; els.optionsBtn.setAttribute('aria-expanded', 'false'); };
      els.optionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu.hidden) { menu.hidden = false; els.optionsBtn.setAttribute('aria-expanded', 'true'); }
        else closeMenu();
      });
      menu.addEventListener('click', () => closeMenu());          // an item ran — tidy up
      document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.options-menu')) closeMenu(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    }
    /* Keyboard slide navigation: ← previous screen, → next screen.
       Ignored while typing in a field, with modifier keys, or when focus
       is inside an embed (the iframe captures the key itself anyway). */
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const ae = document.activeElement;
      const tag = (ae && ae.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (ae && ae.isContentEditable)) return;
      if (e.key === 'ArrowRight') {
        if (currentIndex < course.screens.length - 1) { showScreen(currentIndex + 1); e.preventDefault(); }
      } else if (e.key === 'ArrowLeft') {
        if (currentIndex > 0) { showScreen(currentIndex - 1); e.preventDefault(); }
      }
    });

    els.completeBtn.addEventListener('click', () => {
      const screen = course.screens[currentIndex];
      if (isComplete(screen.id)) {
        setComplete(screen.id, false);
        updateCompleteButton();
      } else {
        setComplete(screen.id, true);
        if (currentIndex < course.screens.length - 1) {
          showScreen(currentIndex + 1);
        } else {
          updateCompleteButton();
        }
      }
    });

    if (els.bundleBtn) {
      const docCount = course.screens.filter((s) => s.type === 'document' && !s.missing).length;
      if (docCount === 0) {
        els.bundleBtn.hidden = true;
      } else {
        els.bundleBtn.querySelector('span').textContent =
          'Download ' + docCount + ' worksheets PDF';
        els.bundleBtn.addEventListener('click', () => downloadBundle(course, els.bundleBtn));
      }
    }
  }

  async function downloadSingleAsPdf(screen, innerEl, btn) {
    if (!window.html2pdf) {
      alert('PDF library not yet loaded. Please wait a moment and try again.');
      return;
    }
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Building PDF…';
    const wrap = document.createElement('div');
    /* position:absolute (not fixed) so html2canvas can rasterise it;
       fixed-positioned elements get skipped and produce blank PDFs. */
    wrap.style.cssText = 'position:absolute;left:-10000px;top:0;width:794px;background:#fff;font-family:"Segoe UI", Calibri, Arial, sans-serif;color:#1a1a2e;font-size:11pt;line-height:1.55;padding:30px 40px;z-index:-1;';
    wrap.innerHTML =
      '<div style="font-size:0.78rem;letter-spacing:2px;color:#7c3aed;text-transform:uppercase;font-weight:700;">' +
      escapeHtml((course && course.code) || '') + '</div>' +
      '<h1 style="font-family:\'Segoe UI\',Inter,Arial,sans-serif;font-size:22pt;color:#1e1b4b;margin:6px 0 18px;font-weight:800;">' +
      escapeHtml(screen.title) + '</h1>' +
      innerEl.innerHTML;
    document.body.appendChild(wrap);
    try {
      await window.html2pdf()
        .set({
          margin: [10, 12, 14, 12],
          filename: filename(screen.src).replace(/\.docx?$/i, '') + '.pdf',
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 1.6, letterRendering: true, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4' }
        })
        .from(wrap)
        .save();
    } catch (err) {
      alert('PDF generation failed: ' + err.message);
    } finally {
      wrap.remove();
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  /* ---------- Combined-PDF bundle generator ---------- */
  async function downloadBundle(course, btn) {
    if (!window.html2pdf || !window.mammoth) {
      alert('PDF library not yet loaded. Please wait a moment and try again.');
      return;
    }
    const documents = course.screens.filter((s) => s.type === 'document' && !s.missing);
    if (!documents.length) return;

    const originalLabel = btn.querySelector('span').textContent;
    btn.disabled = true;

    /* Browser print-to-PDF approach. Every previous html2canvas/html2pdf
       attempt produced blank PDFs because the offscreen sandbox couldn't
       be rasterised correctly. Browsers print fully-styled HTML to PDF
       natively — far more reliable than canvas, and the output is
       selectable text rather than baked-in images.

       Flow:
         1. Pre-fetch every worksheet docx, run mammoth + the worksheet
            enhancer to get rich HTML for each.
         2. Compose a single print-styled HTML document with one
            worksheet per page-break.
         3. Drop that document into a hidden iframe, call .print() on
            the iframe's window. Browser opens its Save-as-PDF dialog. */

    /* Pre-fetch + render every worksheet */
    const sheets = [];
    for (let i = 0; i < documents.length; i++) {
      const screen = documents[i];
      btn.querySelector('span').textContent = 'Preparing (' + (i + 1) + ' of ' + documents.length + ')…';
      try {
        let html = docCache.get(vsrc(screen));
        if (!html) {
          const res = await fetch(vsrc(screen));
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const buf = await res.arrayBuffer();
          const result = await window.mammoth.convertToHtml({ arrayBuffer: buf }, MAMMOTH_OPTS);
          html = enhanceWorksheetHtml(result.value || '');
          docCache.set(vsrc(screen), html);
        }
        sheets.push({ index: i + 1, screen, html });
      } catch (err) {
        sheets.push({
          index: i + 1, screen,
          html: '<p style="color:#b45309;">Could not load worksheet: ' + escapeHtml(err.message) + '</p>'
        });
      }
    }

    /* Build the print document */
    btn.querySelector('span').textContent = 'Opening print dialog…';
    const printCss =
      '@page { size: A4; margin: 12mm 14mm 16mm 14mm; }' +
      '* { box-sizing: border-box; }' +
      'body { font-family: "Segoe UI", Calibri, Arial, sans-serif; color: #1a1a2e; font-size: 11pt; line-height: 1.55; margin: 0; }' +
      'h1, h2, h3 { font-family: "Segoe UI", Calibri, Arial, sans-serif; color: #1e1b4b; page-break-after: avoid; }' +
      '.cover { text-align: center; padding: 100px 30px 40px; page-break-after: always; }' +
      '.cover .code { font-size: 11pt; letter-spacing: 3px; color: #7c3aed; font-weight: 700; }' +
      '.cover h1 { font-size: 34pt; margin: 8px 0 18px; font-weight: 800; }' +
      '.cover p { color: #5d5b78; font-size: 13pt; margin: 0 auto; max-width: 520px; }' +
      '.cover .meta { margin-top: 80px; font-size: 10pt; color: #8a87a6; }' +
      '.sheet { page-break-before: always; padding: 0; }' +
      '.sheet .eyebrow { font-size: 9pt; letter-spacing: 2px; color: #7c3aed; text-transform: uppercase; font-weight: 700; }' +
      '.sheet h1 { font-size: 20pt; margin: 6px 0 14px; }' +
      'table { border-collapse: collapse; width: 100%; margin: 8px 0; }' +
      'td, th { border: 1px solid #333; padding: 4px 6px; vertical-align: top; }' +
      'img { max-width: 100%; height: auto; }' +
      'ul, ol { margin: 6px 0 6px 22px; }' +
      '.doc-section, .doc-h1 { color: #1e1b4b; }' +
      '.inline-youtube, .worksheet-header { display: none; }' +
      '.hints-details { page-break-inside: avoid; }' +
      '.hints-summary { font-weight: 700; color: #a16207; list-style: none; }' +
      '.hints-summary::before { content: "Hints: "; }';

    const cover =
      '<div class="cover">' +
      '<div class="code">' + escapeHtml(course.code) + '</div>' +
      '<h1>' + escapeHtml(course.title) + '</h1>' +
      '<p>' + escapeHtml(course.shortDescription || '') + '</p>' +
      '<div class="meta">' + documents.length + ' worksheets &middot; generated ' +
      new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) +
      '</div></div>';
    const sheetsHtml = sheets.map(function (s) {
      return '<section class="sheet">' +
        '<div class="eyebrow">' + escapeHtml(course.code) + ' &middot; Worksheet ' + s.index + '</div>' +
        '<h1>' + escapeHtml(s.screen.title) + '</h1>' +
        s.html +
        '</section>';
    }).join('');

    const docHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' +
      escapeHtml(course.code) + ' worksheets</title><style>' + printCss + '</style></head><body>' +
      cover + sheetsHtml + '</body></html>';

    /* Hidden iframe for the print dialog. iframe-scoped print doesn't
       affect the parent page styling. */
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);

    const finish = function () {
      setTimeout(function () {
        try { iframe.remove(); } catch (_) {}
        btn.disabled = false;
        btn.querySelector('span').textContent = originalLabel;
      }, 500);
    };

    iframe.onload = function () {
      try {
        const win = iframe.contentWindow;
        win.focus();
        win.print();
      } catch (err) {
        console.error('Print bundle failed:', err);
        alert('Could not open print dialog: ' + err.message);
      } finally {
        finish();
      }
    };
    iframe.srcdoc = docHtml;
  }

  function renderSidebar() {
    /* Delegate to chrome.js's MatrixChrome — it owns the sidebar DOM and
       renders identically on every page. */
    if (!window.MatrixChrome) return;
    const currentScreen = course.screens[currentIndex];
    window.MatrixChrome.setCourse(course, currentScreen ? currentScreen.id : null);
  }

  function showScreen(idx) {
    currentIndex = idx;
    persistLastIndex(idx);
    const screen = course.screens[idx];

    if (window.MatrixChrome) {
      window.MatrixChrome.refreshProgress(screen.id);
      const activeRow = document.querySelector('#sidebar .ms-ws-item.active');
      if (activeRow && activeRow.scrollIntoView) {
        activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    els.screenTitle.textContent = screen.title;
    els.screenMeta.innerHTML = formatMeta(screen);
    updateScreenActions(screen);
    els.prevBtn.disabled = idx === 0;
    const isLast = idx === course.screens.length - 1;
    if (els.nextBtn) els.nextBtn.disabled = isLast;
    if (els.nextBtnBottom) {
      els.nextBtnBottom.disabled = isLast;
      els.nextBtnBottom.hidden = isLast;
      /* Surface the upcoming screen's title to make navigation explicit. */
      if (!isLast) {
        const peek = course.screens[idx + 1];
        els.nextBtnBottom.innerHTML = 'Next: ' + escapeHtml(peek.title) + ' &rarr;';
      }
    }
    updateCompleteButton();

    timeTracker.start(courseId, screen.id);
    renderStage(screen);
  }

  function updateCompleteButton() {
    const screen = course.screens[currentIndex];
    const last = currentIndex === course.screens.length - 1;
    const done = isComplete(screen.id);
    if (done) {
      els.completeBtn.textContent = 'Mark incomplete';
      els.completeBtn.classList.remove('btn-primary');
      els.completeBtn.classList.add('btn-secondary');
    } else {
      els.completeBtn.textContent = last ? 'Mark complete' : 'Mark complete & next';
      els.completeBtn.classList.remove('btn-secondary');
      els.completeBtn.classList.add('btn-primary');
    }
  }

  /* Render by the ACTUAL file, not just the declared screen type — so a screen
     mistakenly typed "HTML" but pointing at a .docx still renders as a document
     (via mammoth) instead of dumping raw file bytes. URLs keep their declared
     type (a YouTube/PDF link has no useful extension). */
  function effectiveType(screen) {
    const src = screen.src || '';
    if (/^https?:/i.test(src)) return screen.type;
    const ext = (src.split('.').pop() || '').toLowerCase();
    const byExt = {
      docx: 'document', doc: 'document', odt: 'document', rtf: 'document',
      pptx: 'powerpoint', ppt: 'powerpoint',
      xlsx: 'spreadsheet', xls: 'spreadsheet', csv: 'spreadsheet',
      pdf: 'pdf',
      png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', bmp: 'image',
      htm: 'html', html: 'html',
    };
    return byExt[ext] || screen.type;
  }
  function renderStage(screen) {
    const stage = els.screenStage;
    stage.innerHTML = '';

    if (screen.missing) {
      const fname = filename(screen.src) || 'this file';
      stage.innerHTML = `
        <div class="stage-missing">
          <span class="badge">Resource missing</span>
          <h2>${escapeHtml(screen.title)}</h2>
          <p>This screen is defined in the course outline, but the source file <code>${escapeHtml(fname)}</code> hasn't been added to the media zip yet.</p>
          <p><strong>Please send <code>${escapeHtml(fname)}</code></strong> and it'll appear here automatically.</p>
        </div>`;
      return;
    }

    switch (effectiveType(screen)) {
      case 'image':
        renderImage(stage, screen);
        return;
      case 'youtube':
        renderYoutube(stage, screen);
        return;
      case 'pdf':
        renderPdf(stage, screen);
        return;
      case 'html':
        renderHtmlContent(stage, screen);
        return;
      case 'document':
        /* Word docs render with Microsoft's Office viewer (same engine as the
           Excel/PowerPoint screens) so fonts, spacing and gaps match Word
           exactly — closer than the in-browser docx-preview approximation. */
        renderOffice(stage, screen);
        return;
      case 'powerpoint':
      case 'spreadsheet':
        renderOffice(stage, screen);
        return;
      default:
        stage.innerHTML = `<p class="stage-loading">Unsupported screen type: ${escapeHtml(screen.type)}</p>`;
    }
  }

  /* Append the per-file content version the sync stamped on each screen, so a
     same-name Drive edit produces a NEW url and is never served from a stale
     browser / CDN / Office-viewer cache. URLs and version-less screens pass through. */
  function vsrc(screen) {
    const s = (screen && screen.src) || '';
    if (/^https?:/i.test(s)) return s;
    return (screen && screen.v) ? s + (s.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(screen.v) : s;
  }

  function renderImage(stage, screen) {
    const wrap = document.createElement('div');
    wrap.className = 'stage-image';
    const img = document.createElement('img');
    /* An admin-uploaded replacement image is stored as a data: URI
       override keyed by screen.src — prefer it over the source file. */
    const ov = window.MatrixCMS ? window.MatrixCMS.getHtmlOverride(screen.src) : null;
    img.src = (ov && /^data:image\//i.test(ov)) ? ov : screen.src;
    img.alt = screen.title;
    wrap.appendChild(img);
    stage.appendChild(wrap);
  }

  function renderYoutube(stage, screen) {
    const id = extractYoutubeId(screen.src);
    if (!id) {
      stage.innerHTML = `<p class="stage-loading">Could not parse YouTube URL: ${escapeHtml(screen.src)}</p>`;
      return;
    }
    /* Wrap the iframe in a responsive 16:9 container with a comfortable
       max-width so the video sits centred on the stage instead of getting
       stretched edge-to-edge OR being letterboxed in the middle. Action
       row at the bottom: 'Open on YouTube' (full external) + 'Fullscreen'. */
    const wrap = document.createElement('div');
    wrap.className = 'stage-youtube';
    wrap.innerHTML = `
      <div class="stage-youtube-frame">
        <iframe
          src="https://www.youtube.com/embed/${id}?rel=0&modestbranding=1"
          title="${escapeAttr(screen.title)}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"></iframe>
      </div>
      <div class="stage-youtube-actions">
        <button type="button" class="btn btn-secondary" data-action="fullscreen">⛶ Fullscreen</button>
      </div>
    `;
    stage.appendChild(wrap);
    const fsBtn = wrap.querySelector('[data-action="fullscreen"]');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        const frame = wrap.querySelector('.stage-youtube-frame');
        if (frame && frame.requestFullscreen) frame.requestFullscreen();
      });
    }
  }

  function renderIframe(stage, src) {
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.referrerPolicy = 'no-referrer';
    stage.appendChild(iframe);
  }

  function renderPdf(stage, screen) {
    const wrap = document.createElement('div');
    wrap.className = 'stage-pdf';
    const safeSrc = escapeAttr(vsrc(screen));
    const fname = filename(screen.src) || 'document.pdf';
    wrap.innerHTML = `
      <div class="stage-pdf-toolbar">
        <span class="stage-pdf-name" title="${safeSrc}">${escapeHtml(fname)}</span>
        <div class="stage-pdf-actions">
          <button type="button" class="btn btn-secondary" data-action="fullscreen">⛶ Fullscreen</button>
          <a class="btn btn-secondary" href="${safeSrc}" target="_blank" rel="noopener">↗ Open in new tab</a>
        </div>
      </div>
      <div class="stage-pdf-frame">
        <iframe class="stage-pdf-iframe" src="${safeSrc}#view=FitH" referrerpolicy="no-referrer" title="${escapeAttr(screen.title)}"></iframe>
        <object class="stage-pdf-object" type="application/pdf" data-src="${safeSrc}" hidden>
          <embed type="application/pdf" />
        </object>
        <div class="stage-pdf-fallback" hidden>
          <div class="stage-pdf-fallback-icon">📄</div>
          <h2>PDF couldn't be displayed inline</h2>
          <p>Some browsers block embedded PDFs, or the file isn't reachable from this page. Try one of these:</p>
          <div class="stage-pdf-fallback-actions">
            <a class="btn btn-primary" href="${safeSrc}" target="_blank" rel="noopener">Open in new tab</a>
            <a class="btn btn-secondary" href="${safeSrc}" download>Download</a>
          </div>
          <p class="stage-pdf-fallback-src"><code>${escapeHtml(screen.src)}</code></p>
        </div>
      </div>
    `;
    stage.appendChild(wrap);

    const iframe = wrap.querySelector('.stage-pdf-iframe');
    const obj = wrap.querySelector('.stage-pdf-object');
    const fallback = wrap.querySelector('.stage-pdf-fallback');
    let resolved = false;

    function showFallback() {
      if (resolved) return;
      resolved = true;
      iframe.style.display = 'none';
      obj.hidden = true;
      fallback.hidden = false;
    }
    function tryObject() {
      iframe.style.display = 'none';
      /* Lazy: only fetch the PDF a second way (object/embed) if the iframe
         actually failed. Loading it upfront made the browser pull the same
         (often large) PDF 2-3x at once — the main cause of the lag. */
      if (!obj.getAttribute('data')) {
        var src = obj.getAttribute('data-src');
        obj.setAttribute('data', src);
        var emb = obj.querySelector('embed');
        if (emb) emb.setAttribute('src', src);
      }
      obj.hidden = false;
      /* If <object> also fails, the fallback above shows after the second timer */
    }

    /* If the URL is unreachable (404, DNS, CORS-network-error) we get an error event. */
    iframe.addEventListener('error', tryObject);

    /* Iframes fire `load` even for blocked content, so we additionally check
       whether anything actually rendered. After a short timeout, if the iframe's
       contentDocument is empty / null (cross-origin throws — that's fine, content
       is loading), or its body height is suspiciously zero, we surface the fallback. */
    iframe.addEventListener('load', () => {
      resolved = true; /* iframe at least settled */
      try {
        const cw = iframe.contentWindow;
        const cd = cw && cw.document;
        if (cd && cd.body) {
          const empty = !cd.body.innerHTML.trim() && cd.body.scrollHeight < 50;
          if (empty) tryObject();
        }
      } catch (_) {
        /* Cross-origin — can't introspect. The iframe is showing whatever the
           browser PDF viewer rendered. The toolbar above already gives the user
           a working escape hatch, so this is fine. */
      }
    });

    /* Final safety net: if neither load nor error has fired in 8s, the request
       is dead in the water — show the fallback. */
    setTimeout(() => {
      if (!resolved) showFallback();
    }, 8000);

    /* If <object> swap-in also doesn't render anything, escalate to fallback. */
    obj.addEventListener('error', showFallback);

    /* Fullscreen via a CSS overlay rather than the native Fullscreen API.
       The native API is silently blocked here because the PDF renders in
       a cross-origin <iframe> (matrixtsl.com) — requestFullscreen on the
       container resolves but the embedded viewer doesn't expand, so it
       "does nothing". A position:fixed overlay always works, can't be
       blocked, and we control the exit affordance. */
    const fsBtn = wrap.querySelector('[data-action="fullscreen"]');
    const frame = wrap.querySelector('.stage-pdf-frame');
    if (fsBtn && frame) {
      let exitBtn = null;
      const enter = () => {
        wrap.classList.add('pdf-overlay');
        document.body.classList.add('pdf-overlay-open');
        fsBtn.textContent = '⛶ Exit fullscreen';
        if (!exitBtn) {
          exitBtn = document.createElement('button');
          exitBtn.type = 'button';
          exitBtn.className = 'stage-pdf-exit';
          exitBtn.innerHTML = '✕ Exit fullscreen';
          exitBtn.addEventListener('click', exit);
          wrap.appendChild(exitBtn);
        }
        exitBtn.hidden = false;
        document.addEventListener('keydown', onEsc);
      };
      const exit = () => {
        wrap.classList.remove('pdf-overlay');
        document.body.classList.remove('pdf-overlay-open');
        fsBtn.textContent = '⛶ Fullscreen';
        if (exitBtn) exitBtn.hidden = true;
        document.removeEventListener('keydown', onEsc);
      };
      const onEsc = (e) => { if (e.key === 'Escape') exit(); };
      fsBtn.addEventListener('click', () => {
        if (wrap.classList.contains('pdf-overlay')) exit(); else enter();
      });
    }
  }

  async function renderHtmlContent(stage, screen) {
    if (screen.external || /^https?:/i.test(screen.src || '')) {
      return renderIframe(stage, screen.src);
    }
    const wrap = document.createElement('div');
    wrap.className = 'stage-doc';
    /* No per-stage toolbar — Print/Download now live in the header action bar,
       consistent across every screen type. */
    wrap.innerHTML = `<div class="stage-doc-inner"><p class="stage-loading">Loading&hellip;</p></div>`;
    stage.appendChild(wrap);
    const inner = wrap.querySelector('.stage-doc-inner');
    try {
      let text;
      const cmsOverride = window.MatrixCMS ? window.MatrixCMS.getHtmlOverride(screen.src) : null;
      if (cmsOverride != null) {
        text = cmsOverride;
      } else {
        const res = await fetch(vsrc(screen));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        text = await res.text();
      }
      if (looksBinary(text)) {
        inner.innerHTML = '<p class="stage-warn-inline" style="color:var(--warn,#b45309);font-weight:600">⚠ This screen is set to <strong>' + escapeHtml(screen.type) + '</strong>, but <code>' + escapeHtml(filename(screen.src)) + '</code> isn\'t a web page — it looks like an Office or binary file. Set the screen type to match the file (e.g. <strong>Document</strong>), or use a real <code>.html</code> file.</p>';
        return;
      }
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const pageEl = doc.querySelector('.page');
      /* Show the authored HTML verbatim — NO enhanceWorksheetHtml() — so
         tables, headings and layout appear exactly as written, no restructuring. */
      const bodyHtml = pageEl ? pageEl.innerHTML : (doc.body ? doc.body.innerHTML : text);
      inner.innerHTML = bodyHtml;
    } catch (err) {
      /* A fetch failure (404 / removed-or-renamed file / network) → a clear
         warning, never a broken frame. A parse hiccup on a real HTML file →
         fall back to iframing it as-is. */
      if (/^HTTP|Failed to fetch|NetworkError|Load failed/i.test(err.message || '')) {
        inner.innerHTML = '<p class="stage-warn-inline" style="color:var(--warn,#b45309);font-weight:600">⚠ Couldn\'t load <code>' + escapeHtml(filename(screen.src)) + '</code> (' + escapeHtml(err.message) + '). The file may have been removed or renamed in Drive.</p>';
      } else {
        wrap.remove();
        renderIframe(stage, screen.src);
      }
    }
  }

  /* The source .docx files apply emphasis/headings through CUSTOM Word
     styles, not the bold button — so mammoth's default map dropped them
     and bold/titles never reached the page. Map the known custom styles
     to semantic HTML (default map still applies on top for real bold/
     italic/lists). Keeps text verbatim — only the wrapping tag changes. */
  const MAMMOTH_OPTS = {
    styleMap: [
      "p[style-name='Ws name'] => h2.ws-name:fresh",
      "p[style-name='Ws number'] => p.ws-number:fresh",
      "p[style-name='Pack title - top right'] => p.pack-title:fresh",
      "p[style-name='YouTube link URL'] => p.yt-url:fresh",
      "p[style-name='Contents'] => p.doc-contents:fresh",
      "p[style-name='Bullet'] => ul > li:fresh",
      "p[style-name='AI instructions'] => p.ai-instr:fresh",
      "r[style-name='Numbered bullet Char'] => strong",
      "r[style-name='Strong'] => strong",
      "r[style-name='Emphasis'] => em"
    ]
  };

  /* Promote pseudo-heading paragraphs ("Design brief:", "Hardware:", etc.) into real headings.
     Source text is preserved verbatim — only the tag changes. */
  function enhanceWorksheetHtml(html) {
    let parsed;
    try {
      parsed = new DOMParser().parseFromString('<!DOCTYPE html><html><body>' + html + '</body></html>', 'text/html');
    } catch (_) {
      return html;
    }
    const root = parsed.body;
    if (!root) return html;

    /* 1. Convert layout-only header tables (the "Worksheet 7 / Title / Course" strip) into a
          subdued metadata header. mammoth-rendered docs always have a small sparse table at the top. */
    Array.from(root.querySelectorAll('table')).forEach((table) => {
      const cells = Array.from(table.querySelectorAll('td, th'));
      const filled = cells
        .map((c) => (c.textContent || '').trim())
        .filter((t) => t && t.length > 0);
      const allShort = filled.every((t) => t.length < 120);
      const hasParagraphTexts = filled.some((t) => t.length >= 120);
      /* If the table is small and contains short labels (worksheet header) — convert.
         If it's a large table with long descriptive paragraphs — leave it alone. */
      if (cells.length <= 16 && filled.length <= 8 && allShort && !hasParagraphTexts) {
        const meta = parsed.createElement('div');
        meta.className = 'worksheet-header';
        meta.innerHTML = filled.map((t) => `<span>${escapeHtml(t)}</span>`).join('');
        table.replaceWith(meta);
      } else if (cells.length <= 6 && filled.length <= 4 && allShort) {
        /* Short overview table → header */
        const meta = parsed.createElement('div');
        meta.className = 'worksheet-header';
        meta.innerHTML = filled.map((t) => `<span>${escapeHtml(t)}</span>`).join('');
        table.replaceWith(meta);
      }
    });

    /* 2. Embed bare YouTube URLs as inline iframes */
    Array.from(root.querySelectorAll('a')).forEach((a) => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
      if (!m) return;
      const aText = (a.textContent || '').trim();
      if (aText !== href.trim() && !/youtu/.test(aText)) return; /* leave styled inline links */
      const wrap = parsed.createElement('div');
      wrap.className = 'inline-youtube';
      wrap.innerHTML = '<iframe src="https://www.youtube.com/embed/' + m[1] + '" allowfullscreen loading="lazy"></iframe>';
      const parent = a.parentElement;
      if (parent && parent.tagName === 'P' && (parent.textContent || '').trim() === aText) {
        parent.replaceWith(wrap);
      } else {
        a.replaceWith(wrap);
      }
    });

    /* 3. "There is no video..." → small subdued note */
    Array.from(root.querySelectorAll('p')).forEach((p) => {
      const t = (p.textContent || '').trim().toLowerCase();
      if (/^there\s+is\s+no\s+video/i.test(t)) {
        p.classList.add('no-video');
      }
    });

    /* 4. Title + section headings only (conservative — per the "Title +
       headings only" decision). TEXT IS VERBATIM; only the tag changes:
       the first line becomes the page title, and paragraphs that are an
       obvious section label ("Design brief:", "Hardware:", "Software", …)
       become headings with the matching icon. NO list grouping or
       hint-collapsing — sub-lines stay as authored. */
    const SECTION_MAP = [
      [/^design\s*brief$/i,                'design-brief'],
      [/^hardware$/i,                      'hardware'],
      [/^software$/i,                      'software'],
      [/^challenges?$/i,                   'challenges'],
      [/^hints?$/i,                        'hints'],
      [/^over\s*to\s*you$/i,               'over-to-you'],
      [/^(risk(\s*assessment)?|safety)$/i, 'risk']
    ];
    let titleDone = false;
    Array.from(root.children).forEach((el) => {
      if (el.tagName !== 'P') return;
      const text = (el.textContent || '').trim();
      if (!text) return;

      /* First non-empty paragraph → page title (verbatim). */
      if (!titleDone) {
        titleDone = true;
        if (text.length <= 90) {
          const h1 = parsed.createElement('h1');
          h1.className = 'doc-h1';
          h1.textContent = text;
          el.replaceWith(h1);
          return;
        }
      }

      /* Obvious section label → heading. A trailing colon is ignored for
         matching only; the displayed text stays exactly as authored. */
      const label = text.replace(/\s*:\s*$/, '');
      if (label.length > 42 || /[.!?]/.test(label)) return; /* a sentence, not a label */
      let cls = '';
      for (let i = 0; i < SECTION_MAP.length; i++) {
        if (SECTION_MAP[i][0].test(label)) { cls = SECTION_MAP[i][1]; break; }
      }
      const isGeneric = !cls && /:\s*$/.test(text) && label.split(/\s+/).length <= 4;
      if (cls || isGeneric) {
        const h2 = parsed.createElement('h2');
        h2.className = 'doc-section' + (cls ? ' ' + cls : '');
        h2.textContent = text;
        el.replaceWith(h2);
      }
    });

    return root.innerHTML;
  }

  /* PowerPoint / Spreadsheet — rendered inline via Microsoft's free Office
     Online embed viewer (real slides + navigation, no SDK, no conversion).
     It needs the file at a public HTTPS URL, so on localhost / file://
     (Office's servers can't reach a local preview) we fall back to a
     download card that explains it works on the published site. */
  function renderOffice(stage, screen) {
    const _et = effectiveType(screen);
    const label = _et === 'document' ? 'Word document' : _et === 'powerpoint' ? 'PowerPoint' : 'Spreadsheet';
    const safeSrc = escapeAttr(vsrc(screen));
    const fname = filename(screen.src) || screen.src;
    let absUrl = '';
    try { absUrl = new URL(vsrc(screen), location.href).href; } catch (_) {}
    const host = location.hostname;
    const isLocal = location.protocol === 'file:' ||
      /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/i.test(host) ||
      /\.local$/i.test(host) || host === '';

    const wrap = document.createElement('div');
    wrap.className = 'stage-pdf';

    if (isLocal || !absUrl) {
      wrap.innerHTML = `
        <div class="stage-pdf-toolbar">
          <span class="stage-pdf-name" title="${safeSrc}">${escapeHtml(fname)}</span>
          <div class="stage-pdf-actions">
            <a class="btn btn-secondary" href="${safeSrc}" target="_blank" rel="noopener">↗ Open</a>
          </div>
        </div>
        <div class="stage-pdf-frame">
          <div class="stage-pdf-fallback">
            <div class="stage-pdf-fallback-icon">📑</div>
            <h2>${escapeHtml(screen.title)}</h2>
            <p>The inline ${label} viewer uses Microsoft's Office viewer, which can't reach a local preview. On the published site this renders inline. For now, open or download it:</p>
            <div class="stage-pdf-fallback-actions">
              <a class="btn btn-primary" href="${safeSrc}" target="_blank" rel="noopener">Open ${label}</a>
              <a class="btn btn-secondary" href="${safeSrc}" download>Download</a>
            </div>
            <p class="stage-pdf-fallback-src"><code>${escapeHtml(screen.src)}</code></p>
          </div>
        </div>`;
      stage.appendChild(wrap);
      return;
    }

    const viewer = 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(absUrl);
    wrap.innerHTML = `
      <div class="stage-pdf-toolbar">
        <span class="stage-pdf-name" title="${safeSrc}">${escapeHtml(fname)}</span>
        <div class="stage-pdf-actions">
          <button type="button" class="btn btn-secondary" data-action="fullscreen">⛶ Fullscreen</button>
          <a class="btn btn-secondary" href="${escapeAttr(viewer)}" target="_blank" rel="noopener">↗ Open viewer</a>
        </div>
      </div>
      <div class="stage-pdf-frame">
        <iframe class="stage-pdf-iframe" src="${escapeAttr(viewer)}" title="${escapeAttr(screen.title)}" allowfullscreen></iframe>
      </div>`;
    stage.appendChild(wrap);

    const frame = wrap.querySelector('.stage-pdf-frame');
    const iframeEl = wrap.querySelector('.stage-pdf-iframe');
    const fsBtn = wrap.querySelector('[data-action="fullscreen"]');
    if (fsBtn && frame) {
      /* Element-fullscreen of a cross-origin (Office) iframe is unreliable on
         mobile — iOS Safari has no element fullscreen, and Android often renders
         the viewer blank in fullscreen (the "white screen" bug). So on touch /
         unsupported devices, open the Office viewer full-page in a new tab. */
      const noElementFs = !document.fullscreenEnabled ||
        window.matchMedia('(max-width: 900px)').matches || ('ontouchstart' in window);
      fsBtn.addEventListener('click', () => {
        if (noElementFs) { window.open(viewer, '_blank', 'noopener'); return; }
        if (document.fullscreenElement) { document.exitFullscreen(); return; }
        const target = iframeEl || frame;
        try {
          const p = target.requestFullscreen && target.requestFullscreen();
          if (p && p.catch) p.catch(() => window.open(viewer, '_blank', 'noopener'));
        } catch (_) { window.open(viewer, '_blank', 'noopener'); }
      });
    }
  }

  /* ---------------------------------------------------------------------------
     Word-image failsafes.
     A .docx can reference pictures the website can't show:
       • "Link to File" images point at file:///C:\… on the author's PC
       • some blips reference media that was never embedded (0 files in word/media)
     docx-preview still emits an <img> for each — which the browser can't load,
     leaving an ugly empty box. These helpers (1) try to RECOVER the real picture
     from a file shipped alongside the doc in the course folder (re-embedding it so
     it renders in the right place), and (2) replace anything still unavailable
     with a clean placeholder so the page never shows a broken box.
  --------------------------------------------------------------------------- */
  function normalizeZipPath(p) {
    const out = [];
    String(p).split('/').forEach((s) => {
      if (s === '..') out.pop();
      else if (s && s !== '.') out.push(s);
    });
    return out.join('/');
  }
  function sanitizeMedia(name) {
    return String(name).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+/, '') || 'image';
  }
  /* Look for an image file shipped next to the document (or in a media/ subfolder).
     Fires all candidate URLs at once and resolves with the first that exists, so
     adding the picture to the course's Drive folder makes it appear automatically. */
  function probeSibling(dir, base) {
    return new Promise((resolve) => {
      if (!dir || !base) return resolve(null);
      const names = Array.from(new Set([base, base.toLowerCase()]));
      const folders = [dir, dir + '/media', dir + '/Media'];
      const urls = [];
      folders.forEach((f) => names.forEach((n) => urls.push(f + '/' + encodeURIComponent(n))));
      let pending = urls.length;
      let done = false;
      if (!pending) return resolve(null);
      const finish = () => { if (!done && --pending <= 0) { done = true; resolve(null); } };
      urls.forEach((url) => {
        fetch(url, { cache: 'no-store' }).then((r) => {
          if (done) return;
          if (!r.ok) return finish();
          r.arrayBuffer().then((b) => {
            if (done) return;
            if (b && b.byteLength > 0) { done = true; resolve({ bytes: b, url: url }); }
            else finish();
          }).catch(finish);
        }).catch(finish);
      });
    });
  }
  /* Open the .docx, recover any linked/missing images we can find in the course
     folder (embedding them so docx-preview renders them in place), and report the
     ones we couldn't. Returns the (possibly rewritten) buffer. Never throws fatally
     — the caller renders the original bytes if anything here fails. */
  async function prepareDocImages(buf, screen) {
    if (!window.JSZip) return { buf: buf, unresolved: [] };
    const zip = await window.JSZip.loadAsync(buf);
    const relsFiles = Object.keys(zip.files).filter((p) => /^word\/_rels\/.+\.rels$/i.test(p));
    if (!relsFiles.length) return { buf: buf, unresolved: [] };
    const dir = (screen.src || '').replace(/\/[^/]*$/, '');
    let changed = false;
    let recIdx = 0;
    const unresolved = [];
    for (const rp of relsFiles) {
      const xml = await zip.file(rp).async('string');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const baseFolder = rp.replace(/_rels\/[^/]+\.rels$/i, '');   // e.g. "word/"
      let relsChanged = false;
      for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
        if (!/\/image$/i.test(rel.getAttribute('Type') || '')) continue;
        const target = rel.getAttribute('Target') || '';
        const mode = (rel.getAttribute('TargetMode') || '').toLowerCase();
        const external = mode === 'external' || /^(file:|https?:|[a-z]:[\\/]|\\\\)/i.test(target);
        /* Embedded and present in the zip → renders fine, leave it. */
        if (!external && zip.file(normalizeZipPath(baseFolder + target))) continue;
        const base = decodeURIComponent((target.split(/[\\/?#]/).pop() || '').split('?')[0]).trim();
        const isImg = /\.(png|jpe?g|gif|bmp|webp|tiff?|svg)$/i.test(base);
        if (external && isImg && base) {
          const found = await probeSibling(dir, base);
          if (found) {
            const mediaName = 'media/_rec' + (recIdx++) + '_' + sanitizeMedia(base);
            zip.file(baseFolder + mediaName, found.bytes);
            rel.setAttribute('Target', mediaName);
            rel.removeAttribute('TargetMode');
            relsChanged = true;
            changed = true;
            continue;
          }
          unresolved.push(base);
        }
      }
      if (relsChanged) zip.file(rp, new XMLSerializer().serializeToString(doc));
    }
    const outBuf = changed ? await zip.generateAsync({ type: 'arraybuffer' }) : buf;
    return { buf: outBuf, unresolved: Array.from(new Set(unresolved)) };
  }
  /* Replace any <img> the browser couldn't load with a tidy placeholder box,
     preserving the slot size so surrounding text keeps the document's layout. */
  function installImagePlaceholders(host, refit) {
    const imgs = Array.from(host.querySelectorAll('img'));
    const isBroken = (img) => img.complete && img.naturalWidth === 0 && img.naturalHeight === 0;
    const place = (img) => {
      if (!img || img.dataset.phDone) return;
      img.dataset.phDone = '1';
      const ph = document.createElement('span');
      ph.className = 'docx-img-missing';
      const w = img.style.width || (img.getAttribute('width') ? img.getAttribute('width') + 'px' : '');
      const h = img.style.height || (img.getAttribute('height') ? img.getAttribute('height') + 'px' : '');
      if (w) ph.style.width = w;
      if (h) ph.style.minHeight = h;
      ph.title = 'This image isn’t embedded in the document';
      ph.innerHTML = '<span class="docx-img-missing-glyph" aria-hidden="true">🖼</span>' +
                     '<span class="docx-img-missing-text">image unavailable</span>';
      if (img.parentNode) img.replaceWith(ph);
    };
    let any = false;
    imgs.forEach((img) => {
      if (isBroken(img)) { place(img); any = true; }
      else img.addEventListener('error', () => { place(img); if (refit) refit(); }, { once: true });
    });
    if (any && refit) refit();
    /* Late sweep — catch images that only finish (and fail) after first paint. */
    setTimeout(() => {
      let late = false;
      imgs.forEach((img) => { if (img.isConnected && isBroken(img)) { place(img); late = true; } });
      if (late && refit) refit();
    }, 800);
  }

  /* SUPERSEDED (kept for reference / quick revert): documents now render via the
     Microsoft Office viewer (see renderOffice + the 'document' case) for exact
     Word fidelity. This in-browser docx-preview renderer only approximated fonts
     and spacing, so it's no longer wired into renderStage.
     Render a .docx VERBATIM with docx-preview — it uses the document's own
     embedded styles (tables with borders/shading/column widths, fonts,
     spacing, numbering, headers/footers). No mammoth, no styleMap, no
     enhanceWorksheetHtml — i.e. no restructuring of the source. */
  async function renderDocument(stage, screen) {
    const wrap = document.createElement('div');
    wrap.className = 'stage-doc';
    /* No per-stage toolbar — Print/Download now live in the header action bar,
       consistent across every screen type. */
    wrap.innerHTML = `<div class="stage-doc-inner"><p class="stage-loading">Rendering document&hellip;</p></div>`;
    stage.appendChild(wrap);
    const inner = wrap.querySelector('.stage-doc-inner');

    try {
      /* Admin CMS edit wins over the source .docx — shown verbatim (no
         enhancer), same override key the HTML-screen renderer uses. */
      const cmsOverride = window.MatrixCMS ? window.MatrixCMS.getHtmlOverride(screen.src) : null;
      if (cmsOverride != null) {
        const odoc = new DOMParser().parseFromString(cmsOverride, 'text/html');
        const opage = odoc.querySelector('.page');
        inner.innerHTML = opage ? opage.innerHTML : (odoc.body ? odoc.body.innerHTML : cmsOverride);
        return;
      }

      if (typeof window.docx === 'undefined' || !window.docx.renderAsync) await waitForDocx();
      const res = await fetch(vsrc(screen));
      if (!res.ok) throw new Error('Could not load file (HTTP ' + res.status + ')');
      let buf = await res.arrayBuffer();
      /* Image failsafe (pre-render): recover linked/missing pictures from the
         course folder so the page mirrors the document. Never fatal — on any
         error we render the original bytes and the post-render step tidies up. */
      let docImages = null;
      try {
        docImages = await prepareDocImages(buf, screen);
        if (docImages && docImages.buf) buf = docImages.buf;
      } catch (_) {}
      inner.innerHTML = '';
      const host = document.createElement('div');
      host.className = 'docx-scalehost';
      inner.appendChild(host);
      await window.docx.renderAsync(buf, host, host, {
        className: 'docx',
        inWrapper: true,
        /* Render at the document's TRUE layout (real column widths etc.) so tables
           match the source. A scale-to-fit step below shrinks the whole page to the
           viewer width, so it stays faithful AND never scrolls sideways. */
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
        experimental: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        useBase64URL: true
      });
      /* Scale the rendered page down to fit the viewer width — preserves the exact
         layout (so a table looks like it does in the doc) while avoiding sideways
         scrolling. Re-runs on resize. Degrades safely: if anything fails the doc
         still shows at full size. */
      const fitDoc = () => {
        try {
          if (!host.isConnected) return;
          const dw = host.querySelector('.docx-wrapper');
          if (!dw) return;
          dw.style.zoom = '';                                    // reset, then measure natural size
          const avail = host.clientWidth;
          let natW = Math.max(dw.scrollWidth, dw.offsetWidth);
          /* A table or image can be WIDER than the document's page (the page would
             clip it). getBoundingClientRect reports its true width even when clipped,
             so we zoom to fit the widest element — nothing runs off the screen. */
          host.querySelectorAll('table, img, svg, pre').forEach((el) => {
            const w = Math.ceil(el.getBoundingClientRect().width);
            if (w > natW) natW = w;
          });
          if (natW > 0 && avail > 0 && natW > avail + 1) {
            /* zoom shrinks the page AND its layout box, so the height collapses with
               it — nothing is clipped, and there's no sideways scroll. */
            dw.style.zoom = String(avail / natW);
          }
        } catch (_) {}
      };
      /* Post-render: swap any picture the browser couldn't load for a tidy
         placeholder, then re-fit so scaling accounts for the swap. */
      try { installImagePlaceholders(host, fitDoc); } catch (_) {}
      if (docImages && docImages.unresolved && docImages.unresolved.length) {
        console.info('[Matrix doc] images not embedded in ' + (screen.src || '') +
          ' — re-insert them in the doc, or add these files to the course folder: ' +
          docImages.unresolved.join(', '));
      }
      fitDoc();
      setTimeout(fitDoc, 400);                                   // re-fit once images/fonts settle
      if (_docFit) window.removeEventListener('resize', _docFit);
      _docFit = fitDoc;
      window.addEventListener('resize', _docFit);
    } catch (err) {
      inner.innerHTML = `<p style="color:var(--warn);">Could not render document: ${escapeHtml(err.message)}</p>`;
    }
  }

  function waitForDocx(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (typeof window.docx !== 'undefined' && window.docx.renderAsync) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('Document renderer not available'));
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function waitForMammoth(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (typeof window.mammoth !== 'undefined') return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('Document renderer not available'));
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function extractYoutubeId(url) {
    const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
    return m ? m[1] : null;
  }

  function filename(p) {
    return String(p || '').split(/[\\/]/).pop();
  }

  /* Detect content that is NOT a web page so we never dump raw bytes at a
     learner: Office files (.docx/.xlsx/.pptx) are zips starting "PK", PDFs
     start "%PDF-", and binary in general has many control characters. */
  function looksBinary(s) {
    if (!s) return false;
    if (s.charCodeAt(0) === 0x50 && s.charCodeAt(1) === 0x4B) return true; // "PK" = zip / Office
    if (s.slice(0, 5) === '%PDF-') return true;
    let ctrl = 0; const n = Math.min(s.length, 1000);
    for (let i = 0; i < n; i++) { const c = s.charCodeAt(i); if (c === 0 || c === 0xFFFD || c < 9 || (c > 13 && c < 32)) ctrl++; }
    return n > 0 && ctrl / n > 0.05;
  }

  function formatMeta(screen) {
    /* Labelled screen info, e.g.
       Title: Homework 1   ·   Time: 2 hours   ·   Type: HTML   ·   Asset: CP4807-H1.htm
       (Title is also shown big in the h2 above; repeated here as a labelled
       field per author request so all the screen metadata reads as one row.) */
    const parts = [];
    parts.push('<span class="meta-field"><span class="meta-k">Title:</span> ' + escapeHtml(screen.title || '—') + '</span>');

    if (screen.hours != null && screen.hours !== '') {
      const h = Number(screen.hours);
      const timeLabel = isNaN(h)
        ? escapeHtml(String(screen.hours))
        : (h === 1 ? '1 hour' : (Number.isInteger(h) ? h + ' hours' : h + ' hours'));
      parts.push('<span class="meta-field"><span class="meta-k">Time:</span> ' + timeLabel + '</span>');
    }

    /* Warn the publisher if the declared type doesn't match the actual file
       (e.g. type HTML but the file is a .docx) — the viewer still renders it
       correctly, but the mismatch should be fixed in the definition. */
    const effType = effectiveType(screen);
    const typeWarn = (!/^https?:/i.test(screen.src || '') && effType !== screen.type)
      ? ' <span class="meta-warn" title="Set the Screen type to match the file" style="color:var(--warn,#b45309)">⚠ file is ' + escapeHtml(effType) + '</span>'
      : '';
    parts.push('<span class="meta-field"><span class="meta-k">Type:</span> ' + escapeHtml(screen.type.toUpperCase()) + typeWarn + '</span>');

    const isUrl = /^https?:/i.test(screen.src || '');
    // Show the real Google Drive location: prefer screen.path (the Drive path
    // typed in the definition); otherwise fall back to the site path with the
    // internal "content/" prefix stripped. The publisher never sees "content/".
    const asset = isUrl
      ? shortUrl(screen.src)
      : (screen.path || (screen.src || '').replace(/^content\//i, ''));
    if (asset) {
      parts.push('<span class="meta-field"><span class="meta-k">Asset:</span> <code>' + escapeHtml(asset) + '</code></span>');
    }
    return parts.join('<span class="meta-sep">·</span>');
  }
  function shortUrl(u) {
    try {
      const url = new URL(u);
      return url.hostname + url.pathname.replace(/^\/.*\//, '/…/');
    } catch (_) { return u; }
  }

  /* Progress / persistence */
  function progressKey() { return 'matrix-lms:progress:' + courseId; }
  function indexKey() { return 'matrix-lms:lastIndex:' + courseId; }

  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(progressKey()) || '{}'); }
    catch (_) { return {}; }
  }
  function saveProgress(p) {
    localStorage.setItem(progressKey(), JSON.stringify(p));
  }
  function isComplete(screenId) {
    const p = loadProgress();
    return Boolean(p[screenId]);
  }
  function setComplete(screenId, value) {
    const p = loadProgress();
    const wasComplete = Boolean(p[screenId]);
    if (value) {
      if (!p[screenId]) p[screenId] = { ts: Date.now() };
    } else {
      delete p[screenId];
    }
    saveProgress(p);
    const idx = course.screens.findIndex((s) => s.id === screenId);
    renderProgress();
    if (idx === currentIndex) updateCompleteButton();
    if (window.Gamify && value && !wasComplete) {
      window.Gamify.onComplete(courseId, course.screens[idx]);
    }
    /* SCORM: report completion progress to the host LMS, if any */
    if (window.MatrixSCORM && window.MatrixSCORM.isActive && window.MatrixSCORM.isActive()) {
      const completed = course.screens.filter((s) => isComplete(s.id)).length;
      window.MatrixSCORM.screenComplete(completed, course.screens.length);
      if (completed >= course.screens.length) window.MatrixSCORM.courseComplete();
    }
  }
  function toggleComplete(screenId) {
    setComplete(screenId, !isComplete(screenId));
  }
  function persistLastIndex(idx) {
    try { localStorage.setItem(indexKey(), String(idx)); } catch (_) {}
  }
  function restoreLastIndex() {
    const raw = Number(localStorage.getItem(indexKey()));
    if (Number.isFinite(raw) && raw >= 0 && raw < course.screens.length) return raw;
    return 0;
  }

  function renderProgress() {
    const p = loadProgress();
    const completed = course.screens.filter((s) => p[s.id]).length;
    const total = course.screens.length;
    const pct = total ? Math.round((completed / total) * 100) : 0;

    if (window.MatrixChrome) {
      const currentScreen = course.screens[currentIndex];
      window.MatrixChrome.refreshProgress(currentScreen ? currentScreen.id : null);
    }

    if (els.certificateCta && course.certificate && course.certificate.enabled) {
      const ready = completed === total && total > 0;
      const link = els.certificateLink;
      if (ready) {
        link.classList.remove('btn-secondary');
        link.classList.add('btn-primary');
        link.textContent = '🎓 Get your certificate';
        link.removeAttribute('aria-disabled');
        link.style.opacity = '';
      } else {
        link.classList.remove('btn-primary');
        link.classList.add('btn-secondary');
        link.textContent = 'Certificate at 100% (' + (total - completed) + ' to go)';
        link.setAttribute('aria-disabled', 'true');
        link.style.opacity = '0.7';
      }
    }
  }

  /* Utils */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ---------- Header action bar (Print / Download / Download course) ----------
     Enable/disable the header buttons for the screen being shown, so every screen
     type carries the SAME controls in one place. Worksheets (document/html) print
     their rendered content; image/PDF/Office open the file in a window the browser
     or native viewer can print from; YouTube and external links can't be
     printed/downloaded, so those buttons go disabled (never hidden — the bar stays
     consistent from screen to screen). */
  const PRINTABLE_TYPES = ['document', 'html', 'image', 'pdf', 'powerpoint', 'spreadsheet'];
  /* Build an "open the original externally" target for a screen, opened in a new
     tab. YouTube → the video on youtube.com. Otherwise follow the Drive link the
     sync stamped on the screen (screen.webUrl): native Google files open in the
     matching editor (Docs / Sheets / Slides); anything else — e.g. an HTML/text
     screen, whose source is an .htm file — opens in Google Drive (from which it
     can be opened with Google Docs). Null when there's nothing to open. */
  function externalOpen(screen) {
    if (!screen || screen.missing) return null;
    if (effectiveType(screen) === 'youtube') {
      const yid = extractYoutubeId(screen.src);
      return yid ? { url: 'https://www.youtube.com/watch?v=' + yid, label: 'Open in YouTube' } : null;
    }
    /* Prefer an explicit Word-document link: the sync sets screen.wordUrl on a
       text/HTML screen that also has a Word version, so we open the WORD file in
       Google Docs — never the raw .htm. Office screens fall back to their own
       Drive link. A screen with only a plain file link gets no open option (we
       never surface a raw HTML/Drive file to customers). */
    const wu = screen.wordUrl || screen.webUrl || '';
    if (!wu) return null;
    if (/\/document\/d\//.test(wu))     return { url: wu, label: 'Open in Word' };
    if (/\/spreadsheets\/d\//.test(wu)) return { url: wu, label: 'Open in Google Sheets' };
    if (/\/presentation\/d\//.test(wu)) return { url: wu, label: 'Open in Google Slides' };
    /* A non-native Drive file (e.g. an .htm worksheet, or an uploaded .docx/.xlsx)
       — open it in Drive, where the learner can choose "Open with…" the matching
       Google editor. Gives .htm screens the same open-the-original option the
       Word-backed screens already have. Labelled by the screen's type. */
    if (/drive\.google\.com\/file\//.test(wu)) {
      const t = effectiveType(screen);
      if (t === 'spreadsheet') return { url: wu, label: 'Open in Google Sheets' };
      if (t === 'powerpoint')  return { url: wu, label: 'Open in Google Slides' };
      if (t === 'html' || t === 'document') return { url: wu, label: 'Open in Google Docs' };
    }
    return null;
  }
  function updateScreenActions(screen) {
    const isUrl = /^https?:/i.test(screen.src || '');
    const t = effectiveType(screen);
    const canDownload = !!screen.src && !isUrl && !screen.missing;
    const canPrint = !screen.missing && !isUrl && PRINTABLE_TYPES.indexOf(t) >= 0;
    /* "Open in …" — opens the original externally: YouTube videos on youtube.com,
       Office files in the matching Google editor. An extra capability (not a core
       control), so it's hidden when not applicable. */
    if (els.openGoogleBtn) {
      const g = externalOpen(screen);
      if (g) {
        els.openGoogleBtn.href = g.url;
        els.openGoogleBtn.innerHTML = '&#8599; ' + g.label;
        els.openGoogleBtn.title = g.label + ' (new tab)';
        els.openGoogleBtn.hidden = false;
      } else {
        els.openGoogleBtn.hidden = true;
        els.openGoogleBtn.removeAttribute('href');
      }
    }
    if (els.downloadBtn) {
      els.downloadBtn.disabled = !canDownload;
      els.downloadBtn.title = canDownload
        ? 'Download this file'
        : (isUrl ? 'This screen is an external link — nothing to download' : 'Nothing to download for this screen');
    }
    if (els.printBtn) {
      els.printBtn.disabled = !canPrint;
      els.printBtn.title = canPrint ? 'Print this screen' : 'This screen can’t be printed';
    }
  }

  function printCurrentScreen() {
    const screen = course.screens[currentIndex];
    if (!screen) return;
    const t = effectiveType(screen);
    /* HTML worksheets are rendered to HTML on the stage — print that, so the
       printout matches exactly what the learner sees. */
    if (t === 'html') {
      const inner = els.screenStage.querySelector('.stage-doc-inner');
      if (inner) { printWorksheet(screen, inner); return; }
    }
    if (t === 'image') { printImage(screen); return; }
    /* PDF / Word / PowerPoint / Spreadsheet: open the file in a new tab — the
       browser's PDF viewer / Office Online viewer / native app each provide
       their own Print. */
    const w = window.open(vsrc(screen), '_blank');
    if (!w) alert('Pop-up blocked. Allow pop-ups for this site to print this file.');
  }

  function printImage(screen) {
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) { alert('Pop-up blocked. Allow pop-ups for this site to print.'); return; }
    w.document.open();
    w.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + escapeHtml(screen.title || 'Image') + '</title>' +
      '<style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;padding:14px}' +
      'img{max-width:100%;max-height:100%}@media print{body{padding:0}}</style></head><body>' +
      '<img src="' + escapeAttr(vsrc(screen)) + '" alt="' + escapeAttr(screen.title || '') + '">' +
      '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},150);};</scr' + 'ipt>' +
      '</body></html>'
    );
    w.document.close();
  }

  /* Programmatic download via a throwaway anchor — works for the per-file Download
     (same-origin content/ paths honour the `download` attribute) and the ZIP blob. */
  function triggerDownload(href, name) {
    const a = document.createElement('a');
    a.href = href;
    if (name) a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  /* Download the current screen's file. Browsers OPEN some types inline (notably
     PDFs) even with a download attribute, so fetch the bytes to a blob first —
     that reliably SAVES the file from anywhere the button lives (header Options,
     fallback cards, etc.). Falls back to a plain anchor if the fetch is blocked. */
  async function downloadScreenFile(screen) {
    if (!screen || !screen.src || /^https?:/i.test(screen.src)) return;
    const name = filename(screen.src) || 'download';
    const url = vsrc(screen);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const burl = URL.createObjectURL(blob);
      triggerDownload(burl, name);
      setTimeout(() => URL.revokeObjectURL(burl), 8000);
    } catch (_) {
      triggerDownload(url, name);                              // best-effort direct link
    }
  }

  /* ---------- Compile the whole course into ONE .docx ----------
     Every CONTENT screen of THIS course — the Word worksheets (.docx) AND the
     text screens (.htm) — compiled into a single Word document, in screen order,
     page break between each. .docx screens (and text screens that have a Word
     version) are merged NATIVELY (full Word fidelity); text screens with no Word
     version are converted to real OOXML (so the file opens cleanly in Word AND
     Google Docs — no altChunk). Numbering is offset per-screen so lists never
     collide; media + hyperlink relationships are remapped. */
  const PAGE_BREAK_XML = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const MEDIA_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', emf: 'image/x-emf', wmf: 'image/x-wmf', webp: 'image/webp' };
  const HTM_BULLET_NUMID = 990001, HTM_DECIMAL_NUMID = 990002;
  const HTM_HEADING_SZ = { H1: 36, H2: 32, H3: 28, H4: 26, H5: 24, H6: 22 };
  function docBodyInner(doc) {
    const open = doc.match(/<w:body[^>]*>/);
    if (!open) return '';
    const start = open.index + open[0].length;
    const close = doc.lastIndexOf('</w:body>');
    let inner = doc.slice(start, close);
    const lastSect = inner.lastIndexOf('<w:sectPr');                 // drop the body-level sectPr
    if (lastSect !== -1) {
      const end = inner.indexOf('</w:sectPr>', lastSect);
      if (end !== -1 && inner.slice(end + 11).trim() === '') inner = inner.slice(0, lastSect);
      else if (end === -1) { const sc = inner.indexOf('/>', lastSect); if (sc !== -1 && inner.slice(sc + 2).trim() === '') inner = inner.slice(0, lastSect); }
    }
    return inner;
  }
  function offsetDocNumbering(xml, off) {
    return xml
      .replace(/(<w:abstractNum\s+w:abstractNumId=")(\d+)(")/g, (m, a, n, b) => a + (+n + off) + b)
      .replace(/(<w:num\s+w:numId=")(\d+)(")/g, (m, a, n, b) => a + (+n + off) + b)
      .replace(/(<w:abstractNumId\s+w:val=")(\d+)(")/g, (m, a, n, b) => a + (+n + off) + b);
  }
  /* ---- HTML → OOXML (text screens) ---- */
  function htmlRunXml(text, fmt) {
    if (!text) return '';
    const rpr = [];   // CT_RPr schema order: b, i, color, sz, u
    if (fmt.b) rpr.push('<w:b/>');
    if (fmt.i) rpr.push('<w:i/>');
    if (fmt.link) rpr.push('<w:color w:val="0563C1"/>');
    if (fmt.sz) rpr.push('<w:sz w:val="' + fmt.sz + '"/>');
    if (fmt.u || fmt.link) rpr.push('<w:u w:val="single"/>');
    const pr = rpr.length ? '<w:rPr>' + rpr.join('') + '</w:rPr>' : '';
    return '<w:r>' + pr + '<w:t xml:space="preserve">' + escapeHtml(text) + '</w:t></w:r>';
  }
  function htmlInlineRuns(node, fmt) {
    let out = '';
    for (const ch of Array.from(node.childNodes || [])) {
      if (ch.nodeType === 3) { out += htmlRunXml(ch.textContent.replace(/\s+/g, ' '), fmt); continue; }
      if (ch.nodeType !== 1) continue;
      const t = ch.tagName;
      if (t === 'BR') { out += '<w:r><w:br/></w:r>'; continue; }
      const f = Object.assign({}, fmt);
      if (t === 'B' || t === 'STRONG') f.b = true;
      else if (t === 'I' || t === 'EM') f.i = true;
      else if (t === 'U') f.u = true;
      else if (t === 'A') f.link = true;
      out += htmlInlineRuns(ch, f);
    }
    return out;
  }
  function htmlParaXml(runs, opts) {
    opts = opts || {};
    const props = [];   // CT_PPr schema order: keepNext, numPr, spacing
    if (opts.heading) props.push('<w:keepNext/>');
    if (opts.numId) props.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + opts.numId + '"/></w:numPr>');
    if (opts.heading) props.push('<w:spacing w:before="200" w:after="80"/>');
    const pPr = props.length ? '<w:pPr>' + props.join('') + '</w:pPr>' : '';
    return '<w:p>' + pPr + (runs || '<w:r><w:t/></w:r>') + '</w:p>';
  }
  function htmlTableXml(node) {
    let trs = ''; let maxCols = 0;
    for (const tr of Array.from(node.querySelectorAll('tr'))) {
      let tcs = ''; const cells = Array.from(tr.querySelectorAll('td,th'));
      if (cells.length > maxCols) maxCols = cells.length;
      for (const td of cells) {
        tcs += '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' + htmlParaXml(htmlInlineRuns(td, td.tagName === 'TH' ? { b: true } : {})) + '</w:tc>';
      }
      if (tcs) trs += '<w:tr>' + tcs + '</w:tr>';
    }
    if (!trs) return '';
    const b = '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>';
    const grid = '<w:tblGrid>' + '<w:gridCol/>'.repeat(maxCols || 1) + '</w:tblGrid>';   // w:tblGrid is required by the schema
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + b + '</w:tblPr>' + grid + trs + '</w:tbl>';
  }
  function htmlBlockify(node, out, flags) {
    let buf = '';
    const flush = () => { if (buf.trim()) out.push(htmlParaXml(buf)); buf = ''; };
    for (const ch of Array.from(node.childNodes || [])) {
      if (ch.nodeType === 3) { if (ch.textContent.trim()) buf += htmlRunXml(ch.textContent.replace(/\s+/g, ' '), {}); continue; }
      if (ch.nodeType !== 1) continue;
      const t = ch.tagName;
      if (t === 'P') { flush(); out.push(htmlParaXml(htmlInlineRuns(ch, {}))); }
      else if (/^H[1-6]$/.test(t)) { flush(); out.push(htmlParaXml(htmlInlineRuns(ch, { b: true, sz: HTM_HEADING_SZ[t] || 28 }), { heading: true })); }
      else if (t === 'UL' || t === 'OL') { flush(); const nid = t === 'OL' ? HTM_DECIMAL_NUMID : HTM_BULLET_NUMID; flags.lists = true; for (const li of Array.from(ch.children)) { if (li.tagName === 'LI') out.push(htmlParaXml(htmlInlineRuns(li, {}), { numId: nid })); } }
      else if (t === 'TABLE') { flush(); const tb = htmlTableXml(ch); if (tb) out.push(tb); }
      else if (t === 'BR') { buf += '<w:r><w:br/></w:r>'; }
      else if (t === 'B' || t === 'STRONG' || t === 'I' || t === 'EM' || t === 'U' || t === 'A' || t === 'SPAN' || t === 'FONT') { buf += htmlInlineRuns(ch, {}); }
      else if (t === 'IMG' || t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT') { /* skip */ }
      else { flush(); htmlBlockify(ch, out, flags); }
    }
    flush();
  }
  function htmlToBodyXml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const out = [];
    const flags = {};
    htmlBlockify(doc.body || doc.documentElement, out, flags);
    return { xml: out.join(''), usesLists: !!flags.lists };
  }
  /* The skeleton's <w:document> root must declare every namespace prefix used by
     ANY body we splice in. Word docs with images/drawings use wp:/a:/pic:/mc:/v:
     etc.; if the skeleton happens not to declare one of those, the merged
     document.xml has an undeclared prefix and Word reports "unreadable content".
     Merge a full standard prefix set into the skeleton's root tag (keeping any the
     skeleton already declares). */
  const OOXML_NS = {
    'xmlns:wpc': 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas',
    'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    'xmlns:o': 'urn:schemas-microsoft-com:office:office',
    'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'xmlns:m': 'http://schemas.openxmlformats.org/officeDocument/2006/math',
    'xmlns:v': 'urn:schemas-microsoft-com:vml',
    'xmlns:wp14': 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
    'xmlns:wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'xmlns:w10': 'urn:schemas-microsoft-com:office:word',
    'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'xmlns:w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
    'xmlns:wpg': 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
    'xmlns:wpi': 'http://schemas.microsoft.com/office/word/2010/wordprocessingInk',
    'xmlns:wne': 'http://schemas.microsoft.com/office/word/2006/wordml',
    'xmlns:wps': 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
    'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'xmlns:pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture'
  };
  function ensureDocNamespaces(skelDoc) {
    const m = skelDoc.match(/<w:document\b([^>]*)>/);
    if (!m) return skelDoc;
    let attrs = m[1];
    for (const k of Object.keys(OOXML_NS)) {
      if (!new RegExp('(?:^|\\s)' + k.replace(':', '\\:') + '=').test(attrs)) attrs += ' ' + k + '="' + OOXML_NS[k] + '"';
    }
    if (!/\bmc:Ignorable=/.test(attrs)) attrs += ' mc:Ignorable="w14 wp14"';
    return skelDoc.replace(/<w:document\b[^>]*>/, '<w:document' + attrs + '>');
  }
  async function compileCourseDocx(items) {
    const JSZip = window.JSZip;
    const skelIdx = items.findIndex((it) => it.type === 'docx');
    if (skelIdx < 0) throw new Error('this course has no Word document to build from');
    const skel = await JSZip.loadAsync(items[skelIdx].buf);
    const numFile = skel.file('word/numbering.xml');
    let numXml = numFile ? await numFile.async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:numbering>';
    let relsXml = await skel.file('word/_rels/document.xml.rels').async('string');
    let ctXml = await skel.file('[Content_Types].xml').async('string');
    const skelDoc = ensureDocNamespaces(await skel.file('word/document.xml').async('string'));
    let mergedBody = '', abstracts = '', nums = '', relsAdd = '';
    const mediaAdds = []; const ctExt = {}; let relCounter = 0; let anyLists = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (i > 0) mergedBody += PAGE_BREAK_XML;
      if (it.type === 'docx') {
        const zip = await JSZip.loadAsync(it.buf);
        const docF = zip.file('word/document.xml'); if (!docF) continue;
        const doc = await docF.async('string');
        const relsF = zip.file('word/_rels/document.xml.rels');
        const rXml = relsF ? await relsF.async('string') : '';
        const off = (i + 1) * 100000;
        let inner = docBodyInner(doc).replace(/(<w:numId\s+w:val=")(\d+)(")/g, (m, a, n, b) => a + (n === '0' ? '0' : (+n + off)) + b);
        /* Inserted section breaks carry header/footer references to parts we don't
           bring across — a dangling reference makes Word refuse the file, so drop them. */
        inner = inner.replace(/<w:(?:headerReference|footerReference)\b[^>]*\/>/g, '');
        const refIds = new Set(); let mm; const re = /r:(?:embed|id|link)="([^"]+)"/g; while ((mm = re.exec(inner))) refIds.add(mm[1]);
        const relMap = {};
        for (const oldId of refIds) {
          const rx = new RegExp('<Relationship\\b[^>]*Id="' + oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*/>');
          const rel = (rXml.match(rx) || [])[0]; if (!rel) continue;
          const rtype = (rel.match(/Type="([^"]+)"/) || [])[1] || ''; const target = (rel.match(/Target="([^"]+)"/) || [])[1] || ''; const mode = (rel.match(/TargetMode="([^"]+)"/) || [])[1] || '';
          if (mode === 'External' || /^[a-z]+:\/\//i.test(target) || /^mailto:/i.test(target)) {
            const newId = 'rIdC' + i + '_' + (relCounter++); relMap[oldId] = newId;
            relsAdd += '<Relationship Id="' + newId + '" Type="' + rtype + '" Target="' + escapeAttr(target) + '" TargetMode="External"/>';
          } else {
            const sp = normalizeZipPath('word/' + target.replace(/^\/+/, ''));
            const ext = (sp.split('.').pop() || 'bin').toLowerCase();
            /* Only carry IMAGES of a known type across — that guarantees every copied
               part has a content type. Other internal parts (headers, footers, OLE
               objects, charts) need their own parts/rels/content-types; copying them
               naively is exactly what corrupts the file, so skip them and the
               reference is stripped below rather than left dangling. */
            if (!MEDIA_MIME[ext]) continue;
            const f = zip.file(sp); if (!f) continue;
            const newId = 'rIdC' + i + '_' + (relCounter++); relMap[oldId] = newId;
            const nm = 'media/c' + i + '_' + relCounter + '.' + ext;
            mediaAdds.push({ path: 'word/' + nm, data: await f.async('uint8array') });
            relsAdd += '<Relationship Id="' + newId + '" Type="' + rtype + '" Target="' + nm + '"/>';
            if (MEDIA_MIME[ext]) ctExt[ext] = MEDIA_MIME[ext];
          }
        }
        /* Remap the references we kept; STRIP any we didn't carry. A leftover
           r:id/r:embed pointing at a relationship that no longer exists is the
           canonical cause of "Word found unreadable content". */
        inner = inner.replace(/(\s)(r:(?:embed|id|link))="([^"]+)"/g, (m, sp, attr, id) => (relMap[id] ? sp + attr + '="' + relMap[id] + '"' : ''));
        mergedBody += inner;
        const nf = zip.file('word/numbering.xml');
        if (nf) { const nx = await nf.async('string'); (nx.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) || []).forEach((bk) => abstracts += offsetDocNumbering(bk, off)); (nx.match(/<w:num\b(?![a-zA-Z])[\s\S]*?<\/w:num>/g) || []).forEach((bk) => nums += offsetDocNumbering(bk, off)); }
      } else {
        const conv = htmlToBodyXml(it.html);
        if (conv.usesLists) anyLists = true;
        mergedBody += (it.title ? htmlParaXml(htmlRunXml(it.title, { b: true, sz: 32 }), { heading: true }) : '') + conv.xml;
      }
    }
    if (anyLists) {
      abstracts += '<w:abstractNum w:abstractNumId="' + HTM_BULLET_NUMID + '"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>'
        + '<w:abstractNum w:abstractNumId="' + HTM_DECIMAL_NUMID + '"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>';
      nums += '<w:num w:numId="' + HTM_BULLET_NUMID + '"><w:abstractNumId w:val="' + HTM_BULLET_NUMID + '"/></w:num><w:num w:numId="' + HTM_DECIMAL_NUMID + '"><w:abstractNumId w:val="' + HTM_DECIMAL_NUMID + '"/></w:num>';
    }
    const numOpen = (numXml.match(/<w:numbering\b[^>]*>/) || ['<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'])[0];
    numXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + numOpen + abstracts + nums + '</w:numbering>';
    const open = skelDoc.match(/<w:body[^>]*>/); const bStart = open.index + open[0].length; const bClose = skelDoc.lastIndexOf('</w:body>');
    let tail = skelDoc.slice(bStart, bClose); let sect = ''; const ls = tail.lastIndexOf('<w:sectPr');
    if (ls !== -1) { const e = tail.indexOf('</w:sectPr>', ls); if (e !== -1) sect = tail.slice(ls, e + 11); }
    const newDoc = skelDoc.slice(0, bStart) + mergedBody + sect + skelDoc.slice(bClose);
    if (relsAdd) relsXml = relsXml.replace('</Relationships>', relsAdd + '</Relationships>');
    let ctAdd = '';
    for (const ext of Object.keys(ctExt)) if (!new RegExp('<Default\\s+Extension="' + ext + '"', 'i').test(ctXml)) ctAdd += '<Default Extension="' + ext + '" ContentType="' + ctExt[ext] + '"/>';
    if (ctAdd) ctXml = ctXml.replace('</Types>', ctAdd + '</Types>');
    skel.file('word/document.xml', newDoc);
    skel.file('word/numbering.xml', numXml);
    skel.file('word/_rels/document.xml.rels', relsXml);
    skel.file('[Content_Types].xml', ctXml);
    for (const m of mediaAdds) skel.file(m.path, m.data);
    return skel.generateAsync({ type: 'blob' });
  }
  async function downloadAllWorksheets(course, btn) {
    /* THIS course's content screens in order — its .docx worksheets AND its .htm
       text screens — de-duped by file; skip images/video/pdf/spreadsheet/missing. */
    const seen = new Set();
    const screens = [];
    for (const s of course.screens) {
      const t = effectiveType(s);
      if ((t !== 'document' && t !== 'html') || s.missing || /^https?:/i.test(s.src || '')) continue;
      if (seen.has(s.src)) continue;
      seen.add(s.src);
      screens.push(s);
    }
    if (!screens.length) { alert('This course has no documents to compile.'); return; }
    const restore = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '&#8987; Compiling ' + screens.length + ' documents…'; }
    try {
      if (!window.JSZip) throw new Error('zip library not loaded');
      const items = [];
      for (const s of screens) {
        const t = effectiveType(s);
        if (t === 'document') {
          const res = await fetch(vsrc(s));
          if (res.ok) items.push({ type: 'docx', buf: await res.arrayBuffer(), title: s.title });
        } else {
          /* text screen: prefer its matching Word file (full fidelity); else convert the HTML. */
          let added = false;
          if (s.wordUrl) {
            try {
              const dres = await fetch(encodeURI(s.src.replace(/\.html?$/i, '.docx')));
              if (dres.ok) { items.push({ type: 'docx', buf: await dres.arrayBuffer(), title: s.title }); added = true; }
            } catch (_) {}
          }
          if (!added) {
            const res = await fetch(vsrc(s));
            if (res.ok) items.push({ type: 'html', html: await res.text(), title: s.title });
          }
        }
      }
      if (!items.length) throw new Error('no documents could be fetched');
      const blob = await compileCourseDocx(items);
      const name = (course.code || course.id || 'course') + ' - worksheets.docx';
      const url = URL.createObjectURL(blob);
      triggerDownload(url, name);
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    } catch (e) {
      alert('Could not compile the documents: ' + ((e && e.message) || e));
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = restore; }
    }
  }

  /* ---------- Whole-course download ----------
     Zip every file in the course into a single download so a learner can take the
     entire course offline in one click. De-dupes files reused across screens,
     disambiguates same-named files, and lists any external (YouTube/web) links in
     an external-links.txt so nothing is silently dropped. */
  async function downloadCourseZip(course, btn) {
    if (!window.JSZip) { alert('The ZIP library is still loading — please try again in a moment.'); return; }
    const label = btn.querySelector('span');
    const orig = label ? label.textContent : '';
    const setLbl = (t) => { if (label) label.textContent = t; };
    btn.disabled = true;
    try {
      const zip = new window.JSZip();
      const seen = new Set();   // unique screen.src already added
      const used = new Set();   // names already used inside the zip
      const files = [], links = [];
      const uniqueName = (name) => {
        if (!used.has(name)) { used.add(name); return name; }
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        let i = 2, n;
        do { n = stem + ' (' + i + ')' + ext; i++; } while (used.has(n));
        used.add(n); return n;
      };
      course.screens.forEach((s) => {
        const src = s.src || '';
        if (/^https?:/i.test(src)) { links.push((s.title || 'Link') + ' — ' + src); return; }
        if (s.missing || !src || seen.has(src)) return;
        seen.add(src);
        files.push(s);
      });
      if (!files.length && !links.length) { alert('This course has no downloadable files.'); return; }

      let done = 0, failed = 0;
      for (const s of files) {
        done++;
        setLbl('Zipping (' + done + '/' + files.length + ')…');
        try {
          const res = await fetch(vsrc(s));
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const buf = await res.arrayBuffer();
          zip.file(uniqueName(filename(s.src) || (s.title || 'file')), buf);
        } catch (err) {
          failed++;
          console.warn('[course zip] skipped ' + s.src + ': ' + err.message);
        }
      }
      if (links.length) zip.file('external-links.txt', links.join('\n') + '\n');

      setLbl('Building ZIP…');
      const blob = await zip.generateAsync(
        { type: 'blob' },
        (meta) => setLbl('Building ZIP ' + Math.round(meta.percent) + '%')
      );
      const url = URL.createObjectURL(blob);
      const safeTitle = String(course.title || '').replace(/[\\/:*?"<>|]+/g, ' ').trim();
      triggerDownload(url, ((course.code || 'course') + (safeTitle ? ' - ' + safeTitle : '')) + '.zip');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (failed) alert(failed + ' file(s) could not be fetched and were left out of the ZIP. See the console for details.');
    } catch (err) {
      alert('Could not build the course download: ' + err.message);
    } finally {
      btn.disabled = false;
      setLbl(orig);
    }
  }

  /* ---------- Worksheet print ----------
     Opens a new window with just the worksheet content + minimal print
     CSS, then triggers the browser's native print dialog. That dialog
     also offers "Save as PDF" on every modern OS, which replaces the
     unreliable html2pdf path and gives the author the real Word-like
     view they want. */
  function printWorksheet(screen, innerEl) {
    const title = (screen && screen.title) || 'Worksheet';
    const code = (course && course.code) || '';
    const body = innerEl && innerEl.innerHTML ? innerEl.innerHTML : '';
    if (!body.trim()) { alert('Wait for the worksheet to render first, then print.'); return; }
    /* NB: do NOT pass noopener/noreferrer here — those make window.open()
       return null, so we could never write the print document into the new
       window (the about:blank bug). The content below is our own. */
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) { alert('Pop-up blocked. Allow pop-ups for this site to print.'); return; }
    w.document.open();
    w.document.write([
      '<!DOCTYPE html><html><head><meta charset="utf-8">',
      '<title>', escapeHtml(title), ' — ', escapeHtml(code), '</title>',
      '<style>',
        '*,*::before,*::after{box-sizing:border-box}',
        'body{margin:0;padding:24px 28px;font:11pt/1.55 "Segoe UI",Calibri,Arial,sans-serif;color:#1a1a2e;}',
        '@media print{body{padding:0}}',
        'h1{font-size:20pt;margin:0 0 4pt;font-weight:700;color:#1e1b4b}',
        '.print-meta{font-size:9pt;letter-spacing:1px;text-transform:uppercase;color:#7c3aed;font-weight:700;margin-bottom:14pt}',
        'h2,h3{margin:1.2em 0 .4em;line-height:1.25}',
        'p{margin:0 0 .8em}',
        'ul,ol{margin:0 0 .8em;padding-left:1.5em}',
        'li{margin-bottom:.25em}',
        'img{max-width:100%;height:auto}',
        'table{border-collapse:collapse;margin:.8em 0;width:100%}',
        'th,td{border:1px solid #c8d5f0;padding:.4em .6em;vertical-align:top}',
        'a{color:#1d4ed8}',
        '@page{margin:18mm 16mm}',
      '</style>',
      '</head><body>',
      '<div class="print-meta">', escapeHtml(code), ' &middot; ', escapeHtml(filename(screen.src) || ''), '</div>',
      '<h1>', escapeHtml(title), '</h1>',
      body,
      '<script>window.onload=function(){setTimeout(function(){window.print();},120);};</script>',
      '</body></html>'
    ].join(''));
    w.document.close();
  }

  /* The sidebar renders a per-screen tick toggle so a learner can mark any
     page complete straight from the menu — not only via the in-page
     "Mark complete & next" button. Route those toggles through the same
     pipeline (setComplete → renderProgress → gamify / SCORM / certificate
     gate / Mark-complete button) so nothing drifts out of sync. */
  window.MatrixCourse = {
    toggleComplete: function (screenId) { toggleComplete(screenId); },
    isComplete: function (screenId) { return isComplete(screenId); },
    getCourseId: function () { return courseId; }
  };
})();

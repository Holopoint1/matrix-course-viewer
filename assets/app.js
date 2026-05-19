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
    completeBtn: document.getElementById('complete-btn')
  };

  let course = null;
  let currentIndex = 0;
  const docCache = new Map();

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
      const res = await fetch('data/courses.json');
      const data = await res.json();
      course = data.courses.find((c) => c.id === courseId);
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
        let html = docCache.get(screen.src);
        if (!html) {
          const res = await fetch(screen.src);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const buf = await res.arrayBuffer();
          const result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
          html = enhanceWorksheetHtml(result.value || '');
          docCache.set(screen.src, html);
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

    switch (screen.type) {
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
        renderDocument(stage, screen);
        return;
      case 'powerpoint':
      case 'spreadsheet':
        renderOffice(stage, screen);
        return;
      default:
        stage.innerHTML = `<p class="stage-loading">Unsupported screen type: ${escapeHtml(screen.type)}</p>`;
    }
  }

  function renderImage(stage, screen) {
    const wrap = document.createElement('div');
    wrap.className = 'stage-image';
    const img = document.createElement('img');
    img.src = screen.src;
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
        <a class="btn btn-secondary" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">↗ Open on YouTube</a>
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
    const safeSrc = escapeAttr(screen.src);
    const fname = filename(screen.src) || 'document.pdf';
    wrap.innerHTML = `
      <div class="stage-pdf-toolbar">
        <span class="stage-pdf-name" title="${safeSrc}">${escapeHtml(fname)}</span>
        <div class="stage-pdf-actions">
          <button type="button" class="btn btn-secondary" data-action="fullscreen">⛶ Fullscreen</button>
          <a class="btn btn-secondary" href="${safeSrc}" target="_blank" rel="noopener">↗ Open in new tab</a>
          <a class="btn btn-secondary" href="${safeSrc}" download>Download</a>
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
    wrap.innerHTML = `
      <div class="stage-doc-toolbar">
        <button type="button" class="btn btn-secondary" data-action="print">🖨 Print</button>
      </div>
      <div class="stage-doc-inner"><p class="stage-loading">Loading&hellip;</p></div>`;
    stage.appendChild(wrap);
    const inner = wrap.querySelector('.stage-doc-inner');
    wrap.querySelector('[data-action="print"]').addEventListener('click', () => {
      printWorksheet(screen, inner);
    });
    try {
      let text;
      const cmsOverride = window.MatrixCMS ? window.MatrixCMS.getHtmlOverride(screen.src) : null;
      if (cmsOverride != null) {
        text = cmsOverride;
      } else {
        const res = await fetch(screen.src);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        text = await res.text();
      }
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const pageEl = doc.querySelector('.page');
      let bodyHtml = pageEl ? pageEl.innerHTML : (doc.body ? doc.body.innerHTML : text);
      bodyHtml = enhanceWorksheetHtml(bodyHtml);
      inner.innerHTML = bodyHtml;
    } catch (err) {
      /* graceful fallback: iframe the file as-is */
      wrap.remove();
      renderIframe(stage, screen.src);
    }
  }

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
    const label = screen.type === 'powerpoint' ? 'PowerPoint' : 'Spreadsheet';
    const safeSrc = escapeAttr(screen.src);
    const fname = filename(screen.src) || screen.src;
    let absUrl = '';
    try { absUrl = new URL(screen.src, location.href).href; } catch (_) {}
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
            <a class="btn btn-secondary" href="${safeSrc}" download>Download</a>
          </div>
        </div>
        <div class="stage-pdf-frame">
          <div class="stage-pdf-fallback">
            <div class="stage-pdf-fallback-icon">📑</div>
            <h2>${escapeHtml(screen.title)}</h2>
            <p>The inline ${label} viewer uses Microsoft's Office viewer, which can't reach a local preview. On the published site this renders the slides inline. For now, open or download it:</p>
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
          <a class="btn btn-secondary" href="${safeSrc}" download>Download</a>
        </div>
      </div>
      <div class="stage-pdf-frame">
        <iframe class="stage-pdf-iframe" src="${escapeAttr(viewer)}" title="${escapeAttr(screen.title)}" allowfullscreen></iframe>
      </div>`;
    stage.appendChild(wrap);

    const frame = wrap.querySelector('.stage-pdf-frame');
    const fsBtn = wrap.querySelector('[data-action="fullscreen"]');
    if (fsBtn && frame) {
      fsBtn.addEventListener('click', () => {
        if (document.fullscreenElement) { document.exitFullscreen(); return; }
        if (frame.requestFullscreen) frame.requestFullscreen();
      });
    }
  }

  async function renderDocument(stage, screen) {
    if (typeof window.mammoth === 'undefined') {
      stage.innerHTML = '<p class="stage-loading">Document renderer is loading&hellip;</p>';
      await waitForMammoth();
    }
    const wrap = document.createElement('div');
    wrap.className = 'stage-doc';
    wrap.innerHTML = `
      <div class="stage-doc-toolbar">
        <button type="button" class="btn btn-secondary" data-action="print">🖨 Print</button>
        <a class="btn btn-secondary" href="${escapeAttr(screen.src)}" download>Download Word</a>
      </div>
      <div class="stage-doc-inner"><p class="stage-loading">Rendering document&hellip;</p></div>`;
    stage.appendChild(wrap);
    const inner = wrap.querySelector('.stage-doc-inner');
    wrap.querySelector('[data-action="print"]').addEventListener('click', () => {
      printWorksheet(screen, inner);
    });

    try {
      /* Admin CMS edit wins over the source .docx — same override key
         (screen.src) the HTML-screen renderer uses, so a worksheet edited
         in the admin shows here immediately. The override is a full HTML
         doc; pull its .page / body, then run the normal enhancer. */
      const cmsOverride = window.MatrixCMS ? window.MatrixCMS.getHtmlOverride(screen.src) : null;
      let html;
      if (cmsOverride != null) {
        const odoc = new DOMParser().parseFromString(cmsOverride, 'text/html');
        const opage = odoc.querySelector('.page');
        html = enhanceWorksheetHtml(opage ? opage.innerHTML : (odoc.body ? odoc.body.innerHTML : cmsOverride));
      } else {
        html = docCache.get(screen.src);
        if (!html) {
          const res = await fetch(screen.src);
          if (!res.ok) throw new Error('Could not load file (HTTP ' + res.status + ')');
          const buf = await res.arrayBuffer();
          const result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
          html = enhanceWorksheetHtml(result.value || '');
          docCache.set(screen.src, html);
        }
      }
      inner.innerHTML = html;
      /* Wire Hint Seeker — first reveal of any hints section in this
         worksheet unlocks the achievement. */
      inner.querySelectorAll('details.hints-details').forEach((d) => {
        d.addEventListener('toggle', function onToggle() {
          if (d.open && window.Gamify && typeof window.Gamify.markHintRevealed === 'function') {
            window.Gamify.markHintRevealed();
          }
        });
      });
    } catch (err) {
      inner.innerHTML = `<p style="color:var(--warn);">Could not render document: ${escapeHtml(err.message)}</p>`;
    }
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

    parts.push('<span class="meta-field"><span class="meta-k">Type:</span> ' + escapeHtml(screen.type.toUpperCase()) + '</span>');

    const isUrl = /^https?:/i.test(screen.src || '');
    const asset = screen.src ? (isUrl ? shortUrl(screen.src) : filename(screen.src)) : '';
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

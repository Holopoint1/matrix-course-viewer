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
    completeBtn: document.getElementById('complete-btn'),
    bundleBtn: document.getElementById('bundle-btn')
  };

  let course = null;
  let currentIndex = 0;
  const docCache = new Map();

  /* ---------- Time tracker ---------- */
  const timeTracker = (function () {
    const SAVE_INTERVAL_MS = 15000;
    const KEY_PREFIX = 'matrix-lms:time:';
    let trackingCourseId = null;
    let trackingScreenId = null;
    let segmentStartedAt = null;
    let intervalId = null;

    function start(cId, sId) {
      stop();
      trackingCourseId = cId;
      trackingScreenId = sId;
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
      const elapsedSec = Math.floor((Date.now() - segmentStartedAt) / 1000);
      if (elapsedSec < 1) return;
      addSeconds(trackingCourseId, trackingScreenId, elapsedSec);
      segmentStartedAt = Date.now();
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
    wrap.style.cssText = 'position:fixed;top:-99999px;left:-99999px;width:794px;background:#fff;font-family:"Segoe UI", Calibri, Arial, sans-serif;color:#1a1a2e;font-size:11pt;line-height:1.55;padding:30px 40px;';
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
    btn.querySelector('span').textContent = 'Building PDF…';

    /* Hidden offscreen container; html2pdf will render from it */
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;top:-99999px;left:-99999px;width:794px;background:#fff;font-family:"Segoe UI", Calibri, Arial, sans-serif;color:#1a1a2e;font-size:11pt;line-height:1.55;';
    document.body.appendChild(wrap);

    /* Cover */
    const cover = document.createElement('div');
    cover.style.cssText = 'padding:120px 60px 60px;text-align:center;';
    cover.innerHTML = `
      <div style="font-size:0.85rem;letter-spacing:3px;color:#7c3aed;font-weight:700;">${escapeHtml(course.code)}</div>
      <h1 style="font-family:'Segoe UI',Inter,Arial,sans-serif;font-size:34pt;color:#1e1b4b;margin:8px 0 20px;font-weight:800;">${escapeHtml(course.title)}</h1>
      <p style="color:#5d5b78;font-size:13pt;margin:0 auto;max-width:520px;">${escapeHtml(course.shortDescription || '')}</p>
      <p style="margin-top:80px;font-size:10pt;color:#8a87a6;">Combined worksheets bundle &middot; ${documents.length} worksheets</p>
      <p style="margin-top:8px;font-size:9pt;color:#8a87a6;">Generated ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    `;
    wrap.appendChild(cover);

    /* Each worksheet on a fresh page */
    for (let i = 0; i < documents.length; i++) {
      const screen = documents[i];
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
        const sec = document.createElement('div');
        sec.style.cssText = 'page-break-before:always;padding:30px 40px;';
        sec.innerHTML =
          '<div style="font-size:0.78rem;letter-spacing:2px;color:#7c3aed;text-transform:uppercase;font-weight:700;">' +
          escapeHtml(course.code) + ' &middot; Worksheet ' + (i + 1) +
          '</div>' +
          '<h1 style="font-family:\'Segoe UI\',Inter,Arial,sans-serif;font-size:20pt;color:#1e1b4b;margin:6px 0 18px;">' +
          escapeHtml(screen.title) + '</h1>' +
          html;
        wrap.appendChild(sec);
      } catch (err) {
        const sec = document.createElement('div');
        sec.style.cssText = 'page-break-before:always;padding:30px;color:#b45309;';
        sec.textContent = 'Could not render ' + screen.title + ' (' + err.message + ')';
        wrap.appendChild(sec);
      }
    }

    try {
      await window.html2pdf()
        .set({
          margin: [10, 12, 14, 12],
          filename: course.code + '-worksheets.pdf',
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 1.6, letterRendering: true, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        })
        .from(wrap)
        .save();
    } catch (err) {
      console.error(err);
      alert('PDF generation failed: ' + err.message);
    } finally {
      wrap.remove();
      btn.disabled = false;
      btn.querySelector('span').textContent = originalLabel;
    }
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
    if (els.nextBtn) els.nextBtn.disabled = idx === course.screens.length - 1;
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
        renderDownload(stage, screen);
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
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${id}`;
    iframe.title = screen.title;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    stage.appendChild(iframe);
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
          <a class="btn btn-secondary" href="${safeSrc}" target="_blank" rel="noopener">↗ Open in new tab</a>
          <a class="btn btn-secondary" href="${safeSrc}" download>Download</a>
        </div>
      </div>
      <div class="stage-pdf-frame">
        <iframe class="stage-pdf-iframe" src="${safeSrc}#view=FitH" referrerpolicy="no-referrer" title="${escapeAttr(screen.title)}"></iframe>
        <object class="stage-pdf-object" data="${safeSrc}" type="application/pdf" hidden>
          <embed src="${safeSrc}" type="application/pdf" />
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
  }

  async function renderHtmlContent(stage, screen) {
    if (screen.external || /^https?:/i.test(screen.src || '')) {
      return renderIframe(stage, screen.src);
    }
    const wrap = document.createElement('div');
    wrap.className = 'stage-doc';
    wrap.innerHTML = '<div class="stage-doc-inner"><p class="stage-loading">Loading&hellip;</p></div>';
    stage.appendChild(wrap);
    const inner = wrap.querySelector('.stage-doc-inner');
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

    /* 4. Promote pseudo-headings */
    const patterns = [
      { tag: 'h1', cls: 'doc-h1', re: /^(Homework\s*\d+|Assessment\s*\d+|Project|Assessment marking schemes)$/i },
      { tag: 'h2', cls: 'doc-section design-brief',  re: /^Design brief:?$/i },
      { tag: 'h2', cls: 'doc-section hardware',      re: /^Hardware:?$/i },
      { tag: 'h2', cls: 'doc-section software',      re: /^Software:?$/i },
      { tag: 'h2', cls: 'doc-section challenges',    re: /^Challenges:?$/i },
      { tag: 'h2', cls: 'doc-section hints',         re: /^Hints:?$/i },
      { tag: 'h2', cls: 'doc-section over-to-you',   re: /^Over to you:?$/i },
      { tag: 'h2', cls: 'doc-section risk',          re: /^Technical risk:?$/i }
    ];

    Array.from(root.querySelectorAll('p')).forEach((p) => {
      const text = (p.textContent || '').trim();
      if (!text) return;
      for (const pat of patterns) {
        if (pat.re.test(text)) {
          const tag = parsed.createElement(pat.tag);
          tag.className = pat.cls;
          tag.textContent = text;
          p.replaceWith(tag);
          return;
        }
      }
    });

    /* 4b. Collapse the Hints section into a click-to-reveal <details>.
       The .doc-section.hints h2 becomes the <summary>; every following
       sibling up to the next h1/h2 (or end of section) becomes the body.
       app.js attaches a one-shot listener after this HTML is mounted so
       the first reveal unlocks the Hint Seeker achievement. */
    Array.from(root.querySelectorAll('h2.hints')).forEach((h) => {
      const det = parsed.createElement('details');
      det.className = 'hints-details';
      const sum = parsed.createElement('summary');
      sum.className = 'hints-summary';
      sum.innerHTML = '<span class="hints-summary-ico">💡</span><span>Hints (click to reveal)</span>';
      det.appendChild(sum);
      /* Move siblings into the details until the next h1/h2 boundary. */
      let n = h.nextElementSibling;
      while (n && !/^H[12]$/.test(n.tagName)) {
        const next = n.nextElementSibling;
        det.appendChild(n);
        n = next;
      }
      h.replaceWith(det);
    });

    /* 5. Group consecutive bullet-like paragraphs after a hardware/topics heading into a list */
    Array.from(root.querySelectorAll('h2.hardware, h1.doc-h1')).forEach((h) => {
      const collected = [];
      let n = h.nextElementSibling;
      while (n && n.tagName === 'P') {
        const txt = (n.textContent || '').trim();
        if (!txt || txt.length > 90) break;
        if (/^(Design brief|Hardware|Software|Challenges|Hints|Over to you|Technical risk):?$/i.test(txt)) break;
        collected.push(n);
        n = n.nextElementSibling;
      }
      if (collected.length >= 2) {
        const ul = parsed.createElement('ul');
        ul.className = 'doc-list';
        collected.forEach((p) => {
          const li = parsed.createElement('li');
          li.innerHTML = p.innerHTML;
          ul.appendChild(li);
          p.remove();
        });
        h.after(ul);
      }
    });

    return root.innerHTML;
  }

  function renderDownload(stage, screen) {
    const wrap = document.createElement('div');
    wrap.className = 'stage-pptx';
    const label = screen.type === 'powerpoint' ? 'PowerPoint file' : 'Spreadsheet file';
    wrap.innerHTML = `
      <h2>${escapeHtml(screen.title)}</h2>
      <p style="color:var(--muted);max-width:520px;">${label} cannot be rendered inline in the browser. Download it to view.</p>
      <a class="btn btn-primary" href="${escapeAttr(screen.src)}" download>Download</a>
    `;
    stage.appendChild(wrap);
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
        <a class="btn btn-secondary" href="${escapeAttr(screen.src)}" download>Download as Word</a>
        <button type="button" class="btn btn-secondary" data-action="download-pdf">Download as PDF</button>
      </div>
      <div class="stage-doc-inner"><p class="stage-loading">Rendering document&hellip;</p></div>`;
    stage.appendChild(wrap);
    const inner = wrap.querySelector('.stage-doc-inner');
    wrap.querySelector('[data-action="download-pdf"]').addEventListener('click', (ev) => {
      downloadSingleAsPdf(screen, inner, ev.currentTarget);
    });

    try {
      let html = docCache.get(screen.src);
      if (!html) {
        const res = await fetch(screen.src);
        if (!res.ok) throw new Error('Could not load file (HTTP ' + res.status + ')');
        const buf = await res.arrayBuffer();
        const result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
        html = enhanceWorksheetHtml(result.value || '');
        docCache.set(screen.src, html);
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
    const parts = [];
    parts.push('<span class="meta-type">' + escapeHtml(screen.type.toUpperCase()) + '</span>');
    if (screen.hours) parts.push('<span class="meta-hours">' + escapeHtml(String(screen.hours)) + ' hr</span>');
    if (screen.equipment) parts.push('<span class="meta-equip">' + escapeHtml(screen.equipment) + '</span>');
    const fname = screen.src ? filename(screen.src) : '';
    if (fname && !/^https?:/i.test(screen.src)) {
      parts.push('<span class="meta-file"><code>' + escapeHtml(fname) + '</code></span>');
    } else if (/^https?:/i.test(screen.src)) {
      parts.push('<span class="meta-file"><code>' + escapeHtml(shortUrl(screen.src)) + '</code></span>');
    }
    return parts.join(' · ');
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
})();

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const courseId = params.get('id');

  if (!courseId) {
    location.replace('index.html');
    return;
  }

  const els = {
    courseCode: document.getElementById('course-code'),
    courseTitle: document.getElementById('course-title'),
    screenList: document.getElementById('screen-list'),
    progressBar: document.getElementById('progress-bar'),
    progressCompleted: document.getElementById('progress-completed'),
    progressTotal: document.getElementById('progress-total'),
    progressPercent: document.getElementById('progress-percent'),
    certificateCta: document.getElementById('certificate-cta'),
    certificateLink: document.getElementById('certificate-link'),
    screenTitle: document.getElementById('screen-title'),
    screenMeta: document.getElementById('screen-meta'),
    screenStage: document.getElementById('screen-stage'),
    prevBtn: document.getElementById('prev-btn'),
    completeBtn: document.getElementById('complete-btn')
  };

  let course = null;
  let currentIndex = 0;
  const docCache = new Map();

  init();

  async function init() {
    try {
      const res = await fetch('data/courses.json');
      const data = await res.json();
      course = data.courses.find((c) => c.id === courseId);
      if (!course) throw new Error('Course not found: ' + courseId);
    } catch (err) {
      els.screenStage.innerHTML = '<p class="stage-loading">Could not load course. ' + err.message + '</p>';
      return;
    }

    document.title = course.title + ' | Matrix Course Viewer';
    els.courseCode.textContent = course.code;
    els.courseTitle.textContent = course.title;
    els.progressTotal.textContent = course.screens.length;

    if (course.certificate && course.certificate.enabled) {
      els.certificateLink.href = 'certificate.html?id=' + encodeURIComponent(course.id);
    }

    renderSidebar();
    renderProgress();

    const startIndex = restoreLastIndex();
    showScreen(startIndex);

    els.prevBtn.addEventListener('click', () => {
      if (currentIndex > 0) showScreen(currentIndex - 1);
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
  }

  function renderSidebar() {
    els.screenList.innerHTML = '';
    course.screens.forEach((screen, idx) => {
      const li = document.createElement('li');
      li.className = 'screen-item';
      li.dataset.index = String(idx);
      if (screen.missing) li.classList.add('missing');
      if (isComplete(screen.id)) li.classList.add('completed');
      li.innerHTML = `
        <button type="button" class="screen-checkbox" aria-label="Toggle complete"></button>
        <span class="screen-title">${escapeHtml(screen.title)}</span>
        <span class="screen-type-badge ${screen.type}">${screen.type}</span>
      `;
      li.addEventListener('click', () => showScreen(idx));
      li.querySelector('.screen-checkbox').addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleComplete(screen.id);
      });
      els.screenList.appendChild(li);
    });
  }

  function showScreen(idx) {
    currentIndex = idx;
    persistLastIndex(idx);
    const screen = course.screens[idx];

    Array.from(els.screenList.children).forEach((node) => node.classList.remove('active'));
    const active = els.screenList.children[idx];
    if (active) {
      active.classList.add('active');
      active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    els.screenTitle.textContent = screen.title;
    els.screenMeta.textContent = formatMeta(screen);
    els.prevBtn.disabled = idx === 0;
    updateCompleteButton();

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
      stage.innerHTML = `
        <div class="stage-missing">
          <span class="badge">Asset not yet available</span>
          <h2>${escapeHtml(screen.title)}</h2>
          <p>This screen is defined in the course outline but the source file <code>${escapeHtml(filename(screen.src))}</code> has not yet been added.</p>
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
        renderIframe(stage, screen.src);
        return;
      case 'html':
        renderIframe(stage, screen.src);
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
      </div>
      <div class="stage-doc-inner"><p class="stage-loading">Rendering document&hellip;</p></div>`;
    stage.appendChild(wrap);
    const inner = wrap.querySelector('.stage-doc-inner');

    try {
      let html = docCache.get(screen.src);
      if (!html) {
        const res = await fetch(screen.src);
        if (!res.ok) throw new Error('Could not load file (HTTP ' + res.status + ')');
        const buf = await res.arrayBuffer();
        const result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
        html = result.value || '';
        docCache.set(screen.src, html);
      }
      inner.innerHTML = html;
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
    parts.push(screen.type.toUpperCase());
    if (screen.hours) parts.push(screen.hours + ' hr');
    if (screen.equipment) parts.push(screen.equipment);
    return parts.join(' · ');
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
    if (value) {
      if (!p[screenId]) p[screenId] = { ts: Date.now() };
    } else {
      delete p[screenId];
    }
    saveProgress(p);
    const idx = course.screens.findIndex((s) => s.id === screenId);
    const li = els.screenList.querySelector(`[data-index="${idx}"]`);
    if (li) li.classList.toggle('completed', value);
    renderProgress();
    if (idx === currentIndex) updateCompleteButton();
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
    els.progressBar.style.width = pct + '%';
    els.progressCompleted.textContent = String(completed);
    els.progressTotal.textContent = String(total);
    els.progressPercent.textContent = pct + '%';

    if (course.certificate && course.certificate.enabled && completed === total && total > 0) {
      els.certificateCta.hidden = false;
    } else {
      els.certificateCta.hidden = true;
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

/* ============================================================================
 * tools.js — Matrix Course Viewer "Tools" page controller
 *
 * Wires the five tool panels to the in-browser modules:
 *   Splitter    → window.MatrixSplitter   (assets/splitter-core.js)
 *   Definition  → window.MatrixDefinition (assets/definition-parser.js)
 *   Course files / Exports  → local logic here
 * Nothing is uploaded — all work happens client-side.
 * ==========================================================================*/
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function dropzone(el, onFiles) {
    ['dragenter', 'dragover'].forEach(function (ev) {
      el.addEventListener(ev, function (e) { e.preventDefault(); el.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      el.addEventListener(ev, function (e) { e.preventDefault(); el.classList.remove('drag'); });
    });
    el.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) onFiles(Array.from(files));
    });
  }

  /* ---------- Tab switching (+ deep-link via #hash) ----------
     `files.html#compiler` (or any #<tab>) opens that tab directly — used by
     the Admin "Worksheet compiler" link and the old standalone-page redirect. */
  var tabs = Array.from(document.querySelectorAll('.tool-tab'));
  var toolAnchor = document.querySelector('.tool-tabs') || document.querySelector('.files-section');
  function activateTab(name, scroll) {
    if (!name || !tabs.some(function (b) { return b.dataset.tab === name; })) return false;
    tabs.forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    document.querySelectorAll('.tool-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
    /* Switching used to feel jumpy: panels differ a lot in height, so
       clicking a tab while scrolled down left you stranded mid-page. On a
       user click, settle back to the (sticky) tab bar smoothly so every
       tool always opens from the same, predictable place. */
    if (scroll && toolAnchor && toolAnchor.scrollIntoView) {
      toolAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return true;
  }
  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      activateTab(btn.dataset.tab, true);
      /* replaceState only — never assign location.hash (that scrolls to a
         matching id and causes the jump the user reported). */
      if (history.replaceState) history.replaceState(null, '', '#' + btn.dataset.tab);
    });
  });
  function tabFromHash() { activateTab((location.hash || '').replace(/^#/, '').trim(), false); }
  tabFromHash();
  window.addEventListener('hashchange', tabFromHash);

  /* ---------- Worksheet preview (plain, mirrors app.js) ---------- */
  function enhancePlain(html) {
    var doc;
    try { doc = new DOMParser().parseFromString('<!DOCTYPE html><html><body>' + html + '</body></html>', 'text/html'); }
    catch (_) { return html; }
    var root = doc.body;
    if (!root) return html;
    Array.from(root.querySelectorAll('table')).forEach(function (table) {
      var cells = Array.from(table.querySelectorAll('td, th'));
      var filled = cells.map(function (c) { return (c.textContent || '').trim(); }).filter(Boolean);
      if (cells.length <= 16 && filled.length <= 8 && filled.every(function (t) { return t.length < 120; })) {
        var meta = doc.createElement('div');
        meta.className = 'worksheet-header';
        meta.innerHTML = filled.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
        table.replaceWith(meta);
      }
    });
    Array.from(root.querySelectorAll('a')).forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var m = href.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
      if (!m) return;
      var wrap = doc.createElement('div');
      wrap.className = 'inline-youtube';
      wrap.innerHTML = '<iframe src="https://www.youtube.com/embed/' + m[1] + '" allowfullscreen loading="lazy"></iframe>';
      a.replaceWith(wrap);
    });
    return root.innerHTML;
  }

  async function previewInto(body, file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    try {
      if (ext === 'docx') {
        var buf = await file.arrayBuffer();
        var r = await window.mammoth.convertToHtml({ arrayBuffer: buf });
        body.innerHTML = '<div class="stage-doc"><div class="stage-doc-inner">' + enhancePlain(r.value || '') + '</div></div>';
      } else if (ext === 'htm' || ext === 'html') {
        var text = await file.text();
        var hd = new DOMParser().parseFromString(text, 'text/html');
        var page = hd.querySelector('.page');
        var inner = page ? page.innerHTML : (hd.body ? hd.body.innerHTML : text);
        body.innerHTML = '<div class="stage-doc"><div class="stage-doc-inner">' + enhancePlain(inner) + '</div></div>';
      } else if (ext === 'pdf') {
        body.innerHTML = '<iframe class="preview-iframe" src="' + URL.createObjectURL(file) + '"></iframe>';
      } else {
        body.innerHTML = '<p class="stage-loading">No inline preview for .' + esc(ext) + '</p>';
      }
    } catch (err) {
      body.innerHTML = '<p style="padding:1.4rem;color:var(--warn)">Preview failed: ' + esc(err.message) + '</p>';
    }
  }

  async function exportPdf(bodyEl, name, btn) {
    if (!window.html2pdf) { alert('PDF library not loaded yet — refresh and retry.'); return; }
    if (!bodyEl || !bodyEl.innerHTML.trim()) { alert('Wait for the preview to render.'); return; }
    var orig = btn.textContent; btn.disabled = true; btn.textContent = 'Building…';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;top:-99999px;left:-99999px;width:794px;background:#fff;font-family:\'Segoe UI\',Calibri,Arial,sans-serif;color:#1a1a2e;font-size:11pt;line-height:1.55;padding:30px 40px;';
    wrap.innerHTML = '<h1 style="font-size:22pt;color:#1e1b4b;margin:0 0 18px;font-weight:800;">' + esc(name.replace(/\.[a-z0-9]+$/i, '')) + '</h1>' + bodyEl.innerHTML;
    document.body.appendChild(wrap);
    try {
      await window.html2pdf().set({
        margin: [10, 12, 14, 12],
        filename: name.replace(/\.[a-z0-9]+$/i, '') + '.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 1.6, letterRendering: true, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4' }
      }).from(wrap).save();
    } catch (err) { alert('PDF generation failed: ' + err.message); }
    finally { wrap.remove(); btn.disabled = false; btn.textContent = orig; }
  }

  /* ====================================================================== *
   *  SPLITTER
   * ====================================================================== */
  var splitState = { analysis: null, sourceName: '', mediaCount: 0 };

  function setSplitStatus(html, kind) {
    var el = $('split-status');
    el.hidden = false;
    el.className = 'split-status' + (kind ? ' ' + kind : '');
    el.innerHTML = html;
  }

  async function onSplitSource(file) {
    if (!/\.docx$/i.test(file.name)) { setSplitStatus('Please choose a Word <code>.docx</code> file.', 'err'); return; }
    setSplitStatus('Reading <strong>' + esc(file.name) + '</strong>…');
    try {
      var analysis = await window.MatrixSplitter.loadSource(file);
      splitState.analysis = analysis;
      splitState.sourceName = file.name;
      var ready = analysis.blocks.filter(function (b) { return b.filename; }).length;
      var errs = analysis.warnings.filter(function (w) { return w.level === 'danger'; }).length;
      var idGuess = (file.name.match(/\b(C[OP]\d{3,4})\b/i) || [])[1] || '';
      if (idGuess) $('split-course-id').value = idGuess.toUpperCase();
      setSplitStatus(
        '<strong>' + esc(file.name) + '</strong> — ' + analysis.blocks.length + ' block(s), ' +
        ready + ' ready' + (errs ? ', <span class="x">' + errs + ' error(s)</span>' : '') + '.', errs ? 'warn' : 'ok'
      );
      $('split-actions').hidden = false;
    } catch (err) {
      setSplitStatus('Could not read the document: ' + esc(err.message), 'err');
    }
  }

  async function onSplitMedia(input) {
    try {
      await window.MatrixSplitter.loadMedia(input);
      var bundle = window.MatrixSplitter.getMediaBundle() || [];
      splitState.mediaCount = bundle.length;
      $('media-status').textContent = bundle.length + ' media file(s) loaded';
      $('media-status').classList.add('ok');
    } catch (err) {
      $('media-status').textContent = 'Media load failed: ' + err.message;
    }
  }

  function renderSplitResults(artefacts) {
    var card = $('split-results-card');
    var list = $('split-results');
    card.hidden = false;
    list.innerHTML = '';
    var an = splitState.analysis;
    var wEl = $('split-warnings');
    var allW = an ? (an.warnings || []).concat(an.media ? an.media.warnings || [] : []) : [];
    wEl.innerHTML = allW.length
      ? allW.map(function (w) {
          return '<div class="split-warn ' + (w.level === 'danger' ? 'err' : '') + '"><strong>' +
            esc(w.title) + '</strong> ' + esc(w.detail) + '</div>';
        }).join('')
      : '';
    if (!artefacts.length) { list.innerHTML = '<p class="stage-loading">No output files were generated.</p>'; return; }
    artefacts.forEach(function (art, i) {
      var id = 'art-' + i;
      var card2 = document.createElement('article');
      card2.className = 'preview-card';
      card2.innerHTML =
        '<header class="preview-card-head"><div>' +
        '<span class="preview-card-type ' + (art.tagType.toLowerCase() === 'html' ? 'html' : 'document') + '">' + esc(art.tagType) + '</span> ' +
        '<span class="preview-card-name">' + esc(art.filename) + '</span> ' +
        '<span class="preview-card-size">' + esc(art.status || '') + '</span></div>' +
        '<div class="preview-card-actions">' +
        '<button class="btn btn-secondary" type="button" data-act="dl">↓ Download</button>' +
        '<button class="btn btn-ghost" type="button" data-act="tog">Preview</button>' +
        '</div></header>' +
        '<div class="preview-card-body" id="' + id + '" hidden></div>';
      list.appendChild(card2);
      card2.querySelector('[data-act="dl"]').addEventListener('click', function () {
        if (art.blob) download(art.blob, art.filename);
        else if (art.content != null) download(new Blob([art.content], { type: art.mime || 'text/html' }), art.filename);
      });
      card2.querySelector('[data-act="tog"]').addEventListener('click', async function () {
        var b = $(id);
        if (!b.hidden) { b.hidden = true; return; }
        b.hidden = false;
        if (b.dataset.done) return;
        b.dataset.done = '1';
        if (art.content != null) {
          var hd = new DOMParser().parseFromString(art.content, 'text/html');
          var page = hd.querySelector('.page');
          b.innerHTML = '<div class="stage-doc"><div class="stage-doc-inner">' +
            enhancePlain(page ? page.innerHTML : art.content) + '</div></div>';
        } else if (art.blob) {
          try {
            var buf = await art.blob.arrayBuffer();
            var r = await window.mammoth.convertToHtml({ arrayBuffer: buf });
            b.innerHTML = '<div class="stage-doc"><div class="stage-doc-inner">' + enhancePlain(r.value || '') + '</div></div>';
          } catch (e) { b.innerHTML = '<p class="stage-loading">Preview unavailable.</p>'; }
        }
      });
    });
  }

  $('split-pick').addEventListener('click', function () { $('split-input').click(); });
  $('split-input').addEventListener('change', function (e) { if (e.target.files[0]) onSplitSource(e.target.files[0]); });
  dropzone($('split-drop'), function (files) {
    var docx = files.find(function (f) { return /\.docx$/i.test(f.name); });
    if (docx) onSplitSource(docx);
  });
  $('media-pick-folder').addEventListener('click', function () { $('media-folder-input').click(); });
  $('media-pick-zip').addEventListener('click', function () { $('media-zip-input').click(); });
  $('media-folder-input').addEventListener('change', function (e) {
    if (e.target.files.length) onSplitMedia(Array.from(e.target.files));
  });
  $('media-zip-input').addEventListener('change', function (e) {
    if (e.target.files[0]) onSplitMedia(e.target.files[0]);
  });

  $('split-build').addEventListener('click', async function () {
    if (!splitState.analysis) { setSplitStatus('Load a content document first.', 'err'); return; }
    var btn = this; btn.disabled = true; var t = btn.textContent; btn.textContent = 'Building…';
    try {
      var artefacts = await window.MatrixSplitter.build();
      renderSplitResults(artefacts);
      $('split-bundle').disabled = false;
      $('split-lms-zip').disabled = false;
      setSplitStatus(artefacts.length + ' file(s) generated.', 'ok');
    } catch (err) {
      setSplitStatus('Build failed: ' + esc(err.message), 'err');
    } finally { btn.disabled = false; btn.textContent = t; }
  });

  $('split-bundle').addEventListener('click', function () { window.MatrixSplitter.downloadBundle(); });

  $('split-lms-zip').addEventListener('click', async function () {
    var artefacts = window.MatrixSplitter.getArtefacts();
    if (!artefacts || !artefacts.length) { alert('Build the outputs first.'); return; }
    var id = ($('split-course-id').value || '').trim().toUpperCase();
    if (!id) { alert('Enter the LMS course id (e.g. CP4807) so files land in content/<id>/.'); return; }
    var zip = new JSZip();
    var dir = 'content/' + id + '/';
    for (var i = 0; i < artefacts.length; i++) {
      var a = artefacts[i];
      if (a.blob) zip.file(dir + a.filename, a.blob);
      else if (a.content != null) zip.file(dir + a.filename, a.content);
    }
    var media = window.MatrixSplitter.getMediaBundle() || [];
    media.forEach(function (m) { zip.file(dir + m.exportName, m.data); });
    zip.file('README.txt',
      'Matrix LMS drop-in for ' + id + '\n\nUnzip into the lms/ folder. Files land in ' + dir +
      '\nThis only ADDS / REPLACES files — nothing is deleted.\n\n' +
      artefacts.map(function (a) { return '- ' + dir + a.filename; }).join('\n') +
      (media.length ? '\n' + media.map(function (m) { return '- ' + dir + m.exportName; }).join('\n') : '') + '\n');
    var blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    download(blob, id + '-lms-dropin.zip');
  });

  /* ====================================================================== *
   *  DEFINITION
   * ====================================================================== */
  async function onDefinition(file) {
    if (!/\.docx$/i.test(file.name)) { alert('Please choose the definition .docx file.'); return; }
    try {
      var d = await window.MatrixDefinition.parseFile(file);
      $('def-out').hidden = false;
      var bits = [
        ['Course', d.courseId || '(unknown)'],
        ['Kind', d.kind],
        [d.kind === 'pack' ? 'Documents' : 'Screens', d.kind === 'pack' ? d.packDocs.length : d.screens.length]
      ];
      if (d.certificate) bits.push(['Certificate', d.certificate.file]);
      $('def-meta').innerHTML = bits.map(function (b) {
        return '<span class="def-chip"><strong>' + esc(b[0]) + ':</strong> ' + esc(b[1]) + '</span>';
      }).join('') +
        (d.warnings.length ? '<div class="split-warn">' + d.warnings.map(esc).join('<br>') + '</div>' : '');
      $('def-structure').value = d.structureText;
      var screensCard = $('def-screens-card');
      if (d.kind === 'pack') {
        screensCard.hidden = true;
      } else {
        screensCard.hidden = false;
        $('def-screens').value = d.screensJson;
      }
    } catch (err) {
      alert('Could not read the definition: ' + err.message);
    }
  }
  $('def-pick').addEventListener('click', function () { $('def-input').click(); });
  $('def-input').addEventListener('change', function (e) { if (e.target.files[0]) onDefinition(e.target.files[0]); });
  dropzone($('def-drop'), function (files) {
    var f = files.find(function (x) { return /\.docx$/i.test(x.name); });
    if (f) onDefinition(f);
  });
  function copyFrom(taId, btn) {
    var ta = $(taId);
    navigator.clipboard.writeText(ta.value).then(function () {
      var o = btn.textContent; btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = o; }, 1400);
    }, function () { ta.select(); document.execCommand('copy'); });
  }
  $('def-copy-structure').addEventListener('click', function () { copyFrom('def-structure', this); });
  $('def-copy-screens').addEventListener('click', function () { copyFrom('def-screens', this); });

  /* ====================================================================== *
   *  COURSE FILES (scoped, per-course)
   * ====================================================================== */
  var coursesData = null;

  async function loadCourses() {
    if (coursesData) return coursesData;
    coursesData = await fetch('data/courses.json').then(function (r) { return r.json(); });
    return coursesData;
  }

  async function initCourseFiles() {
    var data = await loadCourses();
    var sel = $('cf-course');
    sel.innerHTML = data.courses.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.id) + ' — ' + esc(c.title) + '</option>';
    }).join('');
    sel.addEventListener('change', scanCourse);
    $('cf-rescan').addEventListener('click', scanCourse);
    scanCourse();
  }

  async function scanCourse() {
    var data = await loadCourses();
    var id = $('cf-course').value;
    var course = data.courses.find(function (c) { return c.id === id; });
    var tree = $('cf-tree');
    if (!course) { tree.innerHTML = '<p class="stage-loading">No course.</p>'; return; }

    var sc = course.screens || [];
    var totalH = sc.reduce(function (s, x) { return s + (Number(x.hours) || 0); }, 0);
    $('cf-structure').innerHTML =
      '<span class="def-chip"><strong>' + esc(course.id) + ':</strong> ' + esc(course.title) + '</span>' +
      '<span class="def-chip"><strong>Screens:</strong> ' + sc.length + '</span>' +
      '<span class="def-chip"><strong>Time:</strong> ' + (Number.isInteger(totalH) ? totalH : totalH.toFixed(1)) + ' h</span>' +
      (course.certificate && course.certificate.enabled ? '<span class="def-chip">★ Certificate</span>' : '');

    var entries = [];
    sc.forEach(function (s) {
      if (s.src && !/^https?:/i.test(s.src)) entries.push({ path: s.src, type: s.type, title: s.title });
      if (s.thumbnail) entries.push({ path: s.thumbnail, type: 'image', title: s.title + ' (thumb)' });
    });
    if (!entries.length) { tree.innerHTML = '<p class="stage-loading">No local files referenced (URL screens only).</p>'; return; }

    tree.innerHTML = '<p class="stage-loading">Scanning ' + entries.length + ' file(s)…</p>';
    await Promise.all(entries.map(async function (e) {
      try {
        var res = await fetch(e.path, { method: 'HEAD', cache: 'no-store' });
        e.status = res.ok ? 'ok' : 'missing';
        e.size = Number(res.headers.get('content-length') || 0) || null;
      } catch (_) { e.status = 'missing'; }
    }));

    tree.innerHTML = '<ul class="files-folder-list">' + entries.map(function (e) {
      return '<li class="files-row files-row-' + e.status + '">' +
        '<span class="files-row-icon">' + (e.status === 'ok' ? '✓' : '✗') + '</span>' +
        '<div class="files-row-body"><div class="files-row-name"><code>' + esc(e.path) + '</code></div>' +
        '<div class="files-row-meta">' + esc(e.type) + ' · ' + esc(e.title) + '</div></div>' +
        '<span class="files-row-action">' + (e.status === 'ok' && e.size ? '<span class="files-row-size">' + fmtSize(e.size) + '</span>' : (e.status === 'missing' ? '<span class="files-status missing">missing</span>' : '')) + '</span>' +
        '</li>';
    }).join('') + '</ul>';
  }

  /* ====================================================================== *
   *  EXPORTS
   * ====================================================================== */
  function addExport(file) {
    var list = $('exp-list');
    var card = document.createElement('article');
    card.className = 'preview-card';
    var bodyId = 'exp-' + Math.random().toString(36).slice(2, 8);
    var isDocx = /\.docx$/i.test(file.name);
    card.innerHTML =
      '<header class="preview-card-head"><div>' +
      '<span class="preview-card-name">' + esc(file.name) + '</span> ' +
      '<span class="preview-card-size">' + fmtSize(file.size) + '</span></div>' +
      '<div class="preview-card-actions">' +
      (isDocx ? '<button class="btn btn-secondary" data-act="word" type="button">Save Word copy</button>' : '') +
      '<button class="btn btn-secondary" data-act="pdf" type="button">Download as PDF</button>' +
      '<button class="btn btn-ghost" data-act="rm" type="button" aria-label="Remove">×</button>' +
      '</div></header>' +
      '<div class="preview-card-body" id="' + bodyId + '"><p class="stage-loading">Rendering…</p></div>';
    list.appendChild(card);
    var body = $(bodyId);
    previewInto(body, file);
    card.querySelector('[data-act="rm"]').addEventListener('click', function () { card.remove(); });
    card.querySelector('[data-act="pdf"]').addEventListener('click', function (e) {
      exportPdf(body, file.name, e.currentTarget);
    });
    var wbtn = card.querySelector('[data-act="word"]');
    if (wbtn) wbtn.addEventListener('click', function () { download(file, file.name); });
  }
  $('exp-pick').addEventListener('click', function () { $('exp-input').click(); });
  $('exp-input').addEventListener('change', function (e) { Array.from(e.target.files).forEach(addExport); });
  dropzone($('exp-drop'), function (files) { files.forEach(addExport); });

  /* ====================================================================== *
   *  SCORM 1.2 EXPORT (client-side port of tools/build-scorm.js)
   * ====================================================================== */
  async function initScorm() {
    var data = await loadCourses();
    var sel = $('scorm-course');
    sel.innerHTML = data.courses.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.id) + ' — ' + esc(c.title) + '</option>';
    }).join('');
  }
  function scormStatus(html, kind) {
    var el = $('scorm-status');
    el.hidden = false;
    el.className = 'split-status' + (kind ? ' ' + kind : '');
    el.innerHTML = html;
  }
  /* SCORM tab is temporarily removed from the Tools page. The handler and
     initScorm()/scormStatus() are kept intact (just not bound/run) so the
     tab can be restored later by re-adding the panel markup only. */
  var scormBuildBtn = $('scorm-build');
  if (scormBuildBtn) scormBuildBtn.addEventListener('click', async function () {
    if (!window.MatrixScormExport) { scormStatus('SCORM exporter not loaded — refresh and retry.', 'err'); return; }
    var id = $('scorm-course').value;
    var btn = this; btn.disabled = true; var t = btn.textContent; btn.textContent = 'Building…';
    try {
      var res = await window.MatrixScormExport.build(id, function (msg) { scormStatus(esc(msg)); });
      download(res.blob, res.filename);
      var s = res.stats;
      scormStatus('✓ <strong>' + esc(res.filename) + '</strong> built — ' + s.screens +
        ' screen(s), ' + s.got + ' content file(s) included' +
        (s.miss ? ', <span class="x">' + s.miss + ' missing (placeholder shown in viewer)</span>' : '') + '.', 'ok');
    } catch (err) {
      scormStatus('Build failed: ' + esc(err.message), 'err');
    } finally { btn.disabled = false; btn.textContent = t; }
  });

  /* ====================================================================== *
   *  DATABASE — read-only download of the live (amended) course content
   *  from Supabase, zipped in the browser. No secret key: RLS allows
   *  public read, so this can never modify the project. (Replaced the
   *  old Google Drive tab.)
   * ====================================================================== */
  (function initDatabase() {
    var statusEl = $('cmsdb-status');
    if (!statusEl) return;                              /* panel not on page */
    var dlAll = $('cmsdb-dl-all'), dlOne = $('cmsdb-dl-one'),
        courseSel = $('cmsdb-course'), outEl = $('cmsdb-out');

    function getClient() {
      try {
        if (window.MatrixCMS && window.MatrixCMS.supabaseClient) return window.MatrixCMS.supabaseClient;
        if (window.supabase && window.MATRIX_SUPABASE)
          return window.supabase.createClient(window.MATRIX_SUPABASE.url,
            window.MATRIX_SUPABASE.publishableKey, { auth: { persistSession: false } });
      } catch (_) {}
      return null;
    }
    function out(msg, kind) {
      outEl.hidden = !msg;
      outEl.className = 'split-status' + (kind ? ' ' + kind : '');
      outEl.textContent = msg || '';
    }
    function safeRel(p) {
      return String(p == null ? 'untitled' : p).replace(/[^\w.\-/]+/g, '_').replace(/^\/+/, '');
    }
    function stamp() { return new Date().toISOString().slice(0, 10); }

    var cache = null;
    async function load() {
      var sb = getClient();
      if (!sb) throw new Error('Supabase client not available on this page.');
      var r = await Promise.all([
        sb.from('courses').select('*'),
        sb.from('screens').select('*'),
        sb.from('pages').select('*')
      ]);
      for (var i = 0; i < 3; i++) if (r[i].error) throw new Error(r[i].error.message);
      cache = { courses: r[0].data || [], screens: r[1].data || [], pages: r[2].data || [] };
      return cache;
    }
    function zipFrom(courses, screens, pages, name) {
      var zip = new JSZip();
      zip.file('courses.json', JSON.stringify(courses, null, 2));
      zip.file('screens.json', JSON.stringify(screens, null, 2));
      zip.file('pages.json', JSON.stringify(pages, null, 2));
      var hf = zip.folder('html');
      pages.forEach(function (p) {
        if (!p || p.path == null) return;
        hf.file(safeRel(p.path) + (/\.html?$/i.test(p.path) ? '' : '.html'), p.html || '');
      });
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
        .then(function (b) { download(b, name); });
    }

    (async function () {
      try {
        var d = await load();
        statusEl.className = 'split-status ok';
        statusEl.textContent = 'Connected ✓ — ' + d.courses.length + ' courses, ' +
          d.screens.length + ' screens, ' + d.pages.length + ' page bodies in the database.';
        courseSel.innerHTML = d.courses.slice()
          .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); })
          .map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.id) + ' — ' + esc(c.title || '') + '</option>'; })
          .join('');
        dlAll.disabled = false;
        dlOne.disabled = d.courses.length === 0;
      } catch (e) {
        statusEl.className = 'split-status err';
        statusEl.textContent = 'Database not reachable: ' + (e && e.message ? e.message : e) +
          '  (The live site still works — it falls back to the built-in content.)';
      }
    })();

    dlAll.addEventListener('click', async function () {
      var b = this, t = b.textContent; b.disabled = true; b.textContent = 'Building…';
      try {
        var d = cache || await load();
        await zipFrom(d.courses, d.screens, d.pages, 'matrix-courses-' + stamp() + '.zip');
        out('Downloaded all ' + d.courses.length + ' courses.', 'ok');
      } catch (e) { out('Download failed: ' + (e && e.message ? e.message : e), 'err'); }
      finally { b.disabled = false; b.textContent = t; }
    });

    dlOne.addEventListener('click', async function () {
      var id = courseSel.value;
      if (!id) return;
      var b = this, t = b.textContent; b.disabled = true; b.textContent = 'Building…';
      try {
        var d = cache || await load();
        var course = d.courses.filter(function (c) { return c.id === id; });
        var scr = d.screens.filter(function (s) { return s.course_id === id; });
        var paths = {};
        scr.forEach(function (s) { if (s.src) paths[s.src] = 1; });
        var pgs = d.pages.filter(function (p) { return p && paths[p.path]; });
        await zipFrom(course, scr, pgs, id + '-' + stamp() + '.zip');
        out('Downloaded ' + id + ' (' + scr.length + ' screens, ' + pgs.length + ' page bodies).', 'ok');
      } catch (e) { out('Download failed: ' + (e && e.message ? e.message : e), 'err'); }
      finally { b.disabled = false; b.textContent = t; }
    });
  })();

  /* ====================================================================== *
   *  COMPILER — merge many .docx into one continuously-paginated PDF.
   *  Moved here from the old standalone worksheet-compiler.html. Content is
   *  verbatim: each doc is rendered (mammoth → html2pdf), the parts are
   *  concatenated with pdf-lib and page-numbered. No cover pages.
   * ====================================================================== */
  (function initCompiler() {
    var drop = $('cmp-drop');
    if (!drop) return;                         /* panel not on page */
    var input = $('cmp-input'), pick = $('cmp-pick'), listEl = $('cmp-list');
    var compileBtn = $('cmp-compile'), compileDocxBtn = $('cmp-compile-docx'), clearBtn = $('cmp-clear');
    var statusEl = $('cmp-status'), progress = $('cmp-progress'), progressBar = $('cmp-progress-bar');
    var filenameInput = $('cmp-filename'), sandbox = $('cmp-sandbox');
    var defPick = $('cmp-def-pick'), defInput = $('cmp-def-input');
    var cFiles = [];

    /* The sandbox lives inside the Compiler tab panel, which is
       display:none whenever another tab is active — an off-flow element
       there has no layout and html2canvas renders BLANK. Re-parent it to
       <body> once so it always has layout (matches the proven
       downloadSingleAsPdf approach: absolute, off-screen, z-index:-1). */
    if (sandbox && sandbox.parentNode !== document.body) document.body.appendChild(sandbox);

    /* Pack lists — verbatim from the asset definition docs / master doc
       ("Please make me a single PDF/DOCX document consisting of …").
       Order, the duplicate CP4807-8 and the head/cont/TN entries are kept
       exactly as the source specifies. Missing files are skipped with a
       warning (same policy as the SCORM builder). */
    var PACKS = {
      CP4807: (function () {
        var a = ['content/CP4807/CP4807-head.docx', 'content/CP4807/CP4807-cont.docx'];
        for (var i = 1; i <= 12; i++) a.push('content/CP4807/CP4807-' + i + '.docx');
        a.push('content/CP4807/CP4807-TN.docx'); return a;
      })(),
      CP7244: [
        'content/CP7244/CP7244-head.docx', 'content/CP7244/CP7244-cont.docx',
        'content/CP4807/CP4807-1.docx', 'content/CP4807/CP4807-2.docx', 'content/CP4807/CP4807-3.docx',
        'content/CP4807/CP4807-4.docx', 'content/CP4807/CP4807-5.docx', 'content/CP4807/CP4807-6.docx',
        'content/CP4807/CP4807-7.docx', 'content/CP1972/CP1972-1.docx',
        'content/CP4807/CP4807-8.docx', 'content/CP4807/CP4807-8.docx',
        'content/CP1972/CP1972-2.docx', 'content/CP1972/CP1972-3.docx',
        'content/CP0507/CP0507-1.docx', 'content/CP0507/CP0507-2.docx', 'content/CP0507/CP0507-4.docx',
        'content/CP4807/TN-1.docx'
      ],
      CP2563: [
        'content/CP7244/CP2563-head.docx', 'content/CP7244/CP2563-cont.docx',
        'content/CP4807/CP4807-1.docx', 'content/CP4807/CP4807-2.docx', 'content/CP4807/CP4807-3.docx',
        'content/CP4807/CP4807-4.docx', 'content/CP4807/CP4807-5.docx', 'content/CP4807/CP4807-6.docx',
        'content/CP4807/CP4807-7.docx', 'content/CP1972/CP1972-1.docx',
        'content/CP4807/CP4807-8.docx', 'content/CP4807/CP4807-8.docx',
        'content/CP1972/CP1972-2.docx', 'content/CP1972/CP1972-3.docx',
        'content/CP1972/CP1972-4.docx', 'content/CP1972/CP1972-5.docx',
        'content/CP0507/CP0507-1.docx', 'content/CP0507/CP0507-2.docx',
        'content/CP0507/CP0507-3.docx', 'content/CP0507/CP0507-4.docx',
        'content/CP4807/TN-1.docx'
      ]
    };

    async function fetchAsFile(path) {
      try {
        var r = await fetch(path, { cache: 'no-store' });
        if (!r.ok) return null;
        var blob = await r.blob();
        return new File([blob], path.split('/').pop(),
          { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      } catch (e) { return null; }
    }
    async function loadList(paths, label) {
      compileBtn.disabled = compileDocxBtn.disabled = clearBtn.disabled = true;
      cStatus('Loading ' + paths.length + ' document(s)' + (label ? ' for ' + label : '') + '…');
      var got = 0, miss = [];
      for (var i = 0; i < paths.length; i++) {
        var f = await fetchAsFile(paths[i]);
        if (f) { cFiles.push(f); got++; } else { miss.push(paths[i].split('/').pop()); }
        cProgress(Math.round(((i + 1) / paths.length) * 100));
      }
      cRender(); cProgress(0); clearBtn.disabled = false;
      cStatus(got + ' loaded in order' +
        (miss.length ? ' · ' + miss.length + ' missing, skipped: ' + miss.join(', ') : '') + '.',
        miss.length ? 'warn' : 'ok');
    }

    /* Combine many .docx into ONE .docx using OOXML altChunk: each source
       is embedded whole and referenced by <w:altChunk>, so Word/LibreOffice
       inline every worksheet with its ORIGINAL formatting intact (lossless,
       no re-render). Page break between documents. */
    async function buildDocxAltChunk(files) {
      var JSZipRef = window.JSZip;
      var zip = new JSZipRef();
      var rels = [], body = [], ctOverrides = [];
      for (var i = 0; i < files.length; i++) {
        var n = i + 1, part = 'afchunk' + n + '.docx', rid = 'acId' + n;
        var buf = await files[i].arrayBuffer();
        zip.file('word/' + part, buf);
        rels.push('<Relationship Id="' + rid +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="' + part + '"/>');
        ctOverrides.push('<Override PartName="/word/' + part +
          '" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>');
        body.push('<w:altChunk r:id="' + rid + '"/>');
        if (i < files.length - 1) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      }
      zip.file('[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        ctOverrides.join('') + '</Types>');
      zip.file('_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>');
      zip.file('word/_rels/document.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        rels.join('') + '</Relationships>');
      zip.file('word/document.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<w:body>' + body.join('') + '<w:sectPr/></w:body></w:document>');
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    }

    function cStatus(msg, kind) {
      statusEl.hidden = !msg;
      statusEl.className = 'split-status' + (kind ? ' ' + kind : '');
      statusEl.textContent = msg || '';
    }
    function cProgress(pct) {
      progress.classList.toggle('active', pct > 0 && pct < 100);
      progressBar.style.width = pct + '%';
    }
    function cRender() {
      listEl.innerHTML = '';
      cFiles.forEach(function (f, i) {
        var row = document.createElement('div');
        row.className = 'file-row';
        row.innerHTML =
          '<div class="idx">' + (i + 1) + '</div>' +
          '<div class="name"></div>' +
          '<div class="size">' + fmtSize(f.size) + '</div>' +
          '<button type="button" class="row-btn" data-a="up" ' + (i === 0 ? 'disabled' : '') + ' aria-label="Move up">↑</button>' +
          '<button type="button" class="row-btn" data-a="down" ' + (i === cFiles.length - 1 ? 'disabled' : '') + ' aria-label="Move down">↓</button>' +
          '<button type="button" class="row-btn row-btn-rm" data-a="rm" aria-label="Remove">×</button>';
        row.querySelector('.name').textContent = f.name;
        row.querySelector('[data-a=up]').onclick = function () { var t = cFiles[i - 1]; cFiles[i - 1] = cFiles[i]; cFiles[i] = t; cRender(); };
        row.querySelector('[data-a=down]').onclick = function () { var t = cFiles[i + 1]; cFiles[i + 1] = cFiles[i]; cFiles[i] = t; cRender(); };
        row.querySelector('[data-a=rm]').onclick = function () { cFiles.splice(i, 1); cRender(); };
        listEl.appendChild(row);
      });
      compileBtn.disabled = compileDocxBtn.disabled = cFiles.length === 0;
    }
    function cAdd(fl) {
      Array.prototype.forEach.call(fl, function (f) {
        if (!/\.docx$/i.test(f.name)) { cStatus('Skipped ' + f.name + ' — only .docx files are supported.', 'err'); return; }
        cFiles.push(f);
      });
      cRender();
    }
    pick.addEventListener('click', function () { input.click(); });
    drop.addEventListener('click', function (ev) { if (ev.target.closest('button')) return; input.click(); });
    input.addEventListener('change', function (e) { cAdd(e.target.files); input.value = ''; });
    dropzone(drop, function (files) { cAdd(files); });
    clearBtn.addEventListener('click', function () { cFiles = []; cRender(); cStatus(''); cProgress(0); });

    function docxToPdfBytes(file) {
      return file.arrayBuffer()
        .then(function (ab) { return window.mammoth.convertToHtml({ arrayBuffer: ab }); })
        .then(function (r) {
          sandbox.innerHTML = r.value || '<p>(empty document)</p>';
          var opts = {
            margin: [15, 15, 20, 15], filename: 'tmp.pdf',
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: {
              scale: 1.6, useCORS: true, letterRendering: true,
              backgroundColor: '#ffffff', scrollX: 0, scrollY: 0,
              windowWidth: 794, windowHeight: 1123
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
          };
          return window.html2pdf().set(opts).from(sandbox).output('blob');
        })
        .then(function (blob) { sandbox.innerHTML = ''; return blob.arrayBuffer(); })
        .then(function (ab) { return new Uint8Array(ab); });
    }
    function mergeAndPaginate(parts) {
      var P = window.PDFLib;
      return P.PDFDocument.create().then(function (merged) {
        var chain = Promise.resolve();
        parts.forEach(function (bytes) {
          chain = chain
            .then(function () { return P.PDFDocument.load(bytes); })
            .then(function (src) { return merged.copyPages(src, src.getPageIndices()); })
            .then(function (pages) { pages.forEach(function (p) { merged.addPage(p); }); });
        });
        return chain
          .then(function () { return merged.embedFont(P.StandardFonts.Helvetica); })
          .then(function (font) {
            var pages = merged.getPages(), total = pages.length;
            pages.forEach(function (p, i) {
              var label = (i + 1) + ' / ' + total, size = 9;
              var w = font.widthOfTextAtSize(label, size), pw = p.getSize().width;
              p.drawText(label, { x: (pw - w) / 2, y: 12, size: size, font: font, color: P.rgb(0.3, 0.3, 0.3) });
            });
            return merged.save();
          });
      });
    }
    function baseName() {
      return ((filenameInput.value || 'worksheets').trim().replace(/\.(pdf|docx?)$/i, '')) || 'worksheets';
    }

    /* One combined print document → the browser's own PDF engine.
       html2canvas (html2pdf) renders BLANK in this environment — proved
       repeatedly (certificate, here). The browser's print renderer is
       the reliable path: mammoth embeds images as data URIs so they
       appear, and "Save as PDF" in the dialog yields one combined PDF
       in order. Same mechanism as the working worksheet Print button. */
    function buildPrintHtml(parts, title) {
      function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
      var sections = parts.map(function (h, i) {
        return '<section class="ws"' + (i ? ' style="page-break-before:always;"' : '') + '>' + (h || '<p>(empty document)</p>') + '</section>';
      }).join('\n');
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
        '<style>@page{margin:18mm 16mm;}*{box-sizing:border-box;}' +
        'body{margin:0;font:11pt/1.55 "Segoe UI",Calibri,Arial,sans-serif;color:#1a1a2e;}' +
        '.ws{padding:0 0 6mm;}h1{font-size:20pt;margin:0 0 6pt;color:#1e1b4b;font-weight:800;}' +
        'h2,h3{margin:1.1em 0 .35em;line-height:1.25;color:#1e1b4b;}' +
        'p{margin:0 0 .7em;}ul,ol{margin:0 0 .8em;padding-left:1.4em;}li{margin-bottom:.25em;}' +
        'img{max-width:100%;height:auto;}table{border-collapse:collapse;width:100%;margin:.8em 0;}' +
        'th,td{border:1px solid #c8d5f0;padding:.4em .6em;vertical-align:top;}a{color:#1d4ed8;}' +
        '@media print{.ws{padding:0;}}</style></head><body>' + sections +
        '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},350);};</scr' + 'ipt>' +
        '</body></html>';
    }

    compileBtn.addEventListener('click', async function () {
      var title = baseName();
      if (!cFiles.length) { cStatus('Add at least one .docx file.', 'err'); return; }
      if (!window.mammoth) { cStatus('Document renderer still loading — retry in a moment.', 'err'); return; }
      compileBtn.disabled = compileDocxBtn.disabled = clearBtn.disabled = true;
      cStatus('Rendering documents…'); cProgress(1);
      try {
        var parts = [];
        for (var i = 0; i < cFiles.length; i++) {
          cStatus('Rendering ' + (i + 1) + ' of ' + cFiles.length + ': ' + cFiles[i].name);
          var ab = await cFiles[i].arrayBuffer();
          var r = await window.mammoth.convertToHtml({ arrayBuffer: ab });
          parts.push(r.value || '');
          cProgress(Math.round(((i + 1) / cFiles.length) * 90));
        }
        var w = window.open('', '_blank');
        if (!w) { cStatus('Pop-up blocked — allow pop-ups for this site, then Compile PDF again.', 'err'); return; }
        w.document.open();
        w.document.write(buildPrintHtml(parts, title));
        w.document.close();
        cProgress(100);
        cStatus('Print view opened for ' + title + '.pdf — in the dialog pick “Save as PDF”. ' +
          cFiles.length + ' worksheet(s), in order.', 'ok');
      } catch (err) {
        console.error(err);
        cStatus('Error: ' + (err && err.message ? err.message : err), 'err');
      } finally {
        compileBtn.disabled = compileDocxBtn.disabled = cFiles.length === 0;
        clearBtn.disabled = false;
        setTimeout(function () { cProgress(0); }, 1500);
      }
    });

    /* Word output — lossless altChunk concatenation (original formatting). */
    compileDocxBtn.addEventListener('click', async function () {
      if (!cFiles.length) { cStatus('Add at least one .docx file.', 'err'); return; }
      if (!window.JSZip) { cStatus('Zip library still loading — retry in a moment.', 'err'); return; }
      var outName = baseName() + '.docx';
      compileBtn.disabled = compileDocxBtn.disabled = clearBtn.disabled = true;
      cStatus('Building combined Word document…'); cProgress(40);
      try {
        var blob = await buildDocxAltChunk(cFiles.slice());
        cProgress(100);
        download(blob, outName);
        cStatus('Done — ' + outName + ' downloaded. Opens in Word/LibreOffice with each worksheet’s original formatting.', 'ok');
      } catch (err) {
        console.error(err);
        cStatus('Error building Word doc: ' + (err && err.message ? err.message : err), 'err');
      } finally {
        compileBtn.disabled = compileDocxBtn.disabled = cFiles.length === 0;
        clearBtn.disabled = false;
        setTimeout(function () { cProgress(0); }, 1500);
      }
    });

    /* Pack presets — resolve the verbatim list from content/ in order. */
    var packsRow = $('cmp-packs');
    if (packsRow) {
      packsRow.querySelectorAll('[data-pack]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.dataset.pack, list = PACKS[id];
          if (!list) return;
          cFiles = [];
          filenameInput.value = id + '-worksheets';
          loadList(list, id);
        });
      });
    }

    /* Drop a Course definition.docx → use its ordered pack list. */
    if (defPick && defInput) {
      defPick.addEventListener('click', function () { defInput.click(); });
      defInput.addEventListener('change', async function (e) {
        var f = e.target.files[0]; defInput.value = '';
        if (!f) return;
        if (!window.MatrixDefinition) { cStatus('Definition parser not loaded.', 'err'); return; }
        cStatus('Reading ' + f.name + '…');
        try {
          var d = await window.MatrixDefinition.parseFile(f);
          if (d.kind !== 'pack' || !d.packDocs.length) {
            cStatus('That definition is a course (screen list), not a pack. Use a “single PDF/Document consisting of…” definition.', 'err');
            return;
          }
          cFiles = [];
          if (d.courseId) filenameInput.value = d.courseId + '-worksheets';
          loadList(d.packDocs.map(function (p) { return p.src; }), d.courseId || f.name);
        } catch (err) {
          cStatus('Could not read definition: ' + (err && err.message ? err.message : err), 'err');
        }
      });
    }
  })();

  /* ---------- Boot ---------- */
  initCourseFiles().catch(function (err) {
    $('cf-tree').innerHTML = '<p class="stage-loading">Could not load courses: ' + esc(err.message) + '</p>';
  });
  if ($('scorm-course')) {
    initScorm().catch(function (err) {
      scormStatus('Could not load courses: ' + esc(err.message), 'err');
    });
  }
})();

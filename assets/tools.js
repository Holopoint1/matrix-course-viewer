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

  /* ---------- Tab switching ---------- */
  var tabs = Array.from(document.querySelectorAll('.tool-tab'));
  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.dataset.tab;
      tabs.forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.tool-panel').forEach(function (p) {
        p.classList.toggle('active', p.id === 'panel-' + name);
      });
    });
  });

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
   *  GOOGLE DRIVE  — deferred. The Drive panel is a static notice until a
   *  Google Cloud OAuth client id / scope decision is made (see files.html).
   *  No controls are wired here on purpose.
   *  SCORM 1.2 export is likewise out of scope for this page; the LMS
   *  drop-in zip (Splitter → "Download LMS drop-in") covers getting
   *  generated content into this viewer.
   * ====================================================================== */

  /* ---------- Boot ---------- */
  initCourseFiles().catch(function (err) {
    $('cf-tree').innerHTML = '<p class="stage-loading">Could not load courses: ' + esc(err.message) + '</p>';
  });
})();

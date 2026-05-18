/* ============================================================================
 * scorm-export.js — Matrix Course Viewer
 *
 * Client-side port of tools/build-scorm.js. Builds a self-contained SCORM 1.2
 * package (SCO) for a course entirely in the browser — same structure the
 * Node builder produces (dist/SC<id>-<slug>.zip):
 *
 *   imsmanifest.xml · scorm-api.js · index.html (course.html, id baked in) ·
 *   certificate.html · assets/ (css/js + vendored mammoth) ·
 *   data/courses.json (filtered) + data/achievements.json ·
 *   content/<refs> referenced by this course
 *
 * Keep this in step with tools/build-scorm.js — it is "Hamed's thing"; the
 * package layout must stay LMS-importable.
 * ==========================================================================*/
(function () {
  'use strict';

  var MAMMOTH_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
  var INTRO_STUBS = ['opening.svg', 'welcome.html', 'learning-objectives.html',
    'equipment.html', 'cpd-objectives.html', 'other-resources.html', 'now-try-worksheets.html'];

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c];
    });
  }
  async function txt(url) {
    var r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
    return r.text();
  }
  async function bin(url) {
    try {
      var r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.arrayBuffer();
    } catch (_) { return null; }
  }
  function collectContentRefs(course) {
    var refs = new Set();
    (course.screens || []).forEach(function (s) {
      if (s.src && !/^https?:/i.test(s.src)) refs.add(s.src);
      if (s.thumbnail && !/^https?:/i.test(s.thumbnail)) refs.add(s.thumbnail);
    });
    return Array.from(refs);
  }

  async function build(courseId, onLog) {
    var log = onLog || function () {};
    log('Reading courses.json…');
    var data = JSON.parse(await txt('data/courses.json'));
    var course = (data.courses || []).find(function (c) { return c.id === courseId; });
    if (!course) throw new Error('Course not found: ' + courseId);

    var scId = course.id.replace(/^CO/, 'SC');
    var baseName = scId + '-' + slug(course.title);
    var zip = new JSZip();

    /* 1. imsmanifest.xml */
    log('Building manifest…');
    var tpl = await txt('tools/scorm-template/imsmanifest.xml.tpl');
    zip.file('imsmanifest.xml', tpl
      .replace(/{{IDENTIFIER}}/g, 'MATRIX-' + scId)
      .replace(/{{COURSE_ID}}/g, course.id)
      .replace(/{{TITLE}}/g, escapeXml(scId + ' — ' + course.title)));

    /* 2. SCORM API bridge */
    zip.file('scorm-api.js', await txt('tools/scorm-template/scorm-api.js'));

    /* 3. Filtered courses.json + achievements.json */
    zip.file('data/courses.json', JSON.stringify({ courses: [course] }, null, 2));
    zip.file('data/achievements.json', await txt('data/achievements.json'));

    /* 4. Vendored mammoth (template copy if deployed, else fetch CDN) */
    log('Vendoring mammoth…');
    var mam = await bin('tools/scorm-template/mammoth.browser.min.js');
    if (!mam) mam = await bin(MAMMOTH_CDN);
    if (mam) zip.file('assets/mammoth.browser.min.js', mam);

    /* 5. CSS / JS / logo (verbatim) */
    for (var i = 0; i < 5; i++) {
      var f = ['styles.css', 'embedded.css', 'app.js', 'gamify.js', 'matrix-logo.svg'][i];
      var b = await bin('assets/' + f);
      if (b) zip.file('assets/' + f, b);
    }

    /* 6. course.html → index.html (id baked in + scorm-api wired) */
    log('Generating index.html…');
    var courseHtml = await txt('course.html');
    var totalScreens = course.screens.length;
    var indexHtml = courseHtml
      .replace(/<script src="https:\/\/cdnjs[^"]+mammoth[^"]+"><\/script>/,
        '<script src="assets/mammoth.browser.min.js"></script>')
      .replace('<script src="assets/gamify.js"></script>',
        '<script src="scorm-api.js"></script>\n  <script src="assets/gamify.js"></script>')
      .replace(/<\/body>/,
        '  <script>\n' +
        "    if (!new URLSearchParams(location.search).get('id')) {\n" +
        "      history.replaceState(null, '', location.pathname + '?id=" + course.id + "');\n" +
        '    }\n' +
        "    window.addEventListener('DOMContentLoaded', () => {\n" +
        '      setTimeout(() => {\n' +
        '        if (window.MatrixSCORM) {\n' +
        "          window.MatrixSCORM.init({ courseId: '" + course.id + "', totalScreens: " + totalScreens + " });\n" +
        '        }\n' +
        '      }, 250);\n' +
        '    });\n' +
        '  </script>\n' +
        '</body>');
    zip.file('index.html', indexHtml);

    /* 7. certificate.html */
    if (course.certificate && course.certificate.enabled) {
      try { zip.file('certificate.html', await txt('certificate.html')); } catch (_) {}
    }

    /* 8. Content files referenced by this course (+ best-effort intro stubs) */
    log('Collecting content…');
    var refs = collectContentRefs(course);
    var got = 0, miss = 0;
    for (var r = 0; r < refs.length; r++) {
      var d = await bin(refs[r]);
      if (d) { zip.file(refs[r], d); got++; } else { miss++; }
    }
    for (var s = 0; s < INTRO_STUBS.length; s++) {
      var rel = 'content/' + course.id + '/' + INTRO_STUBS[s];
      if (refs.indexOf(rel) >= 0) continue;
      var sd = await bin(rel);
      if (sd) zip.file(rel, sd);
    }

    log('Zipping…');
    var blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return {
      blob: blob,
      filename: baseName + '.zip',
      stats: { id: course.id, title: course.title, screens: totalScreens, refs: refs.length, got: got, miss: miss }
    };
  }

  window.MatrixScormExport = { build: build };
})();

#!/usr/bin/env node
/* Matrix LMS — SCORM 1.2 package builder
 *
 *   node tools/build-scorm.js              -> builds SC packages for all courses
 *   node tools/build-scorm.js CO0002       -> just CO0002
 *
 * Output: dist/SC<id>-<slug>.zip
 *
 * Each zip is a self-contained SCORM 1.2 SCO containing:
 *   - imsmanifest.xml
 *   - index.html (course viewer pre-configured with the course id)
 *   - certificate.html
 *   - assets/ (css, js, mammoth vendored locally)
 *   - data/courses.json (filtered to one course) + data/achievements.json
 *   - content/<course>/ + content/CP####/ (just the files this course references)
 *   - scorm-api.js (window.MatrixSCORM bridge)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TEMPLATE = path.join(__dirname, 'scorm-template');
const MAMMOTH_URL = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
const MAMMOTH_LOCAL = path.join(TEMPLATE, 'mammoth.browser.min.js');

async function main() {
  const wanted = process.argv[2] ? [process.argv[2]] : null;
  const coursesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'courses.json'), 'utf8'));
  const achievements = fs.readFileSync(path.join(ROOT, 'data', 'achievements.json'), 'utf8');

  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
  await ensureMammoth();
  const mammothJs = fs.readFileSync(MAMMOTH_LOCAL, 'utf8');

  const targets = wanted
    ? coursesData.courses.filter((c) => wanted.includes(c.id))
    : coursesData.courses;

  if (targets.length === 0) {
    console.error('No matching courses for', wanted);
    process.exit(1);
  }

  for (const course of targets) {
    await buildOne(course, achievements, mammothJs);
  }
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function buildOne(course, achievementsJson, mammothJs) {
  const scId = course.id.replace(/^CO/, 'SC');
  const baseName = `${scId}-${slug(course.title)}`;
  console.log(`\n=== Building SCORM package for ${course.id} → ${baseName}.zip ===`);

  const zip = new JSZip();

  /* 1. imsmanifest.xml */
  const manifestTpl = fs.readFileSync(path.join(TEMPLATE, 'imsmanifest.xml.tpl'), 'utf8');
  const manifest = manifestTpl
    .replace(/{{IDENTIFIER}}/g, `MATRIX-${scId}`)
    .replace(/{{COURSE_ID}}/g, course.id)
    .replace(/{{TITLE}}/g, escapeXml(`${scId} — ${course.title}`));
  zip.file('imsmanifest.xml', manifest);

  /* 2. SCORM API bridge */
  zip.file('scorm-api.js', fs.readFileSync(path.join(TEMPLATE, 'scorm-api.js'), 'utf8'));

  /* 3. Filtered courses.json + achievements.json */
  const filteredCourses = { courses: [course] };
  zip.file('data/courses.json', JSON.stringify(filteredCourses, null, 2));
  zip.file('data/achievements.json', achievementsJson);

  /* 4. Vendored mammoth */
  zip.file('assets/mammoth.browser.min.js', mammothJs);

  /* 5. CSS / JS / logo (verbatim) */
  for (const file of ['styles.css', 'embedded.css', 'app.js', 'gamify.js', 'matrix-logo.svg']) {
    const p = path.join(ROOT, 'assets', file);
    if (fs.existsSync(p)) zip.file('assets/' + file, fs.readFileSync(p));
  }

  /* 6. course.html → index.html with course id baked in + scorm-api wired up */
  const courseHtml = fs.readFileSync(path.join(ROOT, 'course.html'), 'utf8');
  const totalScreens = course.screens.length;
  const indexHtml = courseHtml
    .replace(
      /<script src="https:\/\/cdnjs[^"]+mammoth[^"]+"><\/script>/,
      '<script src="assets/mammoth.browser.min.js"></script>'
    )
    .replace(
      '<script src="assets/gamify.js"></script>',
      '<script src="scorm-api.js"></script>\n  <script src="assets/gamify.js"></script>'
    )
    .replace(
      /<\/body>/,
      `  <script>
    /* Bake in the course id so the SCO entry point doesn't depend on URL params */
    if (!new URLSearchParams(location.search).get('id')) {
      history.replaceState(null, '', location.pathname + '?id=${course.id}');
    }
    /* Initialise SCORM bridge once gamify is ready */
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        if (window.MatrixSCORM) {
          window.MatrixSCORM.init({ courseId: '${course.id}', totalScreens: ${totalScreens} });
        }
      }, 250);
    });
  </script>
</body>`
    );
  zip.file('index.html', indexHtml);

  /* 7. certificate.html (also using vendored mammoth + filtered data) */
  if (course.certificate && course.certificate.enabled) {
    const certHtml = fs.readFileSync(path.join(ROOT, 'certificate.html'), 'utf8');
    zip.file('certificate.html', certHtml);
  }

  /* 8. Content files referenced by this course */
  const contentRefs = collectContentRefs(course);
  for (const rel of contentRefs) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue; /* missing assets are skipped — placeholder shows in viewer */
    zip.file(rel, fs.readFileSync(abs));
  }

  /* Per-course intro art + stubs (welcome / LO / equipment) */
  const introDir = path.join(ROOT, 'content', course.id);
  if (fs.existsSync(introDir)) {
    for (const f of fs.readdirSync(introDir)) {
      const abs = path.join(introDir, f);
      if (fs.statSync(abs).isFile()) {
        zip.file(`content/${course.id}/${f}`, fs.readFileSync(abs));
      }
    }
  }

  /* 9. Write the zip */
  const outPath = path.join(DIST, baseName + '.zip');
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(outPath, buf);

  const sizeKb = Math.round(buf.length / 1024);
  console.log(`  ${course.screens.length} screens · ${contentRefs.length} content refs · ${sizeKb} KB`);
  console.log(`  → ${path.relative(ROOT, outPath)}`);
}

function collectContentRefs(course) {
  const refs = new Set();
  for (const s of course.screens) {
    if (!s.src) continue;
    if (/^https?:/i.test(s.src)) continue; /* external URLs */
    refs.add(s.src);
  }
  return Array.from(refs);
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  }[c]));
}

async function ensureMammoth() {
  if (fs.existsSync(MAMMOTH_LOCAL)) return;
  console.log('Fetching mammoth.browser.min.js from CDN…');
  await new Promise((resolve, reject) => {
    https.get(MAMMOTH_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('Could not fetch mammoth: HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        fs.writeFileSync(MAMMOTH_LOCAL, Buffer.concat(chunks));
        resolve();
      });
    }).on('error', reject);
  });
  console.log('  cached at', path.relative(ROOT, MAMMOTH_LOCAL));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

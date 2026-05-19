/* ============================================================================
 * migrate.mjs — Phase 1 one-time seed: git content  ->  Supabase
 *
 * LOCAL ONLY. Never deployed, never run from the site. Reads the SECRET
 * key from supabase/.env (gitignored). Idempotent (upserts) — safe to
 * re-run. Nothing on the live site changes; Phase 2 wires the viewer.
 *
 *   cd lms/supabase/seed
 *   npm install
 *   npm run seed:dry      # parse + report, NO writes
 *   npm run seed          # actually upsert into Supabase
 *
 * Flags: --dry-run            parse only, no writes
 *        --course=CO0001      limit to one course id
 *        --skip-media         don't upload/rewrite images
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
/* @supabase/supabase-js is imported lazily (only for real writes) so
   --dry-run validates with just mammoth, no install required. */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LMS_ROOT   = path.resolve(__dirname, '..', '..');          // …/lms
const REPO_ASSETS = path.resolve(LMS_ROOT, '..', 'assets');      // …/Matrix May LMS/assets (authoring media)
const ENV_PATH   = path.resolve(__dirname, '..', '.env');        // …/lms/supabase/.env

const args = process.argv.slice(2);
const DRY        = args.includes('--dry-run');
const SKIP_MEDIA = args.includes('--skip-media');
const ONLY       = (args.find((a) => a.startsWith('--course=')) || '').split('=')[1] || null;

/* Same styleMap as assets/app.js MAMMOTH_OPTS so seeded HTML matches what
   the viewer renders today (recovers the custom Word styles / bold). */
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

function loadEnv() {
  const env = { ...process.env };
  if (fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('  ! ', ...a);

/* ---- media: find a referenced image on disk, upload, return public URL --- */
const mediaDirsFor = (courseCode) => {
  const dirs = [path.join(LMS_ROOT, 'content', courseCode)];
  // authoring Media/ folders live next to lms/ under assets/<…>/Media
  if (fs.existsSync(REPO_ASSETS)) {
    for (const d of fs.readdirSync(REPO_ASSETS)) {
      if (!d.toUpperCase().includes(courseCode.toUpperCase())) continue;
      for (const sub of ['Media', 'media']) {
        const p = path.join(REPO_ASSETS, d, sub);
        if (fs.existsSync(p)) dirs.push(p);
      }
    }
  }
  return dirs;
};
function findFile(basename, dirs) {
  const want = decodeURIComponent(basename).toLowerCase();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === want);
    if (hit) return path.join(dir, hit);
  }
  return null;
}
async function rewriteImages(sb, html, courseCode, stats) {
  if (SKIP_MEDIA || !html) return html;
  const dirs = mediaDirsFor(courseCode);
  const re = /<img\b[^>]*?\ssrc=["']([^"']+)["']/gi;
  const refs = [...html.matchAll(re)].map((m) => m[1]);
  for (const ref of [...new Set(refs)]) {
    if (/^(data:|https?:)/i.test(ref)) continue;   /* inline / already-remote — leave as-is */
    const base = ref.split(/[\\/]/).pop().split('?')[0];
    const file = findFile(base, dirs);
    if (!file) { stats.imgMissing.add(base); continue; }
    const safe = base.replace(/[^\w.\-]+/g, '_');
    const key = `${courseCode}/${safe}`;
    if (!DRY) {
      const buf = fs.readFileSync(file);
      const { error } = await sb.storage.from('course-media')
        .upload(key, buf, { upsert: true, contentType: guessType(safe) });
      if (error && !/exists/i.test(error.message)) { warn('upload', key, error.message); continue; }
    }
    const pub = `${SB_URL}/storage/v1/object/public/course-media/${key}`;
    html = html.split(ref).join(pub);
    stats.imgOk++;
  }
  return html;
}
const guessType = (n) => ({ '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.svg':'image/svg+xml', '.webp':'image/webp' })[path.extname(n).toLowerCase()] || 'application/octet-stream';

/* ---- html page extraction (mirror app.js: prefer .page innerHTML) -------- */
function extractPageHtml(raw) {
  const page = raw.match(/<div[^>]*class=["'][^"']*\bpage\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/body>/i);
  if (page) return page[1].trim();
  const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (body ? body[1] : raw).trim();
}

const SB_URL = loadEnv().SUPABASE_URL || 'https://ujrowwtkhmzoshvmujxw.supabase.co';

async function main() {
  const env = loadEnv();
  const SECRET = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!DRY && !SECRET) {
    console.error('Missing SUPABASE_SECRET_KEY in lms/supabase/.env (needed for writes). Use --dry-run to parse only.');
    process.exit(1);
  }
  let sb = null;
  if (!DRY) {
    const { createClient } = await import('@supabase/supabase-js');
    sb = createClient(SB_URL, SECRET, { auth: { persistSession: false } });
  }

  const data = JSON.parse(fs.readFileSync(path.join(LMS_ROOT, 'data', 'courses.json'), 'utf8'));
  const courses = data.courses.filter((c) => !ONLY || c.id === ONLY);
  const stats = { courses: 0, screens: 0, pages: 0, imgOk: 0, imgMissing: new Set(), errors: [] };

  for (const c of courses) {
    log(`\n=== ${c.id} — ${c.title} (${c.screens.length} screens) ===`);
    const courseRow = {
      id: c.id, code: c.code || c.id, title: c.title || '',
      short_description: c.shortDescription || '',
      estimated_hours: Number(c.estimatedHours) || 0,
      certificate_enabled: !!(c.certificate && c.certificate.enabled),
      categories: c.categories || [], kind: c.kind || 'course'
    };
    if (!DRY) {
      const { error } = await sb.from('courses').upsert(courseRow);
      if (error) { stats.errors.push(`${c.id} course: ${error.message}`); warn(error.message); }
    }
    stats.courses++;

    const screenRows = [];
    for (let i = 0; i < c.screens.length; i++) {
      const s = c.screens[i];
      screenRows.push({
        id: s.id, course_id: c.id, position: i, type: s.type, title: s.title || '',
        hours: Number(s.hours) || 0, equipment: s.equipment || '',
        src: s.src || '', missing: !!s.missing
      });

      /* Editable body for document/html screens, keyed by src path
         (mirrors the existing cms html-override model). */
      const src = s.src || '';
      const abs = src && !/^https?:/i.test(src) ? path.join(LMS_ROOT, src) : null;
      let body = null;
      try {
        if (s.type === 'document' && abs && /\.docx$/i.test(abs) && fs.existsSync(abs)) {
          body = (await mammoth.convertToHtml({ path: abs }, MAMMOTH_OPTS)).value || '';
        } else if (s.type === 'html' && abs && fs.existsSync(abs)) {
          body = extractPageHtml(fs.readFileSync(abs, 'utf8'));
        }
      } catch (e) { stats.errors.push(`${s.id} render: ${e.message}`); warn(s.id, e.message); }

      if (body != null) {
        body = await rewriteImages(sb, body, c.code || c.id, stats);
        if (!DRY) {
          const { error } = await sb.from('pages').upsert({ path: src, html: body });
          if (error) { stats.errors.push(`${s.id} page: ${error.message}`); warn(error.message); }
        }
        stats.pages++;
        log(`  · ${s.id} ${s.type}  body ${body.length} chars  (${path.basename(src)})`);
      } else if (abs && !fs.existsSync(abs)) {
        warn(`${s.id} source missing on disk: ${src}`);
      }
    }
    if (!DRY && screenRows.length) {
      const { error } = await sb.from('screens').upsert(screenRows);
      if (error) { stats.errors.push(`${c.id} screens: ${error.message}`); warn(error.message); }
    }
    stats.screens += screenRows.length;
  }

  log(`\n──────── ${DRY ? 'DRY RUN' : 'SEED'} SUMMARY ────────`);
  log(`courses=${stats.courses}  screens=${stats.screens}  page bodies=${stats.pages}  images uploaded=${stats.imgOk}`);
  if (stats.imgMissing.size) log(`images NOT found on disk (${stats.imgMissing.size}): ${[...stats.imgMissing].slice(0, 20).join(', ')}${stats.imgMissing.size > 20 ? ' …' : ''}`);
  if (stats.errors.length) { log(`ERRORS (${stats.errors.length}):`); stats.errors.slice(0, 30).forEach((e) => log('  - ' + e)); }
  log(DRY ? '\n(dry run — nothing written. Re-run without --dry-run to seed.)' : '\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });

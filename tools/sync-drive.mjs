/* ============================================================================
 * sync-drive.mjs — the Drive → GitHub publish step.
 *
 * Runs in GitHub Actions (network + the service-account secret available).
 * Two phases:
 *   1) DOWNLOAD — pull every real (non-Google-native) file from each
 *      "<CODE> - ..." course folder under the LMS Project Assets root into
 *      content/<CODE>/<filename> (md5-skip unchanged).
 *   2) GENERATE — for each course registered in data/sheets.json, read its
 *      definition Google Sheet (server-side, no CORS), turn the rows into
 *      screens, resolve each File to a content/ path, and rebuild
 *      data/courses.json. Sheet-driven courses are marked _source:'sheet'.
 *
 * Auth: service-account JSON in env DRIVE_SA_KEY, shared (Viewer) on the
 * "LMS Project Assets" folder.
 *
 * Env: DRIVE_SA_KEY (required); COURSE (optional, limit DOWNLOAD to one code)
 * ==========================================================================*/
import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT_FOLDER_ID = '1MejJoVtqL2O7PxNwc3HYbrN_PmwqlFYu'; // "LMS Project Assets" (sync rev 3)
const CONTENT_DIR = path.resolve('content');
const COURSES_JSON = path.resolve('data', 'courses.json');
const SHEETS_JSON = path.resolve('data', 'sheets.json');
const ONLY_COURSE = (process.env.COURSE || '').trim().toUpperCase();
const GOOGLE_NATIVE = /^application\/vnd\.google-apps\./;

function getAuth() {
  const raw = (process.env.DRIVE_SA_KEY || '').trim();
  if (!raw) throw new Error('DRIVE_SA_KEY secret is missing or empty');
  let creds;
  try { creds = JSON.parse(raw); }
  catch (e) {
    throw new Error(`DRIVE_SA_KEY is not valid JSON (length=${raw.length}, starts with "${raw.slice(0, 1)}", ends with "${raw.slice(-1)}"). It must be the WHOLE .json key file — starting with { and ending with }.`);
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error('DRIVE_SA_KEY parsed but has no client_email/private_key — that is not the service-account key file.');
  }
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

const drive = google.drive({ version: 'v3', auth: getAuth() });

async function listChildren(folderId) {
  const out = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,name,mimeType,md5Checksum)',
      pageSize: 1000, pageToken,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    out.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return out;
}

async function collectFiles(folderId, acc) {
  for (const c of await listChildren(folderId)) {
    if (c.mimeType === 'application/vnd.google-apps.folder') await collectFiles(c.id, acc);
    else if (!GOOGLE_NATIVE.test(c.mimeType)) acc.push(c);
  }
}

const localMd5 = (p) => { try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };

async function download(fileId, dest) {
  const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(res.data));
}

const codeOf = (name) => { const m = String(name).match(/^([A-Za-z]{2}\d{4})/); return m ? m[1].toUpperCase() : null; };

/* ---------- phase 1: download asset files ---------- */
async function downloadPhase() {
  const driveFilesByCode = {}; // CODE -> Set(actual filenames in that Drive folder, incl. subfolders)
  const folders = (await listChildren(ROOT_FOLDER_ID))
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && codeOf(f.name));
  if (!folders.length) throw new Error('No course folders visible — is "LMS Project Assets" shared (Viewer) with the service account?');
  let downloaded = 0, skipped = 0, failed = 0;
  for (const folder of folders) {
    const code = codeOf(folder.name);
    if (ONLY_COURSE && code !== ONLY_COURSE) continue;
    const files = [];
    await collectFiles(folder.id, files);
    driveFilesByCode[code] = new Set(files.map((f) => f.name)); // what REALLY exists in Drive now
    console.log(`\n${code} — ${files.length} file(s)`);
    for (const f of files) {
      const dest = path.join(CONTENT_DIR, code, f.name);
      if (f.md5Checksum && f.md5Checksum === localMd5(dest)) { skipped++; continue; }
      try { await download(f.id, dest); console.log(`  ✓ ${f.name}`); downloaded++; }
      catch (e) { console.error(`  ✗ ${f.name}: ${e.message}`); failed++; }
    }
  }
  console.log(`\nDownload: ${downloaded} new/updated, ${skipped} unchanged, ${failed} failed.`);
  return driveFilesByCode;
}

/* ---------- CSV + screen helpers (server-side, so no CORS) ---------- */
function parseCsv(text) {
  const rows = [], s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let row = [], field = '', inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) { if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') inQ = false; else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const TYPE_MAP = { image: 'image', html: 'html', page: 'html', document: 'document', worksheet: 'document', doc: 'document', docx: 'document', youtube: 'youtube', video: 'youtube', pdf: 'pdf', powerpoint: 'powerpoint', slides: 'powerpoint', pptx: 'powerpoint', ppt: 'powerpoint', spreadsheet: 'spreadsheet' };
const normType = (t) => { const k = String(t || '').trim().toLowerCase(); return TYPE_MAP[k] || (k || 'html'); };
const cleanFile = (s) => String(s || '').replace(/^\s*["“”']\s*/, '').replace(/\s*["“”']\s*$/, '').trim();
const sheetIdFromUrl = (u) => { const m = String(u || '').match(/\/d\/([a-zA-Z0-9_-]+)/); return m ? m[1] : null; };

/* A definition sheet's screens table can be preceded by an optional "settings"
   block — key:value rows like "Active: yes" or "Certificate: no" — which is how
   AUTO-DISCOVERED courses carry their metadata. Find the real header row so both
   legacy sheets (header at row 0) and settings-block sheets parse correctly. */
function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] || []).map((c) => String(c || '').trim().toLowerCase());
    if (cells.some((c) => c === 'screen type' || c === 'type') && cells.some((c) => c === 'title')) return i;
  }
  return 0; // legacy: no settings block, header is the first row
}

/* Parse the key:value rows above the screens header. Accepts "Active: yes" in a
   single cell, or "Active" | "yes" across two columns. Keys are lower-cased. */
function parseSettings(rows, headerIdx) {
  const out = {};
  for (let i = 0; i < headerIdx; i++) {
    const cells = (rows[i] || []).map((c) => String(c == null ? '' : c).trim());
    if (!cells.some((c) => c)) continue;
    let key, val;
    if (cells[0] && cells[0].includes(':')) {
      const p = cells[0].split(':'); key = p.shift().trim(); val = p.join(':').trim() || (cells[1] || '').trim();
    } else { key = (cells[0] || '').replace(/:$/, '').trim(); val = (cells[1] || '').trim(); }
    if (key) out[key.toLowerCase()] = val;
  }
  return out;
}

function rowsToScreens(rows, code) {
  if (!rows.length) return { screens: [], missing: [] };
  const headerIdx = findHeaderRow(rows);
  const header = rows[headerIdx].map((h) => String(h || '').trim().toLowerCase());
  const idx = {}; header.forEach((h, i) => { idx[h] = i; });
  const cell = (r, names) => { for (const n of names) if (idx[n] != null) return r[idx[n]]; return ''; };
  const screens = [], missing = [];
  rows.slice(headerIdx + 1).filter((r) => r.some((c) => String(c || '').trim())).forEach((r, i) => {
    const type = normType(cell(r, ['screen type', 'type']));
    const hours = parseFloat(String(cell(r, ['hours'])).trim()) || 0;
    const equipment = String(cell(r, ['equipment'])).trim();
    const title = String(cell(r, ['title'])).trim();
    const file = cleanFile(cell(r, ['file', 'src']));
    let src, drivePath;
    if (/^https?:/i.test(file)) src = file;                 // a URL → use as-is
    else if (/^content\//i.test(file)) src = file;          // legacy site path → use as-is
    else {
      /* A Google DRIVE path the publisher typed — anything from a bare
         "opening.svg" to a full "LMS Project Assets/CO0001 - FC E-blocks CPD
         course/media/CO0001 - opening.png". Resolve the fetch location
         content/<CODE>/<filename> (CODE = the first path segment that looks
         like a course code, else THIS course) and KEEP the typed Drive path
         verbatim so the sheet + viewer can show the real Drive location. */
      const parts = file.split(/[\\/]+/).filter(Boolean);
      const name = parts[parts.length - 1];
      let folderCode = code;
      for (const seg of parts.slice(0, -1)) {
        const m = seg.match(/([A-Za-z]{2}\d{4})/);
        if (m) { folderCode = m[1].toUpperCase(); break; }
      }
      src = 'content/' + folderCode + '/' + name;
      drivePath = file;                                     // the real Drive path, for display
    }
    const screen = { id: `${code}-s${i + 1}`, type, title, hours, src };
    if (drivePath) screen.path = drivePath;
    if (equipment) screen.equipment = equipment;
    // flag local files that don't exist on disk (so we can see gaps)
    if (!/^https?:/i.test(src) && !fs.existsSync(path.resolve(src))) { screen.missing = true; missing.push(`${title} → ${src}`); }
    screens.push(screen);
  });
  return { screens, missing };
}

/* ---------- phase 2: generate courses.json from the definition sheets ---------- */
async function generatePhase(driveFilesByCode = {}) {
  const db = JSON.parse(fs.readFileSync(COURSES_JSON, 'utf8'));
  const byId = {}; db.courses.forEach((c, i) => { byId[c.id] = i; });

  let entries = [];
  if (fs.existsSync(SHEETS_JSON)) {
    try { entries = (JSON.parse(fs.readFileSync(SHEETS_JSON, 'utf8')) || {}).sheets || []; } catch (_) {}
  }
  const registered = new Set(entries.map((e) => String(e.code).toUpperCase()));

  for (const e of entries) {
    const code = String(e.code).toUpperCase();
    const sheetId = sheetIdFromUrl(e.url);
    if (!sheetId) { console.error(`  ! ${code}: cannot read sheet id from ${e.url}`); continue; }
    let csv;
    try {
      const res = await drive.files.export({ fileId: sheetId, mimeType: 'text/csv' }, { responseType: 'text' });
      csv = typeof res.data === 'string' ? res.data : String(res.data);
    } catch (err) { console.error(`  ! ${code}: failed to read definition sheet — ${err.message}`); continue; }

    const { screens, missing } = rowsToScreens(parseCsv(csv), code);
    const totalHours = screens.reduce((s, x) => s + (Number(x.hours) || 0), 0);
    const course = {
      id: code, code, kind: e.kind || 'course',
      title: e.title || code,
      shortDescription: e.description || '',
      estimatedHours: Math.round(totalHours * 10) / 10,
      certificate: Object.assign({ enabled: !!e.certificate }, e.certificateTemplate ? { templateName: e.certificateTemplate } : {}),
      screens,
      categories: Array.isArray(e.categories) ? e.categories : [],
      _source: 'sheet',
    };
    if (byId[code] != null) db.courses[byId[code]] = course; else { byId[code] = db.courses.length; db.courses.push(course); }
    console.log(`\n${code}: ${screens.length} screens generated${missing.length ? `, ${missing.length} missing file(s):` : ' (all files resolve ✓)'}`);
    missing.forEach((m) => console.log(`  ⚠ ${m}`));
  }

  await autoDiscoverPhase(db, byId, registered);

  writeAccuracyReport(db, driveFilesByCode);

  fs.writeFileSync(COURSES_JSON, JSON.stringify(db, null, 2) + '\n');
  console.log('\nWrote data/courses.json');
}

/* ---------- directory-accuracy report ----------
 * "0 missing" only means a file of that NAME exists in the published copy — it
 * can still be a stale leftover while the real Drive file goes unused. This
 * compares every screen's file against what's ACTUALLY in the Drive folder now:
 *   stale  = the screen points at a file that is no longer in its Drive folder
 *            (so it's rendering an old leftover), and
 *   unused = a file sitting in a Drive folder that no screen references.
 * Written to content/_sync-report.json (committed with the rest of content/). */
function srcParts(src) {
  if (!src || /^https?:/i.test(src)) return null;
  const m = String(src).match(/^content\/([^/]+)\/(.+)$/);
  return m ? { folderCode: m[1].toUpperCase(), name: m[2] } : null;
}
function writeAccuracyReport(db, driveFilesByCode) {
  const referencedByFolder = {}; // folderCode -> Set(name) used by any screen
  for (const c of db.courses) for (const s of (c.screens || [])) {
    const p = srcParts(s.src); if (!p) continue;
    (referencedByFolder[p.folderCode] = referencedByFolder[p.folderCode] || new Set()).add(p.name);
  }
  const courses = {};
  for (const c of db.courses) {
    if (!c.screens || !c.screens.length) continue;
    const stale = [], missing = [];
    for (const s of c.screens) {
      const p = srcParts(s.src); if (!p) continue;
      if (s.missing) { missing.push({ title: s.title, file: p.name, expectedIn: p.folderCode }); continue; }
      const driveSet = driveFilesByCode[p.folderCode];
      if (driveSet && !driveSet.has(p.name)) stale.push({ title: s.title, showing: p.name, expectedIn: p.folderCode });
    }
    if (stale.length || missing.length) courses[c.id] = { stale, missing };
  }
  const unusedMedia = {};
  for (const code of Object.keys(driveFilesByCode)) {
    const ref = referencedByFolder[code] || new Set();
    const unused = [...driveFilesByCode[code]].filter((n) => !ref.has(n) && !/^_|\.tmp$/.test(n));
    if (unused.length) unusedMedia[code] = unused;
  }
  const report = { generatedAt: new Date().toISOString(), courses, unusedMedia };
  fs.writeFileSync(path.join(CONTENT_DIR, '_sync-report.json'), JSON.stringify(report, null, 2) + '\n');
  const staleCount = Object.values(courses).reduce((n, c) => n + c.stale.length, 0);
  const orphanCount = Object.values(unusedMedia).reduce((n, a) => n + a.length, 0);
  console.log(`\nAccuracy report: ${staleCount} stale reference(s), ${orphanCount} unused Drive file(s). See content/_sync-report.json`);
  for (const [id, c] of Object.entries(courses)) c.stale.forEach((s) => console.log(`  ⚠ ${id}: "${s.title}" shows stale '${s.showing}' (not in ${s.expectedIn} Drive folder)`));
}

/* Build a DRAFT course straight from a folder's files when it has NO definition
 * sheet — "upload files, get a course". Screen type comes from each file's
 * extension, title from its name. Most images are treated as embedded assets;
 * one opening/cover image becomes the title screen. Marked draft:true so it
 * shows in the admin for the publisher to refine, but stays OFF the public
 * catalogue until a definition sheet (Active: yes) finishes it. */
const EXT_TYPE = { png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', pdf: 'pdf', doc: 'document', docx: 'document', ppt: 'powerpoint', pptx: 'powerpoint', xls: 'spreadsheet', xlsx: 'spreadsheet', htm: 'html', html: 'html' };
const extOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
const typeFromFile = (name) => EXT_TYPE[extOf(name)] || null;
function titleFromFile(name, code) {
  return String(name).replace(/\.[a-z0-9]+$/i, '').replace(new RegExp('^' + code + '\\s*[-–—:]*\\s*', 'i'), '').replace(/[-_]+/g, ' ').trim() || name;
}
async function buildDraftFromFiles(folder, code, db, byId) {
  const files = [];
  await collectFiles(folder.id, files);
  const typed = files.map((f) => ({ name: f.name, type: typeFromFile(f.name) })).filter((f) => f.type);
  const images = typed.filter((f) => f.type === 'image');
  const content = typed.filter((f) => f.type !== 'image').sort((a, b) => a.name.localeCompare(b.name));
  let opening = images.find((f) => /opening|cover|title|intro/i.test(f.name));
  if (!opening && images.length && images.length <= 3) opening = images.slice().sort((a, b) => a.name.localeCompare(b.name))[0];
  const ordered = (opening ? [opening] : []).concat(content);
  if (!ordered.length) return false;                            // nothing screen-worthy → not a course
  const screens = ordered.map((f, i) => ({ id: `${code}-s${i + 1}`, type: f.type, title: titleFromFile(f.name, code), hours: 0, src: `content/${code}/${f.name}` }));
  const title = String(folder.name).replace(/^[A-Za-z]{2}\d{4}\s*[-–—:]*\s*/, '').trim() || code;
  const course = { id: code, code, kind: 'course', title, shortDescription: '', estimatedHours: 0, certificate: { enabled: false }, screens, categories: [], draft: true, _source: 'auto-files' };
  if (byId[code] != null) db.courses[byId[code]] = course; else { byId[code] = db.courses.length; db.courses.push(course); }
  console.log(`\n${code} (auto-built DRAFT from ${screens.length} file(s)): "${title}"`);
  return true;
}

/* ---------- phase 2b: auto-discover unregistered course folders ----------
 * Any "<CODE> - Title" folder that (a) isn't already registered in sheets.json
 * and (b) contains a "<CODE> - definition" sheet becomes a course automatically.
 * Metadata comes from a settings block at the top of that sheet (Title,
 * Certificate, Categories, Kind, Active); Title falls back to the folder name.
 * Publishing is OPT-IN: a discovered folder only goes live if its sheet says
 * Active: yes (or true/on/live/published). Anything else — including no Active
 * cell at all — is held back as a draft, so nothing appears by accident. */
const PUBLISH_VALUES = ['yes', 'true', 'on', '1', 'live', 'published', 'active', 'y'];
async function autoDiscoverPhase(db, byId, registered) {
  let added = 0, drafts = 0, built = 0;
  const folders = (await listChildren(ROOT_FOLDER_ID))
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && codeOf(f.name));
  for (const folder of folders) {
    const code = codeOf(folder.name);
    if (registered.has(code)) continue;                       // a registered course always wins
    if (ONLY_COURSE && code !== ONLY_COURSE) continue;
    const children = await listChildren(folder.id);
    const def = children.find((c) => c.mimeType === 'application/vnd.google-apps.spreadsheet' && /definition/i.test(c.name || ''));
    if (!def) {
      // No definition sheet → auto-build a draft from the files — but NEVER
      // clobber a course that already exists from a real source (sheet/manual).
      const existing = byId[code] != null ? db.courses[byId[code]] : null;
      if (!existing || existing._source === 'auto-files') {
        try { if (await buildDraftFromFiles(folder, code, db, byId)) built++; }
        catch (e) { console.error(`  ! ${code}: auto-build failed — ${e.message}`); }
      }
      continue;
    }

    let csv;
    try {
      const res = await drive.files.export({ fileId: def.id, mimeType: 'text/csv' }, { responseType: 'text' });
      csv = typeof res.data === 'string' ? res.data : String(res.data);
    } catch (err) { console.error(`  ! ${code}: cannot read "${def.name}" — ${err.message}`); continue; }

    const rows = parseCsv(csv);
    const settings = parseSettings(rows, findHeaderRow(rows));
    const activeRaw = String(settings.active || settings.status || settings.published || '').trim().toLowerCase();
    if (!PUBLISH_VALUES.includes(activeRaw)) { drafts++; console.log(`  · ${code}: held as draft (Active="${activeRaw || 'unset'}")`); continue; }

    const { screens, missing } = rowsToScreens(rows, code);
    const titleFromFolder = String(folder.name).replace(/^[A-Za-z]{2}\d{4}\s*[-–—:]*\s*/, '').trim();
    const title = settings.title || titleFromFolder || code;
    const certRaw = String(settings.certificate || settings.certificates || '').toLowerCase();
    const certEnabled = certRaw ? !['no', 'false', 'off', '0', 'none'].includes(certRaw) : true;
    const cats = String(settings.categories || settings.category || '').split(',').map((s) => s.trim()).filter(Boolean);
    const totalHours = screens.reduce((s, x) => s + (Number(x.hours) || 0), 0);
    const course = {
      id: code, code, kind: (settings.kind || 'course').toLowerCase(),
      title,
      shortDescription: settings.description || '',
      estimatedHours: Math.round(totalHours * 10) / 10,
      certificate: Object.assign({ enabled: certEnabled }, certEnabled ? { templateName: title } : {}),
      screens,
      categories: cats,
      _source: 'auto',
    };
    if (byId[code] != null) db.courses[byId[code]] = course; else { byId[code] = db.courses.length; db.courses.push(course); }
    added++;
    console.log(`\n${code} (auto-discovered): "${title}" — ${screens.length} screens${missing.length ? `, ${missing.length} missing file(s):` : ' (all files resolve ✓)'}`);
    missing.forEach((m) => console.log(`  ⚠ ${m}`));
  }
  console.log(`\nAuto-discovery: ${added} new course(s), ${built} auto-built draft(s) from files, ${drafts} held as draft.`);
}

async function main() {
  const driveFilesByCode = await downloadPhase();
  await generatePhase(driveFilesByCode);
  console.log('\nSync complete.');
}
main().catch((e) => { console.error('SYNC FAILED:', e.message); process.exit(1); });

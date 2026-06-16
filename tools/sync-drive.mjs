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
  const folders = (await listChildren(ROOT_FOLDER_ID))
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && codeOf(f.name));
  if (!folders.length) throw new Error('No course folders visible — is "LMS Project Assets" shared (Viewer) with the service account?');
  let downloaded = 0, skipped = 0, failed = 0;
  for (const folder of folders) {
    const code = codeOf(folder.name);
    if (ONLY_COURSE && code !== ONLY_COURSE) continue;
    const files = [];
    await collectFiles(folder.id, files);
    console.log(`\n${code} — ${files.length} file(s)`);
    for (const f of files) {
      const dest = path.join(CONTENT_DIR, code, f.name);
      if (f.md5Checksum && f.md5Checksum === localMd5(dest)) { skipped++; continue; }
      try { await download(f.id, dest); console.log(`  ✓ ${f.name}`); downloaded++; }
      catch (e) { console.error(`  ✗ ${f.name}: ${e.message}`); failed++; }
    }
  }
  console.log(`\nDownload: ${downloaded} new/updated, ${skipped} unchanged, ${failed} failed.`);
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

function rowsToScreens(rows, code) {
  if (!rows.length) return { screens: [], missing: [] };
  const header = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const idx = {}; header.forEach((h, i) => { idx[h] = i; });
  const cell = (r, names) => { for (const n of names) if (idx[n] != null) return r[idx[n]]; return ''; };
  const screens = [], missing = [];
  rows.slice(1).filter((r) => r.some((c) => String(c || '').trim())).forEach((r, i) => {
    const type = normType(cell(r, ['screen type', 'type']));
    const hours = parseFloat(String(cell(r, ['hours'])).trim()) || 0;
    const equipment = String(cell(r, ['equipment'])).trim();
    const title = String(cell(r, ['title'])).trim();
    const file = cleanFile(cell(r, ['file', 'src']));
    let src;
    if (/^https?:/i.test(file)) src = file;
    else if (/^content\//i.test(file)) src = file;
    else src = 'content/' + code + '/' + file;            // bare name → course folder
    const screen = { id: `${code}-s${i + 1}`, type, title, hours, src };
    if (equipment) screen.equipment = equipment;
    // flag local files that don't exist on disk (so we can see gaps)
    if (!/^https?:/i.test(src) && !fs.existsSync(path.resolve(src))) { screen.missing = true; missing.push(`${title} → ${src}`); }
    screens.push(screen);
  });
  return { screens, missing };
}

/* ---------- phase 2: generate courses.json from the definition sheets ---------- */
async function generatePhase() {
  if (!fs.existsSync(SHEETS_JSON)) { console.log('No data/sheets.json — skipping courses.json generation.'); return; }
  const cfg = JSON.parse(fs.readFileSync(SHEETS_JSON, 'utf8'));
  const entries = (cfg && cfg.sheets) || [];
  if (!entries.length) { console.log('No sheets registered — skipping courses.json generation.'); return; }

  const db = JSON.parse(fs.readFileSync(COURSES_JSON, 'utf8'));
  const byId = {}; db.courses.forEach((c, i) => { byId[c.id] = i; });

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

  fs.writeFileSync(COURSES_JSON, JSON.stringify(db, null, 2) + '\n');
  console.log('\nWrote data/courses.json');
}

async function main() {
  await downloadPhase();
  await generatePhase();
  console.log('\nSync complete.');
}
main().catch((e) => { console.error('SYNC FAILED:', e.message); process.exit(1); });

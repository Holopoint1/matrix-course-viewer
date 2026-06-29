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

const ROOT_FOLDER_ID = '1MejJoVtqL2O7PxNwc3HYbrN_PmwqlFYu'; // "LMS Project Assets" (sync rev 4 — re-run to re-flag removed files as missing)
const CONTENT_DIR = path.resolve('content');
const COURSES_JSON = path.resolve('data', 'courses.json');
const SHEETS_JSON = path.resolve('data', 'sheets.json');
const COURSE_STRUCTURE_JSON = path.resolve('data', 'course-structure.json');
const ONLY_COURSE = (process.env.COURSE || '').trim().toUpperCase();

/* Per-file content fingerprint ('content/<code>/<name>' -> short md5) so the
   viewer can cache-bust each file by its bytes (a same-name Drive edit gets a new
   ?v= and is never served stale). Plus sync issues surfaced to the admin report. */
const CONTENT_VERSIONS = {};
const DRIVE_LINKS = {};   // content/<code>/<name> -> Drive webViewLink (for "Open in Google …")
const SYNC_ISSUES = { failed: [], collisions: [], canonCollisions: [], removed: [] };
const GOOGLE_NATIVE = /^application\/vnd\.google-apps\./;
/* Google-native docs can't be downloaded directly, but they CAN be exported to
   their Office equivalents — so a publisher can author a screen straight from a
   Google Doc/Sheet/Slides and the sync turns it into a real file the viewer can
   show. (The definition sheets themselves are skipped — read via CSV elsewhere.) */
const GOOGLE_EXPORT = {
  'application/vnd.google-apps.document':     { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   ext: '.docx' },
  'application/vnd.google-apps.spreadsheet':  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         ext: '.xlsx' },
  'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx' },
};
const exportName = (f) => {
  const e = GOOGLE_EXPORT[f.mimeType];
  if (!e) return f.name;
  /* Drop a misleading pseudo-extension a Google-native title may carry (e.g.
     "CO0001 – LO.HTM"), so it exports as the natural "CO0001 – LO.docx" the sheet
     would type — not a doubled "…HTM.docx". */
  const base = f.name.replace(/\.(html?|pdf|txt|rtf|odt|csv|pages)$/i, '');
  return base.toLowerCase().endsWith(e.ext) ? base : base + e.ext;
};

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
      fields: 'nextPageToken, files(id,name,mimeType,md5Checksum,webViewLink)',
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
    if (c.mimeType === 'application/vnd.google-apps.folder') { await collectFiles(c.id, acc); continue; }
    if (GOOGLE_NATIVE.test(c.mimeType)) {
      /* Export Google Docs/Slides and content Sheets. Skip ONLY the course's
         control "definition" Sheet (read via CSV elsewhere) — a Google DOC named
         "...definition" is real content and still exports. Other Google types
         (Forms etc.) have no Office export and are ignored. */
      const isDefinitionSheet = c.mimeType === 'application/vnd.google-apps.spreadsheet' && /\bdefinition\b/i.test(c.name || '');
      if (GOOGLE_EXPORT[c.mimeType] && !isDefinitionSheet) acc.push(c);
    } else acc.push(c);                                    // a real uploaded file
  }
}

const localMd5 = (p) => { try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const versionFromDisk = (p) => { const m = localMd5(p); return m ? m.slice(0, 10) : null; };

async function download(file, dest) {
  const exp = GOOGLE_EXPORT[file.mimeType];
  const res = exp
    ? await drive.files.export({ fileId: file.id, mimeType: exp.mime }, { responseType: 'arraybuffer' })
    : await drive.files.get({ fileId: file.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  const buf = Buffer.from(res.data);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf;
}
/* Retry transient Drive errors (5xx / rate limits) so a blip doesn't leave a
   stale prior copy passing as fresh. */
async function downloadWithRetry(file, dest, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await download(file, dest); }
    catch (e) { last = e; if (i < tries - 1) await sleep(500 * (i + 1)); }
  }
  throw last;
}

/* Make content/<code> a TRUE MIRROR of the Drive folder: delete any file no longer
   in Drive, so a renamed/replaced/retyped file can never linger as a stale "twin"
   that canon-matching might snap onto. Only runs for codes synced this run; never
   touches _-prefixed meta files. */
function pruneFolder(code, keepSet) {
  const dir = path.join(CONTENT_DIR, code);
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  /* TRUE MIRROR — the live site shows ONLY what is in Drive. Any content file that
     is NOT in the course's Drive folder is removed, so a leftover/old/cached copy can
     never be served. A screen pointing at a now-absent file honestly shows "missing"
     until the real file is added to Drive. (_-prefixed meta files are left alone.) */
  for (const e of entries) {
    if (e.isDirectory() || e.name.startsWith('_')) continue;
    if (keepSet.has(e.name)) continue;
    try {
      fs.rmSync(path.join(dir, e.name));
      SYNC_ISSUES.removed.push({ code, name: e.name });
      console.log(`  ✗ removed ${code}/${e.name} (not in Drive)`);
    } catch (_) {}
  }
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
    const keep = new Set(files.map(exportName)); // names as they land in content/ (Google docs get an Office ext)
    driveFilesByCode[code] = keep;
    /* Basename collision: two Drive files (e.g. root + a media/ subfolder) flatten
       to the same content/<code>/<name>; only one survives, so warn. */
    const counts = {};
    for (const f of files) { const n = exportName(f); counts[n] = (counts[n] || 0) + 1; }
    for (const [n, c] of Object.entries(counts)) {
      if (c > 1) { SYNC_ISSUES.collisions.push({ code, name: n, count: c }); console.warn(`  ! collision: ${c} Drive files map to ${code}/${n} — only one survives`); }
    }
    console.log(`\n${code} — ${files.length} file(s)`);
    for (const f of files) {
      const name = exportName(f);
      const dest = path.join(CONTENT_DIR, code, name);
      const rel = 'content/' + code + '/' + name;
      if (f.webViewLink) DRIVE_LINKS[rel] = f.webViewLink;   // exact "Open in Google …" target
      // real files: md5-skip when unchanged. Google-native files have no md5, so always re-export (keeps edits fresh).
      if (!GOOGLE_EXPORT[f.mimeType] && f.md5Checksum && f.md5Checksum === localMd5(dest)) {
        skipped++; CONTENT_VERSIONS[rel] = f.md5Checksum.slice(0, 10); continue;
      }
      try {
        const buf = await downloadWithRetry(f, dest); console.log(`  ✓ ${name}`); downloaded++;
        CONTENT_VERSIONS[rel] = f.md5Checksum ? f.md5Checksum.slice(0, 10) : crypto.createHash('md5').update(buf).digest('hex').slice(0, 10);
      } catch (e) {
        console.error(`  ✗ ${name}: ${e.message}`); failed++;
        SYNC_ISSUES.failed.push({ code, name, error: e.message });
        const dv = versionFromDisk(dest); if (dv) CONTENT_VERSIONS[rel] = dv; // tag whatever bytes are actually served
      }
    }
    // True-mirror: remove any content/<code> file no longer present in this Drive folder.
    pruneFolder(code, keep);
  }
  console.log(`\nDownload: ${downloaded} new/updated, ${skipped} unchanged, ${failed} failed, ${SYNC_ISSUES.collisions.length} collision(s).`);
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

/* ---- Tolerant file matching: forgive naming drift between sheets & Drive ----
   A sheet may say "opening.svg" / "CO0001 - LO.html" while the real Drive file
   is "CO0001 - opening.png" / "CO0001 – LO.HTM". When the exact name isn't in the
   folder, match by a normalised key (drop code prefix, dashes, case, extension)
   and the screen type — but only ever snap when the match is unambiguous. */
const TYPE_EXTS = { image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'], html: ['htm', 'html'], document: ['doc', 'docx'], powerpoint: ['ppt', 'pptx'], spreadsheet: ['xls', 'xlsx'], pdf: ['pdf'] };
const normKey = (name) => String(name).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[-–—_\s]+/g, ' ').trim();
const matchExt = (f) => (f.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
function matchInSet(want, type, set) {
  if (!set) return null;
  let c = [...set].filter((f) => normKey(f) === want);
  const exts = TYPE_EXTS[type];
  if (c.length > 1 && exts) c = c.filter((f) => exts.includes(matchExt(f)));
  return c.length === 1 ? c[0] : null;                    // unique match within this folder
}
/* Find the real Drive file for a screen whose exact filename has drifted. Tries
   the screen's OWN folder first; then — for shared content that lives in another
   course's folder (e.g. CO0001 reusing CO0002's PowerPoints) — every other
   folder, accepting a cross-folder match only when it is globally unique.
   Returns {code, name} or null. */
function tolerantMatch(name, type, folderCode, byCode) {
  const own = byCode[folderCode];
  if (!own || own.has(name)) return null;                 // no folder data, or exact file present → leave as typed
  /* Forgive ONLY same-folder name drift (.htm vs .html, hyphen vs en-dash) within
     the SAME course. NEVER match another course's folder — that cross-course snap
     is what made CO0002 grab CO0001's "opening" file. */
  const inOwn = matchInSet(normKey(name), type, own);
  return inOwn ? { code: folderCode, name: inOwn } : null;
}

/* Last-resort heal: if a screen's resolved file isn't on disk under content/,
   but a copy with the SAME filename already exists elsewhere in the published
   tree (e.g. shared content sitting under another course's folder), point the
   screen at that real file instead of publishing a dead 404. Exact basename
   (case-insensitive) and globally unique only — never a fuzzy guess. */
let _pubIndex = null;
function publishedIndex() {
  if (_pubIndex) return _pubIndex;
  const exact = new Map();
  const root = path.resolve('content');
  const walk = (dir) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const rel = 'content/' + path.relative(root, p).split(path.sep).join('/');
      const k = e.name.toLowerCase();
      const a = exact.get(k); if (a) a.push(rel); else exact.set(k, [rel]);
    }
  };
  walk(root);
  _pubIndex = exact;
  return _pubIndex;
}
function healFromPublished(src) {
  const base = String(src).split('/').pop().toLowerCase();
  const c = publishedIndex().get(base);
  return (c && c.length === 1) ? c[0] : null;            // unique filename match only
}

/* Extensions that are the SAME format under different spellings — folding these
   lets a sheet's "welcome.htm" find a real "welcome.html". Kept deliberately tiny:
   only truly interchangeable pairs. Distinct formats (.docx/.pdf/.png/.svg/...) are
   never folded, so a Word doc can never be served in place of a web page. */
const EXT_FAMILY = { htm: 'htm', html: 'htm', jpg: 'jpg', jpeg: 'jpg', tif: 'tif', tiff: 'tif' };

/* Canonicalise a filename down to the part that actually carries meaning, by
   flattening what users can't see or didn't choose: letter-case, en/em-dash vs
   hyphen, repeated/trailing spaces, and interchangeable extensions (.htm/.html).
   Every real word and digit is preserved, so "CO0001" can never look like "CO0002"
   and a .docx can never look like a .htm. */
const canon = (s) => String(s).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
  .replace(/\.([a-z0-9]+)$/, (_, e) => '.' + (EXT_FAMILY[e] || e));

/* Resolve the name the sheet asked for to the REAL file in its own content/<code>
   folder. Exact hit wins; otherwise match by canon(), which forgives only invisible
   typography (case, en/em-dash, spaces) and interchangeable extensions (.htm/.html).
   Never crosses folders and never folds distinct formats, so a screen can only ever
   resolve to the same content under a different spelling — never a different file. */
const _dirCache = new Map();
function realName(folderCode, name) {
  let entry = _dirCache.get(folderCode);
  if (!entry) {
    let names = []; try { names = fs.readdirSync(path.resolve('content', folderCode)); } catch (_) {}
    const byCanon = new Map();
    for (const n of names) { const k = canon(n); const arr = byCanon.get(k) || []; arr.push(n); byCanon.set(k, arr); }
    entry = { names: new Set(names), byCanon };
    _dirCache.set(folderCode, entry);
  }
  if (entry.names.has(name)) return name;                // already exact
  const hits = entry.byCanon.get(canon(name));
  if (!hits || !hits.length) {
    /* Format-agnostic fallback: the sheet may name "X.htm" while the real file is the
       SAME content in another format — e.g. a Google Doc exported to "X.docx", or a
       Sheet exported to "X.xlsx". Match by BASE NAME (ignoring the extension), and use
       it ONLY when exactly one file in this folder shares that base — so it can never
       pick the wrong file. The viewer renders by the file's real type, so it just works. */
    const stripExt = (s) => canon(s).replace(/\.[a-z0-9]+$/, '');
    const wantBase = stripExt(name);
    const byBase = [...entry.names].filter((n) => stripExt(n) === wantBase);
    return byBase.length === 1 ? byBase[0] : null;
  }
  if (hits.length === 1) return hits[0];
  /* >1 file shares one canon key (e.g. a hyphen vs en-dash twin, or .htm vs .html)
     — they may be byte-different siblings, so don't pick blindly. Rank by closeness
     to the RAW spelling the sheet typed: same dash-style AND extension first, then
     same extension, then deterministic. Record the collision for the report. */
  const aDash = /[–—]/.test(name);
  const aExt = (String(name).match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  const score = (h) => {
    if (h === name) return 100;
    let s = 0;
    if (/[–—]/.test(h) === aDash) s += 2;
    if (((h.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase()) === aExt) s += 2;
    if (h.toLowerCase() === String(name).toLowerCase()) s += 1;
    return s;
  };
  const ranked = [...hits].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  SYNC_ISSUES.canonCollisions.push({ folder: folderCode, asked: name, candidates: hits, chosen: ranked[0] });
  return ranked[0];
}

function rowsToScreens(rows, code, driveFiles = {}) {
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
    let title = String(cell(r, ['title'])).trim();
    const file = cleanFile(cell(r, ['file', 'src']));
    let src, drivePath;
    if (/^https?:/i.test(file)) src = file.replace(/\\/g, '/'); // a URL → normalise backslashes (https:\\… → https://…)
    else if (/^content\//i.test(file)) src = file;          // legacy site path → use as-is
    else {
      /* A Google DRIVE path the publisher typed — anything from a bare
         "opening.svg" to a full "LMS Project Assets/CO0001 - FC E-blocks CPD
         course/media/CO0001 - opening.png". Resolve the fetch location
         content/<CODE>/<filename> (CODE = the first path segment that looks
         like a course code, else THIS course) and KEEP the typed Drive path
         verbatim so the sheet + viewer can show the real Drive location. */
      const parts = file.split(/[\\/]+/).filter(Boolean);
      let name = parts[parts.length - 1];
      let folderCode = code;
      for (const seg of parts.slice(0, -1)) {
        const m = seg.match(/([A-Za-z]{2}\d{4})/);
        if (m) { folderCode = m[1].toUpperCase(); break; }
      }
      /* A Google Doc/Sheet/Slides is referenced by its bare name (no extension);
         the sync exports it to .docx/.xlsx/.pptx, so when the Screen type implies
         an Office file and no extension was given, fetch that exported file. */
      const gExt = { document: '.docx', spreadsheet: '.xlsx', powerpoint: '.pptx' }[type];
      /* Resolve to the REAL on-disk file: exact name first, then typography-canon
         (case / en-dash / .htm-.html). For a Google-native screen type whose name
         has no Office extension, prefer the exported "<name>.docx" — even when the
         bare name ends in a number/version that LOOKS like an extension (e.g.
         "Q1.2024" → "Q1.2024.docx"). Same folder only, never a different file. */
      let resolved = realName(folderCode, name);
      if (!resolved && gExt) resolved = realName(folderCode, name + gExt);
      if (resolved) name = resolved;
      else if (gExt && !/\.(docx?|xlsx?|pptx?|pdf)$/i.test(name)) name += gExt;
      src = 'content/' + folderCode + '/' + name;
      drivePath = file.replace(/\\/g, '/');                 // the Drive path as typed, for display
    }
    /* Bulletproofing: a new row with a File but a blank Title still becomes a
       properly named screen — derive a human title from the file/URL so rows
       can never publish as nameless screens. */
    if (!title) {
      const base = /^https?:/i.test(file)
        ? (file.split(/[?#]/)[0].split(/[\\/]+/).filter(Boolean).pop() || '')
        : (String(file).split(/[\\/]+/).filter(Boolean).pop() || '');
      title = base
        .replace(/\.[a-z0-9]{2,6}$/i, '')                   // drop extension
        .replace(/^[A-Za-z]{2}\d{4}\s*[-–—:]*\s*/, '')      // drop "CO0001 - " prefix
        .replace(/[-_]+/g, ' ')
        .trim() || `Screen ${i + 1}`;
    }
    const screen = { id: `${code}-s${i + 1}`, type, title, hours, src };
    if (drivePath) screen.path = drivePath;
    const _v = CONTENT_VERSIONS[src]; if (_v) screen.v = _v;   // per-file content hash → viewer cache-bust
    const _wu = DRIVE_LINKS[src]; if (_wu) screen.webUrl = _wu;   // Drive link → "Open in Google Docs/Sheets"
    if (equipment) screen.equipment = equipment;
    // flag local files that don't exist on disk (so we can see gaps) — but first
    // try to heal to an identically-named file already published elsewhere.
    if (!/^https?:/i.test(src) && !fs.existsSync(path.resolve(src))) {
      /* No cross-folder "healing" — an exact miss is reported as missing, never
         silently swapped for a same-named file in another course. */
      screen.missing = true; missing.push(`${title} → ${src}`);
    }
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
    if (ONLY_COURSE && code !== ONLY_COURSE) continue;       // scoped run: don't rebuild courses we didn't re-sync
    const sheetId = sheetIdFromUrl(e.url);
    if (!sheetId) { console.error(`  ! ${code}: cannot read sheet id from ${e.url}`); continue; }
    let csv;
    try {
      const res = await drive.files.export({ fileId: sheetId, mimeType: 'text/csv' }, { responseType: 'text' });
      csv = typeof res.data === 'string' ? res.data : String(res.data);
    } catch (err) { console.error(`  ! ${code}: failed to read definition sheet — ${err.message}`); continue; }

    const { screens, missing } = rowsToScreens(parseCsv(csv), code, driveFilesByCode);
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

  await autoDiscoverPhase(db, byId, registered, driveFilesByCode);

  /* Final pass — stamp EVERY screen (sheet-driven, auto-discovered AND packs)
     with its Drive link + content version straight from the maps, keyed by src.
     Worksheet packs are built on a path that doesn't apply these, so without this
     a pack worksheet would miss its "Open in Google Docs/Sheets" button and its
     per-file cache-bust. Keyed by src, so it's correct for every course type. */
  for (const c of (db.courses || [])) {
    for (const s of (c.screens || [])) {
      if (!s || !s.src || /^https?:/i.test(s.src)) continue;
      if (DRIVE_LINKS[s.src]) s.webUrl = DRIVE_LINKS[s.src];
      if (CONTENT_VERSIONS[s.src] && !s.v) s.v = CONTENT_VERSIONS[s.src];
      /* A text/HTML screen whose content was also authored as a Word doc: expose
         the matching Word file's link (same base name, .docx/.doc synced alongside)
         so the viewer offers "Open in Word" — never the raw .htm. Customer-facing. */
      if (/\.html?$/i.test(s.src)) {
        const base = s.src.replace(/\.html?$/i, '');
        const wl = DRIVE_LINKS[base + '.docx'] || DRIVE_LINKS[base + '.doc'];
        if (wl) s.wordUrl = wl;
      }
    }
  }

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
const baseOf = (s) => String(s || '').split(/[\\/]+/).filter(Boolean).pop() || '';

/* Plain-English reasons the typed name didn't exactly match the real file — so the
   admin log teaches the publisher WHY, not just that it happened. asked = what the
   sheet typed; used = the real filename matched to it (both share one canon key). */
function diffReasons(asked, used) {
  const r = [];
  const stripDash = (s) => s.replace(/[–—]/g, '-');
  if ((/[–—]/.test(asked) !== /[–—]/.test(used)) && stripDash(asked).toLowerCase() === stripDash(used).toLowerCase())
    r.push('Hyphen vs en-dash “–”: Word/Drive autocorrect quietly swaps a normal hyphen "-" for a longer en-dash you can’t tell apart by eye.');
  const neutral = (s) => stripDash(s).replace(/\.[a-z0-9]+$/i, (m) => m.toLowerCase());
  if (neutral(asked) !== neutral(used) && neutral(asked).toLowerCase() === neutral(used).toLowerCase())
    r.push('Capitalisation: the live site runs on Linux (case-sensitive), so “Equip.HTM” and “Equip.htm” are different files.');
  const ext = (s) => (String(s).match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  if (ext(asked) !== ext(used))
    r.push('Extension: the sheet says “' + ext(asked) + '” but the file is “' + ext(used) + '” — interchangeable web formats, matched automatically.');
  if (!r.length) r.push('A small spelling/spacing difference, matched automatically.');
  return r;
}

function writeAccuracyReport(db, driveFilesByCode) {
  const referencedByFolder = {}; // folderCode -> Set(name) used by any screen
  for (const c of db.courses) for (const s of (c.screens || [])) {
    const p = srcParts(s.src); if (!p) continue;
    (referencedByFolder[p.folderCode] = referencedByFolder[p.folderCode] || new Set()).add(p.name);
  }
  /* Which folders a canon-equal filename actually lives in — lets a "missing" note
     point out "but a file like it is in the CP4807 folder". */
  const canonIndex = new Map();
  for (const [code, set] of Object.entries(driveFilesByCode))
    for (const n of set) { const k = canon(n); let g = canonIndex.get(k); if (!g) { g = new Set(); canonIndex.set(k, g); } g.add(code); }

  const gExt = { document: '.docx', spreadsheet: '.xlsx', powerpoint: '.pptx' };
  const courses = {};
  for (const c of db.courses) {
    if (!c.screens || !c.screens.length) continue;
    const stale = [], missing = [], autofixed = [];
    for (const s of c.screens) {
      const p = srcParts(s.src); if (!p) continue;
      /* what the publisher typed, with the Google-export extension added the same
         way the resolver does, so a bare "Doc" → "Doc.docx" isn't seen as a diff. */
      let asked = baseOf(s.path) || p.name;
      const g = gExt[s.type];
      if (g && !/\.[a-z0-9]{2,6}$/i.test(asked)) asked += g;
      if (s.missing) {
        let reason;
        if (/\bdefinition\b/i.test(asked))
          reason = 'The file name contains “definition”, which the sync never publishes (those are the control sheets). Rename it without that word.';
        else {
          const where = canonIndex.get(canon(asked));
          const elsewhere = where && [...where].filter((x) => x !== p.folderCode);
          reason = (elsewhere && elsewhere.length)
            ? 'No file by this name in the ' + p.folderCode + ' folder — but a matching file is in the ' + elsewhere.join('/') + ' folder. Move it there, or point the row at the right folder.'
            : 'No file with this name (or a hyphen/case/extension variant) is in the ' + p.folderCode + ' folder yet. Add it to that Drive folder, or correct the name in the definition.';
        }
        missing.push({ id: s.id, title: s.title, asked, expectedIn: p.folderCode, reason });
        continue;
      }
      /* resolved, but the typed name differed from the real file → auto-fixed twin */
      if (asked && asked !== p.name && canon(asked) === canon(p.name))
        autofixed.push({ id: s.id, title: s.title, asked, used: p.name, reasons: diffReasons(asked, p.name) });
      const driveSet = driveFilesByCode[p.folderCode];
      if (driveSet && !driveSet.has(p.name)) stale.push({ id: s.id, title: s.title, showing: p.name, expectedIn: p.folderCode });
    }
    if (stale.length || missing.length || autofixed.length) courses[c.id] = { title: c.title, stale, missing, autofixed };
  }
  /* "Unused" should mean genuinely-orphaned COURSE CONTENT — not the control and
     build files that legitimately live in a course folder. Excluding these stops
     the report flagging e.g. "CP4807 - definition.xlsx" or SCORM export artifacts
     as if a screen were missing them. */
  const NON_CONTENT = (n) =>
    /^_/.test(n) || /\.tmp$/i.test(n) ||
    /\bdefinition\b/i.test(n) ||                 // the course's control sheet (Drive-native or uploaded .xlsx)
    /^imsmanifest\.xml$/i.test(n) ||             // SCORM package manifest
    /-metadata\.json$/i.test(n) ||               // e.g. blocks-metadata.json
    /-readiness\.txt$/i.test(n) ||               // e.g. scorm-readiness.txt
    /^summary-report\.txt$/i.test(n);            // SCORM export summary
  const unusedMedia = {};
  for (const code of Object.keys(driveFilesByCode)) {
    const ref = referencedByFolder[code] || new Set();
    const unused = [...driveFilesByCode[code]].filter((n) => !ref.has(n) && !NON_CONTENT(n));
    if (unused.length) unusedMedia[code] = unused;
  }
  /* Tag each name collision with whether the colliding file is actually USED by a
     screen — an unused-file collision is harmless noise, a used one means a screen
     may be served the wrong copy and is the only kind worth a health warning. */
  const collisions = SYNC_ISSUES.collisions.map((c) => ({
    ...c, used: (referencedByFolder[c.code] || new Set()).has(c.name),
  }));
  const collisionsAffecting = collisions.filter((c) => c.used).length;
  const totalScreens = db.courses.reduce((n, c) => n + ((c.screens || []).length), 0);
  const totalMissing = db.courses.reduce((n, c) => n + ((c.screens || []).filter((s) => s.missing).length), 0);
  const totalAutofixed = Object.values(courses).reduce((n, c) => n + c.autofixed.length, 0);
  const totalStale = Object.values(courses).reduce((n, c) => n + c.stale.length, 0);
  const totalUnused = Object.values(unusedMedia).reduce((n, a) => n + a.length, 0);
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      courses: db.courses.length, screens: totalScreens, displaying: totalScreens - totalMissing,
      missing: totalMissing, autofixed: totalAutofixed, stale: totalStale, unused: totalUnused,
      downloadFailed: SYNC_ISSUES.failed.length,
      collisions: collisions.length, collisionsAffecting,
    },
    courses, unusedMedia,
    failed: SYNC_ISSUES.failed,
    collisions,
    canonCollisions: SYNC_ISSUES.canonCollisions,
    removed: SYNC_ISSUES.removed,   // content files deleted because they were not in Drive (their screen now shows missing)
  };
  fs.writeFileSync(path.join(CONTENT_DIR, '_sync-report.json'), JSON.stringify(report, null, 2) + '\n');
  const staleCount = Object.values(courses).reduce((n, c) => n + c.stale.length, 0);
  const orphanCount = Object.values(unusedMedia).reduce((n, a) => n + a.length, 0);
  console.log(`\nAccuracy report: ${totalMissing} missing, ${totalAutofixed} auto-fixed name(s), ${staleCount} stale, ${orphanCount} unused. See content/_sync-report.json`);
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
  const screens = ordered.map((f, i) => {
    const src = `content/${code}/${f.name}`;
    const s = { id: `${code}-s${i + 1}`, type: f.type, title: titleFromFile(f.name, code), hours: 0, src };
    if (DRIVE_LINKS[src]) s.webUrl = DRIVE_LINKS[src];
    return s;
  });
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
async function autoDiscoverPhase(db, byId, registered, driveFilesByCode = {}) {
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

    const { screens, missing } = rowsToScreens(rows, code, driveFilesByCode);
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

/* ---------- phase 3: publish catalogue metadata from the Course_structure sheet ----------
 * A single "Course_structure" sheet in the LMS Project Assets root holds, per course:
 *   Course code | Course title | Course type | Number of sheets | Hours of learning | Keywords
 * This becomes data/course-structure.json, which the catalogue merges in to drive the
 * course TYPE label and the text SEARCH (keywords). The sheet is the control surface.
 *
 * Per-row fallback: a BLANK cell never wipes good data — it keeps whatever is already in
 * data/course-structure.json. Sheets/Hours fall back to the live values computed from
 * courses.json. Fully guarded + non-fatal: a sheet/network problem leaves the existing
 * file untouched and never fails the content sync. */
const parseKeywords = (s) => String(s || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);

async function buildCourseStructure() {
  const children = await listChildren(ROOT_FOLDER_ID);
  const sheet = children.find((c) => c.mimeType === 'application/vnd.google-apps.spreadsheet' && /course[_ -]?structure/i.test(c.name || ''));

  let existing = {};
  try { existing = (JSON.parse(fs.readFileSync(COURSE_STRUCTURE_JSON, 'utf8')) || {}).courses || {}; } catch (_) {}

  /* Live sheets/hours computed from the published courses.json (authoritative counts). */
  const byCode = {};
  try {
    const courses = (JSON.parse(fs.readFileSync(COURSES_JSON, 'utf8')) || {}).courses || [];
    for (const c of courses) {
      const code = String(c.id || c.code || '').toUpperCase();
      if (!code) continue;
      byCode[code] = {
        kind: c.kind,
        sheets: (c.screens || []).length,
        hours: Math.round((c.screens || []).reduce((s, x) => s + (Number(x.hours) || 0), 0) * 10) / 10,
      };
    }
  } catch (_) {}

  /* Raw cells from the sheet, keyed by course code. */
  const fromSheet = {};
  if (sheet) {
    try {
      const res = await drive.files.export({ fileId: sheet.id, mimeType: 'text/csv' }, { responseType: 'text' });
      const rows = parseCsv(typeof res.data === 'string' ? res.data : String(res.data));
      let hi = rows.findIndex((r) => (r || []).some((c) => /^\s*course\s*code\s*$/i.test(String(c || ''))));
      if (hi < 0) hi = 0;
      const header = (rows[hi] || []).map((h) => String(h || '').trim().toLowerCase());
      const col = (name) => header.indexOf(name);
      const ci = { code: col('course code'), title: col('course title'), type: col('course type'), sheets: col('number of sheets'), hours: col('hours of learning'), keywords: col('keywords'), description: col('description') };
      for (const r of rows.slice(hi + 1)) {
        /* Extract the course code with the SAME forgiving prefix match the
           definition-file pipeline uses (codeOf) — so trailing edits like
           "CO0001 " or "CO0001 (CPD)" still resolve to CO0001, rather than the
           whole row being silently dropped. The code is the join key to the course. */
        const code = ci.code >= 0 ? codeOf(String(r[ci.code] || '').trim()) : null;
        if (!code) continue;
        fromSheet[code] = {
          title: ci.title >= 0 ? String(r[ci.title] || '').trim() : '',
          type: ci.type >= 0 ? String(r[ci.type] || '').trim() : '',
          sheets: ci.sheets >= 0 ? String(r[ci.sheets] || '').trim() : '',
          hours: ci.hours >= 0 ? String(r[ci.hours] || '').trim() : '',
          keywords: ci.keywords >= 0 ? parseKeywords(r[ci.keywords]) : [],
          description: ci.description >= 0 ? String(r[ci.description] || '').trim() : '',
        };
      }
    } catch (e) { console.warn('  ! Course_structure: could not read the sheet — ' + e.message + ' (keeping existing file)'); }
  } else {
    console.warn('  ! Course_structure sheet not found in the root folder — keeping existing data/course-structure.json');
  }

  const codes = new Set([...Object.keys(byCode), ...Object.keys(existing), ...Object.keys(fromSheet)]);
  const out = {};
  for (const code of [...codes].sort()) {
    const s = fromSheet[code] || {}, e = existing[code] || {}, comp = byCode[code] || {};
    const title = s.title || e.title || '';
    const keywords = (s.keywords && s.keywords.length) ? s.keywords : (Array.isArray(e.keywords) ? e.keywords : []);
    const description = s.description || e.description || '';
    const type = s.type || e.type || (comp.kind === 'pack' ? 'Worksheet pack' : 'Course');
    const sheets = (s.sheets && !isNaN(parseFloat(s.sheets))) ? parseInt(s.sheets, 10)
      : (comp.sheets != null ? comp.sheets : (e.sheets != null ? e.sheets : null));
    const hours = (s.hours && !isNaN(parseFloat(s.hours))) ? parseFloat(s.hours)
      : (comp.hours != null ? comp.hours : (e.hours != null ? e.hours : null));
    out[code] = { title, type, sheets, hours, keywords, description };
  }

  const payload = {
    _note: "Catalogue metadata mirrored from the Google Sheet 'LMS Project Assets/Course_structure'. Rebuilt on each sync; a blank Keywords cell keeps the existing value. Powers the catalogue search + course type. Edit the sheet to change it.",
    generatedAt: new Date().toISOString(),
    source: 'Course_structure',
    courses: out,
  };
  fs.writeFileSync(COURSE_STRUCTURE_JSON, JSON.stringify(payload, null, 2) + '\n');
  console.log('\nCourse structure: ' + Object.keys(out).length + ' course(s) -> data/course-structure.json' + (sheet ? '' : ' (sheet missing — kept existing keywords)'));

  /* Fold the sheet's fields straight INTO courses.json, so every page that reads
     courses.json — the per-course dashboard/viewer, the catalogue, the account —
     is populated by the Course_structure sheet exactly the way the per-course
     definition sheets populate screens. A blank cell never overwrites (out[] has
     already applied the per-row fallback). Guarded: a problem here leaves
     courses.json untouched and never fails the sync. */
  try {
    const db = JSON.parse(fs.readFileSync(COURSES_JSON, 'utf8'));
    let merged = 0;
    for (const c of (db.courses || [])) {
      const m = out[String(c.id || c.code || '').toUpperCase()];
      if (!m) continue;
      if (m.title) c.title = m.title;                           // card / hero title
      if (m.description) c.shortDescription = m.description;     // course-page hero text
      if (Array.isArray(m.keywords) && m.keywords.length) c.keywords = m.keywords;
      if (m.type) c.courseType = m.type;
      if (m.hours != null) c.structureHours = m.hours;          // catalogue hours chip
      merged++;
    }
    fs.writeFileSync(COURSES_JSON, JSON.stringify(db, null, 2) + '\n');
    console.log('Course structure: merged into ' + merged + ' course(s) in courses.json');
  } catch (e) { console.warn('  ! Could not merge structure into courses.json — ' + e.message); }
}

async function main() {
  const driveFilesByCode = await downloadPhase();
  await generatePhase(driveFilesByCode);
  /* Catalogue metadata is a bonus output — never let it fail the content sync. */
  try { await buildCourseStructure(); } catch (e) { console.warn('Course structure step failed (non-fatal): ' + e.message); }
  console.log('\nSync complete.');
}
main().catch((e) => { console.error('SYNC FAILED:', e.message); process.exit(1); });

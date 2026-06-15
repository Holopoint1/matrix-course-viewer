/* ============================================================================
 * sync-drive.mjs — pull course asset files from the Google Drive hub into the
 * site's content/ folder, so the static site can serve them.
 *
 * Runs in GitHub Actions (where there IS network + the service-account secret).
 * Auth: a Google service account whose JSON key is in env DRIVE_SA_KEY, and
 * which has been shared (Viewer) on the "LMS Project Assets" Drive folder.
 *
 * For each course folder under the root (named like "CO0001 - ..."), it walks
 * the folder tree and downloads every real (non-Google-native) file into
 * content/<CODE>/<filename>. Unchanged files are skipped via md5, so re-runs
 * are cheap. It never deletes — it only adds/updates.
 *
 * Env:
 *   DRIVE_SA_KEY  (required) the service-account JSON, verbatim
 *   COURSE        (optional) limit to one code, e.g. "CO0001"; blank = all
 * ==========================================================================*/
import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT_FOLDER_ID = '1MejJoVtqL2O7PxNwc3HYbrN_PmwqlFYu'; // "LMS Project Assets"
const CONTENT_DIR = path.resolve('content');
const ONLY_COURSE = (process.env.COURSE || '').trim().toUpperCase();
const GOOGLE_NATIVE = /^application\/vnd\.google-apps\./;

function getAuth() {
  if (!process.env.DRIVE_SA_KEY) throw new Error('DRIVE_SA_KEY secret is missing');
  let creds;
  try { creds = JSON.parse(process.env.DRIVE_SA_KEY); }
  catch (e) { throw new Error('DRIVE_SA_KEY is not valid JSON — re-paste the whole key file'); }
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
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
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

function localMd5(p) {
  try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }
  catch { return null; }
}

async function download(fileId, dest) {
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(res.data));
}

function codeOf(name) {
  const m = String(name).match(/^([A-Za-z]{2}\d{4})/);
  return m ? m[1].toUpperCase() : null;
}

async function main() {
  const folders = (await listChildren(ROOT_FOLDER_ID))
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && codeOf(f.name));
  if (!folders.length) {
    throw new Error('No course folders visible. Is "LMS Project Assets" shared (Viewer) with the service account, and is the Drive API enabled?');
  }
  let downloaded = 0, skipped = 0, failed = 0;
  for (const folder of folders) {
    const code = codeOf(folder.name);
    if (ONLY_COURSE && code !== ONLY_COURSE) continue;
    const files = [];
    await collectFiles(folder.id, files);
    console.log(`\n${code} (${folder.name}) — ${files.length} file(s)`);
    for (const f of files) {
      const dest = path.join(CONTENT_DIR, code, f.name);
      if (f.md5Checksum && f.md5Checksum === localMd5(dest)) { skipped++; continue; }
      try { await download(f.id, dest); console.log(`  ✓ ${f.name}`); downloaded++; }
      catch (e) { console.error(`  ✗ ${f.name}: ${e.message}`); failed++; }
    }
  }
  console.log(`\nSync complete — ${downloaded} downloaded, ${skipped} unchanged, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('SYNC FAILED:', e.message); process.exit(1); });

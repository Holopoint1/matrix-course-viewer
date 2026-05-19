/* ============================================================================
 * export.mjs — pull everything OUT of Supabase back to local files.
 *
 * The reverse of migrate.mjs. READ-ONLY: uses the public publishable key
 * (RLS allows public SELECT), so NO secret key is needed and it can never
 * modify the project. Doubles as the versioned-backup safeguard.
 *
 *   cd lms/supabase/seed
 *   npm install      # (already done if you ran the seed)
 *   npm run export
 *
 * Writes to lms/supabase/export/:
 *   courses.json, screens.json, pages.json   (full raw snapshots)
 *   html/<path>.html                          (each page body, browsable)
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'export');
const ENV_PATH = path.resolve(__dirname, '..', '.env');

/* Public values — safe in the open. Falls back to .env if present. */
const CFG = { url: 'https://ujrowwtkhmzoshvmujxw.supabase.co',
              key: 'sb_publishable_cqfNgQceqbQFL5gsI_ageg_0rsi8RAA' };
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === 'SUPABASE_URL') CFG.url = m[2].replace(/^["']|["']$/g, '');
  }
}

function writeJSON(name, obj) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2));
}
function safeRel(p) {
  return String(p || 'untitled').replace(/[^\w.\-/]+/g, '_').replace(/^\/+/, '');
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(CFG.url, CFG.key, { auth: { persistSession: false } });

  const tables = ['courses', 'screens', 'pages'];
  const dump = {};
  for (const t of tables) {
    const { data, error } = await sb.from(t).select('*');
    if (error) { console.error(`! ${t}: ${error.message}`); process.exit(1); }
    dump[t] = data || [];
    writeJSON(`${t}.json`, dump[t]);
    console.log(`${t}: ${dump[t].length} rows -> export/${t}.json`);
  }

  /* Each page body as a browsable .html file. */
  let n = 0;
  for (const p of dump.pages) {
    if (!p || p.path == null) continue;
    const file = path.join(OUT, 'html', safeRel(p.path) + (/\.html?$/i.test(p.path) ? '' : '.html'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, p.html || '');
    n++;
  }
  console.log(`page bodies: ${n} -> export/html/`);

  const bytes = (() => { let s = 0; for (const t of tables) s += fs.statSync(path.join(OUT, `${t}.json`)).size; return s; })();
  console.log(`\nDone. Snapshot ~${(bytes / 1048576).toFixed(2)} MB in lms/supabase/export/`);
}
main().catch((e) => { console.error(e); process.exit(1); });

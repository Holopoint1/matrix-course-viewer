/* Walks the ../assets folder and prints text content for every
 * "<CODE> - definition.docx" file. Used as a one-off to refresh
 * courses.json after the source documents change.
 */
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

const ASSETS_ROOT = path.resolve(__dirname, '..', '..', 'assets');

async function extract(file) {
  try {
    const { value: text } = await mammoth.extractRawText({ path: file });
    return text;
  } catch (err) {
    return '[[error reading: ' + err.message + ']]';
  }
}

async function main() {
  if (!fs.existsSync(ASSETS_ROOT)) {
    console.error('Assets root not found at ' + ASSETS_ROOT);
    process.exit(1);
  }
  const dirs = fs.readdirSync(ASSETS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const targetArg = process.argv[2] || '';

  for (const dir of dirs) {
    if (targetArg && !dir.toLowerCase().includes(targetArg.toLowerCase())) continue;
    const full = path.join(ASSETS_ROOT, dir);
    const defFile = fs.readdirSync(full).find((n) => /definition\.docx$/i.test(n));
    const contentFile = fs.readdirSync(full).find((n) => /content\.docx$/i.test(n));
    console.log('\n=============================================================');
    console.log('  FOLDER: ' + dir);
    console.log('=============================================================');
    if (defFile) {
      console.log('\n--- DEFINITION: ' + defFile + ' ---');
      console.log(await extract(path.join(full, defFile)));
    }
    if (contentFile) {
      console.log('\n--- CONTENT: ' + contentFile + ' ---');
      const text = await extract(path.join(full, contentFile));
      console.log(text.slice(0, 4000));
      if (text.length > 4000) console.log('\n... [' + (text.length - 4000) + ' more chars truncated]');
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

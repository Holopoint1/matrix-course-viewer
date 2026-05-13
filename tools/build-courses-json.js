/* Parses every CO* course's `<CODE> - definition.docx` and rebuilds
 * courses.json. Pure regenerate of the CO courses; preserves CP* curriculum
 * packs that were already in courses.json verbatim.
 *
 * Each definition contains a screen-by-screen table:
 *   <ScreenType>\t<Hours>\t<Equipment>\t<Title>\t<FileOrURL>
 *
 * Equipment is always "Flowcode / E-blocks3" — we use that as a fixed pivot
 * to split the row into (type, hours) on the left and (title, file) on the
 * right.
 *
 * Run: node tools/build-courses-json.js
 */
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

const ASSETS_ROOT  = path.resolve(__dirname, '..', '..', 'assets');
const COURSES_JSON = path.resolve(__dirname, '..', 'data', 'courses.json');

const EQUIPMENT = 'Flowcode / E-blocks3';

const TYPE_MAP = {
  'opening screen': 'image',
  'image':          'image',
  'html':           'html',
  'youtube':        'youtube',
  'pdf':            'pdf',
  'powerpoint':     'powerpoint',
  'document':       'document',
  'spreadsheet':    'spreadsheet'
};

/* Course-level metadata derived from the assets folder name + definition's title line.
   Hand-tuned because the docx structure varies slightly between authors. */
const COURSE_META = {
  'CO0001': {
    code: 'CO0001',
    title: 'Flowcode and E-blocks 3 CPD Course',
    shortDescription: 'A short CPD course for instructors covering how Flowcode and E-blocks 3 help students learn modern digital electronics. Includes videos, PowerPoints, key worksheets, and a printable CPD certificate.',
    categories: ['CPD', 'Embedded'],
    certificate: { enabled: true, templateName: 'Flowcode & E-blocks 3 CPD Course' }
  },
  'CO0002': {
    code: 'CO0002',
    title: 'Introduction to Microcontrollers',
    shortDescription: 'The full Flowcode + E-blocks 3 introduction to microcontroller programming. 12 bronze/silver/gold worksheets plus sensor, motor, and assessment screens spanning analogue I/O, interrupts, displays, and web mirror projects.',
    categories: ['Embedded', 'Curriculum'],
    certificate: { enabled: true, templateName: 'Introduction to Microcontrollers' }
  },
  'CO0003': {
    code: 'CO0003',
    title: 'Digital Techniques for Aviation Technicians',
    shortDescription: 'CP7244 / EASA Unit 5 Digital Techniques for Aviation Technicians, delivered as a SCORM-ready browser course. Mirrors the CO0002 worksheet path adapted for aviation maintenance learners.',
    categories: ['Aviation', 'EASA', 'Curriculum'],
    certificate: { enabled: true, templateName: 'Digital Techniques for Aviation Technicians' }
  },
  'CO0004': {
    code: 'CO0004',
    title: 'Microcontrollers for T-Levels',
    shortDescription: 'T-Level Engineering microcontroller pathway built on the CP2563 / CP4807 worksheet base. Covers digital I/O, analogue sensors, motor control, and project work mapped to the T-Level core skills.',
    categories: ['T-Level', 'Embedded', 'Curriculum'],
    certificate: { enabled: true, templateName: 'Microcontrollers for T-Levels' }
  }
};

async function extractText(file) {
  const { value } = await mammoth.extractRawText({ path: file });
  return value;
}

function findDefinitionFile(folder) {
  return fs.readdirSync(folder).find((n) => /definition\.docx$/i.test(n));
}

/* Pull the rows of the definition table — they're the lines that mention the
   fixed equipment string. */
function parseDefinition(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.indexOf(EQUIPMENT) === -1) continue;
    const [left, ...rightParts] = line.split(EQUIPMENT);
    const right = rightParts.join(EQUIPMENT);
    /* left = "ScreenType<spaces>Hours" — collapse whitespace, split on first whitespace */
    const leftClean = left.replace(/\s+/g, ' ').trim();
    const lastSpace = leftClean.lastIndexOf(' ');
    const typeStr = leftClean.slice(0, lastSpace).trim();
    const hoursStr = leftClean.slice(lastSpace + 1).trim();
    /* right = "Title<spaces>File or URL" */
    const rightClean = right.replace(/\s+/g, ' ').trim();
    /* File reference is either a quoted string or a bare URL.
       Quotes are the curly characters "" (U+201C / U+201D) sometimes. */
    let title = rightClean;
    let src = '';
    const quoteMatch = rightClean.match(/[“"]\s*(.+?)\s*[”"]\s*$/);
    const urlMatch = rightClean.match(/(https?:\/\/\S+)\s*$/);
    if (quoteMatch) {
      src = quoteMatch[1].trim();
      title = rightClean.slice(0, quoteMatch.index).trim();
    } else if (urlMatch) {
      src = urlMatch[1].trim();
      title = rightClean.slice(0, urlMatch.index).trim();
    }
    rows.push({ typeStr, hours: Number(hoursStr) || 0, title, src });
  }
  return rows;
}

/* Rewrite the file reference from the docx's path convention to the
   live LMS path convention (lms/content/<CODE>/<file>). */
function normaliseSrc(src, courseId) {
  if (!src) return src;
  if (/^https?:/i.test(src)) return src;
  /* Strip any folder prefix, take the last path component. */
  const file = src.replace(/\\/g, '/').split('/').pop().trim();
  /* CP4807-* / CP1972-* / CP0507-* / CP2563-* / CP7244-* live in their own
     content/<CP>/ folders. Course-owned files (CO0002-H1.htm, etc.) live
     under content/<courseId>/. */
  const cpMatch = file.match(/^(CP\d+)/i);
  if (cpMatch) return 'content/' + cpMatch[1].toUpperCase() + '/' + file;
  return 'content/' + courseId + '/' + file;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function htmlSrcForTitle(courseId, title) {
  /* Title → filename mapping for HTML stubs we own. The docx defines names
     like "CO0002 – welcome.HTM" — we keep the human filename so the file
     manager / files.html can match it. */
  return 'content/' + courseId + '/' + slug(title) + '.html';
}

async function buildCourse(courseId) {
  const meta = COURSE_META[courseId];
  if (!meta) throw new Error('No metadata for ' + courseId);
  const folder = fs.readdirSync(ASSETS_ROOT).find((d) => d.startsWith(courseId + ' '));
  if (!folder) throw new Error('No assets folder for ' + courseId);
  const defFile = findDefinitionFile(path.join(ASSETS_ROOT, folder));
  const text = await extractText(path.join(ASSETS_ROOT, folder, defFile));
  const rows = parseDefinition(text);

  let n = 0;
  const screens = [];
  let estimatedHours = 0;
  /* Track titles to disambiguate duplicates inside a course */
  const titleCounts = new Map();
  for (const r of rows) {
    n += 1;
    const typeKey = r.typeStr.toLowerCase().trim();
    const type = TYPE_MAP[typeKey] || 'document';
    let src = normaliseSrc(r.src, courseId);
    const isUrl = /^https?:/i.test(src);
    /* If the docx referenced an .HTM file, the LMS expects .html in content/<id>/.
       Keep the filename verbatim if it's a CP* worksheet (those keep their .docx). */
    if (!isUrl && /\.HTM$/i.test(src) && !/^content\/CP/.test(src)) {
      src = src.replace(/\.HTM$/i, '.html');
    }
    const screen = {
      id: courseId.toLowerCase().replace(/^co0+/, 'co') + '-s' + String(n).padStart(2, '0'),
      type: type,
      title: r.title,
      hours: r.hours,
      equipment: EQUIPMENT,
      src: src
    };
    if (type === 'youtube') {
      /* YouTube screens use the URL directly */
      screen.src = r.src;
    }
    /* Files we don't ship yet → flag as missing so the resource-pending
       UI fires. Skip URLs (external resources). */
    if (!isUrl) {
      const localPath = path.resolve(__dirname, '..', src);
      if (!fs.existsSync(localPath)) {
        screen.missing = true;
        /* For opening images, surface the violet SVG fallback so catalog
           thumbnails still render. */
        if (type === 'image') {
          screen.thumbnail = 'content/' + courseId + '/opening.svg';
        }
      }
    }
    estimatedHours += Number(r.hours) || 0;
    screens.push(screen);
  }
  return {
    id: courseId,
    code: meta.code,
    title: meta.title,
    shortDescription: meta.shortDescription,
    estimatedHours: Math.round(estimatedHours * 10) / 10,
    certificate: meta.certificate,
    screens: screens,
    categories: meta.categories
  };
}

async function main() {
  const existing = JSON.parse(fs.readFileSync(COURSES_JSON, 'utf8'));
  const out = { courses: [] };
  /* Rebuild every CO course from its definition */
  for (const id of ['CO0001', 'CO0002', 'CO0003', 'CO0004']) {
    try {
      const course = await buildCourse(id);
      out.courses.push(course);
      console.log('  built ' + id + ' (' + course.screens.length + ' screens, ' + course.estimatedHours + 'h)');
    } catch (err) {
      console.log('  SKIP  ' + id + ' — ' + err.message);
    }
  }
  /* Preserve CP* curriculum packs from the existing file */
  for (const c of existing.courses) {
    if (/^CP/.test(c.id)) {
      out.courses.push(c);
      console.log('  kept  ' + c.id);
    }
  }
  fs.writeFileSync(COURSES_JSON, JSON.stringify(out, null, 2) + '\n');
  console.log('\nWrote ' + out.courses.length + ' courses to data/courses.json');
}

main().catch((err) => { console.error(err); process.exit(1); });

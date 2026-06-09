/* ============================================================================
 * sheet-loader.js — Google Sheets as a course-structure source.
 *
 * A publisher edits a Google Sheet (one per course) that lists each screen
 * as a row:  Screen type | Hours | Equipment | Title | File
 * The "File" column either contains a URL (used as-is) or a filename that's
 * resolved against content/<courseCode>/.
 *
 * The sheet's URL + course code live in data/sheets.json. The loader
 * fetches each sheet's CSV export (which IS cross-origin allowed by Google,
 * unlike the /edit HTML page), parses it, and caches the resulting course
 * objects in localStorage. MatrixCMS.mergeCourses() then folds them into
 * the courses array on every page — sheet courses replace static courses
 * of the same id.
 *
 * Fail-open: any network / parse / CORS error leaves the cached value (or
 * nothing) in place; the site keeps rendering whatever data is already there.
 * ============================================================================ */
(function () {
  'use strict';

  var KEY = 'matrix-lms:sheet-courses';
  var CONFIG_URL = 'data/sheets.json';

  /* ------------- helpers ------------- */
  function extractSheetId(url) {
    var m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function parseCsv(text) {
    /* Minimal CSV parser — handles double-quoted fields with embedded
       commas, newlines, and "" escapes. Good enough for Google CSV. */
    var rows = [], row = [], field = '', inQ = false;
    var s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (inQ) {
        if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') { inQ = false; }
        else { field += c; }
      } else {
        if (c === '"') { inQ = true; }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else { field += c; }
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* The 'Screen type' column from a publisher: tolerate trailing
     spaces, mixed case, and the friendly labels we use in admin. */
  var TYPE_MAP = {
    image: 'image',
    html: 'html', page: 'html',
    document: 'document', worksheet: 'document', doc: 'document', docx: 'document',
    youtube: 'youtube', video: 'youtube',
    pdf: 'pdf',
    powerpoint: 'powerpoint', slides: 'powerpoint', pptx: 'powerpoint', ppt: 'powerpoint',
    spreadsheet: 'spreadsheet'
  };
  function normalizeType(t) {
    var k = String(t || '').trim().toLowerCase();
    return TYPE_MAP[k] || (k || 'html');
  }

  function cleanFile(s) {
    /* Strip surrounding straight or smart quotes and trim. */
    return String(s || '')
      .replace(/^\s*["“”']\s*/, '')
      .replace(/\s*["“”']\s*$/, '')
      .trim();
  }

  function rowsToScreens(rows, code) {
    if (!rows.length) return [];
    /* First non-empty row = headers. */
    var headerRow = rows[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
    var idx = {};
    headerRow.forEach(function (h, i) { idx[h] = i; });
    /* Aliases — accept "type" or "screen type", "src" or "file". */
    function cell(row, names) {
      for (var i = 0; i < names.length; i++) {
        if (idx[names[i]] != null) return row[idx[names[i]]];
      }
      return '';
    }
    return rows.slice(1)
      .filter(function (r) { return r.some(function (c) { return String(c || '').trim(); }); })
      .map(function (row, i) {
        var type = normalizeType(cell(row, ['screen type', 'type']));
        var hoursStr = String(cell(row, ['hours'])).trim();
        var hours = hoursStr === '' ? 0 : parseFloat(hoursStr) || 0;
        var equipment = String(cell(row, ['equipment'])).trim();
        var title = String(cell(row, ['title'])).trim();
        var file = cleanFile(cell(row, ['file', 'src']));
        var src = (/^https?:/i.test(file) || /^content\//i.test(file))
          ? file
          : 'content/' + code + '/' + file;
        var screen = {
          /* Stable, deterministic id so admin overrides keyed by id
             survive sheet reloads. */
          id: code + '-s' + (i + 1),
          type: type,
          title: title,
          src: src,
          position: i,
          hours: hours
        };
        if (equipment) screen.equipment = equipment;
        return screen;
      });
  }

  async function fetchSheetRows(sheetId) {
    var url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/export?format=csv';
    var res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error('Sheet fetch failed HTTP ' + res.status);
    var text = await res.text();
    return parseCsv(text);
  }

  async function loadCourseFromSheet(entry) {
    var sheetId = extractSheetId(entry.url);
    if (!sheetId) throw new Error('Could not extract sheet id from URL: ' + entry.url);
    var rows = await fetchSheetRows(sheetId);
    return {
      id: entry.code,
      code: entry.code,
      title: entry.title || entry.code,
      kind: entry.kind || 'course',
      shortDescription: entry.description || '',
      estimatedHours: 0,
      certificate: { enabled: !!entry.certificate },
      categories: Array.isArray(entry.categories) ? entry.categories : [],
      screens: rowsToScreens(rows, entry.code),
      _source: 'sheet'
    };
  }

  /* ------------- public API ------------- */

  function cached() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; }
    catch (_) { return []; }
  }

  async function refresh() {
    try {
      var cfg = await fetch(CONFIG_URL, { cache: 'no-cache' }).then(function (r) { return r.json(); });
      var entries = (cfg && cfg.sheets) || [];
      if (!entries.length) return cached();
      var results = await Promise.all(entries.map(function (e) {
        return loadCourseFromSheet(e).catch(function (err) {
          console.warn('[sheet-loader]', e && e.code, err.message);
          return null;
        });
      }));
      var courses = results.filter(Boolean);
      try { localStorage.setItem(KEY, JSON.stringify(courses)); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('matrix:sheets-loaded', { detail: { courses: courses } })); } catch (_) {}
      return courses;
    } catch (e) {
      console.warn('[sheet-loader] refresh failed:', e.message);
      return cached();
    }
  }

  window.MatrixSheets = { cached: cached, refresh: refresh };

  /* Auto-refresh on script load so the cache is up to date for the
     next render. The current render uses whatever's already cached
     (stale-while-revalidate). */
  if (typeof window !== 'undefined') refresh();
})();

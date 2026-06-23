/* Matrix LMS — CMS overrides layer  (RETIRED / inert)
 * ============================================================================
 * Courses are now controlled SOLELY by Google Drive: each course's definition
 * Google Sheet + its files are synced to data/courses.json and content/ by
 * tools/sync-drive.mjs. That is the single source of truth and it updates on
 * every sync.
 *
 * THE BUG THIS REMOVES:
 * The old admin editor saved edits into each browser's localStorage as
 * "overrides" (course/screen metadata, per-file HTML content, hidden screens,
 * hidden courses). Every page applied those on top of — and they WON over — the
 * synced Drive data. Because an override was keyed by id/path with NO version
 * and NO expiry, a single old edit would shadow the real Drive file FOREVER on
 * that device — e.g. a worksheet kept showing months-old text even though the
 * sheet/file had been updated. Two sources of truth = drift = not bulletproof.
 *
 * THE FIX (this file):
 *   1. PURGE any existing override / discovery caches on load (every device
 *      self-heals — the stale data is gone, not just ignored).
 *   2. Every override READ returns "nothing", so pages render the Drive-synced
 *      data verbatim.
 *   3. Every override WRITE is a no-op, so the retired editor can't create new
 *      overrides and the problem can't come back.
 * The full window.MatrixCMS API is preserved so existing callers keep working.
 * Learner progress, streaks and sidebar prefs are NOT touched.
 * ==========================================================================*/
(function () {
  'use strict';

  /* 1. One-time purge of the legacy override + discovery caches. Explicit
     allow-list only — never touch matrix-lms:progress:* / gamify / prefs. */
  try {
    [
      'matrix-lms:cms:courses',
      'matrix-lms:cms:screens',
      'matrix-lms:cms:html',
      'matrix-lms:cms:dirty',
      'matrix-lms:cms:deleted-screens',
      'matrix-lms:cms:deleted-courses',
      'matrix-lms:db-courses',
      'matrix-lms:sheet-courses'
    ].forEach(function (k) { localStorage.removeItem(k); });
  } catch (_) {}

  var KEY_AUTH = 'matrix-lms:cms:auth';
  function loadJson(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { return {}; } }
  function saveJson(key, data) { try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) {} }
  var noop = function () {};

  window.MatrixCMS = {
    /* 2. Reads — always "no override" → the Drive-synced course/file is used. */
    applyOverrides: function (course) { return course; },
    applyHtmlOverride: function (_path, originalText) { return originalText; },
    getCourseOverride: function () { return null; },
    getScreenOverrides: function () { return {}; },
    getHtmlOverride: function () { return null; },
    getDeletedScreens: function () { return []; },
    getDeletedCourses: function () { return []; },
    hasAnyEdits: function () { return false; },

    /* 3. Writes — inert, so the retired editor can't recreate overrides. */
    setCourseOverride: noop,
    setScreenOverride: noop,
    setHtmlOverride: noop,
    addDeletedScreen: noop,
    removeDeletedScreen: noop,
    addDeletedCourse: noop,
    removeDeletedCourse: noop,
    clearCourse: noop,
    clearAll: noop,

    /* Auth gate kept (local UI theatre) so the admin pages still open. */
    isUnlocked: function () { return Boolean(loadJson(KEY_AUTH).unlocked); },
    unlock: function () { saveJson(KEY_AUTH, { unlocked: true, ts: 0 }); return true; },
    lock: function () { try { localStorage.removeItem(KEY_AUTH); } catch (_) {} },

    /* Export now just emits the current (un-overridden) courses.json. */
    buildExportPayload: async function (originalCourses) {
      return { 'data/courses.json': JSON.stringify(originalCourses || { courses: [] }, null, 2) + '\n' };
    },
    exportZip: async function () {}
  };
})();

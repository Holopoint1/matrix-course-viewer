/* Matrix LMS — CMS overrides layer
 *
 * The admin CMS (admin.html) writes edits to localStorage. Every page that
 * loads course data should pass the parsed course through `applyOverrides()`
 * so admin edits show up live across the site.
 *
 * Storage keys:
 *   matrix-lms:cms:courses    -> { <courseId>: { title?, code?, shortDescription?, estimatedHours?, certificate? } }
 *   matrix-lms:cms:screens    -> { <courseId>: { <screenId>: { title?, hours?, equipment?, type?, src?, missing? } } }
 *   matrix-lms:cms:html       -> { <relativePath>: htmlString }
 *   matrix-lms:cms:auth       -> { unlocked: true } once admin logs in
 *
 * Auth gate is theatre — all changes are local until exported and committed.
 * Phase 2 (real backend) replaces this whole module with API calls.
 */
(function () {
  'use strict';

  const KEY_COURSES = 'matrix-lms:cms:courses';
  const KEY_SCREENS = 'matrix-lms:cms:screens';
  const KEY_HTML = 'matrix-lms:cms:html';
  const KEY_AUTH = 'matrix-lms:cms:auth';

  /* The "password" — local-only gate. Real auth is Phase 2 work.
     Override by setting localStorage['matrix-lms:cms:custom-password'] = 'something' */
  const DEFAULT_PASSWORD = 'matrix';

  function loadJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); }
    catch (_) { return {}; }
  }
  function saveJson(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

  function getCourseOverride(courseId) {
    const all = loadJson(KEY_COURSES);
    return all[courseId] || null;
  }
  function getScreenOverrides(courseId) {
    const all = loadJson(KEY_SCREENS);
    return all[courseId] || {};
  }
  function getHtmlOverride(path) {
    const all = loadJson(KEY_HTML);
    return all[path] || null;
  }

  function setCourseOverride(courseId, patch) {
    const all = loadJson(KEY_COURSES);
    all[courseId] = Object.assign({}, all[courseId] || {}, patch);
    saveJson(KEY_COURSES, all);
  }
  function setScreenOverride(courseId, screenId, patch) {
    const all = loadJson(KEY_SCREENS);
    if (!all[courseId]) all[courseId] = {};
    all[courseId][screenId] = Object.assign({}, all[courseId][screenId] || {}, patch);
    saveJson(KEY_SCREENS, all);
  }
  function setHtmlOverride(path, html) {
    const all = loadJson(KEY_HTML);
    all[path] = html;
    saveJson(KEY_HTML, all);
  }
  function clearAll() {
    localStorage.removeItem(KEY_COURSES);
    localStorage.removeItem(KEY_SCREENS);
    localStorage.removeItem(KEY_HTML);
  }
  function clearCourse(courseId) {
    const c = loadJson(KEY_COURSES); delete c[courseId]; saveJson(KEY_COURSES, c);
    const s = loadJson(KEY_SCREENS); delete s[courseId]; saveJson(KEY_SCREENS, s);
  }

  /* Apply overrides to a parsed course object — returns a new course object
     with edits merged in. Does not mutate the input. */
  function applyOverrides(course) {
    if (!course || typeof course !== 'object') return course;
    /* A sheet-controlled course (loaded by sheet-loader.js) is the
       SOLE source of structural truth. Don't append admin-added
       screens to it; the publisher manages the screen list in the
       Google Sheet. (Per-screen content overrides — pages table —
       still apply via getHtmlOverride at render time.) */
    const fromSheet = course._source === 'sheet';
    const courseOverride = getCourseOverride(course.id);
    const screenOverrides = getScreenOverrides(course.id);
    const merged = Object.assign({}, course, courseOverride || {});
    const origIds = {};
    (course.screens || []).forEach((s) => { origIds[s.id] = true; });
    /* Originals with any overrides applied. Position defaults to the
       courses.json / sheet index — so an un-overridden course keeps
       its original order, and reordering writes explicit positions. */
    let screens = (course.screens || []).map((s, i) => {
      const o = screenOverrides[s.id];
      const out = (o && !fromSheet) ? Object.assign({}, s, o) : Object.assign({}, s);
      if (out.position == null || out.position === '') out.position = i;
      return out;
    });
    if (!fromSheet) {
      /* Append admin-added screens (present in overrides but not in
         courses.json) for non-sheet courses only. */
      const added = Object.keys(screenOverrides)
        .filter((id) => !origIds[id] && screenOverrides[id] && screenOverrides[id].src)
        .map((id) => Object.assign({ id: id }, screenOverrides[id]));
      if (added.length) screens = screens.concat(added);
    }
    /* Filter out screens the editor deleted (local-only, Phase 1).
       This still works for sheet courses too. */
    const deleted = getDeletedScreens(course.id);
    if (deleted.length) {
      const ds = {}; deleted.forEach((id) => { ds[id] = true; });
      screens = screens.filter((s) => !ds[s.id]);
    }
    /* Defensive dedupe by screen id so a stale override + a fresh
       sheet row can never both surface for the same screen. */
    const seen = {};
    screens = screens.filter((s) => {
      if (!s || !s.id) return false;
      if (seen[s.id]) return false;
      seen[s.id] = true;
      return true;
    });
    /* Final order is by position. */
    screens.sort((a, b) => (a.position || 0) - (b.position || 0));
    merged.screens = screens;
    return merged;
  }

  const KEY_DELETED = 'matrix-lms:cms:deleted-screens';
  function getDeletedScreens(courseId) {
    try {
      const all = JSON.parse(localStorage.getItem(KEY_DELETED) || '{}');
      return all[courseId] || [];
    } catch (_) { return []; }
  }
  function addDeletedScreen(courseId, screenId) {
    try {
      const all = JSON.parse(localStorage.getItem(KEY_DELETED) || '{}');
      const arr = all[courseId] || [];
      if (arr.indexOf(screenId) < 0) arr.push(screenId);
      all[courseId] = arr;
      localStorage.setItem(KEY_DELETED, JSON.stringify(all));
    } catch (_) {}
  }
  function removeDeletedScreen(courseId, screenId) {
    try {
      const all = JSON.parse(localStorage.getItem(KEY_DELETED) || '{}');
      const arr = (all[courseId] || []).filter((x) => x !== screenId);
      all[courseId] = arr;
      localStorage.setItem(KEY_DELETED, JSON.stringify(all));
    } catch (_) {}
  }

  /* Course-level soft delete (local-only, same Phase-1 approach). */
  const KEY_DELETED_COURSES = 'matrix-lms:cms:deleted-courses';
  function getDeletedCourses() {
    try { return JSON.parse(localStorage.getItem(KEY_DELETED_COURSES) || '[]'); }
    catch (_) { return []; }
  }
  function addDeletedCourse(courseId) {
    try {
      const arr = JSON.parse(localStorage.getItem(KEY_DELETED_COURSES) || '[]');
      if (arr.indexOf(courseId) < 0) arr.push(courseId);
      localStorage.setItem(KEY_DELETED_COURSES, JSON.stringify(arr));
    } catch (_) {}
  }
  function removeDeletedCourse(courseId) {
    try {
      const arr = JSON.parse(localStorage.getItem(KEY_DELETED_COURSES) || '[]').filter((x) => x !== courseId);
      localStorage.setItem(KEY_DELETED_COURSES, JSON.stringify(arr));
    } catch (_) {}
  }

  /* Apply HTML override at fetch time — replaces the file content with the
     edited version if one exists. Used by the worksheet renderer in app.js. */
  function applyHtmlOverride(path, originalText) {
    const o = getHtmlOverride(path);
    return o == null ? originalText : o;
  }

  function hasAnyEdits() {
    return Object.keys(loadJson(KEY_COURSES)).length > 0
        || Object.keys(loadJson(KEY_SCREENS)).length > 0
        || Object.keys(loadJson(KEY_HTML)).length > 0;
  }

  /* ----- Auth (local-only theatre — Phase 1) -----
   *
   * Phase 1 has no backend, so there's nothing to actually authenticate against.
   * Per the user's direction the form is purely a UI gate — anyone who clicks
   * Sign In gets in. The form fields are pre-filled and any value is accepted.
   * Phase 2 (real backend) replaces this with a server-side session.
   */
  function isUnlocked() {
    return Boolean(loadJson(KEY_AUTH).unlocked);
  }
  function unlock(_password) {
    /* Always succeeds — no real auth in Phase 1. */
    saveJson(KEY_AUTH, { unlocked: true, ts: Date.now() });
    return true;
  }
  function lock() {
    localStorage.removeItem(KEY_AUTH);
  }

  /* ----- Export ----- */
  async function buildExportPayload(originalCourses) {
    const couresOverrides = loadJson(KEY_COURSES);
    const screenOverrides = loadJson(KEY_SCREENS);
    const htmlOverrides = loadJson(KEY_HTML);

    /* Build a fully-merged courses.json */
    const merged = { courses: originalCourses.courses.map((c) => applyOverrides(c)) };

    return {
      'data/courses.json': JSON.stringify(merged, null, 2) + '\n',
      ...Object.fromEntries(
        Object.entries(htmlOverrides).map(([path, html]) => [path, html])
      )
    };
  }

  async function exportZip(originalCourses) {
    /* No jszip in the browser — fall back to multiple file downloads. */
    const payload = await buildExportPayload(originalCourses);
    for (const [path, content] of Object.entries(payload)) {
      const blob = new Blob([content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = path.split(/[\\/]/).pop();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await new Promise((r) => setTimeout(r, 250)); /* let browser breathe between downloads */
    }
  }

  window.MatrixCMS = {
    applyOverrides,
    applyHtmlOverride,
    getCourseOverride,
    getScreenOverrides,
    getHtmlOverride,
    setCourseOverride,
    setScreenOverride,
    setHtmlOverride,
    clearCourse,
    clearAll,
    hasAnyEdits,
    isUnlocked,
    unlock,
    lock,
    exportZip,
    buildExportPayload,
    /* Delete API — Phase-1 soft hide for originals (the file lives in
       the repo), local-only so a pull won't bring it back. */
    addDeletedScreen,
    getDeletedScreens,
    removeDeletedScreen,
    addDeletedCourse,
    getDeletedCourses,
    removeDeletedCourse
  };
})();

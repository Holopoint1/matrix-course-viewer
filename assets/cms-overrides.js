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
    const courseOverride = getCourseOverride(course.id);
    const screenOverrides = getScreenOverrides(course.id);
    const merged = Object.assign({}, course, courseOverride || {});
    merged.screens = (course.screens || []).map((s) => {
      const o = screenOverrides[s.id];
      return o ? Object.assign({}, s, o) : s;
    });
    return merged;
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
    buildExportPayload
  };
})();

/* Matrix LMS — SCORM 1.2 runtime bridge
 * Detects the SCORM API on window.parent / window.opener walks, maps
 * Course-Viewer events (start, screen-complete, course-complete) to
 * SCORM data-model values, and commits them.
 *
 * Loaded only inside SCORM packages (alongside an `imsmanifest.xml`).
 * Outside SCORM (e.g. on GitHub Pages), the global `MatrixSCORM` is
 * inert — `find()` returns null and every method becomes a no-op.
 */
(function () {
  'use strict';

  let api = null;
  let initialised = false;
  let courseId = null;
  let totalScreens = 0;
  let sessionStartedAt = null;

  function find() {
    if (api) return api;
    let win = window;
    let depth = 0;
    while (win && depth < 12) {
      if (win.API) { api = win.API; return api; }                /* SCORM 1.2 */
      if (win.API_1484_11) { api = win.API_1484_11; return api; } /* SCORM 2004 */
      if (win.parent && win.parent !== win) { win = win.parent; }
      else if (win.opener && win.opener !== win) { win = win.opener; }
      else { break; }
      depth += 1;
    }
    return null;
  }

  function set(key, value) {
    if (!api || !initialised) return false;
    try {
      const ok = api.LMSSetValue(key, String(value));
      return ok === 'true' || ok === true;
    } catch (_) { return false; }
  }
  function commit() {
    if (!api || !initialised) return false;
    try { return api.LMSCommit('') === 'true'; } catch (_) { return false; }
  }

  function init(opts) {
    api = find();
    if (!api) return false;
    courseId = opts && opts.courseId ? opts.courseId : null;
    totalScreens = opts && opts.totalScreens ? Number(opts.totalScreens) : 0;
    sessionStartedAt = Date.now();
    try {
      const ok = api.LMSInitialize('');
      initialised = ok === 'true' || ok === true;
    } catch (_) { initialised = false; }
    if (!initialised) return false;
    set('cmi.core.lesson_status', 'incomplete');
    commit();
    return true;
  }

  function screenComplete(completed, total) {
    if (!initialised) return;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    set('cmi.core.score.raw', String(pct));
    set('cmi.core.score.min', '0');
    set('cmi.core.score.max', '100');
    if (completed >= total && total > 0) {
      set('cmi.core.lesson_status', 'completed');
    } else {
      set('cmi.core.lesson_status', 'incomplete');
    }
    commit();
  }

  function courseComplete() {
    if (!initialised) return;
    set('cmi.core.lesson_status', 'completed');
    set('cmi.core.score.raw', '100');
    commit();
  }

  function finish() {
    if (!initialised) return;
    if (sessionStartedAt) {
      const secs = Math.floor((Date.now() - sessionStartedAt) / 1000);
      set('cmi.core.session_time', secondsToScormTime(secs));
    }
    commit();
    try { api.LMSFinish(''); } catch (_) {}
    initialised = false;
  }

  function secondsToScormTime(secs) {
    /* SCORM 1.2 format: HHHH:MM:SS.SS */
    secs = Math.max(0, Math.floor(secs));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return String(h).padStart(4, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.00';
  }

  /* Auto-finish on page unload */
  window.addEventListener('beforeunload', finish);
  window.addEventListener('pagehide', finish);

  window.MatrixSCORM = { find, init, screenComplete, courseComplete, finish, isActive: () => initialised };
})();

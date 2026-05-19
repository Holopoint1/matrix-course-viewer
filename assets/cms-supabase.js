/* ============================================================================
 * cms-supabase.js — Phase 2 data layer (FAIL-OPEN)
 *
 * Decorates the existing window.MatrixCMS (from cms-overrides.js) so the
 * editable layer is backed by Supabase instead of only localStorage —
 * WITHOUT changing the synchronous MatrixCMS API the pages rely on.
 *
 * Strategy: stale-while-revalidate. The proven local engine keeps serving
 * instantly from localStorage; on load we pull the latest from Supabase
 * into those same localStorage keys, and (once per session, viewer pages
 * only) reload so the existing engine renders the fresh data. Setters also
 * push to Supabase when an editor is signed in.
 *
 * Safety: every Supabase touch is wrapped — any missing SDK / config /
 * network error / empty project makes this a complete no-op, so the live
 * site behaves EXACTLY as before until the Phase 1 seed has run.
 *
 * Load order (after the SDK + config + cms-overrides.js):
 *   cms-overrides.js → supabase-js (UMD) → supabase-config.js → cms-supabase.js
 * ==========================================================================*/
(function () {
  'use strict';

  var CMS = window.MatrixCMS;
  var CFG = window.MATRIX_SUPABASE;
  var SDK = window.supabase;
  if (!CMS || !CFG || !SDK || !CFG.url || !CFG.publishableKey) return; /* fail-open */

  var KEY_COURSES = 'matrix-lms:cms:courses';
  var KEY_SCREENS = 'matrix-lms:cms:screens';
  var KEY_HTML    = 'matrix-lms:cms:html';
  var SYNC_FLAG   = 'matrix-sb-synced';

  var sb;
  try {
    sb = SDK.createClient(CFG.url, CFG.publishableKey, { auth: { persistSession: true } });
  } catch (_) { return; }

  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (_) { return {}; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  var isAdmin = /admin\.html$/i.test(location.pathname);

  /* ---- Pull Supabase → localStorage (the existing engine reads these) ---- */
  async function pull() {
    try {
      var res = await Promise.all([
        sb.from('courses').select('*'),
        sb.from('screens').select('*'),
        sb.from('pages').select('*')
      ]);
      var courses = res[0].data, screens = res[1].data, pages = res[2].data;
      if (res[0].error || res[1].error || res[2].error) return;          /* fail-open */
      if (!courses || !courses.length) return;          /* not seeded yet → no-op */

      var cOv = {}, sOv = {}, hOv = {};
      courses.forEach(function (c) {
        cOv[c.id] = {
          title: c.title, code: c.code,
          shortDescription: c.short_description,
          estimatedHours: c.estimated_hours
          /* certificate left to the static course (keeps templateName) */
        };
      });
      (screens || []).forEach(function (s) {
        (sOv[s.course_id] = sOv[s.course_id] || {})[s.id] = {
          title: s.title, hours: s.hours, equipment: s.equipment,
          type: s.type, src: s.src, missing: !!s.missing
        };
      });
      (pages || []).forEach(function (p) { if (p && p.path != null) hOv[p.path] = p.html || ''; });

      var prev = localStorage.getItem(KEY_HTML) || '';
      writeJSON(KEY_COURSES, cOv);
      writeJSON(KEY_SCREENS, sOv);
      writeJSON(KEY_HTML, hOv);

      /* Once per session, on viewer pages, reload so app.js re-applies the
         now-fresh overrides. Flag is set first so this can't loop; admin is
         skipped so an editing session isn't interrupted. */
      if (!isAdmin && !sessionStorage.getItem(SYNC_FLAG)) {
        sessionStorage.setItem(SYNC_FLAG, '1');
        if (prev !== JSON.stringify(hOv)) location.reload();
      } else {
        sessionStorage.setItem(SYNC_FLAG, '1');
      }
    } catch (_) { /* fail-open: keep whatever the local engine had */ }
  }

  /* ---- Push localStorage edits → Supabase (editors only) ---------------- */
  function authed() {
    try { return !!(sb.auth && sb.__session); } catch (_) { return false; }
  }
  async function push(table, row) {
    try { if (authed()) await sb.from(table).upsert(row); } catch (_) {}
  }
  function wrap(name, fn) {
    var orig = CMS[name];
    if (typeof orig !== 'function') return;
    CMS[name] = function () {
      var r = orig.apply(CMS, arguments);
      try { fn.apply(null, arguments); } catch (_) {}
      return r;
    };
  }
  wrap('setCourseOverride', function (courseId, patch) {
    var p = patch || {};
    push('courses', {
      id: courseId,
      title: p.title, code: p.code,
      short_description: p.shortDescription,
      estimated_hours: p.estimatedHours
    });
  });
  wrap('setScreenOverride', function (courseId, screenId, patch) {
    var p = patch || {};
    push('screens', {
      id: screenId, course_id: courseId,
      title: p.title, hours: p.hours, equipment: p.equipment,
      type: p.type, src: p.src, missing: p.missing
    });
  });
  wrap('setHtmlOverride', function (path, html) {
    push('pages', { path: path, html: html });
  });

  /* ---- Auth helpers (used by the Phase 3 editor; harmless here) --------- */
  sb.auth.getSession().then(function (r) { sb.__session = r && r.data ? r.data.session : null; }).catch(function () {});
  sb.auth.onAuthStateChange(function (_e, session) { sb.__session = session; });
  CMS.supabaseClient = sb;
  CMS.supabaseAuth = {
    signInWithEmail: function (email) {
      return sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href } });
    },
    signOut: function () { return sb.auth.signOut(); },
    session: function () { return sb.__session || null; },
    onChange: function (cb) { return sb.auth.onAuthStateChange(function (_e, s) { cb(s); }); }
  };

  pull();
})();

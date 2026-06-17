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
  var KEY_DIRTY   = 'matrix-lms:cms:dirty';   /* page paths edited locally, awaiting a confirmed Supabase save */
  var KEY_DBCOURSES = 'matrix-lms:db-courses'; /* full course objects rebuilt from Supabase (for discovery) */
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
    /* Clear the discovered-courses cache UP FRONT (synchronously, before any
       await) so it's empty by the time the catalogue's mergeCourses() runs on
       this same load. dbCourses is sourced ONLY from a live Supabase pull, so
       if the project is gone/empty/unreachable this stays empty and no ghost
       courses (deleted in the files, or removed in admin) can survive in the
       catalogue. A successful pull below repopulates it from live data. */
    try { localStorage.removeItem(KEY_DBCOURSES); } catch (_) {}
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
          type: s.type, src: s.src, missing: !!s.missing, position: s.position
        };
      });
      (pages || []).forEach(function (p) { if (p && p.path != null) hOv[p.path] = p.html || ''; });

      /* Keep any page edited locally but not yet CONFIRMED saved to
         Supabase — otherwise this pull wipes an edit that is still
         syncing (or whose push failed / lost the race). Once the push
         succeeds the path is cleared from KEY_DIRTY and the remote
         copy is allowed to win again. */
      var dirty = readJSON(KEY_DIRTY);
      var localHtml = readJSON(KEY_HTML);
      Object.keys(dirty).forEach(function (path) {
        if (Object.prototype.hasOwnProperty.call(localHtml, path)) hOv[path] = localHtml[path];
      });
      var prev = localStorage.getItem(KEY_HTML) || '';
      writeJSON(KEY_COURSES, cOv);
      writeJSON(KEY_SCREENS, sOv);
      writeJSON(KEY_HTML, hOv);

      /* Rebuild every Supabase course as a full course object so the
         catalog / editor / viewer can DISCOVER courses that aren't in the
         static data/courses.json (e.g. ones added in Admin). Consumers
         call MatrixCMS.mergeCourses(staticList) to fold these in. */
      var byCourse = {};
      (screens || []).forEach(function (s) {
        (byCourse[s.course_id] = byCourse[s.course_id] || []).push(s);
      });
      writeJSON(KEY_DBCOURSES, courses.map(function (c) {
        var scr = (byCourse[c.id] || []).slice()
          .sort(function (a, b) { return (a.position || 0) - (b.position || 0); })
          .map(function (s) {
            return { id: s.id, type: s.type, title: s.title, hours: s.hours,
                     equipment: s.equipment, src: s.src, missing: !!s.missing };
          });
        return {
          id: c.id, code: c.code || c.id, kind: c.kind || 'course',
          title: c.title || '', shortDescription: c.short_description || '',
          estimatedHours: Number(c.estimated_hours) || 0,
          certificate: { enabled: !!c.certificate_enabled },
          categories: Array.isArray(c.categories) ? c.categories : [],
          screens: scr
        };
      }));

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

  /* ---- Push localStorage edits → Supabase (editors only) ---------------- *
   * Live writes: debounced per-record so rapid typing collapses to one
   * upsert. Partial payloads are safe — PostgREST upsert only updates the
   * columns present, and all rows already exist from the seed. Every
   * attempt emits a `matrixcms:save` window event so the editor can show
   * real success / failure (RLS rejection included). */
  function authed() {
    try { return !!(sb.auth && sb.__session); } catch (_) { return false; }
  }
  function emit(detail) {
    try { window.dispatchEvent(new CustomEvent('matrixcms:save', { detail: detail })); } catch (_) {}
  }
  function clean(o) { var r = {}; for (var k in o) if (o[k] !== undefined) r[k] = o[k]; return r; }
  var _timers = {};
  /* OPEN ACCESS (interim): no login yet, so writes are NOT gated on a
     session here — the (temporarily) permissive RLS policy is the gate.
     When logins return, restore the `if (!authed()) return` guard AND
     re-lock RLS to editor-only. */
  function push(table, row) {
    var payload = clean(row);
    var key = table + ':' + (payload.id || payload.path || '');
    emit({ ok: null, table: table });                       /* "saving…" */
    clearTimeout(_timers[key]);
    _timers[key] = setTimeout(function () {
      sb.from(table).upsert(payload).then(function (res) {
        if (res && res.error) { console.warn('[cms-supabase]', table, res.error.message); emit({ ok: false, table: table, error: res.error.message }); }
        else {
          /* Confirmed in Supabase — a later pull may now safely take the
             remote copy of this page back. */
          if (table === 'pages' && payload.path) {
            try { var d = readJSON(KEY_DIRTY); delete d[payload.path]; writeJSON(KEY_DIRTY, d); } catch (_) {}
          }
          emit({ ok: true, table: table });
        }
      }, function (e) {
        var m = (e && e.message) ? e.message : String(e);
        console.warn('[cms-supabase]', table, m); emit({ ok: false, table: table, error: m });
      });
    }, 350);
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
    var p = patch || {}, row = { id: courseId };
    if (p.title !== undefined) row.title = p.title;
    if (p.code !== undefined) row.code = p.code;
    if (p.shortDescription !== undefined) row.short_description = p.shortDescription;
    if (p.estimatedHours !== undefined) row.estimated_hours = p.estimatedHours;
    if (p.certificate !== undefined) row.certificate_enabled = !!(p.certificate && p.certificate.enabled);
    if (Object.keys(row).length > 1) push('courses', row);
  });
  wrap('setScreenOverride', function (courseId, screenId, patch) {
    var p = patch || {}, row = { id: screenId, course_id: courseId };
    ['title', 'hours', 'equipment', 'type', 'src', 'missing', 'position'].forEach(function (k) {
      if (p[k] !== undefined) row[k] = p[k];
    });
    if (Object.keys(row).length > 2) push('screens', row);
  });
  wrap('setHtmlOverride', function (path, html) {
    /* Mark the page locally-edited so a concurrent / subsequent pull
       can't overwrite it before Supabase confirms the save. */
    try { var d = readJSON(KEY_DIRTY); d[path] = 1; writeJSON(KEY_DIRTY, d); } catch (_) {}
    push('pages', { path: path, html: html });
  });

  /* ---- Auth helpers (used by the Phase 3 editor) ----------------------- */
  sb.auth.getSession().then(function (r) { sb.__session = r && r.data ? r.data.session : null; }).catch(function () {});
  sb.auth.onAuthStateChange(function (_e, session) { sb.__session = session; });
  CMS.supabaseClient = sb;
  /* Course discovery: full course objects pulled from Supabase, and a
     merge helper so any consumer can fold in courses that aren't in the
     static data/courses.json. */
  CMS.dbCourses = function () {
    try { return JSON.parse(localStorage.getItem(KEY_DBCOURSES) || '[]') || []; }
    catch (_) { return []; }
  };
  CMS.mergeCourses = function (staticList) {
    var out = (staticList || []).slice();
    var byId = {};
    out.forEach(function (c, i) { if (c && c.id) byId[c.id] = i; });
    /* Supabase-only courses (added in admin) — append if not in static. */
    CMS.dbCourses().forEach(function (c) {
      if (!c || !c.id) return;
      if (byId[c.id] == null) { byId[c.id] = out.length; out.push(c); }
    });
    /* Google Sheet courses — REPLACE the static / Supabase version
       (sheet is the publisher-controlled structure source). */
    if (window.MatrixSheets && typeof window.MatrixSheets.cached === 'function') {
      window.MatrixSheets.cached().forEach(function (c) {
        if (!c || !c.id) return;
        if (byId[c.id] != null) out[byId[c.id]] = c;
        else { byId[c.id] = out.length; out.push(c); }
      });
    }
    return out;
  };
  CMS.supabaseAuth = {
    getSession: function () { return sb.auth.getSession(); },
    signInWithPassword: function (email, password) {
      return sb.auth.signInWithPassword({ email: email, password: password });
    },
    signInWithEmail: function (email) {
      return sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href } });
    },
    signOut: function () { return sb.auth.signOut(); },
    session: function () { return sb.__session || null; },
    email: function () { try { return sb.__session && sb.__session.user && sb.__session.user.email || null; } catch (_) { return null; } },
    onChange: function (cb) { return sb.auth.onAuthStateChange(function (_e, s) { cb(s); }); }
  };

  pull();
})();

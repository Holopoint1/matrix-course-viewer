# Build tools

Author-time scripts. **Not** loaded at runtime — the LMS itself has zero npm dependencies.

## SCORM 1.2 package builder — `build-scorm.js`

```sh
npm install                       # one-off, installs jszip
node tools/build-scorm.js         # all courses
node tools/build-scorm.js CO0002  # just one
```

Output: `dist/SC<id>-<slug>.zip` per course.

Each zip is a self-contained SCORM 1.2 SCO containing:

- `imsmanifest.xml` — single organization, single SCO, points at `index.html`
- `index.html` — the course viewer (`course.html`) with the course id baked in and `scorm-api.js` wired up
- `certificate.html` — when the course offers a certificate
- `assets/` — styles, embedded.css, app.js, gamify.js, the Matrix logo, and `mammoth.browser.min.js` **vendored locally** (downloaded once from CDN into `tools/scorm-template/` and reused)
- `data/courses.json` — filtered to just the one course
- `data/achievements.json`
- `content/` — only the files this course actually references; missing assets are skipped (the viewer's "Asset not yet available" placeholder still renders inside SCORM)
- `scorm-api.js` — runtime bridge

### How the bridge works

`scorm-api.js` walks `window.parent` / `window.opener` looking for `window.API` (SCORM 1.2) or `window.API_1484_11` (SCORM 2004 fallback). If found:

- On startup: `LMSInitialize('')`, sets `cmi.core.lesson_status = incomplete`, commits.
- On every screen tick (in `app.js`): updates `cmi.core.score.raw` to the percentage, sets `lesson_status = completed` once 100% is reached, commits.
- On `beforeunload` / `pagehide`: writes `cmi.core.session_time`, commits, calls `LMSFinish('')`.

Outside SCORM (e.g. on GitHub Pages), `MatrixSCORM.isActive()` returns `false` and every method becomes a no-op — the same files run unchanged.

### File layout

```
tools/
├─ README.md              ← this file
├─ build-scorm.js         ← Node build script
└─ scorm-template/
   ├─ scorm-api.js        ← copied into every zip as /scorm-api.js
   ├─ imsmanifest.xml.tpl ← {{IDENTIFIER}}, {{COURSE_ID}}, {{TITLE}} substitutions
   └─ mammoth.browser.min.js  ← vendored on first build, reused after
```

### Testing a SCORM zip

Drop the zip into any SCORM 1.2 LMS — Moodle, Canvas, TalentLMS, SCORM Cloud (https://cloud.scorm.com — free trial, easiest for sanity checks).

If the LMS reports `cmi.core.lesson_status = completed` and a non-zero `cmi.core.session_time` after a learner ticks every screen, the bridge is working.

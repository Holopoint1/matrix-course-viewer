# Matrix Course Viewer — System Reference

A static course-viewer site whose **single source of truth is Google Drive**. You manage
courses entirely in Drive; a scheduled job mirrors them into this repo and GitHub Pages
serves them. There is **no database, no CMS, and no in-browser editing** — the site shows
*exactly* what is in Drive, and nothing else.

- **Live site:** https://holopoint1.github.io/matrix-course-viewer/
- **Repo:** `Holopoint1/matrix-course-viewer` (GitHub Pages = deploy from `main`, root)
- **Last reviewed:** 2026-06-24

---

## 1. How it works (the whole pipeline)

```
   YOU (Google Drive)            GitHub Action (every ~5 min / on change / manual)        GitHub Pages
   ──────────────────           ───────────────────────────────────────────────         ────────────
   "LMS Project Assets"/        tools/sync-drive.mjs:                                     serves the repo
     <CODE> - Title/              1. DOWNLOAD every file → content/<CODE>/ (true mirror)   as the live static
       <CODE> - definition  ──▶   2. MIRROR/PRUNE: delete content not in Drive            site (no build step;
       <files…>                   3. GENERATE data/courses.json from each definition       .nojekyll)
                                  4. write content/_sync-report.json (health)
                                  5. commit + push + trigger a Pages rebuild
```

**The rule:** edit Drive → wait ≤5 min (or press "Sync from Drive now" in admin) → the live
site matches Drive.

---

## 2. Key parameters / IDs

| Thing | Value |
|---|---|
| Drive root folder | **"LMS Project Assets"** — `1MejJoVtqL2O7PxNwc3HYbrN_PmwqlFYu` |
| Sync workflow | `.github/workflows/sync-from-drive.yml` — triggers: cron `*/5 * * * *`, push to `tools/sync-drive.mjs` \| `data/sheets.json` \| the workflow, and manual dispatch (default course = `''` = full sync) |
| Sync script | `tools/sync-drive.mjs` (Node + `googleapis`) |
| Drive auth | service-account JSON in the repo secret **`DRIVE_SA_KEY`** (shared *Viewer* on the root folder). Never put it in the site or in chat. |
| Registered courses | `data/sheets.json` (code, title, kind, description, certificate, categories, sheet URL) |
| Generated catalogue | `data/courses.json` (rebuilt every sync — **do not hand-edit**) |
| Downloaded content | `content/<CODE>/…` (a true mirror of each Drive folder, flattened by filename) |
| Health report | `content/_sync-report.json` (summary, per-course missing/auto-fixed, removed, failures, collisions) |
| Manual-sync worker | `https://matrix-course-sync.ad5046.workers.dev/` (key `mcv-publish-9f3a2c`) — used by the admin "Sync from Drive now" button |
| Jekyll off | `.nojekyll` at repo root (**required** — see §7) |

---

## 3. Defining a course

A course is a Drive **folder** named `<CODE> - Title` (code = 2 letters + 4 digits, e.g.
`CO0002 - Introduction to microcontrollers`) under "LMS Project Assets", containing:

1. A **`<CODE> - definition` Google Sheet** — the ordered screen list. Columns:
   `Screen type | Hours | Equipment | Title | File`.
   - `Screen type`: `Image, HTML, Document, PowerPoint, Spreadsheet, PDF, YouTube`.
   - `File`: the file's name (the sync finds it in the folder, incl. a `media/` subfolder),
     or a full URL for YouTube / web PDFs.
2. The **content files** (Word/img/pptx/xlsx/htm), optionally inside a `media/` subfolder.

A course becomes **live** one of two ways:
- **Registered** in `data/sheets.json` (always published), or
- **Auto-discovered** — the sync finds the `<CODE> - definition` sheet and publishes it
  **only if** its settings block says `Active: yes` (else it's held back as a draft).

> A Google **Sheet** named `… definition` is the control sheet and is never published.
> A Google **Doc** named `… definition` *is* published (it's content, not a control sheet).

---

## 4. The naming contract (read this — it prevents 99% of issues)

**The site shows ONLY what is in the course's Drive folder.** If the `File` named in a
definition isn't there, the screen shows **"missing"** — it will *never* fall back to an
old, cached, or copied file. (Non-Drive leftovers are deleted from the site every sync.)

Matching is **exact**, forgiving *only* invisible typography:
- **letter-case** (`Equip.HTM` ≡ `equip.htm`) — the live server is Linux/case-sensitive,
  so the sync canonicalises case;
- **hyphen vs en/em-dash** (`-` ≡ `–` ≡ `—`) — Word/Drive autocorrect silently swaps these;
- **interchangeable extensions** (`.htm` ≡ `.html`, `.jpg` ≡ `.jpeg`).

Everything else must match for real: different words, digits, or distinct formats
(`.docx` ≠ `.htm`, `.png` ≠ `.jpg`) are treated as different files.

Practical rules for publishers:
- Put the actual file in the **course's own Drive folder** (or its `media/` subfolder).
- Don't give Google Docs a fake extension in the title (`My doc.HTM`) — it exports as
  `.docx`; name it plainly (`My doc`).
- Keep filenames consistent; lower-case is safest.

---

## 5. What makes it bulletproof

- **Drive-only** — the old admin/Supabase override layer is retired and **inert**
  (`assets/cms-overrides.js` purges any old browser edits on load). Nothing can shadow the
  synced file. (Supabase is dead and fully unwired.)
- **True mirror** — `content/<CODE>` is pruned every sync to exactly the Drive folder, so a
  renamed/removed/leftover file can never be served. Removed files are listed in
  `_sync-report.json` → `removed`.
- **Per-file cache-busting** — every file is stamped with a content hash (`screen.v` in
  `courses.json`); the viewer appends `?v=<hash>` to every fetch/embed (incl. the Office
  viewer), so a same-name Drive edit shows **immediately**, never a stale browser/CDN/Office
  cache.
- **Robust sync** — transient download errors retry; real failures, name collisions, and
  removed files are recorded in `_sync-report.json` (and shown in admin).
- **Verified deploy** — bot commits explicitly trigger a Pages rebuild (Actions-token commits
  don't auto-trigger one); the workflow checks the trigger's HTTP status.

---

## 6. The admin page (`admin.html`)

A **live, read-only course-health dashboard** (no editing — everything is in Drive). It
re-reads `data/courses.json` + `content/_sync-report.json` on every load **and every 60s**,
so it's never static. It shows:
- overall health + a stat strip (courses, screens displaying, missing, auto-fixed, cleaned, fails);
- per course → per screen status: **✅ Displays / ❌ Missing (+reason) / 🔧 Auto-fixed / 🔗 Link**;
- **"Sync from Drive now"** (forces an immediate sync) and **Refresh**;
- the last-synced time and a short fix-it guide.

A ❌ Missing row is your to-do list: add that file (exact name) to the course's Drive folder.

---

## 7. Deployment notes

- GitHub Pages serves `main`/root directly — **every commit is published** (~30–90s).
- **`.nojekyll` is required.** Without it Pages runs Jekyll, which (a) refuses to serve
  `_`-prefixed files (`content/_sync-report.json` would 404 and the admin dashboard would be
  blank) and (b) adds a build step that lags/stalls deploys.
- **Bot commits don't auto-trigger Pages** (GitHub blocks the Actions token from triggering
  builds), so the workflow POSTs to `…/pages/builds` after each changed sync.
- When verifying, always check the **live** `github.io` URL (cache-busted), not just the repo —
  the repo can be ahead of what's deployed for a minute.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Screen shows **"missing"** | The `File` named in the definition isn't in the course's Drive folder. Add it (exact name) → next sync. |
| A change in Drive isn't live | Wait ≤5 min or press **Sync from Drive now**. Check the **live** URL (hard-refresh). |
| Wrong/old content showing | Shouldn't happen (mirror + cache-bust + no overrides). Hard-refresh once; if it persists, check `_sync-report.json` and the admin dashboard. |
| A course doesn't appear | It needs a live definition: register it in `data/sheets.json`, or set `Active: yes` in its definition sheet. |
| "Auto-fixed" on a screen | Harmless — the sheet name differed only by case/dash/extension. Tidy the name if you like. |

---

## 9. File map

```
index.html              catalogue (all courses + packs)
course.html             the viewer (renders a course's screens)
dashboard.html          per-course overview
admin.html              LIVE read-only health dashboard
certificate.html        certificate
assets/
  app.js                viewer logic (render + per-file cache-bust)
  chrome.js             header/sidebar shell (+ mobile drawer)
  sidebar.js            the screen-list menu
  cms-overrides.js      RETIRED/inert (purges old browser overrides)
  styles.css            all styling
data/
  sheets.json           registered courses → definition sheet URLs
  courses.json          generated catalogue (do not hand-edit)
content/<CODE>/…        mirror of each Drive course folder
content/_sync-report.json   health report (read by admin)
tools/sync-drive.mjs    the Drive→repo sync (runs in the Action)
.github/workflows/sync-from-drive.yml   the scheduled sync + Pages trigger
.nojekyll               disables Jekyll (required)
```

See also: `AUTHORING.md` (publisher how-to), `DEPLOYMENT.md` (deploy/sync detail),
`ADMIN.md` (the dashboard), `tools/README.md` (the sync script).

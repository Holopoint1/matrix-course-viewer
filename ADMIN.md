# Admin CMS

A browser-based content editor for non-technical users. Sign in once, edit any course or HTML page, and the changes show up live across the site. When ready, click **Export** to download files a developer can commit.

> **Phase 1** — runs on the static GitHub Pages host. Edits persist to **localStorage in your browser only**. Other users won't see your edits until a developer commits the exported files. Phase 2 (real multi-user backend) is documented in `ROADMAP.md`.

## Sign in

URL: <https://holopoint1.github.io/matrix-course-viewer/admin.html>

Demo credentials are **pre-filled** on the form — just click **Sign in**.

| Field    | Value   |
|----------|---------|
| Username | `admin` |
| Password | `matrix` |

To change the password (still local-only), open DevTools and:
```js
localStorage.setItem('matrix-lms:cms:custom-password', 'your-password-here');
```

## What you can edit

### Course meta
For each of CO0001 / CO0002 / CO0003:
- **Code** (e.g. `CO0002`)
- **Title**
- **Short description** — shown on the catalog card
- **Estimated hours**
- **Certificate enabled** — yes / no toggle

### Per-screen
For every screen in every course:
- **Title** — what learners see in the sidebar / screen-bar
- **Type** — image / html / youtube / pdf / document / powerpoint / spreadsheet
- **Hours** — time estimate
- **File path or URL**
- **Missing flag** — toggle on if the source file isn't ready yet (shows the friendly "Resource missing — please send `<filename>`" panel)

### HTML pages
The five intro / reference HTML files:
- `content/CO0001/cpd-objectives.html` — CPD objectives (Welcome screen for the CPD course)
- `content/CO0002/welcome.html`
- `content/CO0002/learning-objectives.html`
- `content/CO0002/equipment.html`
- `content/CO0003/welcome.html`

Each has a **Body HTML** textarea on the left and a **Live preview** iframe on the right that updates as you type.

## How edits propagate

Behind the scenes, `assets/cms-overrides.js` writes to four localStorage keys:

| Key                              | What's stored                                                |
|----------------------------------|--------------------------------------------------------------|
| `matrix-lms:cms:courses`         | Per-course meta overrides (`{ <id>: { title?, ...}}`)        |
| `matrix-lms:cms:screens`         | Per-screen overrides (`{ <courseId>: { <screenId>: {...}}}`) |
| `matrix-lms:cms:html`            | Per-file body-HTML overrides (`{ <path>: htmlString }`)      |
| `matrix-lms:cms:auth`            | `{ unlocked: true }` once you've signed in                    |

Every page that loads `data/courses.json` calls `MatrixCMS.applyOverrides(course)` on the parsed objects, so edits show up live on:
- Catalog (`index.html`)
- Dashboard (`dashboard.html?id=...`)
- Course viewer (`course.html?id=...`)
- Stats (`stats.html`)
- Certificate (`certificate.html?id=...`)

The course viewer also calls `MatrixCMS.getHtmlOverride(path)` when fetching HTML screens, so edits to welcome / LO / equipment / CPD-objectives pages appear immediately when a learner opens that screen.

## Exporting changes

Click **⤓ Export changes** in the admin sidebar. Your browser will download:

1. **`courses.json`** — the merged file (original + your overrides applied) — drop into `lms/data/courses.json` and commit
2. **One file per edited HTML page**, named after the original (`welcome.html`, `learning-objectives.html`, etc.) — drop each into the matching `lms/content/<COURSE_ID>/` folder and commit

Once the files are committed and pushed, GitHub Pages rebuilds in ~30-60s and **everyone** sees the changes (your localStorage edits become permanent).

## Clearing edits

- **Reset this course** (in the course editor) — drops just the meta + screen edits for the active course
- **Reset to original** (in the HTML editor) — drops just that file's override
- **Clear all overrides** (sidebar footer) — wipes everything, returns to the source courses.json
- **Sign out** (sidebar footer) — clears the unlock cookie; doesn't touch edits

## Limitations of Phase 1

| Limitation                                  | When it matters                                  | Phase 2 fix                                    |
|---------------------------------------------|--------------------------------------------------|------------------------------------------------|
| Edits are per-browser                       | Two admins editing in different browsers won't see each other's changes | Real DB on a real backend                  |
| Other users don't see edits until commit    | Live publishing requires dev intervention        | Save endpoint commits via GitHub API or DB     |
| No image / file upload (text edits only)    | Adding new media requires sending files to dev   | Multipart upload endpoint + Blob storage       |
| No version history / rollback               | Hard to undo across sessions                     | DB rows + soft-delete                          |
| Auth is local theatre                       | No actual authentication                         | NextAuth / Lucia / simple JWT + Vercel KV       |

See `ROADMAP.md` § Phase 2 backend for the migration path. The CMS frontend stays the same — only the persistence layer changes.

## For developers

Source files:
- `admin.html` — the admin UI itself
- `assets/cms-overrides.js` — the override engine; `window.MatrixCMS` API
- Every other page already loads `cms-overrides.js` and calls `applyOverrides()` on data fetch

To add a new editable field:
1. Add the input to the relevant editor section in `admin.html`
2. Persist via `MatrixCMS.setCourseOverride(...)` or `setScreenOverride(...)`
3. Read via `MatrixCMS.applyOverrides(course)` — already wired everywhere

To add a new editable HTML file, add a row to the `HTML_PAGES` array near the top of the `admin.html` script.

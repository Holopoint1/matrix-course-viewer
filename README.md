# Matrix Course Viewer

Browser-based learning management system for Matrix TSL engineering education courses, built on Flowcode and E-blocks 3 curriculum content.

> A static site — vanilla HTML / CSS / JS, single-file Node static server, no build step. Source content (`.docx`, `.htm`, `.pdf`) is rendered live in the browser.

## Courses

| Code     | Title                                            | Screens | Hours  | Certificate |
|----------|--------------------------------------------------|---------|--------|-------------|
| `CO0001` | Flowcode & E-blocks 3 CPD course                 | 15      | ~3.6   | ✓           |
| `CO0002` | Introduction to Microcontrollers                 | 42      | ~86    | ✓           |
| `CO0003` | Digital Techniques for Aviation Technicians      | 26      | ~36    | —           |

Naming convention from the master doc:
- `CO` — browser-based course
- `CP` — curriculum pack / worksheets (e.g. `CP4807`, `CP1972`, `CP0507`)
- `SC` — SCORM module *(not yet implemented)*

## Features

**Course viewer**
- Renders six screen types: Image, HTML, YouTube, PDF, Document (Word `.docx`), PowerPoint
- `.docx` worksheets rendered inline via [mammoth.js](https://github.com/mwilliamson/mammoth.js); also offered as Word download
- YouTube URLs embedded as 16:9 inline players
- Sidebar grouped by **Bronze / Silver / Gold** tiers per the master-doc pedagogy
- Progress saved in `localStorage` per course; toggle complete / incomplete on any screen
- Printable certificate when a course hits 100%

**Worksheet enhancer**
At render time the viewer rewrites docx / htm output for readability:
- Layout-only header tables collapse to a single violet metadata strip
- Pseudo-headings (`Design brief:`, `Hardware:`, `Software`, `Challenges:`, `Hints:`, `Over to you:`, `Technical risk`) get promoted to icon-chip `<h2>`s
- Topic lists (the short-paragraph runs under "Hardware:") group into bordered list items
- "There is no video for this worksheet" becomes an unobtrusive grey pill
- Source `.docx` / `.htm` files are **never modified** — transformation happens at render time

**Gamification**
- 20 achievements (First Steps, Bronze Champion, Tier Trifecta, Embedded Expert, Century Club, …) — see [`data/achievements.json`](data/achievements.json)
- Toast popup on every screen completion with a random compliment + `+1` badge
- 50-piece confetti burst on achievement unlock
- Day-streak counter
- Achievements grid on the dashboard (locked / unlocked states)

**My Stats page**
- Real per-screen time tracking (Page Visibility API, paused on tab hide)
- Per-course time totals + per-screen table
- All achievements + unlocked count + day streak (current + longest)
- Reset-all-progress button

**SCORM 1.2 packages**
- One self-contained zip per course at `dist/SC<id>-<slug>.zip`
- Built via `npm run build:scorm` (uses `jszip`)
- Each zip includes the full course viewer, mammoth.js vendored, the filtered course definition, and an `imsmanifest.xml`
- `scorm-api.js` bridge maps screen completion → `cmi.core.lesson_status`, `cmi.core.score.raw`, `cmi.core.session_time` etc.

**Combined PDF bundle**
- "Download all worksheets PDF" button in the course-viewer sidebar
- Renders every `document` screen via mammoth → composed HTML → PDF via `html2pdf.js`
- Filename pattern: `<course>-worksheets.pdf`
- Per-screen "Download as PDF" button on every worksheet
- "Download as PDF" on every Preview-page card

**Course Dashboard (`/dashboard.html?id=...`)**
- Per-course landing page reached from the catalog "Start course" button
- Hero with title / description / Bronze-Silver-Gold tier counts
- Verbatim "Before you start" preparation block from the master doc, with the Flowcode Embedded intro video embedded
- Promo cards: Matrix Multimedia YouTube channel, Flowcode YouTube channel, Flowcode software download
- Reference: Flowcode Wiki + matrixtsl.com / flowcode.co.uk links
- Worksheets grid grouped by tier with progress
- Persistent left sidebar (Dashboard / All Courses / per-tier numbered worksheet list / SCORM compliance / Worksheet compiler / Admin / Reset)

**Admin CMS (`/admin.html`)**
- Browser-based content editor for non-technical users — sign in with pre-filled `admin` / `matrix` credentials
- Edit course meta (title, code, description, hours, certificate)
- Per-screen editor (title, type, hours, path, missing flag)
- HTML page editor with live preview iframe (welcome / learning objectives / equipment / CPD objectives etc.)
- Edits persist to localStorage and apply live across the whole site
- "Export changes" downloads the merged `courses.json` + edited HTML files for a developer to commit
- Phase 1 (current): static-host friendly, per-browser. Phase 2 (real backend) on the roadmap.
- Full guide: [ADMIN.md](ADMIN.md)

**Resource-missing surfacing**
- "Resources to send" panel on the dashboard listing every missing file across courses with destination paths
- Per-screen "Resource missing — please send `<filename>`" panel inside the viewer
- Opening images flagged missing per master-doc filenames; catalog cards keep a thumbnail placeholder (`thumbnail` field) for visual continuity

**File manager (`/files.html`)**
- Resource browser that runs HEAD probes against the server to confirm exactly which files are present (✓) and which are missing (✗) — verifies your "is `Opening.png` really missing?" suspicion in seconds
- Drag-drop staging zone — files are auto-routed to the right folder based on filename (`CP4807-N.docx` → `content/CP4807/`, `CO002 - opening.png` → `content/CO0002/`, etc.)
- Click "Send file →" next to any missing row to upload directly into that path
- Editable target path per staged file
- "Download zip" produces `matrix-files.zip` with the correct folder structure and a README — drop the zip on a developer, they unzip into `lms/` and commit, the missing-resource panels disappear automatically

## Quick start

The runtime needs **no npm install** — uses only Node built-ins:

```sh
node server.js
```

Default port `4173`. Override with `PORT=4000 node server.js`.

Open <http://localhost:4173/>.

**Build SCORM packages** (one-off, requires `npm install`):

```sh
npm install                          # installs jszip dev-dep
npm run build:scorm                  # builds all 3 SCORM zips into dist/
npm run build:scorm:CO0002           # just one course
```

## Project structure

```
lms/
├─ index.html            # Catalog (dashboard) — courses + achievements
├─ course.html           # Course viewer — sidebar + main stage
├─ certificate.html      # Printable certificate of completion
├─ server.js             # Static node server (no deps)
├─ data/
│  ├─ courses.json       # Course definitions (edit to change screens)
│  └─ achievements.json  # Achievement catalog
├─ assets/
│  ├─ styles.css         # All site styles (violet theme)
│  ├─ embedded.css       # Styles for stub HTML pages (welcome / LO / equip)
│  ├─ app.js             # Course viewer logic + worksheet enhancer
│  ├─ gamify.js          # Achievement engine, toasts, confetti, streaks
│  └─ matrix-logo.svg    # Matrix TSL brand mark
└─ content/
   ├─ CO0001/            # CPD welcome / LO / equipment / opening art
   ├─ CO0002/            # Intro to Microcontrollers stubs + opening art
   ├─ CO0003/            # EASA welcome + opening art
   └─ CP4807/            # 32 split source files (worksheets, homework, assessments)
```

## Documentation

- **[MASTER-DOC-SPEC.md](MASTER-DOC-SPEC.md)** — bulletproof verbatim mapping of `master_doc.docx` to this implementation; flags master-doc inconsistencies and decisions still owed
- **[ADMIN.md](ADMIN.md)** — admin CMS guide (sign-in, what's editable, export workflow, Phase 1 vs Phase 2)
- **[AUTHORING.md](AUTHORING.md)** — how `courses.json` works, four-pack worksheet ecosystem, hardware spec, adding courses or screens, where missing assets go
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — local + GitHub Pages, Cloudflare/Netlify alternatives
- **[ROADMAP.md](ROADMAP.md)** — what's still missing, the 12 master-doc discussion points, Phase 2 backend plan, planned work
- **[CLAUDE.md](CLAUDE.md)** — guidance for AI assistants working in this repo
- **[tools/README.md](tools/README.md)** — SCORM build pipeline + bridge protocol

## Tech

- **Vanilla** HTML, CSS (custom-properties theming), ES2017 JS
- **mammoth.js** (CDN) for in-browser Word-doc rendering
- **No framework, no bundler, no npm install**
- Persists per-user state in `localStorage`

## License

© Matrix TSL. All course content (CP4807 worksheets, master doc, branding) belongs to Matrix TSL.

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

## Quick start

No npm install required — uses only Node built-ins.

```sh
node server.js
```

Default port `4173`. Override with `PORT=4000 node server.js`.

Open <http://localhost:4173/>.

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
- **[AUTHORING.md](AUTHORING.md)** — how `courses.json` works, four-pack worksheet ecosystem, hardware spec, adding courses or screens, where missing assets go
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — local + GitHub Pages, Cloudflare/Netlify alternatives
- **[ROADMAP.md](ROADMAP.md)** — what's still missing, the 12 master-doc discussion points, planned work
- **[CLAUDE.md](CLAUDE.md)** — guidance for AI assistants working in this repo

## Tech

- **Vanilla** HTML, CSS (custom-properties theming), ES2017 JS
- **mammoth.js** (CDN) for in-browser Word-doc rendering
- **No framework, no bundler, no npm install**
- Persists per-user state in `localStorage`

## License

© Matrix TSL. All course content (CP4807 worksheets, master doc, branding) belongs to Matrix TSL.

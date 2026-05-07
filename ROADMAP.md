# Roadmap

What's still missing to fully satisfy `master_doc.docx`, plus open questions and next features.

## Missing assets (referenced but not yet present)

These are flagged with `"missing": true` in `data/courses.json` and render a placeholder panel.

| File                                  | Used by              | Master-doc title                       |
|---------------------------------------|----------------------|----------------------------------------|
| `Microcontroller-basics-1.pptx`       | CO0001, CO0002, CO0003 | Microcontroller basics 1               |
| `Microcontroller-basics-2.pptx`       | CO0001, CO0002, CO0003 | Microcontroller basics 2               |
| `CP1972-1.docx` Analogue inputs       | CO0002, CO0003       | Sensors Bronze worksheet 1             |
| `CP1972-2.docx` Light sensor          | CO0002, CO0003       | Sensors Bronze worksheet 2             |
| `CP1972-3.docx` Analogue temp sensor  | CO0002, CO0003       | Sensors Bronze worksheet 3             |
| `CP1972-4.docx` Digital temp sensor   | CO0002               | Sensors Bronze worksheet 4             |
| `CP1972-5.docx` Digital accelerometer | CO0002               | Sensors Bronze worksheet 5             |
| `CP1972-6.docx` Floats and INTs       | CO0002               | Sensors Silver worksheet 6             |
| `CP0507-1.docx` Basic DC motors       | CO0002, CO0003       | Motors Bronze worksheet 1              |
| `CP0507-2.docx` Full bridge motor     | CO0002, CO0003       | Motors Bronze worksheet 2              |
| `CP0507-3.docx` Stepper motor         | CO0002               | Motors Bronze worksheet 3              |
| `CP0507-4.docx` Servo motor           | CO0002, CO0003       | Motors Bronze worksheet 4              |

To enable: drop the file into `content/CP1972/` or `content/CP0507/` (or `content/CO0002/` for the pptx) and remove the `missing: true` flag from each matching screen in `courses.json`.

## Master-doc features not yet built

These are explicitly described in `master_doc.docx` but not implemented.

### Course Viewer features
- **Spreadsheet screen type** — listed as a supported screen type but no course currently uses one. Renderer is a download-only stub like PowerPoint.
- **Hours-based certificate** — the master doc says CPD certs should print "the time spent and % completeness". Currently we print elapsed `hours` and completion %, but `hours` is the master-doc estimate, not actual time logged. Real time-tracking would need an interval timer per screen.
- **PDF certificate generation** — currently the certificate is a print-stylesheet HTML page. The master doc references a `CP4807-CPDcert.docx` template file. Optional: render the cert as a true PDF download via something like jsPDF.

### Courses not yet built
- **CP4807 worksheets PDF bundle** (a single combined PDF of head + cont + 1–12 + TN). The master doc requests it.
- **CP7244 — EASA Unit 5 Digital Techniques worksheets** ("Needs assembling" per the master doc).
- **T-level course set** (`CPXXX`, `COXXX`, `SCXXX`) — explicitly marked "not complete" in the master doc.

### SCORM packages (not started)
- **SC0001** — Intro to Microcontrollers as SCORM 1.2 package
- **SC0001 (sic)** — EASA Unit 5 SCORM
- **SCXXX** — T-level SCORM

The master doc has a SCORM `imsmanifest` skeleton; producing real SCORM zips is a separate workstream (likely a build script that wraps the existing course content with the manifest + SCORM API JS).

## Open discussion points (from master doc)

These are flagged in the master doc as "Discussion points with Alf and Hamed" — none are blockers but they shape design choices:

- File / product naming and where the canonical course definition lives long-term
- Word vs. HTML for worksheets (Alf went HTML; the master doc suggests Word). Current implementation: HTML for homework / assessments / SOW / TN, `.docx` for worksheets. Could standardise.
- Style guide / template / fonts. Branding for Locktronics will likely differ from Matrix Microcontrollers — would the viewer need per-course themes?
- What happens when a resource is requested but does not exist (currently: "Asset not yet available" placeholder)
- SCORM framing — needs a deeper conversation
- Hours-based vs % completeness for CPD certificate

## Planned features (not in master doc)

User-suggested gamification / UX additions that aren't yet built:

- **Settings → Reset progress** button (currently requires DevTools)
- **Sound effect on tick / unlock** (off by default, opt-in)
- **Hint reveals** (the "Hints:" section currently auto-callouts the next 3 paragraphs — turning the visibility into an explicit click-to-reveal would unlock the **Hint Seeker** achievement and add genuine pedagogy value)
- **Rapid-streak timer** for the **On a Roll** achievement (3 ticks in 60 seconds)
- **Persistent left sidebar** across both catalog and course pages, like the reference design (Northbrick-style nav with "Dashboard / All Courses / Course X expanded")
- **Real course thumbnails** — replacing the SVG opening art with photographs (engineering board, aircraft, etc. like the reference design)
- **Per-course completion email** to a tutor / admin
- **Account / login** so progress syncs across devices instead of being per-browser

## Tech debt

- No automated tests. A handful of smoke tests (course renders, achievements unlock at the right thresholds, `.docx` loads via mammoth) would catch regressions when courses.json changes.
- The worksheet enhancer (`enhanceWorksheetHtml` in `app.js`) is a 100-line function with five sequential transforms. Probably fine at this scope, but if a sixth transform shows up consider unit-testing each pass independently.
- `inferTier()` and `inferSection()` in `gamify.js` hard-code worksheet ranges. Adding a fourth or fifth CP code will mean editing those functions — a `data/tiers.json` config might age better.
- All CSS is in one ~30KB `styles.css`. Once it grows much past 50KB consider splitting into `_layout.css`, `_components.css`, `_pages.css`.

## Things to revisit before going to production

- Logo: current SVG is the colourful Matrix TSL mark inverted to white via CSS filter. Designer review on whether this is acceptable or whether a dedicated white-on-dark mark should be used.
- Mammoth fetched from CDN (cdnjs). Vendor it locally if offline / air-gapped delivery is in scope.
- No analytics. Add Plausible / Cloudflare Web Analytics if usage data matters.
- No accessibility audit. The achievement toasts pop in fast and could be missed by screen-reader users; a polite announce-region for "Achievement unlocked: Bronze Champion" would help.
- `localStorage` is per-browser. Students using shared lab machines will see each other's progress unless we add a profile-picker or login.

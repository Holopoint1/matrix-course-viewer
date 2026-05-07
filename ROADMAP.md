# Roadmap

Tracks what's still missing to fully satisfy `master_doc.docx`, plus open questions and next features.

> **See also:** [`MASTER-DOC-SPEC.md`](MASTER-DOC-SPEC.md) — the verbatim mapping of master doc requirements to implementation. This file flags master-doc inconsistencies and decisions still owed by the team.

## Missing assets (referenced but not yet present)

These are flagged with `"missing": true` in `data/courses.json` and render a placeholder panel.

| File                                  | Used by              | Master-doc title                       |
|---------------------------------------|----------------------|----------------------------------------|
| `Microcontroller-basics-1.pptx`       | CO0001, CO0002, CO0003 | Microcontroller basics 1 24 02 26.pptx |
| `Microcontroller-basics-2.pptx`       | CO0001, CO0002, CO0003 | Microcontroller basics 2 24 02 26.pptx |
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

## Worksheet packs not yet authored

The master doc's Teacher's-notes section lists four worksheet packs in total. Only **CP4807** has been split / produced.

| Pack code  | Title                          | Status                                                        |
|------------|--------------------------------|---------------------------------------------------------------|
| **CP4807** | Introduction to microcontrollers (12 worksheets) | ✅ All 12 split docx files in `content/CP4807/`        |
| **CP1972** | Sensors and Microcontrollers (11 worksheets)     | ❌ None produced yet (Bronze 1-5 + Silver 6 referenced; Gold 7-11 mechanical-sensor projects not yet referenced anywhere) |
| **CP0507** | Motors and microcontrollers (5 worksheets)       | ❌ None produced yet (Bronze 1-4 referenced; Gold 5 "DC motor speed control" not yet referenced) |
| **PC interfacing** (no `CP` code given) | PC interfacing (4 worksheets) | ❌ Not produced and no course currently references it |

CP1972 Gold worksheets (Thermocouple, Flow sensor, Compressive force sensor, Strain sensor, Pressure sensor) and the Motors Gold "DC motor speed control" worksheet are listed in the master doc but **not referenced by any CO course** in the current `courses.json` — they would belong to a future "Sensors" / "Motors" stand-alone course or be added as Gold extras to CO0002.

## Master-doc features not yet built

These are explicitly described in `master_doc.docx` but not implemented. See `MASTER-DOC-SPEC.md` for verbatim master-doc text.

### Course Viewer features
- **Spreadsheet screen type** — listed by master doc as a supported screen type but no course currently uses one. Renderer is a download-only stub like PowerPoint.
- **PowerPoint inline render** — master doc says "appears in the Course Viewer with scroll bars". Currently download-only. No good in-browser pptx renderer without a paid SDK; possible workaround = pre-convert pptx → PDF at content-author time, then use the PDF renderer.
- **Hours-based certificate** — ✅ **Done.** Real per-screen time tracking implemented (Page Visibility API, paused on tab hide). Certificate now shows actual time spent + completion %.
- **PDF certificate generation** — currently an HTML print-stylesheet page. The master doc references a `CP4807-CPDcert.docx` template file. Optional: render the cert as a true PDF download via something like `jspdf` or browser `window.print → save as PDF`.
- **CPD self vs. third-party assessment**: master doc raises "CPD can take one of two forms: Self assessed, or assessed by a third party … We don't have that which is a kind of weakness." Currently fully self-assessed. Adding tutor sign-off would need accounts.

### Courses not yet built
- **CP4807 worksheets PDF bundle** — ✅ **Done.** "Download all worksheets PDF" button in the course viewer sidebar — uses `html2pdf.js` + the existing mammoth render path. Filename pattern: `<course>-worksheets.pdf`.
- **CP7244 — EASA Unit 5 Digital Techniques worksheets**. Master doc says "Needs assembling".
- **T-level course set** (`CPXXX`, `COXXX`, `SCXXX`) — explicitly marked "T level stuff not complete" in the master doc.

### SCORM packages — ✅ Done

`tools/build-scorm.js` produces a SCORM 1.2 zip per CO course:

- `dist/SC0001-flowcode-and-e-blocks-3-cpd-course.zip`
- `dist/SC0002-introduction-to-microcontrollers.zip`
- `dist/SC0003-digital-techniques-for-aviation-technicians.zip`

Each zip is self-contained (mammoth.js vendored locally) and reports completion to `window.API` via `cmi.core.lesson_status`, `cmi.core.score.raw`, `cmi.core.session_time`. See `tools/README.md`.

T-level SCORM (`SCXXX`) still pending — gated on T-level course content existing.

## Open discussion points (verbatim from master doc)

These are tagged in the master doc as "Discussion points with Alf and Hamed" and are not yet resolved. Quoting verbatim:

1. **"This whole document."** — The master-doc structure itself is up for review.
2. **"What is the filename for the course, what is its extension, and where does it live? I suspect it will have subdirectories? How its managed and backed up?"**
   *Implementation choice:* `CO####` is used as the unique course id; the course "definition" lives in `data/courses.json`; per-course content files live in `content/CO####/` and `content/CP####/` subdirectories. Backup = git.
3. **"What is the filename for this document and how do we manage it?"** *(referring to the master doc itself)*
   *Implementation choice:* the master doc lives at `Matrix May LMS\assets\master_doc.docx`. The whole project is in git with an immutable commit history.
4. **(Locktronics speculation)** — "I suspect that we could have a similar document for the whole of Locktronics electrical / electronic. Perhaps 200 pages long? Then a similar one for Locktronics Automotive?"
   *Implementation choice:* the Course Viewer is **content-driven** — adding a new product line (Locktronics) is a matter of adding new `CO####` entries to `courses.json` and dropping content into `content/`. No rewrite needed.
5. **"We need to talk about file, or product, names."**
6. **"We need to talk about fonts, styles and branding. Alyce should be involved. Although what Alf has done looks spot on."**
   *Implementation choice:* a single CSS variable block in `assets/styles.css` (`:root` block) controls the entire palette. Per-product themes are achievable by switching the palette per course.
7. **"I have specified Word files for worksheets. I think Alf has made them HTM? What's correct?"**
   *Implementation choice:* both. `.docx` for the 12 numbered worksheets; `.htm` for homework / assessments / project / SOW / TN. Renderer handles both with the same enhancer.
8. **"Do we need a style guide for Worksheets? A template? How does that work? For Locktronics you will probably want a different layout. How can we manage that?"**
9. **"There will be times when a resource does not exist but we have asked for it. What happens?"**
   *Implementation choice:* `"missing": true` flag in `courses.json` shows a friendly "Asset not yet available — drop `<filename>` into `content/`" panel. Drop the file in and remove the flag → screen activates.
10. **"I need help with SCORM. How do I frame that for you?"** — Open.
11. **"For the CPD we want a certificate when everything is marked as 'complete'. How do we do that?"** — Implemented (see `certificate.html`). The master-doc add-on "use the time spent and % completeness on the certificate" is partly there (% yes, real time-tracking no).
12. **"I have used Microsoft formatted files. Could be that we move to Google equivalents?"** — Open. Implementation works with whichever; would require a different renderer (currently mammoth.js for `.docx`; Google Docs would need a different fetch-and-convert pipeline).

## Master-doc inconsistencies (recap)

Quick recap — full detail in `MASTER-DOC-SPEC.md` § 11:

- "9 separate resources" — actually 10 listed.
- EASA course code is `CO003` once and `CO0003` elsewhere — we use `CO0003` everywhere.
- SCORM code `SC0001` is listed for both Intro Microcontrollers SCORM **and** EASA SCORM.
- CO0001's "Image opening" file is named `CO002 – opening.png` — likely a typo for `CO0001 – opening.png`.
- CO0002 row 35 "Floats and INTs" is typed `HTML` but the file is `.docx` (a Document) — handled as Document.
- CO0002 lists "Colour graphical displays / CP4807-8.docx" twice (rows 20 and 22).
- CO0003 first row uses `Opening screen` not `Image` — treated as the same.

These are tensions in the master doc the team needs to resolve before another publishing round.

## Planned UX features (not in master doc)

- **Settings → Reset progress** button (currently requires DevTools — see `AUTHORING.md`).
- **Sound effect** on tick / unlock (off by default, opt-in).
- **Hint reveals** — the "Hints:" section currently auto-expands. Turning it into click-to-reveal would unlock the **Hint Seeker** achievement and add real pedagogy value.
- **Rapid-streak timer** for the **On a Roll** achievement (3 ticks in 60 s).
- **Persistent left sidebar** across both catalog and course pages (Northbrick-reference style).
- **Real course thumbnails** — replacing the SVG opening art with photographs (engineering board, aircraft, …).
- **Per-course completion email** to a tutor / admin.
- **Account / login** so progress syncs across devices instead of being per-browser.

## Tech debt

- No automated tests. A handful of smoke tests (course renders, achievements unlock at the right thresholds, `.docx` loads via mammoth) would catch regressions when `courses.json` changes.
- The worksheet enhancer (`enhanceWorksheetHtml` in `app.js`) is a 100-line function with five sequential transforms. Probably fine at this scope, but if a sixth transform shows up consider unit-testing each pass independently.
- `inferTier()` and `inferSection()` in `gamify.js` hard-code worksheet ranges. Adding a fourth or fifth CP code will mean editing those functions — a `data/tiers.json` config might age better.
- All CSS is in one ~30 KB `styles.css`. Once it grows past 50 KB consider splitting into `_layout.css`, `_components.css`, `_pages.css`.

## Things to revisit before going to production

- **Logo treatment** — current SVG is the colourful Matrix TSL mark inverted to white via CSS filter. Designer review needed (per master-doc point: "We need to talk about fonts, styles and branding. Alyce should be involved.").
- **Mammoth fetched from CDN** (`cdnjs.cloudflare.com`). Vendor it locally if offline / air-gapped delivery is in scope.
- **No analytics**. Add Plausible / Cloudflare Web Analytics if usage data matters.
- **No accessibility audit**. Achievement toasts pop in fast and could be missed by screen-reader users; a polite ARIA `aria-live="polite"` announce-region for "Achievement unlocked: Bronze Champion" would help.
- **`localStorage` is per-browser**. Students using shared lab machines will see each other's progress unless we add a profile-picker or login.

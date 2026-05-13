# AI Media Instructions — Microcontrollers Resource Suite

> Source: `assets/AI media instructions 13 05 26.docx`
> Status: living spec. Engineers maintain the curriculum packs (CP*); publishers assemble the courses (CO*) and SCORM modules (SC*).

This document is the **single source of truth** for how the microcontrollers resource suite is constructed. The Matrix Course Viewer LMS reads from `data/courses.json`, but that JSON is regenerated *from this spec* (via `npm run build:courses`). When the spec changes, the JSON catches up.

---

## 1. The 13 resources

One master spec produces 13 separate deliverables. Each resource has a code prefix that determines its kind:

| Code prefix | Kind | Description | Lives at |
|---|---|---|---|
| **CO** | Course | Full learner-facing course viewable in a browser | `lms/dashboard.html?id=CO000x` |
| **CP** | Curriculum Pack | Reusable worksheet pack; building blocks the courses pull from | `lms/dashboard.html?id=CPxxxx` |
| **SC** | SCORM | SCORM 1.2 package built from the matching CO course | `lms/dist/SC000x-*.zip` |

The 13 deliverables defined by this spec:

| # | Deliverable | Code | Kind | Source |
|---|---|---|---|---|
| 1 | Flowcode & E-blocks 3 CPD course | CO0001 | CO | Spec table below |
| 2 | Introduction to Microcontrollers worksheets PDF | CP4807-worksheets.pdf | CP | Assembled from CP4807-1…12 + head/cont/TN |
| 3 | Introduction to Microcontrollers worksheets DOCX | CP4807-worksheets.docx | CP | Same docx parts, combined |
| 4 | Introduction to Microcontrollers course | CO0002 | CO | Spec table below |
| 5 | Introduction to Microcontrollers SCORM | SC0001 | SC | Built from CO0002 |
| 6 | EASA Unit 5 Digital Techniques worksheets PDF | CP7244-worksheets.pdf | CP | Assembled from CP7244-head/cont + CP4807/CP1972/CP0507 mix |
| 7 | EASA Unit 5 Digital Techniques worksheets DOCX | CP7244-worksheets.docx | CP | Same parts, DOCX |
| 8 | EASA Unit 5 Digital Techniques course | CO0003 | CO | Spec table below |
| 9 | EASA Unit 5 Digital Techniques SCORM | SC0002 | SC | Built from CO0003 |
| 10 | T-Level Microcontrollers worksheets PDF | CP2563-worksheets.pdf | CP | Assembled from CP2563-head/cont + CP4807/CP1972/CP0507 mix |
| 11 | T-Level Microcontrollers worksheets DOCX | CP2563-worksheets.docx | CP | Same parts, DOCX |
| 12 | T-Level Microcontrollers course | CO0004 | CO | Spec table below |
| 13 | T-Level Microcontrollers SCORM | SC0003 | SC | Built from CO0004 |

---

## 2. Naming conventions

- **Worksheets / Curriculum Packs** → `CPxxxx` prefix (e.g. `CP4807`, `CP1972`, `CP0507`, `CP2563`, `CP7244`)
- **SCORM modules** → `SCxxxx` prefix (e.g. `SC0001`, `SC0002`, `SC0003`, `SC0004`)
- **Courses viewable in a browser** → `COxxxx` prefix (e.g. `CO0001`–`CO0004`)
- Individual worksheets inside a pack are numbered: `CP4807-1.docx`, `CP4807-2.docx`, …
- Homework HTML stubs follow `CP4807-H1.htm`, `CP4807-H2.htm`, … (1-based)
- Assessment HTML stubs follow `CP4807-A1.htm`, `CP4807-A2.htm`, …
- Special parts: `CP4807-head.docx` (cover), `CP4807-cont.docx` (contents), `CP4807-TN.docx` (teacher notes), `CP4807-CPDcert.docx` (CPD certificate template)

**Open question (from the spec):** where do new kinds of content live? File naming for new resources hasn't been formalised — flagged for discussion with Alf and Hamed.

---

## 3. Screen types

The Course Viewer recognises these screen types. Anything in the table's `Screen type` column maps to one of these:

| Spec value | LMS type | Renderer | What learners see |
|---|---|---|---|
| `Image` / `Opening screen` | `image` | `<img>` | A static image (e.g. PNG cover) — full-width on the stage |
| `HTML` | `html` | Mammoth-enhanced inline HTML | Rich text + images + inline video |
| `YouTube` | `youtube` | Embedded `<iframe>` | A YouTube player |
| `PDF` | `pdf` | `<iframe>` with scroll | The full PDF document scrollable in-stage |
| `Document` | `document` | Mammoth (.docx → HTML) | A Word document rendered as styled HTML; worksheet enhancer promotes section headings, embeds YouTube links, wraps Hints in click-to-reveal |
| `Powerpoint` | `powerpoint` | Download card | Cannot render inline; offers a download button (Office Online viewer is on the roadmap) |
| `Spreadsheet` | `spreadsheet` | Download card | Same as Powerpoint |

**The list will grow.** When a new screen type is needed, add it to `lms/assets/app.js` (`renderStage` switch) and CSS for the stage.

---

## 4. Where files live

Inside `lms/content/`:

```
content/
├── CO0001/                  ← course-owned files (welcome.html, LO.html, openings, certs)
│   ├── opening.svg
│   ├── welcome.html
│   ├── learning-objectives.html
│   └── …
├── CO0002/
├── CO0003/
├── CO0004/
├── CP0507/                  ← curriculum-pack worksheets
│   ├── CP0507-1.docx
│   ├── CP0507-2.docx
│   └── …
├── CP1972/
├── CP4807/
│   ├── CP4807-1.docx
│   ├── …
│   ├── CP4807-12.docx
│   ├── CP4807-H1.htm        ← shared homework stubs live with the pack
│   ├── CP4807-A1.htm        ← shared assessment stubs live with the pack
│   ├── CP4807-CPDcert.docx
│   └── CP4807-head.docx
└── …
```

**Path rule used by the LMS:**
- Any file starting with `CPxxxx-` (or `CPxxxx -`) is auto-routed to `content/CPxxxx/<file>`
- Any other file is auto-routed to `content/<courseId>/<file>`

The spec uses bare filenames (e.g. `"CP4807-1.docx"` without folder prefix). The builder applies the rule above to expand each to its full path.

**Backup/version control:** all content lives in `lms/content/` and is tracked in git. The `assets/` folder at the repo root holds the master DOCX definitions; `lms/content/` holds the published worksheets.

---

## 5. Resource specs

### 5.1 CO0001 — Flowcode & E-blocks 3 CPD course

**Filename of generated course:** `CO0001-FC-EB-CPD.html`
**Hours:** 3.5 (short CPD)
**Certificate:** ✅ enabled — uses `CP4807-CPDcert.docx`, inserts `<name>` and `<date>`

| # | Type | Hours | Title | File |
|---:|---|---:|---|---|
| 1 | Image | 0 | Introduction to microcontrollers | `CO002 - opening.png` |
| 2 | HTML | 0.1 | Learning objectives | `CO002 - LO.HTM` |
| 3 | HTML | 0.1 | Equipment | `CO002 - Equip.HTM` |
| 4 | HTML | 0.2 | Welcome | `CP4807 - CPD objectives.HTM` |
| 5 | YouTube | 0.2 | Introducing E-blocks 3 | `https://youtu.be/KmpyVmv6J_Y` |
| 6 | YouTube | 0.2 | Introducing Flowcode | `https://youtu.be/tDdptTbvDM0` |
| 7 | PDF | 0.2 | E-blocks datasheet | `https://www.matrixtsl.com/wp-content/uploads/2026/03/CP9645-Eblocks-3-Datasheet-1.pdf` |
| 8 | Powerpoint | 0.3 | Microcontroller basics 1 | `Microcontroller basics 1 24 02 26.pptx` |
| 9 | Powerpoint | 0.3 | Microcontroller basics 2 | `Microcontroller basics 2 24 02 26.pptx` |
| 10 | HTML | 0.1 | Now try the worksheets | `Now try the worksheets.HTM` |
| 11 | HTML | 0.1 | Other resources | `Other resources.HTM` |
| 12 | Document | 1 | First program | `CP4807-1.docx` |
| 13 | Document | 0.2 | Performing calculations | `CP4807-2.docx` |
| 14 | Document | 0.2 | Connection points | `CP4807-3.docx` |
| 15 | Document | 0.2 | Digital inputs | `CP4807-4.docx` |
| 16 | HTML | 0.2 | Homework 1 | `CP4807-H1.htm` |
| 17 | Document | 0.2 | Making decisions | `CP4807-5.docx` |

**Certificate behaviour:** when every screen is marked complete, the LMS opens `certificate.html?id=CO0001` and prints a customised certificate using `CP4807-CPDcert.docx` as the template.

**CPD self-assessment note (from spec):** real CPD courses are assessed by a course leader. Since this LMS has no leader role, we put **time spent** and **% completion** on the certificate as proxies.

---

### 5.2 CO0002 — Introduction to Microcontrollers course

**Filename:** `CO0002-Introduction-to-microcontrollers.html`
**Hours:** ~86 (full course)
**Certificate:** ✅ enabled

| # | Type | Hours | Title | File |
|---:|---|---:|---|---|
| 1 | Image | 0 | Introduction to microcontrollers | `CO002 - opening.png` |
| 2 | HTML | 0.1 | Welcome | `CO002 - welcome.HTM` |
| 3 | HTML | 0.1 | Learning objectives | `CO002 - LO.HTM` |
| 4 | HTML | 0.1 | Equipment | `CO002 - Equip.HTM` |
| 5 | YouTube | 0.2 | Introducing E-blocks 3 | `https://youtu.be/KmpyVmv6J_Y` |
| 6 | YouTube | 0.2 | Introducing Flowcode | `https://youtu.be/tDdptTbvDM0` |
| 7 | PDF | 0.2 | E-blocks datasheet | (external URL) |
| 8 | Powerpoint | 0.3 | Microcontroller basics 1 | `Microcontroller basics 1 24 02 26.pptx` |
| 9 | Powerpoint | 0.3 | Microcontroller basics 2 | `Microcontroller basics 2 24 02 26.pptx` |
| 10 | HTML | 1 | Getting started guide | https://www.flowcode.co.uk/wiki/index.php?title=Embedded_Getting_Started_Guide |
| 11 | Document | 1 | First program | `CP4807-1.docx` |
| 12 | Document | 1 | Performing calculations | `CP4807-2.docx` |
| 13 | Document | 2 | Connection points | `CP4807-3.docx` |
| 14 | Document | 2 | Digital inputs | `CP4807-4.docx` |
| 15 | HTML | 2 | Homework 1 | `CP4807-H1.htm` |
| 16 | Document | 2 | Making decisions | `CP4807-5.docx` |
| 17 | Document | 2 | Macros / subroutines | `CP4807-6.docx` |
| 18 | Document | 2 | Using prototype boards | `CP4807-7.docx` |
| 19 | Document | 2 | Analogue inputs | `CP1972-1.docx` |
| 20 | Document | 2 | Colour graphical displays | `CP4807-8.docx` |
| 21 | HTML | 2 | Homework 2 | `CP4807-H2.htm` |
| 22 | Document | 2 | Light sensor | `CP1972-2.docx` |
| 23 | Document | 2 | Analogue temperature sensor | `CP1972-3.docx` |
| 24 | HTML | 2 | Homework 3 | `CP4807-H3.htm` |
| 25 | HTML | 2 | Assessment 1 | `CP4807-A1.htm` |
| 26 | Document | 2 | Digital temperature sensor | `CP1972-4.docx` |
| 27 | Document | 2 | Digital accelerometer | `CP1972-5.docx` |
| 28 | HTML | 2 | Assessment 2 | `CP4807-A2.htm` |
| 29 | Document | 2 | Basic DC motors | `CP0507-1.docx` |
| 30 | Document | 2 | Full bridge motor control | `CP0507-2.docx` |
| 31 | Document | 2 | Stepper motor control | `CP0507-3.docx` |
| 32 | Document | 2 | Servo motor control | `CP0507-4.docx` |
| 33 | HTML | 2 | Homework 6 | `CP4807-H6.htm` |
| 34 | Document | 2 | Floats and INTs | `CP1972-6.docx` |
| 35 | Document | 2 | Pin interrupts | `CP4807-9.docx` |
| 36 | Document | 2 | Timer interrupts | `CP4807-10.docx` |
| 37 | HTML | 2 | Homework 7 | `CP4807-H7.htm` |
| 38 | Document | 2 | Touch control systems | `CP4807-11.docx` |
| 39 | HTML | 2 | Homework 8 | `CP4807-H8.htm` |
| 40 | Document | 2 | Web mirror | `CP4807-12.docx` |
| 41 | HTML | 24 | Homework 9 | `CP4807-H9.htm` |

**Note on row 21 (was duplicated in spec):** the source doc repeats "Colour graphical displays" twice — once before Homework 2 and once after. Treated as a single screen on row 20; the second mention is dropped.

---

### 5.3 CO0003 — Digital Techniques for Aviation Technicians (EASA Unit 5)

**Filename:** `CO0003-Digital-techniques-for-aviation-technicians.html`
**Hours:** ~46
**Certificate:** ✅ enabled
**Curriculum:** EASA Unit 5 — narrower than CO0002 (no T-level assessments, no advanced interrupts/web-mirror, fewer motor screens)

| # | Type | Hours | Title | File |
|---:|---|---:|---|---|
| 1 | Image | 0 | Introduction to microcontrollers | `CO0003 - opening.png` |
| 2 | HTML | 0.1 | Welcome | `CO0003 - welcome.HTM` |
| 3 | YouTube | 0.2 | Introducing E-blocks 3 | (URL) |
| 4 | YouTube | 0.2 | Introducing Flowcode | (URL) |
| 5 | PDF | 0.2 | E-blocks datasheet | (URL) |
| 6 | Powerpoint | 0.3 | Microcontroller basics 1 | `Microcontroller basics 1 24 02 26.pptx` |
| 7 | Powerpoint | 0.3 | Microcontroller basics 2 | `Microcontroller basics 2 24 02 26.pptx` |
| 8 | HTML | 1 | Getting started guide | (URL) |
| 9 | Document | 1 | First program | `CP4807-1.docx` |
| 10 | Document | 1 | Performing calculations | `CP4807-2.docx` |
| 11 | Document | 2 | Connection points | `CP4807-3.docx` |
| 12 | Document | 2 | Digital inputs | `CP4807-4.docx` |
| 13 | HTML | 2 | Homework 1 | `CP4807-H1.htm` |
| 14 | Document | 2 | Making decisions | `CP4807-5.docx` |
| 15 | Document | 2 | Macros / subroutines | `CP4807-6.docx` |
| 16 | Document | 2 | Using prototype boards | `CP4807-7.docx` |
| 17 | Document | 2 | Analogue inputs | `CP1972-1.docx` |
| 18 | Document | 2 | Colour graphical displays | `CP4807-8.docx` |
| 19 | HTML | 2 | Homework 2 | `CP4807-H2.htm` |
| 20 | Document | 2 | Light sensor | `CP1972-2.docx` |
| 21 | Document | 2 | Analogue temperature sensor | `CP1972-3.docx` |
| 22 | HTML | 2 | Homework 3 | `CP4807-H3.htm` |
| 23 | Document | 2 | Basic DC motors | `CP0507-1.docx` |
| 24 | Document | 2 | Full bridge motor control | `CP0507-2.docx` |
| 25 | Document | 2 | Servo motor control | `CP0507-4.docx` |

**No Assessment 1/2, no stepper motor (CP0507-3), no pin/timer interrupts, no touch, no web mirror, no homeworks 6–9.** EASA Unit 5 stops at servo control.

---

### 5.4 CO0004 — Microcontrollers for T-Levels

**Filename:** `CO0004-Microcontrollers-for-T-levels.html`
**Hours:** ~46
**Certificate:** ✅ enabled
**Curriculum:** T-Level Engineering — full assessment path (Assessment 1, Assessment 2) plus all motors (incl. stepper) and Homework 6

| # | Type | Hours | Title | File |
|---:|---|---:|---|---|
| 1 | Image | 0 | Introduction to microcontrollers | `CO004 - opening.jpg` |
| 2 | HTML | 0.1 | Welcome | `CO004 - welcome.HTM` |
| 3 | HTML | 0.1 | Learning objectives | `CO004 - LO.HTM` |
| 4 | HTML | 0.1 | Equipment | `CO004 - Equip.HTM` |
| 5 | YouTube | 0.2 | Introducing E-blocks 3 | (URL) |
| 6 | YouTube | 0.2 | Introducing Flowcode | (URL) |
| 7 | PDF | 0.2 | E-blocks datasheet | (URL) |
| 8 | Powerpoint | 0.3 | Microcontroller basics 1 | `Microcontroller basics 1 24 02 26.pptx` |
| 9 | Powerpoint | 0.3 | Microcontroller basics 2 | `Microcontroller basics 2 24 02 26.pptx` |
| 10 | HTML | 1 | Getting started guide | (URL) |
| 11 | Document | 1 | First program | `CP4807-1.docx` |
| 12 | Document | 1 | Performing calculations | `CP4807-2.docx` |
| 13 | Document | 2 | Connection points | `CP4807-3.docx` |
| 14 | Document | 2 | Digital inputs | `CP4807-4.docx` |
| 15 | HTML | 2 | Homework 1 | `CP4807-H1.htm` |
| 16 | Document | 2 | Making decisions | `CP4807-5.docx` |
| 17 | Document | 2 | Macros / subroutines | `CP4807-6.docx` |
| 18 | Document | 2 | Using prototype boards | `CP4807-7.docx` |
| 19 | Document | 2 | Analogue inputs | `CP1972-1.docx` |
| 20 | Document | 2 | Colour graphical displays | `CP4807-8.docx` |
| 21 | HTML | 2 | Homework 2 | `CP4807-H2.htm` |
| 22 | Document | 2 | Light sensor | `CP1972-2.docx` |
| 23 | Document | 2 | Analogue temperature sensor | `CP1972-3.docx` |
| 24 | HTML | 2 | Homework 3 | `CP4807-H3.htm` |
| 25 | HTML | 2 | Assessment 1 | `CP4807-A1.htm` |
| 26 | Document | 2 | Digital temperature sensor | `CP1972-4.docx` |
| 27 | Document | 2 | Digital accelerometer | `CP1972-5.docx` |
| 28 | HTML | 2 | Assessment 2 | `CP4807-A2.htm` |
| 29 | Document | 2 | Basic DC motors | `CP0507-1.docx` |
| 30 | Document | 2 | Full bridge motor control | `CP0507-2.docx` |
| 31 | Document | 2 | Stepper motor control | `CP0507-3.docx` |
| 32 | Document | 2 | Servo motor control | `CP0507-4.docx` |
| 33 | HTML | 2 | Homework 6 | `CP4807-H6.htm` |

---

### 5.5 Curriculum-pack PDF/DOCX bundles

| Pack | Parts (in order) |
|---|---|
| **CP4807-worksheets.pdf** | `CP4807-head.docx`, `CP4807-cont.docx`, `CP4807-1.docx` … `CP4807-12.docx`, `CP4807-TN.docx` |
| **CP4807-worksheets.docx** | Same parts, combined as one DOCX |
| **CP7244-worksheets.pdf** | `CP7244-head.docx`, `CP7244-cont.docx`, `CP4807-1.docx`, `CP4807-2.docx`, `CP4807-3.docx`, `CP4807-4.docx`, `CP4807-5.docx`, `CP4807-6.docx`, `CP4807-7.docx`, `CP1972-1.docx`, `CP4807-8.docx`, `CP1972-2.docx`, `CP1972-3.docx`, `CP0507-1.docx`, `CP0507-2.docx`, `CP0507-4.docx` |
| **CP7244-worksheets.docx** | Same parts, combined |
| **CP2563-worksheets.pdf** | `CP2563-head.docx`, `CP2563-cont.docx`, `CP4807-1.docx` … `CP4807-7.docx`, `CP1972-1.docx`, `CP4807-8.docx`, `CP1972-2.docx`, `CP1972-3.docx`, `CP1972-4.docx`, `CP1972-5.docx`, `CP0507-1.docx`, `CP0507-2.docx`, `CP0507-3.docx`, `CP0507-4.docx` |
| **CP2563-worksheets.docx** | Same parts, combined |

The in-LMS Worksheet Compiler (currently delivered as a standalone tool) does the same job interactively — drop the DOCX parts in, hit "Compile PDF", get the merged document.

---

## 6. SCORM packages

The spec defines three SCORM modules: SC0001 (built from CO0002), SC0002 (built from CO0003), SC0003 (built from CO0004).

> "I don't know what to put here to make sure that the SCORM data gets included properly." — from the spec; the SCORM build settings are inferred from Hamed's resources.

**Settings used by `tools/build-scorm.js`:**

| Setting | Value |
|---|---|
| SCORM version | 1.2 |
| Launch | `CO000X-…html` |
| Tracking | completion only |
| Completion | page view (any screen marked complete counts) |
| Navigation | free |

Each SCORM zip mirrors the corresponding CO course's screen list, embeds its content files, and bundles a SCORM 1.2 `imsmanifest.xml`. Drop a zip into any SCORM-compliant LMS (Moodle, Canvas, Cornerstone, etc.).

---

## 7. How the LMS implements this spec

| Concern | Where it lives | How it works |
|---|---|---|
| Course definitions | `lms/data/courses.json` | Generated from this spec via `npm run build:courses` |
| Worksheet content | `lms/content/CP<code>/` | Tracked in git; refresh via the doc splitter under `doc_splitter/` |
| Course-owned files | `lms/content/CO<code>/` | Welcome/LO/Equipment HTML, openings, certificates |
| Sidebar / chrome / shell | `lms/assets/chrome.js` + `sidebar.js` | Injects identical chrome on every page |
| Resource-missing UI | `lms/content/...` + `missing: true` in courses.json | Friendly "Please send X" panel + global "Resources to send" widget on catalog |
| Certificate | `lms/certificate.html?id=…` | Reads name from `matrix-lms:account-name` localStorage key, inserts date, prints |
| SCORM build | `tools/build-scorm.js` | Reads courses.json, writes SC* zips to `lms/dist/` |

---

## 8. The "resource missing" lifecycle

When the spec references a file that doesn't yet exist in `lms/content/`:

1. `npm run build:courses` flags the screen with `"missing": true` after checking `fs.existsSync`.
2. The course viewer shows the **Resource missing** panel ("Please send `CP4807-A1.htm` and it'll appear here automatically").
3. The catalog's **Resources to send** widget lists every missing file across all courses, with the path it needs to be dropped into.
4. The moment the file appears in the right folder, the next `npm run build:courses` (or the catalog re-render) flips it from missing → live without any code change.

This makes the spec actionable: you can ship the LMS with 30% of the assets missing and the missing-asset UI tells the publisher exactly what's needed next.

---

## 9. Open questions (from the spec, flagged for Alf + Hamed)

| Topic | Question |
|---|---|
| File naming | What's the canonical filename + extension for each generated course? Subdirectory structure? |
| Document management | How are these master DOCX files backed up / version-controlled outside git? |
| Locktronics scope | A similar 200-page spec would exist for Locktronics Electrical and Locktronics Automotive — same conventions? |
| Branding | Fonts / styles / branding — Alyce to be involved. Worksheets currently look right per Alf's pass. |
| Worksheet format | Spec says Word (.docx). Some worksheets currently exist as `.htm`. Pick one canonical format. |
| Style guide | Do we need a worksheet template + style guide? Locktronics may want a different layout — how is that managed? |
| Missing assets | What happens when a resource is asked for but doesn't exist? (Answered: missing-asset UI, see §8.) |
| SCORM framing | How to frame SCORM requirements clearly enough for the AI to assemble manifests? |
| File hosting | Where does the master content actually live? Currently: git + GitHub Pages. |
| CPD certificate | When everything is marked complete, how is the certificate printed? (Answered: `certificate.html?id=CO000x`, see §5.1.) |

---

## 10. Tooling

| Command | What it does |
|---|---|
| `npm run extract:definitions` | Dumps every course's definition + content `.docx` text to stdout |
| `npm run build:courses` | Rebuilds `data/courses.json` from each course's definition |
| `npm run build:scorm` | Builds all 9 SCORM zips (4 SC + 5 CP packs) into `lms/dist/` |
| `npm run build:scorm:CO000X` | Builds a single SCORM package |
| `npm test` | Audits every achievement; asserts all 20 wire correctly |
| `npm start` | Local dev server at `http://localhost:4173` |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Screen** | One step of a course — an image, HTML, YouTube embed, PDF, DOCX, PowerPoint, etc. |
| **Worksheet** | A single DOCX `CPxxxx-N.docx` file authored by a Matrix engineer |
| **Curriculum pack** | A numbered set of worksheets (CP4807 = 12 worksheets, CP1972 = 11, CP0507 = 5) |
| **Course** | A learner-facing browser-rendered sequence of screens, built by a publisher from one or more packs |
| **Section** (in a worksheet) | A pseudo-heading the enhancer recognises: `Design brief:`, `Hardware:`, `Software:`, `Challenges:`, `Hints:`, `Over to you:`, `Technical risk:` |
| **SCORM module** | A SCORM 1.2 zip built from a CO course; drop into any LMS |
| **CPD certificate** | The PDF printed when a learner finishes CO0001; includes name, date, time spent, % completion |

---

*Last updated: 2026-05-13*
*Source spec: `assets/AI media instructions 13 05 26.docx`*

# Master-doc → implementation mapping

This document is the **canonical, bulletproof mapping** between Matrix TSL's `master_doc.docx` (in `Matrix May LMS\assets\master_doc.docx`) and what this LMS implements.

Master-doc text is quoted verbatim. Where the master doc is internally inconsistent, the inconsistency is called out. Where this implementation differs from the master doc, the difference is called out.

**Master-doc revision history (per the doc itself):**
> 04 12 25  First release
> 18 02 26  Second release with schemes of work
> 05 04 26  with AI mark up instructions
> 10 04 26  More courses

---

## 1. The nine resources

> "This will be a single resource file that uses AI to create 9 separate resources:"

The master doc lists ten under three groupings (the count of "9" is itself slightly off — see § Inconsistencies below):

| Code        | Title                                                                       | Implemented?                       |
|-------------|-----------------------------------------------------------------------------|------------------------------------|
| `CO0001`    | Flowcode and E-blocks 3 CPD course                                          | ✅ Yes — 15 screens, 3.6 hr        |
| `CP4807`    | Introduction to microcontrollers worksheets.pdf                             | ❌ Not built (combined PDF bundle) |
| `CO0002`    | Introduction to microcontrollers Matrix AI Course Viewer course             | ✅ Yes — 42 screens, 86.5 hr       |
| `SC0001`    | Introduction to microcontrollers SCORM content course                       | ❌ Not built                       |
| `CP7244`    | EASA unit 5 Digital Techniques microcontrollers worksheets                  | ❌ Master doc says "Needs assembling" |
| `CO0003`    | EASA unit 5 Digital Techniques microcontrollers Matrix AI Course Viewer course | ✅ Yes — 26 screens, 36.3 hr (master doc spells this `CO003` in one place — see Inconsistencies) |
| `SC0001`    | EASA unit 5 Digital Techniques SCORM compliant resource                     | ❌ Master doc says "Needs assembling" — also same code as CO0001's SCORM (see Inconsistencies) |
| `CPXXX`     | T level microcontrollers worksheets                                         | ❌ Master doc: "T level stuff not complete" |
| `COXXX`     | T level microcontrollers Matrix AI Course Viewer course                     | ❌ Same                             |
| `SCXXX`     | T level SCORM compliant resource                                            | ❌ Same                             |

---

## 2. Naming convention

> About naming
> Worksheets or Curriculum Packs are prefixed with CP
> SCORM modules are prefixed with SC
> Courses viewable in a browser are prefixed with CO
> We have not sorted out where new kinds of content lives yet

This implementation:
- Uses `CO` prefix for the three Course Viewer courses ✅
- Uses `CP` for curriculum packs (CP4807, CP1972, CP0507) ✅
- Has no `SC` resources yet ❌

---

## 3. Screen types

> The document details screen types that appear in the Matrix AI Course Viewer. These are:
> - Youtube: a video on the YouTube site
> - PDF: a PDF document that appears in the Course Viewer with scroll bars to that the user can navigate through the PDF
> - HTML: a combination of rich text, images and video as per normal HTML
> - Document: a Word document that appears in the Course Viewer with scroll bars to that the user can navigate through it
> - Powerpoint: a PowerPoint file that appears in the Course Viewer with scroll bars to that the user can navigate through it
> - Spreadsheet: a Spreadsheet file that appears in the Course Viewer with scroll bars to that the user can navigate through it
> We will add to this list

Implementation status of each:

| Type        | Master-doc requirement                       | Implementation                                                |
|-------------|----------------------------------------------|---------------------------------------------------------------|
| YouTube     | Video on YouTube                             | ✅ Embedded `<iframe>` from extracted video id                |
| PDF         | Appears with scroll bars                     | ✅ Browser-native PDF viewer in iframe                        |
| HTML        | Rich text, images and video                  | ✅ Fetch + inject + post-process via worksheet enhancer       |
| Document    | Word document with scroll bars               | ✅ `mammoth.js` renders `.docx` to inline HTML; download offered |
| Powerpoint  | PowerPoint with scroll bars                  | ⚠️ **Partial** — download-only card. Inline render not implemented (no good in-browser pptx renderer without a paid SDK) |
| Spreadsheet | Spreadsheet with scroll bars                 | ⚠️ **Partial** — download-only card. No screens currently use it. |
| Image       | Implied by master doc CO0001/CO0002 lists ("Image" / "Opening screen") but not explicitly listed under "Screen types" | ✅ Inline image / SVG with backdrop |

---

## 4. CO0001 — CPD course screen list

Master doc verbatim:

> Screen type | Hours | Equipment | Title | File
> Image | 0 | Flowcode / E-blocks3 | Introduction to microcontrollers | "CO002 – opening.png"
> HTML | 0.1 | Flowcode / E-blocks3 | Learning objectives | "CO002 – LO.HTM"
> HTML | 0.1 | Flowcode / E-blocks3 | Equipment | "CO002 – Equip.HTM"
> HTML | 0.2 | Flowcode / E-blocks3 | Welcome | "CO0001 – CPD objectives.HTM"
> YouTube | 0.2 | Flowcode / E-blocks3 | Introducing E-blocks 3 | https://youtu.be/KmpyVmv6J_Y
> YouTube | 0.2 | Flowcode / E-blocks3 | Introducing Flowcode | https://youtu.be/tDdptTbvDM0
> PDF | 0.2 | Flowcode / E-blocks3 | E-blocks datasheet | https://www.matrixtsl.com/wp-content/uploads/2026/03/CP9645-Eblocks-3-Datasheet-1.pdf
> Powerpoint | 0.3 | Flowcode / E-blocks3 | Microcontroller basics 1 | "Microcontroller basics 1 24 02 26.pptx"
> Powerpoint | 0.3 | Flowcode / E-blocks3 | Microcontroller basics 2 | "Microcontroller basics 2 24 02 26.pptx"
> Document | 1 | Flowcode / E-blocks3 | First program | "CP4807-1.docx"
> Document | 0.2 | Flowcode / E-blocks3 | Performing calculations | "CP4807-2.docx"
> Document | 0.2 | Flowcode / E-blocks3 | Connection points | "CP4807-3.docx"
> Document | 0.2 | Flowcode / E-blocks3 | Digital inputs | "CP4807-4.docx"
> HTML | 0.2 | Flowcode / E-blocks3 | Homework 1 | "CP4807-H1.htm"
> Document | 0.2 | Flowcode / E-blocks3 | Making decisions | "CP4807-5.docx"
>
> When the client has gone through all screens and marked them as complete please print them a certificate of completion using "CP4807-CPDcert.docx" and insert the candidate name in the &lt;name&gt; field and the date in the &lt;date&gt; field.

This implementation: 15 screens in `data/courses.json` → `CO0001`. **Match.** Filename in master doc is `"CO0001- FC-EB CPD.pdf"` for the course as a whole — the implementation uses `CO0001` as the course id rather than as a `.pdf` filename.

**Certificate**: implemented in `certificate.html`. Triggers when 100% complete, prompts for name, prints. The "insert in `<name>` and `<date>` fields" requirement is fulfilled — but we do not currently use the source `.docx` template from the master doc as the visual basis. See `ROADMAP.md`.

---

## 5. CO0002 — Introduction to Microcontrollers screen list

42 screens in master doc, 42 in implementation. **Match.** Notable points the master doc itself acknowledges:

- **Duplicate "Colour graphical displays"**: the master doc lists `CP4807-8.docx` twice (rows 20 and 22). This implementation keeps both per the master-doc verbatim rule.
- **Row 35 "Floats and INTs"**: master doc says `Screen type: HTML` but `File: CP1972-6.docx` — that's a master-doc typo (a `.docx` is a Document, not HTML). Implementation marks this as `type: document`, file `content/CP1972/CP1972-6.docx`, currently flagged missing.
- **External "Getting started guide" URL**: Flowcode wiki link with `external: true` to force iframe (CORS prevents fetch+inject).

---

## 6. CO0003 — Digital Techniques (EASA) screen list

26 screens. **Match.**

Master-doc text uses "**Opening screen**" (not "Image") for the first screen — this implementation treats them as the same type. See Inconsistencies.

No certificate — master doc gives no certificate instruction for CO0003. Implementation respects this (`certificate.enabled: false`).

---

## 7. The four worksheet packs

> There are three sets of worksheets in this series: Introduction to microcontrollers, Sensors and microcontrollers, and Motors and microcontrollers.
> *(The master doc's Teacher's notes section also lists a fourth set: PC interfacing.)*

The master doc's Teacher's-notes "List of all tutorials across workbooks" gives:

### CP4807 — Introduction to microcontrollers (12 worksheets)
**Bronze**
1. First program
2. Performing calculations
3. Connection points
4. Digital inputs
5. Making decisions
6. Macros / subroutines
7. Using prototype boards

**Silver**
8. Colour graphical displays
9. Pin interrupts
10. Timer interrupts

**Gold**
11. Touch control systems
12. Web mirror

### CP1972 — Sensors and Microcontrollers (11 worksheets)
**Bronze**
1. Analogue inputs
2. Light sensor
3. Analogue temperature sensor
4. Digital temperature sensor
5. Digital accelerometer

**Silver**
6. Floats and ints

**Gold** *(any one of the following mechanical sensor projects)*
7. Thermocouple
8. Flow sensor
9. Compressive force sensor
10. Strain sensor
11. Pressure sensor

### CP0507 — Motors and microcontrollers (5 worksheets)
**Bronze**
1. Basic DC motor control
2. Full bridge motor control
3. Servo motor control
4. Stepper motor control

**Gold**
5. DC motor speed control

### PC interfacing (4 worksheets — code not given by master doc)
**Bronze**
1. Beginning hardware interfacing — PC to hardware
2. Bidirectional hardware control
3. JSON encoding

**Silver**
4. Full PC – Embedded project

The tier inference in `assets/gamify.js` (`inferTier()`) implements all of the above. PC interfacing has no `CP` code yet — it isn't currently referenced by any `CO` course.

---

## 8. Hardware referenced in the master doc

> This course is designed to be used with a Matrix Microcontroller development centre. There are three versions:
> - BL5394    ESP32 microcontroller development centre
> - BL8624    PIC microcontroller development centre
> - BL3797    Arduino microcontroller development centre

> These consist of:
> - Upstream board – BL0082 PIC, BL0040 Arduino, or BL0070 ESP32
> - BL0114 Combo board
> - BL0117 Prototype board
> - BL0118 Project board
> - BL0127 Actuators board
> - BL0135 9 axis motion / accelerometer board
> - BL0144 Temp/humidity board
> - BL0145 Switch board
> - BL0156 Splitter board
> - BL0172 Logic analyser with ribbon cable
> - BL0167 LED board
> - BL0183 Relay board
> - BL0189 Analogue board

These BL part numbers appear in worksheets (e.g. *Macros / subroutines* references `BL0114 Combo board component`). Verbatim text is preserved in the rendered `.docx` content — the renderer does not annotate them.

---

## 9. AI splitter instructions (master-doc origin)

The master doc embeds AI-splitter instructions verbatim:

> "Go through this document and create individual files with the content that starts with a tag enclosed in back and forward ticks <> as follows:
> Content between "&lt;HTML&gt;" and "&lt;/HTML&gt;": make me an HTML file from the content between these tags
> Content between "&lt;worksheet&gt;" and "&lt;/worksheet&gt;": make me a Word file from the content between these tags
> Content between "&lt;document&gt;" and "&lt;/document&gt;": make me a Word file from the content between these tags"

The `Matrix May LMS\doc_splitter\` folder is the implementation of these splitter instructions — it produced the files in `Matrix May LMS\assets\split_docs\CP4807\generated\` that this LMS reads.

> Note that I suspect that we want to be making HTML files here – not Word

This is an open question (see `ROADMAP.md`). The implementation accepts both: `.htm` files for homework / assessments / project / SOW / TN, `.docx` for the 12 numbered worksheets.

---

## 10. CPD certificate requirement

> For the CPD we want a certificate when everything is marked as 'complete'. How do we do that?

Implemented in `certificate.html`:
- Triggers when course progress hits 100%
- Recipient name + date inserted in styled fields
- Total hours, completion %, "The Matrix team" sign-off
- Print stylesheet hides chrome

Master doc adds:
> What we could do is use the time spend and % completeness and put that on the certificate.

Implementation shows **estimated** hours from the course definition and **completion %**. It does **not** track actual time spent on each screen — see `ROADMAP.md` for the planned interval timer.

---

## 11. Inconsistencies in the master doc itself

These are not bugs in this implementation; they are tensions in the master doc the team will need to resolve.

| # | Inconsistency                                                                          | Where                                          | This impl's choice                          |
|---|----------------------------------------------------------------------------------------|------------------------------------------------|---------------------------------------------|
| 1 | "9 separate resources" — actually lists 10 (or 11 including the worksheets PDF)        | "About this document"                          | We document all 10                          |
| 2 | EASA course code is `CO003` once and `CO0003- Digital techniques for aviation technicians.htm` elsewhere | Resource list vs. AI instruction filename      | Use `CO0003` consistently                   |
| 3 | SCORM ID `SC0001` listed for both Intro Microcontrollers SCORM and EASA SCORM          | Resource list                                  | n/a — no SCORM built yet                    |
| 4 | CO0001 image file is `"CO002 – opening.png"` — should likely be `CO0001 – opening.png`  | CO0001 screen-list table                       | We use a per-course `opening.svg` placeholder |
| 5 | CO0001 HTML "Welcome" file is `"CO0001 – CPD objectives.HTM"` (mixes course-id and a separate concept) | CO0001 screen-list table                       | Stored at `content/CO0001/cpd-objectives.html` |
| 6 | CO0002 row 35 "Floats and INTs" — type `HTML` but file `CP1972-6.docx`                 | CO0002 screen-list table                       | We treat it as `document` type              |
| 7 | CO0002 lists "Colour graphical displays / CP4807-8.docx" twice (rows 20 and 22)        | CO0002 screen-list table                       | We keep both per verbatim rule              |
| 8 | CO0003 first row uses `Opening screen` instead of `Image`                              | CO0003 screen-list table                       | Treated as `image` type                     |
| 9 | CP4807-Cont and CP4807-1 master-doc filename annotations both say `CP4807-1.doc`       | Worksheet content section                      | Implementation uses `CP4807-Cont.docx` for contents and `CP4807-1.docx` for "First program" |
| 10 | Some `.doc` references vs `.docx` references vary                                     | Throughout                                     | Implementation uses `.docx` exclusively for worksheets |

---

## 12. Open discussion points (from master doc, verbatim)

> Discussion points with Alf and Hamed
>
> - This whole document.
> - What is the filename for the course, what is its extension, and where does it live? I suspect it will have subdirectories? How its managed and backed up?
> - What is the filename for this document and how do we manage it?
>   (I suspect that we could have a similar document for the whole of Locktronics electrical / electronic. Perhaps 200 pages long? Then a similar one for Locktronics Automotive?)
> - We need to talk about file, or product, names.
> - We need to talk about fonts, styles and branding. Alyce should be involved. Although what Alf has done looks spot on.
> - I have specified Word files for worksheets. I think Alf has made them HTM? What's correct?
> - Do we need a style guide for Worksheets? A template? How does that work? For Locktronics you will probably want a different layout. How can we manage that?
> - There will be times when a resource does not exist but we have asked for it. What happens?
> - I need help with SCORM. How do I frame that for you?

> I have used Microsoft formatted files. Could be that we move to Google equivalents?

These are tracked in `ROADMAP.md`. Each remains open until the team decides — this LMS is built so that the eventual answers (Word vs HTML, MS vs Google, single-doc vs subdirectory layout, per-product themes) can be applied without a rewrite.

---

## 13. Not in master doc — implementation choices

Things this implementation adds that the master doc does not specify:

- **Achievements / gamification** — 20 achievements (`data/achievements.json`)
- **Bronze / Silver / Gold sidebar grouping** — derived from the master doc's Teacher's-notes pedagogy
- **Streak counter** — distinct days with activity
- **Toast popups + confetti** on completion / unlock
- **Worksheet enhancer** — promotes pseudo-headings (`Design brief:`, `Hardware:`, etc.) into icon-chip `<h2>`s, embeds bare YouTube URLs inline, collapses layout-only header tables
- **Tier inference** — per `assets/gamify.js`, derives tier from `CP####-N.docx` filename pattern
- **Per-screen time tracker** — real elapsed time written to `cmi.core.session_time` inside SCORM and shown on the certificate
- **Stats page** (`/stats.html`) — totals, per-course / per-screen breakdown, achievements, reset
- **Author preview tool** (`/preview.html`) — drop-to-render with inline mammoth + the same enhancer; per-card "Download as PDF"
- **Course Dashboard** (`/dashboard.html?id=...`) — per-course landing with hero, prep, promo cards, wiki refs, worksheet grid (the "before-you-start" experience the master doc describes prose-only as the "Preparation" worksheet, here surfaced as a real page)
- **Admin CMS** (`/admin.html`) — non-technical content editing with localStorage persistence and export
- **Resources-to-send panel** — dashboard widget listing every missing asset with destination paths
- **SCORM 1.2 packaging** — `tools/build-scorm.js` produces self-contained zips per `CO` course; addresses master-doc § "AI instructions for Introduction to microcontrollers SCORM content course"
- **Combined-PDF bundle generator** — addresses master-doc § "AI instructions for Introduction to microcontrollers worksheets.pdf" (the head + cont + 1-12 + TN bundle)

These are additive — none of them changes a master-doc requirement.

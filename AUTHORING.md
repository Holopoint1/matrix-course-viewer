# Authoring guide

How to define courses, add screens, and drop in content files.

## The big picture

The viewer is **content-driven**. Two JSON files describe everything:

| File                       | What it controls                                |
|----------------------------|-------------------------------------------------|
| `data/courses.json`        | Courses, their screen lists, file paths         |
| `data/achievements.json`   | The 20 achievements shown on the dashboard      |

Edit JSON → refresh browser. No build step.

## Course schema

```jsonc
{
  "courses": [
    {
      "id": "CO0002",                              // unique, used in URL ?id=…
      "code": "CO0002",                            // shown in sidebar / cards
      "title": "Introduction to Microcontrollers",
      "shortDescription": "Browser-based course covering the BTEC Level 3 Unit 6 …",
      "estimatedHours": 60,
      "certificate": {
        "enabled": true,                           // shows certificate CTA at 100%
        "templateName": "Introduction to Microcontrollers"
      },
      "screens": [
        { "id": "co2-s01", "type": "image", "title": "Introduction to microcontrollers", "hours": 0,   "equipment": "Flowcode / E-blocks3", "src": "content/CO0002/opening.svg" },
        { "id": "co2-s02", "type": "html",  "title": "Welcome",                          "hours": 0.1, "equipment": "Flowcode / E-blocks3", "src": "content/CO0002/welcome.html" },
        { "id": "co2-s07", "type": "pdf",   "title": "E-blocks datasheet",               "hours": 0.2, "equipment": "Flowcode / E-blocks3", "src": "https://www.matrixtsl.com/wp-content/uploads/.../CP9645-Eblocks-3-Datasheet-1.pdf" },
        { "id": "co2-s11", "type": "document", "title": "First program",                 "hours": 1,   "equipment": "Flowcode / E-blocks3", "src": "content/CP4807/CP4807-1.docx" }
      ]
    }
  ]
}
```

### Screen fields

| Field        | Required | Notes                                                                      |
|--------------|----------|----------------------------------------------------------------------------|
| `id`         | yes      | Unique within a course. Used as the localStorage key for completion state. |
| `type`       | yes      | One of `image`, `html`, `youtube`, `pdf`, `document`, `powerpoint`, `spreadsheet` |
| `title`      | yes      | Shown in sidebar + screen-bar. Copy verbatim from master doc                |
| `hours`      | yes      | Numeric estimate. Powers the Hours stat and certificate "time spent"        |
| `equipment`  | optional | Free-text label, shown in screen-bar meta line                              |
| `src`        | yes      | Path or URL — see below                                                     |
| `missing`    | optional | `true` if the asset isn't here yet — shows a "not yet available" placeholder|
| `external`   | optional | `true` to force iframe even for HTML (e.g. Flowcode wiki link)              |

### `src` patterns

| Type         | Example                                                                |
|--------------|------------------------------------------------------------------------|
| `image`      | `content/CO0002/opening.svg` (relative to `lms/`)                      |
| `html`       | `content/CP4807/CP4807-H1.htm` (local) or external URL with `external:true` |
| `youtube`    | `https://youtu.be/KmpyVmv6J_Y` — full URL; viewer extracts the video id|
| `pdf`        | Local path or full HTTPS URL — both work via iframe                    |
| `document`   | `content/CP4807/CP4807-1.docx` — fetched and rendered with mammoth.js  |
| `powerpoint` | `content/CO0002/Microcontroller-basics-1.pptx` — download-only card    |

## Adding a new screen to an existing course

1. Drop the file into the right folder under `content/`. Existing convention:
   - `content/CP4807/` — Intro to Microcontrollers worksheets + homework + assessments
   - `content/CO000X/` — per-course intro pages (welcome / learning objectives / equipment / opening art)
   - For new CP codes, create `content/CP1972/` (Sensors), `content/CP0507/` (Motors), etc.
2. Add a screen entry to the course's `screens` array in `data/courses.json`.
3. Refresh the page.

## Adding a whole new course

Say you want to add **CO0004 — Robotics with Allcode** (per the master doc's 120-hour scheme of work mention):

1. **Create the content folder** `content/CO0004/`.
2. **Add three intro stubs** (verbatim from whatever source doc):
   - `content/CO0004/welcome.html`
   - `content/CO0004/learning-objectives.html`
   - `content/CO0004/equipment.html`
   Use the existing `<link rel="stylesheet" href="../../assets/embedded.css">` pattern.
3. **Create the catalog opening art** — `content/CO0004/opening.svg`. Copy one of the existing `opening.svg` files and adjust the title text. Viewbox is 1280×720; gradient is `--primary-darker` → `--primary-dark`.
4. **Append the course entry** in `data/courses.json`.
5. **(Optional) Add a course-specific achievement** to `data/achievements.json` with `"test": "courseDone:CO0004"`.

That's it. Refresh the dashboard — the new course appears in the catalog grid.

## The Bronze / Silver / Gold tiering

The sidebar groups screens by tier. **Tier is inferred from the worksheet filename**, not stored in `courses.json`:

| Worksheet pack | Bronze | Silver | Gold     |
|----------------|--------|--------|----------|
| CP4807         | 1–7    | 8–10   | 11–12    |
| CP1972         | 1–5    | 6      | 7+       |
| CP0507         | 1–4    | —      | 5        |

If you introduce a **new CP code**, edit `inferTier()` in `assets/gamify.js` to add the rules.

Non-document screens (image / html / youtube / pdf / pptx) fall into:
- `intro` — anything that isn't a worksheet, homework or assessment
- `homework` — any HTML titled "Homework N"
- `assessment` — any HTML titled "Assessment N"
- `project` — final homework / project HTML

## Verbatim content rule

When extracting text from `master_doc.docx` or any `.docx` worksheet:

- Copy text **exactly as written** — including odd capitalisation, missing punctuation, em dashes, double spaces. The master doc is the source of truth.
- Do **not** "improve" wording, fix typos, or paraphrase.
- HTML tag changes are allowed (e.g. promoting `<p>Design brief:</p>` to `<h2>Design brief:</h2>`). Word changes are not.
- The worksheet enhancer in `assets/app.js` only changes tags, not text — keep it that way.

This keeps the viewer faithful to the print worksheets and assessments that students may also be working from on paper.

## Missing assets

Files referenced in `courses.json` that don't yet exist should be marked `"missing": true`. The viewer renders a friendly "Asset not yet available — drop `<filename>` into `content/`" panel instead of failing. Drop the file in and the screen activates automatically (no `missing: true` change needed if it's a runtime fetch — but cleaner to also remove the flag).

Currently flagged missing across the catalogue:
- `Microcontroller-basics-1.pptx`, `Microcontroller-basics-2.pptx`
- `CP1972-1.docx` … `CP1972-6.docx` (Sensors)
- `CP0507-1.docx` … `CP0507-4.docx` (Motors)

See `ROADMAP.md` for the full picture.

## Achievements

`data/achievements.json` is a flat list. Each entry:

```jsonc
{
  "id":   "first_steps",                  // stable string, used as localStorage key
  "title":"First Steps",
  "desc": "Tick your first challenge",
  "icon": "🎯",                           // emoji preferred (no asset hassle)
  "test": "totalCompleted>=1"             // see test grammar below
}
```

### Test grammar

| Pattern                     | Meaning                                                                 |
|-----------------------------|-------------------------------------------------------------------------|
| `totalCompleted>=N`         | At least N screens ticked across all courses                            |
| `documentsCompleted>=N`     | At least N `document`-type screens ticked                               |
| `coursesVisited>=N`         | Opened the course viewer for N distinct courses                         |
| `coursesWithTicks>=N`       | Has at least one tick in N distinct courses                             |
| `coursesWithDocTicks>=N`    | Has at least one *worksheet* tick in N distinct courses                 |
| `coursesDone>=N`            | N courses at 100%                                                       |
| `anyCourse>=N`              | At least one course at N% or higher                                     |
| `tierDone:bronze` (or silver/gold) | Every non-missing worksheet of that tier ticked                  |
| `courseDone:CO0002`         | Specific course at 100%                                                 |
| `tierTrifecta`              | At least one tick in each of bronze, silver, gold                       |

Adding a new test type means editing `passes()` in `assets/gamify.js` and adding the matching stat in `computeStats()`.

## Removing demo data / resetting state

There's no UI button yet. From the browser DevTools console:

```js
// Wipe all progress, achievements, streak, visit history for this site
Object.keys(localStorage)
  .filter(k => k.startsWith('matrix-lms:'))
  .forEach(k => localStorage.removeItem(k));
location.reload();
```

(See `ROADMAP.md` — a Settings → Reset progress button is on the planned list.)

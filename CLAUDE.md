# CLAUDE.md

Guidance for AI assistants (Claude Code, Cursor, etc.) working in this repo.

## What this is

A **standalone static LMS** for Matrix TSL — vanilla HTML / CSS / JS served by a single zero-dependency Node static server. **Not a framework project.** Do not introduce React, Next.js, Vite, Tailwind, etc. unless explicitly asked.

The site lives at `Matrix May LMS\lms\` inside a wider Matrix May LMS folder. The sibling `Matrix May LMS\doc_splitter\` folder is a **separate Matrix tool — ignore it for this LMS work**. The sibling `Matrix May LMS\assets\` folder contains the source `master_doc.docx` and `split_docs/CP4807/` reference content; treat as read-only inputs.

## Authoring rule (carry over from the wider project)

**Never reword source-doc content.** When pulling text from `master_doc.docx`, `.docx` worksheets, or any split source file into HTML, copy the text **verbatim**. Do not paraphrase, summarise, or "improve" wording. Tag changes (`<p>` → `<h2>`) are fine; word changes are not.

This applies to:
- The welcome / LO / Equipment HTML stubs in `content/CO000X/`
- Any new courses authored from the master doc
- Any rewriting of homework / assessment content

## Architecture

```
data/courses.json       ← source of truth for course structure. Edit this to add/edit screens.
data/achievements.json  ← achievement catalog. Each entry has a `test` string evaluated by gamify.js.

assets/app.js           ← course viewer (renders sidebar, screens, handles completion).
                          Owns the worksheet enhancer (`enhanceWorksheetHtml`) that
                          transforms .htm and mammoth-converted .docx output.
                          Includes the per-screen time tracker.
assets/gamify.js        ← achievement engine, toast/confetti, streaks, time stats.
                          Globally exposed as `window.Gamify`.
assets/cms-overrides.js ← admin edits persistence layer (localStorage Phase 1).
                          `window.MatrixCMS.applyOverrides(course)` is called by
                          every page that loads courses.json. Phase 2 swaps the
                          storage layer for a real backend without touching callers.
assets/sidebar.js       ← shared left-rail renderer used by dashboard.html
                          (course.html still has its own sidebar logic in app.js).
                          Globally exposed as `window.MatrixSidebar`.
assets/styles.css       ← all site styles. Uses CSS custom properties — change palette
                          via the `:root` block.

index.html              ← catalog + achievements grid + Resources-to-send panel
dashboard.html          ← per-course landing (hero, prep, promo cards, wiki refs, worksheet grid)
course.html             ← per-screen viewer
certificate.html        ← printable certificate of completion
stats.html              ← My Stats — totals, per-course, per-screen, achievements, reset
preview.html            ← author drop-to-preview tool (file → mammoth → enhancer → render)
                          plus per-card "Download as PDF" button
admin.html              ← CMS admin (login + course meta + screen editor + HTML body editor + export)

server.js               ← static server with .docx, .pptx mime types. Port 4173 by default.
tools/build-scorm.js    ← author-time SCORM 1.2 zip builder (npm install jszip)
```

The mammoth library is loaded from a CDN in `course.html`. The site has **no build step**; refresh = deploy.

## How a screen renders

`app.js` switches on `screen.type`:
- `image` → inline image / SVG with dark backdrop
- `youtube` → iframe with extracted video id
- `pdf` → iframe (browser-native PDF viewer)
- `html` → fetch + parse + run through `enhanceWorksheetHtml` + inject into `.stage-doc-inner` (so it inherits site styles, not the source file's plain stylesheet). External URLs (`screen.external: true` or `https?:` src) fall back to iframe.
- `document` → fetch arraybuffer, mammoth → HTML, run through `enhanceWorksheetHtml`, inject. Cached in `docCache`.
- `powerpoint` / `spreadsheet` → download-only card.

The enhancer lives in `app.js` as `enhanceWorksheetHtml`. It does five passes in order: header-table cleanup → YouTube embedding → "no video" pill → pseudo-heading promotion → topic-list grouping. **Add new transforms there**, don't sprinkle them into renderers.

## Course definition format

See `AUTHORING.md` for the full schema. Key points:

- Each screen needs `id`, `type`, `title`, `hours`, `equipment`, `src`. Optional: `missing: true`, `external: true`.
- `src` for local files is a path relative to `lms/` (e.g. `content/CP4807/CP4807-1.docx`).
- `src` for YouTube is the full URL.
- `src` for the master doc's external links (e.g. Flowcode wiki) gets `external: true` so the viewer iframes instead of fetching.

When adding a course, also create:
- `content/<COURSE_ID>/welcome.html`, `learning-objectives.html`, `equipment.html` (or whatever screens the master doc defines as HTML)
- `content/<COURSE_ID>/opening.svg` for the catalog thumbnail (1280×720 viewBox)

## Tier inference

`gamify.js` infers Bronze / Silver / Gold tier from the `src` filename (CP4807-1..7 = bronze, 8..10 = silver, 11..12 = gold; CP1972 1..5 bronze / 6 silver / 7+ gold; CP0507 1..4 bronze / 5 gold). The sidebar groups screens by `inferSection(screen)`. When introducing new CP codes update both `inferTier` and `inferSection` together.

## Gotchas

- `.htm` source files (split-doc output) embed their own `<style>` block. The renderer strips it by extracting only the `.page` div's innerHTML — keep that behaviour unless you have a reason to change it.
- The `screen-checkbox` is a `<button>` (not `<div>`) so keyboard users can toggle. Don't regress this.
- `localStorage` keys are namespaced. Don't change these keys — existing user data will be lost:
  - Progress / time / streak: `matrix-lms:progress:<courseId>`, `matrix-lms:time:<courseId>`, `matrix-lms:streak`
  - Gamification: `matrix-lms:unlocked`, `matrix-lms:visited-courses`
  - CMS: `matrix-lms:cms:courses`, `matrix-lms:cms:screens`, `matrix-lms:cms:html`, `matrix-lms:cms:auth`
- Mammoth runs in the browser. Large `.docx` files (with embedded images > a few MB) may stutter on first render. Caching is in `docCache` (in-memory only — clears on page reload).
- The viewer fetches `data/courses.json` on every page load. Browsers cache it for 5 minutes per the server's `Cache-Control` header. Hard-refresh after editing.
- **Always apply CMS overrides** when loading courses.json: `data.courses = data.courses.map((c) => window.MatrixCMS.applyOverrides(c))`. Skipping this means admin edits don't show on that page.
- HTML override in worksheet renderer: `window.MatrixCMS.getHtmlOverride(path)` is called before fetching — if non-null, use it instead of fetching. Keep this hook intact.

## When in doubt

Read **[`MASTER-DOC-SPEC.md`](MASTER-DOC-SPEC.md)** first — it captures every master-doc requirement verbatim, maps it onto current implementation, and flags master-doc inconsistencies. If `MASTER-DOC-SPEC.md` doesn't answer your question, fall back to `master_doc.docx` itself (in `Matrix May LMS\assets\`).

Open questions are tracked in `ROADMAP.md`.

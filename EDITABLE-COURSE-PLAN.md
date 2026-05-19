# Editable Course — Architecture & Plan

Status (2026-05-19): **Phase 0 ✅ (schema/RLS live), Phase 1 ✅ (seeded:
9 courses / 148 screens / 121 HTML bodies), Phase 2 ✅ (fail-open data
layer deployed). Phase 3 (editor + Supabase login) next. Cloudflare
Access deferred. Open follow-up: external `file:///…Media…` worksheet
images still dropped by mammoth (pre-existing; embedded images OK).**

## Goal
The whole course (meta, screen list, every screen's content, intro pages,
certificate) is editable in a real admin editor; changes persist for all
users; the admin is behind a real login **and** not publicly reachable.

## Locked decisions
1. **Worksheets stop being `.docx` for editing.** One-time convert every
   `.docx` → HTML (via the existing mammoth + styleMap pipeline in
   `app.js`, which now recovers the custom Word styles / bold / headings).
   HTML becomes the editable source. The Word/Splitter pipeline is retired
   for editing (kept only as an optional import tool — Phase 4).
2. **Supabase** = Auth + Postgres (content) + Storage (media) + RLS.
3. **Cloudflare Pages** hosts the site; **Cloudflare Access** gates
   `/admin*` so only approved identities can even load the admin page.
   Supabase Auth + RLS still secure the data underneath (defence in depth).
4. Git stays the app-shell source + a versioned backup/seed of content.

## Architecture
```
Visitor ─► Cloudflare Pages (static app: HTML/CSS/JS, from the GitHub repo)
            │
            ├─ /index, /course, /dashboard …  → public
            │     reads course/screens/pages from Supabase (anon key, RLS: public SELECT)
            │     media from Supabase Storage
            │
            └─ /admin*  → Cloudflare Access (approved emails/SSO only reach the page)
                            → Supabase Auth (editor session)
                            → writes to Supabase (RLS: editor-only INSERT/UPDATE)
```
No always-on server. The only privileged job (one-time seed with the
service-role key) runs locally, never from the site. No Cloudflare Worker
needed for editing.

## Data model
```
courses ( id pk, code, title, short_description, estimated_hours,
          certificate_enabled, categories jsonb, kind, updated_at )
screens ( id pk, course_id fk, position int, type, title, hours,
          equipment, src, body_html, missing bool, updated_at )
pages   ( path pk, html, updated_at )            -- intro / LO / equipment pages
media   ( Supabase Storage bucket "course-media" )
-- auth.users + an `editors` allow-list table (email) for the editor role
```
Maps 1:1 onto today's `cms-overrides.js` shapes
(`matrix-lms:cms:courses|screens|html`), so `window.MatrixCMS` keeps the
**same public API** — `app.js` / `admin.html` barely change.

### RLS policies
- `courses/screens/pages`: `SELECT` for `anon` + `authenticated`.
- `INSERT/UPDATE/DELETE`: only if `auth.jwt().email` ∈ `editors`.
- Storage bucket: public read; write restricted to editors.

## Phased plan
- **Phase 0 — Foundations** (needs user actions, see below)
  Supabase project + schema + RLS + Storage bucket + editors allow-list.
  Cloudflare Pages project connected to the GitHub repo; Cloudflare Access
  policy on `/admin*`.
- **Phase 1 — Migration/seed (git → Supabase)**
  Script: render each `.docx` via the mammoth+styleMap path → `screens.body_html`;
  import `.htm` pages → `pages.html`; upload every `Media/` asset to Storage
  and rewrite `file:///…` / `content/…` refs to Storage URLs (fixes the
  broken-image bug). QA pass against a checklist. Git keeps a snapshot.
- **Phase 2 — Viewer reads Supabase**
  `cms-overrides.js` → `cms-supabase.js`, identical `window.MatrixCMS`
  API, plus a cached static fallback snapshot if Supabase is unreachable.
- **Phase 3 — Real editor**
  `admin.html` → WYSIWYG (rich-text `body_html`; add/remove/reorder/retype
  screens; meta; intro pages; certificate). Supabase Auth gate. Save →
  Supabase. The export-zip→commit workflow is removed.
- **Phase 4 — Repurpose tools**
  Splitter/Definition become *import* actions (content.docx →
  seed/replace screens in Supabase) rather than git-file generators.

## What I need from the user to start Phase 0
Only these require dashboard access I don't have:
1. A free **Supabase project** → its **Project URL** + **anon public key**
   (safe in the client). Handle the **service-role key** privately — used
   only by the local one-time seed script.
2. A **Cloudflare Pages** project pointed at the GitHub repo
   (`Holopoint1/matrix-course-viewer`), and a **Cloudflare Access**
   application on the `/admin*` path with the approved editor emails.
   (User has a Cloudflare account: see memory `reference_cloudflare_account`.)

I scaffold SQL/RLS + the seed script + `cms-supabase.js` and hand back
exact dashboard click-steps; nothing on the live site changes until
Phase 2 is reviewed.

## Risks / honest notes
- `.docx → HTML` is lossy by nature; Phase 1 needs a visual QA pass
  (styleMap already recovers bold/headings — see app.js `MAMMOTH_OPTS`).
- Runtime dependency on Supabase → mitigated by the cached fallback.
- Source of truth moves to Supabase → scheduled export back to git for
  versioned backup.
- RLS must be correct (anon key is public by design); single highest-risk
  item — review policies before any write path goes live.
- Free tier (≈500MB DB / 1GB Storage) — confirm total media size in Phase 0.

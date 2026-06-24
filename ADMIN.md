# Admin — Live course-health dashboard

`admin.html` is a **read-only, live dashboard**, not an editor. Everything about a course is
controlled in **Google Drive** (see `README.md` and `AUTHORING.md`); the admin page just
shows you, accurately and continuously, what the live site is currently serving and where any
problems are.

> The old in-browser content editor (edit text / upload Word / delete / "last edited") has
> been **removed**. It wrote to a retired Supabase/localStorage override layer that does
> nothing in the Drive-only model, so it was static and misleading. It's gone.

URL: <https://holopoint1.github.io/matrix-course-viewer/admin.html>

## What it shows (and how it stays current)

On every page load **and every 60 seconds**, it re-fetches (cache-busted):
- `data/courses.json` — the generated catalogue, and
- `content/_sync-report.json` — the latest sync health report.

So it is never static — it always reflects the most recent sync.

- **Overall health line** — green ("all healthy") or amber with current issue counts.
- **Stat strip** — courses · screens displaying · missing · auto-fixed names · cleaned
  (files removed because they weren't in Drive) · download fails.
- **Per course → per screen status** (expand any course):
  - **✅ Displays** — file is in Drive and resolves.
  - **❌ Missing** — the file named in the definition isn't in the course's Drive folder.
    The reason tells you what to add. (The site never shows a stale/leftover copy — it
    shows missing.)
  - **🔧 Auto-fixed** — the sheet name differed only by case / hyphen-vs-en-dash /
    `.htm`-vs-`.html`; matched automatically.
  - **🔗 Link** — an external URL (YouTube / web PDF).
- **Last synced** time (and "x min ago").

## Actions

- **🚀 Sync from Drive now** — POSTs to the sync worker
  (`https://matrix-course-sync.ad5046.workers.dev/`, key `mcv-publish-9f3a2c`) to trigger an
  immediate sync instead of waiting for the ~5-minute schedule. The dashboard auto-updates
  a minute or two later.
- **↻ Refresh** — re-pull the report + courses immediately.

## Using it

A **❌ Missing** row is your to-do list: add that file (exact name) to the course's Drive
folder, then sync. The dashboard turns that row ✅ on the next sync. When every course is
green, the live site is a complete mirror of Drive.

## For developers

- `admin.html` is self-contained: the `<script>` fetches the two JSON files and renders the
  dashboard; it cross-references `_sync-report.json` (`missing`, `autofixed`, `removed`,
  `failed`, `collisions`) to give each screen a live status.
- It loads `chrome.js` (header) and the inert `cms-overrides.js` (harmless; purges any legacy
  browser overrides). No mammoth/jszip/Supabase/sheet-loader.
- The report shape is produced by `tools/sync-drive.mjs` (`writeAccuracyReport`).

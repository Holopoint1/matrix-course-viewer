# Publishing, reliability & the test course

This covers everything added in the "make publishing reliable + verify courses +
add a test course" pass.

## TL;DR

- **Why your CO0004 edit didn't show:** GitHub's `*/5` cron wasn't running. The
  pipeline was fine; nothing was triggering it.
- **The fix:** a Cloudflare Worker (`worker/`) now triggers the sync — reliably
  every 5 min **and** instantly via a **🚀 Publish to live** button in the admin.
- **A test course** (`ZZ9999`) was added so you can click through and confirm the
  whole viewer works.

---

## 1. Reliable publishing

### What changed
- `worker/` — a Cloudflare Worker with a 5-min Cron Trigger **and** a POST endpoint.
- `admin.html` — a fixed **🚀 Publish to live** button (bottom-right) that calls it.

### Deploy it (one-time)
See **`worker/README.md`**. Short version, from `lms/worker/`:
```bash
npx wrangler login
npx wrangler secret put GH_TOKEN     # a GitHub fine-grained PAT, Actions: Read/write on the repo
npx wrangler secret put PUBLISH_KEY  # mcv-publish-9f3a2c  (must match admin.html)
npx wrangler deploy
```
Until the Worker is deployed, the button shows "Could not reach the publish
service" — that's expected. The site itself still works.

### How you'll publish from now on
Edit the Google Sheet → open the admin → click **🚀 Publish to live** → ~1–2 min
later it's live. (Or just wait up to ~5 min for the automatic cron.)

---

## 2. Course health — all definition courses

Verified against the **live** `courses.json`:

| Course | Screens | Status |
|---|---|---|
| CO0001 | 17 | ✅ |
| CO0002 | 41 | ✅ |
| CO0003 | 25 | ✅ |
| CO0004 | 33 | ✅ |
| CP2563 (pack) | 17 | ⚠️ 3 missing files |
| CP7244 (pack) | 17 | ⚠️ 3 missing files |

### The 6 missing files = filename typos in the pack definition sheets
The files exist in the shared **CP4807** base folder; the sheets point at names
that don't exist. Fix is 3 cells in **each** pack's definition Google Sheet:

| Screen (row) | Change the **File** cell to |
|---|---|
| Title page | `content/CP4807/CP4807-head.docx` |
| Contents | `content/CP4807/CP4807-Cont.docx` |
| Teacher notes | `content/CP4807/CP4807-TN.htm` |

(The "Teacher notes" row currently says `CP4807/TN-1.docx`, which doesn't exist.)

After editing both sheets, click **🚀 Publish to live** — that re-syncs and the
two packs go to 17/17. *(This doubles as a real test of the publish button.)*

If you'd rather the packs have their **own** title/contents/teacher-notes pages
instead of reusing CP4807's, add those files to each pack's Drive folder with the
names the sheet already expects (`CP2563-head.docx`, etc.) and they'll download
on the next sync.

---

## 3. The test course (`ZZ9999`)

A self-contained "Test Course — System Check" added straight into `courses.json`
(not sheet-driven, so syncs leave it alone). Files live in `content/ZZ9999/`.

It exercises every screen type: **image** (SVG title card), **HTML** pages,
**YouTube** video, a **Word (.docx) worksheet**, plus progress tracking and the
**certificate**. It appears in the main course grid under a **Test** category.

### Click-through test
1. Open the live site → the **Test Course — System Check** card (Test category).
2. Open it → check the worksheet card shows on the course page.
3. Click **Start course** → step through all 7 screens; each should render.
4. **Mark complete & next** through to the end → the **Get your certificate**
   button should appear at 100%.

### Removing it when done
Delete the folder and the entry, then publish:
```bash
cd lms
rm -rf content/ZZ9999
node -e "const fs=require('fs'),p='data/courses.json',d=JSON.parse(fs.readFileSync(p));d.courses=d.courses.filter(c=>c.id!=='ZZ9999');fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n')"
git add -A && git commit -m "Remove ZZ9999 test course" && git push origin main
```

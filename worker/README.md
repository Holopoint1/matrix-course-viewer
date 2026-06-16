# matrix-course-sync (Cloudflare Worker)

Fires the LMS **Drive → GitHub sync** reliably, so course edits actually publish
instead of waiting on GitHub's flaky `*/5` cron.

It does two jobs:

| Trigger | What happens |
|---|---|
| **Cron** (`*/5 * * * *`) | Cloudflare runs `scheduled()` every 5 min and calls GitHub's `workflow_dispatch` → the sync runs → live site updates. Reliable, unlike GitHub's own scheduler. |
| **POST `/`** | The **🚀 Publish to live** button in `admin.html` calls this for an instant, on-demand sync. |

The GitHub token lives **only** in this Worker as a secret. It is never in the
website or this repo.

---

## One-time setup

You need: the [Cloudflare account](https://dash.cloudflare.com) (already in
`wrangler.toml`) and a GitHub token that can start the workflow.

### 1. Create the GitHub token (fine-grained PAT)

1. GitHub → **Settings → Developer settings → Fine-grained tokens → Generate new token**.
2. **Resource owner:** Holopoint1. **Repository access:** *Only select repositories* → `matrix-course-viewer`.
3. **Permissions → Repository → Actions: Read and write.** (That's the only one needed.)
4. Set an expiry (e.g. 1 year) and generate. Copy the `github_pat_...` value.

### 2. Deploy + set the secrets

From `lms/worker/`:

```bash
npx wrangler login                 # once, opens browser (or set CLOUDFLARE_API_TOKEN)
npx wrangler secret put GH_TOKEN   # paste the github_pat_... value
npx wrangler secret put PUBLISH_KEY # paste:  mcv-publish-9f3a2c
npx wrangler deploy
```

`PUBLISH_KEY` **must** match the value in `admin.html` (`mcv-publish-9f3a2c`). If you
change one, change both.

The Worker deploys to: **https://matrix-course-sync.ad5046.workers.dev**
(`admin.html` already points here — change `PUBLISH_ENDPOINT` there if you rename it.)

### 3. Test it

```bash
curl https://matrix-course-sync.ad5046.workers.dev/health      # {"ok":true,...}
```

Then open the live admin, click **🚀 Publish to live**, and watch the run appear
under the repo's **Actions** tab. ~1–2 min later the live site reflects the change.

### 4. (Optional) retire GitHub's own cron

Now that the Worker drives the schedule, the `schedule:` block in
`.github/workflows/sync-from-drive.yml` is redundant (and unreliable). You can
delete just those two lines — `workflow_dispatch` and `push` triggers stay, so
the Worker and manual runs keep working. Left in place it's harmless (just the
occasional duplicate run).

---

## Notes

- **Auth model:** `PUBLISH_KEY` is a soft gate, not a vault — `admin.html` is a
  public page so the key is visible in source. That's acceptable because the only
  action it allows is re-running an **idempotent** sync (it re-reads Drive; it
  can't delete or alter content). The Worker also throttles manual triggers to one
  per 30s.
- **Full sync:** the Worker sends `inputs.course = ''` so every course is synced,
  overriding the workflow's `CO0001` input default.

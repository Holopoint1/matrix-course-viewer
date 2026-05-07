# Deployment

## Local development

The site is fully static. Run the bundled Node server:

```sh
node server.js
```

- Default port `4173`. Override: `PORT=4000 node server.js`.
- Zero npm dependencies — uses only `node:http`, `node:fs/promises`, `node:path`.
- The server adds correct MIME types for `.docx`, `.pptx`, `.xlsx` so mammoth.js can fetch worksheet files as ArrayBuffers.
- `Cache-Control` is set to 5 minutes for static assets and `no-cache` for HTML, so editing `data/courses.json` or markup is reflected on hard-refresh (Ctrl+Shift+R).

## GitHub Pages (current public host)

The repo is at <https://github.com/Holopoint1/matrix-course-viewer>.

To enable Pages on a fresh fork:

1. Push to `main` on GitHub.
2. **Settings → Pages**
3. **Build and deployment → Source**: *Deploy from a branch*
4. **Branch**: `main`, folder: `/ (root)` → **Save**
5. Wait ~30–60 seconds for the first build.
6. URL pattern: `https://<owner>.github.io/<repo>/`

For this project: **<https://holopoint1.github.io/matrix-course-viewer/>**

GitHub Pages serves the static files as-is. The `node server.js` script is **not** used on Pages — Pages is a static host. If you add server-side functionality later (auth, dynamic data), you'll need to switch to a Node-capable host (see options below).

### Custom domain on Pages

1. Repo **Settings → Pages → Custom domain** → enter the domain (e.g. `learn.matrixtsl.com`)
2. Add a CNAME DNS record pointing to `holopoint1.github.io` (or apex `A`/`AAAA` records — see GitHub docs)
3. Tick **Enforce HTTPS** once the cert provisions

A `CNAME` file gets committed automatically when you set the domain in the UI.

## Cloudflare Pages (alternative)

If you prefer Cloudflare's edge:

1. Connect the GitHub repo to Cloudflare Pages
2. **Build command**: leave blank
3. **Build output directory**: `/` (the root of the repo)
4. Deploy

Cloudflare gives a `*.pages.dev` URL plus optional custom domain. Free tier is fine.

## Netlify (alternative)

Same idea — connect the repo, leave build command blank, publish directory `/`. Netlify gives `*.netlify.app` URLs.

## Self-host

For a Node-capable host (a small VM, Render, Fly.io, etc.):

```sh
PORT=80 node server.js
```

The server binds to 0.0.0.0 and serves the same static tree. Behind a reverse proxy (Nginx / Caddy / Cloudflare in front) is recommended for HTTPS + caching.

## Environment variables

| Var      | Default | Effect                                |
|----------|---------|---------------------------------------|
| `PORT`   | `4173`  | TCP port to listen on                 |

There are **no secrets and no API keys** — the project is fully client-side.

## CI / pre-flight

There's no CI configured yet. Manual sanity check before deploy:

```sh
node -c server.js                                          # syntax-check server
node -e "require('./data/courses.json')"                   # validate JSON
node -e "require('./data/achievements.json')"              # validate JSON
node server.js & sleep 2                                   # start server
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/        # 200?
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4173/course.html?id=CO0002"   # 200?
kill %1
```

## Rollback

GitHub Pages tracks the deployed commit. To roll back, `git revert` the bad commit and push, or `git reset --hard <good-sha> && git push --force-with-lease` (don't force-push without good reason — see the section on git safety in `CLAUDE.md`).

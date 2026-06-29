/* ============================================================================
 * matrix-course-sync — Drive→GitHub sync trigger + course-cover store.
 *
 * Two responsibilities:
 *   1) SYNC TRIGGER
 *        scheduled() — Cron (every 5 min) calls GitHub's workflow_dispatch.
 *        POST /      — the admin "Sync from Drive now" button.
 *      GitHub's own every-5-min schedule is flaky, so this Worker drives it.
 *
 *   2) COURSE COVERS (KV: COVERS)
 *        POST   /cover/<id>  — admin uploads a cover image (key-gated).
 *        GET    /cover/<id>  — public; serves the image for the catalog cards.
 *        DELETE /cover/<id>  — admin removes a cover (key-gated).
 *        GET    /covers      — public; JSON manifest {id:{ct,v,w,h,size}} so the
 *                              catalog knows which courses have a cover.
 *      A static GitHub Pages site has nowhere to store an upload, and the Drive
 *      sync full-mirror-prunes content/, so covers live here in KV instead.
 *
 * The GitHub token never touches the website. It lives only here as the Worker
 * secret GH_TOKEN. See worker/README.md for setup.
 * ==========================================================================*/

const GH_API_VERSION = '2022-11-28';

/* Cover upload limits (KV value cap is 25 MiB; covers should be far smaller). */
const MAX_COVER_BYTES = 5 * 1024 * 1024;               // 5 MB hard limit
const ALLOWED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;                 // course ids: CO0001, CP4807, …
// Manifest of which courses have covers, kept as one KV key so reads are prompt
// (KV list() can lag ~60s). "@" isn't allowed in a course id, so it can't clash.
const MANIFEST_KEY = '@manifest';

function corsHeaders(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allow = env.ALLOW_ORIGIN || '*';
  const allowOrigin = allow === '*' ? '*' : (origin === allow ? origin : allow);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Publish-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// Fire GitHub's workflow_dispatch. Returns the raw fetch Response (204 = ok).
async function dispatch(env) {
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/${env.GH_WORKFLOW}/dispatches`;
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GH_API_VERSION,
      'User-Agent': 'matrix-course-sync-worker',
      'Content-Type': 'application/json',
    },
    // course:'' forces a FULL sync (download all course folders). Without it,
    // the workflow input default ('CO0001') would limit the download phase to
    // a single course and a new file in another course would be missed.
    body: JSON.stringify({ ref: env.GH_REF || 'main', inputs: { course: '' } }),
  });
}

function authed(request, env) {
  const key = request.headers.get('X-Publish-Key') || '';
  return env.PUBLISH_KEY && key === env.PUBLISH_KEY;
}

/* ---- cover handlers ---------------------------------------------------- */

// Rebuild the manifest from a full KV listing (self-heal if the key is lost).
async function rebuildManifest(env) {
  const out = {};
  let cursor;
  do {
    const res = await env.COVERS.list({ cursor });
    for (const k of res.keys) { if (k.name !== MANIFEST_KEY) out[k.name] = k.metadata || {}; }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  await env.COVERS.put(MANIFEST_KEY, JSON.stringify(out));
  return out;
}

async function listCovers(env, cors) {
  if (!env.COVERS) return json({ ok: false, error: 'Cover store not configured' }, 500, cors);
  let manifest = await env.COVERS.get(MANIFEST_KEY, { type: 'json' });
  if (!manifest) manifest = await rebuildManifest(env);
  // Short cache: the catalog cache-busts per-cover with ?v=<v>, so this only
  // needs to be fresh enough that a brand-new cover shows up promptly.
  return json({ ok: true, covers: manifest }, 200, { ...cors, 'Cache-Control': 'public, max-age=30' });
}

async function getCover(id, env, cors) {
  if (!env.COVERS) return json({ ok: false, error: 'Cover store not configured' }, 500, cors);
  const { value, metadata } = await env.COVERS.getWithMetadata(id, { type: 'arrayBuffer' });
  if (!value) return json({ ok: false, error: 'No cover for ' + id }, 404, cors);
  const m = metadata || {};
  return new Response(value, {
    status: 200,
    headers: {
      'Content-Type': m.ct || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
      'ETag': '"' + (m.v || '0') + '"',
      'Access-Control-Allow-Origin': cors['Access-Control-Allow-Origin'],
      'Vary': 'Origin',
    },
  });
}

async function putCover(id, request, env, cors) {
  if (!env.COVERS) return json({ ok: false, error: 'Cover store not configured' }, 500, cors);

  let bytes = null, ct = '', w = 0, h = 0;
  const reqType = (request.headers.get('Content-Type') || '').toLowerCase();
  try {
    if (reqType.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return json({ ok: false, error: 'No file field' }, 400, cors);
      ct = (file.type || '').toLowerCase();
      bytes = await file.arrayBuffer();
      w = parseInt(form.get('w'), 10) || 0;
      h = parseInt(form.get('h'), 10) || 0;
    } else if (reqType.startsWith('image/')) {
      ct = reqType.split(';')[0].trim();
      bytes = await request.arrayBuffer();
      const u = new URL(request.url);
      w = parseInt(u.searchParams.get('w'), 10) || 0;
      h = parseInt(u.searchParams.get('h'), 10) || 0;
    } else {
      return json({ ok: false, error: 'Send the image as multipart/form-data (field "file") or a raw image/* body.' }, 415, cors);
    }
  } catch (e) {
    return json({ ok: false, error: 'Could not read upload: ' + String((e && e.message) || e) }, 400, cors);
  }

  if (!bytes || bytes.byteLength === 0) return json({ ok: false, error: 'Empty upload' }, 400, cors);
  if (bytes.byteLength > MAX_COVER_BYTES) {
    return json({ ok: false, error: 'Image is ' + Math.round(bytes.byteLength / 1024) + ' KB — keep covers under ' + (MAX_COVER_BYTES / 1024 / 1024) + ' MB.' }, 413, cors);
  }
  if (!ALLOWED_COVER_TYPES.includes(ct)) {
    return json({ ok: false, error: 'Unsupported type "' + ct + '". Use JPG, PNG, WebP, GIF or SVG.' }, 415, cors);
  }

  const meta = { ct, v: Date.now(), w, h, size: bytes.byteLength };
  await env.COVERS.put(id, bytes, { metadata: meta });
  const manifest = (await env.COVERS.get(MANIFEST_KEY, { type: 'json' })) || {};
  manifest[id] = meta;
  await env.COVERS.put(MANIFEST_KEY, JSON.stringify(manifest));
  return json({ ok: true, id, ...meta }, 200, cors);
}

async function deleteCover(id, env, cors) {
  if (!env.COVERS) return json({ ok: false, error: 'Cover store not configured' }, 500, cors);
  await env.COVERS.delete(id);
  const manifest = (await env.COVERS.get(MANIFEST_KEY, { type: 'json' })) || {};
  delete manifest[id];
  await env.COVERS.put(MANIFEST_KEY, JSON.stringify(manifest));
  return json({ ok: true, id, deleted: true }, 200, cors);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const cors = corsHeaders(env, request);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (request.method === 'GET' && path === '/health') {
      return json({ ok: true, service: 'matrix-course-sync', covers: !!env.COVERS }, 200, cors);
    }

    /* ---- covers (public reads) ---- */
    if (request.method === 'GET' && path === '/covers') return listCovers(env, cors);

    const coverMatch = path.match(/^\/cover\/([^/]+)$/);
    if (coverMatch) {
      const id = decodeURIComponent(coverMatch[1]);
      if (!ID_RE.test(id)) return json({ ok: false, error: 'Bad course id' }, 400, cors);
      if (request.method === 'GET') return getCover(id, env, cors);
      if (request.method === 'POST') {
        if (!authed(request, env)) return json({ ok: false, error: 'Unauthorized' }, 401, cors);
        return putCover(id, request, env, cors);
      }
      if (request.method === 'DELETE') {
        if (!authed(request, env)) return json({ ok: false, error: 'Unauthorized' }, 401, cors);
        return deleteCover(id, env, cors);
      }
      return json({ ok: false, error: 'Method not allowed' }, 405, cors);
    }

    /* ---- sync trigger (POST /) ---- */
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405, cors);
    }

    // Soft auth. The admin page is public, so this key is a gate, not a vault —
    // but the action is idempotent (re-reads Drive), so a leaked key only lets
    // someone trigger an extra harmless sync.
    if (!authed(request, env)) {
      return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    }

    // Throttle manual triggers to at most one per 30s (best-effort, per colo).
    const cache = caches.default;
    const throttleKey = new Request('https://throttle.internal/publish');
    if (await cache.match(throttleKey)) {
      return json({ ok: false, throttled: true, error: 'Just published — give it a moment.' }, 429, cors);
    }
    ctx.waitUntil(cache.put(throttleKey, new Response('1', { headers: { 'Cache-Control': 'max-age=30' } })));

    if (!env.GH_TOKEN) return json({ ok: false, error: 'Worker is missing its GH_TOKEN secret' }, 500, cors);

    try {
      const res = await dispatch(env);
      if (res.status === 204) return json({ ok: true, dispatched: true }, 200, cors);
      const detail = (await res.text()).slice(0, 300);
      return json({ ok: false, status: res.status, detail }, 502, cors);
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e) }, 502, cors);
    }
  },

  // Reliable replacement for GitHub's flaky */5 schedule.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env).catch(() => {}));
  },
};

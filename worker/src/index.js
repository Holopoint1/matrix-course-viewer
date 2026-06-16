/* ============================================================================
 * matrix-course-sync — reliable trigger for the LMS Drive → GitHub sync.
 *
 * Why this exists: GitHub's `schedule:` cron (the every-5-min schedule in
 * sync-from-drive.yml) is best-effort and routinely skips runs, so edits sit unpublished
 * for hours. This Worker does two things instead:
 *   1) scheduled() — a Cloudflare Cron Trigger (every 5 min) that actually
 *      fires, calling GitHub's workflow_dispatch to run the sync.
 *   2) fetch()     — a POST endpoint the admin "Publish now" button calls for
 *      an instant, on-demand sync.
 *
 * The GitHub token never touches the website. It lives only here as the Worker
 * secret GH_TOKEN. See worker/README.md for the one-time setup.
 * ==========================================================================*/

const GH_API_VERSION = '2022-11-28';

function corsHeaders(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allow = env.ALLOW_ORIGIN || '*';
  const allowOrigin = allow === '*' ? '*' : (origin === allow ? origin : allow);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'matrix-course-sync' }, 200, cors);
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405, cors);
    }

    // Soft auth. The admin page is public, so this key is a gate, not a vault —
    // but the action is idempotent (re-reads Drive), so a leaked key only lets
    // someone trigger an extra harmless sync.
    const key = request.headers.get('X-Publish-Key') || '';
    if (!env.PUBLISH_KEY || key !== env.PUBLISH_KEY) {
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

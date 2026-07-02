/* matrix-feedback — a tiny anonymous feedback board for the Matrix Course Viewer.
   The site is static (GitHub Pages), so posts live here in Cloudflare KV.

   Anonymity + "delete your own, not others'": each post gets a secret delete
   token (returned once, on create). The browser stores it in localStorage. Delete
   requires that token — so only the author (whose browser holds it) can remove a
   post. An optional ADMIN_KEY secret lets the site owner moderate any post.

   Routes (CORS-open — the board is public):
     GET    /posts            → [{id,text,name,createdAt}]  (never returns tokens)
     POST   /posts  {text,name?} → {id, token, post}
     DELETE /posts/:id        → needs header X-Delete-Token (owner) or X-Admin-Key
*/
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Delete-Token, X-Admin-Key',
  'Access-Control-Max-Age': '86400',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const clampName = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 40);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (!env.FEEDBACK) return json({ error: 'Feedback storage is not configured.' }, 503);
    const url = new URL(request.url);
    const path = (url.pathname.replace(/\/+$/, '') || '/');
    try {
      // ---- list ----
      if (path === '/posts' && request.method === 'GET') {
        const list = await env.FEEDBACK.list({ prefix: 'post:' });
        const raw = await Promise.all(list.keys.map((k) => env.FEEDBACK.get(k.name, 'json')));
        const posts = raw.filter(Boolean)
          .map((p) => ({ id: p.id, text: p.text, name: p.name || '', createdAt: p.createdAt }))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return json({ posts });
      }

      // ---- create ----
      if (path === '/posts' && request.method === 'POST') {
        let body; try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
        let text = String(body.text || '').trim();
        if (!text) return json({ error: 'Please write some feedback first.' }, 400);
        if (text.length > 2000) text = text.slice(0, 2000);
        const name = clampName(body.name);
        const id = crypto.randomUUID();
        const token = crypto.randomUUID() + crypto.randomUUID();
        const createdAt = Date.now();
        const record = { id, text, name, createdAt, tokenHash: await sha256hex(token) };
        await env.FEEDBACK.put('post:' + createdAt + ':' + id, JSON.stringify(record));
        return json({ ok: true, id, token, post: { id, text, name, createdAt } }, 201);
      }

      // ---- delete (owner token or admin key) ----
      const m = path.match(/^\/posts\/([^/]+)$/);
      if (m && request.method === 'DELETE') {
        const id = decodeURIComponent(m[1]);
        const list = await env.FEEDBACK.list({ prefix: 'post:' });
        const key = list.keys.find((k) => k.name.endsWith(':' + id));
        if (!key) return json({ error: 'That post no longer exists.' }, 404);
        const post = await env.FEEDBACK.get(key.name, 'json');
        if (!post) return json({ error: 'That post no longer exists.' }, 404);
        const token = request.headers.get('X-Delete-Token') || '';
        const adminKey = request.headers.get('X-Admin-Key') || '';
        const isOwner = token && (await sha256hex(token)) === post.tokenHash;
        const isAdmin = env.ADMIN_KEY && adminKey && adminKey === env.ADMIN_KEY;
        if (!isOwner && !isAdmin) return json({ error: 'You can only delete your own posts.' }, 403);
        await env.FEEDBACK.delete(key.name);
        return json({ ok: true });
      }

      return json({ error: 'Not found.' }, 404);
    } catch (e) {
      return json({ error: 'Server error: ' + (e && e.message) }, 500);
    }
  },
};

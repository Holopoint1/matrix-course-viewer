const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.pdf':  'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt':  'text/plain; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    const safe = path.normalize(pathname).replace(/^([\\/])+/, '').replace(/^(\.\.[\\/])+/g, '');
    let filePath = path.join(ROOT, safe);

    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); return res.end('Forbidden');
    }

    let stat;
    try { stat = await fs.stat(filePath); }
    catch (_) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found: ' + pathname);
    }

    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      try { stat = await fs.stat(filePath); }
      catch (_) {
        res.writeHead(404); return res.end('Not Found');
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || ext === '.htm' ? 'no-cache' : 'public, max-age=300',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  } catch (err) {
    console.error(err);
    res.writeHead(500); res.end('Server error');
  }
});

server.listen(PORT, () => {
  console.log('Matrix Course Viewer running at http://localhost:' + PORT + '/');
});

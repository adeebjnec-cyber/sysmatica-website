/* SysMatica — local server for testing the admin on this computer.
   Serves the site at http://localhost:5181 and lets /admin save straight into these files
   (content/site.json and new images in assets/img/uploads/), then rebuilds the pages.
   Run:  node scripts/admin-server.mjs */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 5181);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif', '.gif': 'image/gif', '.xml': 'application/xml', '.txt': 'text/plain' };
const ALLOWED = (p) => p === 'content/site.json' || /^assets\/img\/uploads\/[a-z0-9-]+\.(webp|png|svg)$/.test(p);

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__admin/ping') return send(res, 200, '{"ok":true}');
    if (url.pathname === '/__admin/save' && req.method === 'POST') {
      let body = ''; for await (const c of req) body += c;
      const { files } = JSON.parse(body);
      for (const f of files) if (!ALLOWED(f.path)) return send(res, 400, JSON.stringify({ error: 'Not allowed: ' + f.path }));
      JSON.parse(Buffer.from(files.find((f) => f.path === 'content/site.json').content, 'base64').toString('utf8'));
      for (const f of files) {
        const out = join(ROOT, f.path);
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, Buffer.from(f.content, 'base64'));
      }
      execFileSync(process.execPath, [join(ROOT, 'scripts/build.mjs')], { stdio: 'inherit' });
      return send(res, 200, '{"ok":true}');
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
    let file = join(ROOT, p);
    if (!file.startsWith(ROOT + sep) && file !== ROOT) return send(res, 403, 'Forbidden', 'text/plain');
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file).catch(() => null);
    if (!data) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
  } catch (e) { send(res, 500, JSON.stringify({ error: e.message })); }
}).listen(PORT, '127.0.0.1', () => console.log(`Admin test server: http://localhost:${PORT}/admin/`));

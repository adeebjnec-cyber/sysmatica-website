/* SysMatica — website admin backend (Netlify function, reached at /.netlify/functions/admin).
   - The admin password is checked here (PBKDF2 hash kept in Netlify Blobs, store "admin", key "auth").
   - Saving publishes a new Netlify deploy: it reuses every file of the current deploy, rebuilds
     index.html and careers.html from the new content, and adds any uploaded images.
   - Needs the site environment variable ADMIN_NETLIFY_TOKEN (a Netlify personal access token).
   Set up with:  node scripts/netlify-admin-setup.mjs */
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { connectLambda, getStore } from '@netlify/blobs';
import { render } from '../../scripts/render.mjs';

const SITE_ID = 'dcf3697b-3917-4a6a-be29-7e9baf8e4d86';
const SITE_NAME = 'sysmatica';
const LIVE_HOSTS = ['www.sysmpl.com', 'sysmpl.com', 'sysmatica.netlify.app'];
const API = 'https://api.netlify.com/api/v1';
const SESSION_HOURS = 12;
const UPLOAD_PATH = /^assets\/img\/uploads\/[a-z0-9-]{1,80}\.(webp|png|svg)$/;
const MIME = { webp: 'image/webp', png: 'image/png', svg: 'image/svg+xml' };

const json = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }, body: JSON.stringify(body) });
const fail = (status, error) => json(status, { error });
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hashPassword(password, salt = randomBytes(16).toString('base64'), iter = 310000) {
  return { salt, iter, hash: pbkdf2Sync(password, Buffer.from(salt, 'base64'), iter, 32, 'sha256').toString('base64') };
}

async function netlify(path, opts = {}) {
  const token = process.env.ADMIN_NETLIFY_TOKEN;
  if (!token) throw Object.assign(new Error('The admin is not connected to Netlify yet (ADMIN_NETLIFY_TOKEN is missing).'), { status: 503 });
  const r = await fetch(API + path, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  if (!r.ok) throw Object.assign(new Error(`Netlify ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: 502 });
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// Sessions: "<expiry>.<hmac>", signed with the stored password hash, so changing the password logs everyone out.
const sign = (auth, exp) => createHmac('sha256', auth.hash).update('session:' + exp).digest('base64url');
function makeSession(auth) { const exp = Date.now() + SESSION_HOURS * 3600e3; return exp + '.' + sign(auth, exp); }
function checkSession(auth, token) {
  const [exp, mac] = String(token || '').split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const want = Buffer.from(sign(auth, exp)), got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}
function checkPassword(auth, password) {
  const got = Buffer.from(hashPassword(String(password || ''), auth.salt, auth.iter).hash), want = Buffer.from(auth.hash);
  return got.length === want.length && timingSafeEqual(got, want);
}

function baseDeployFor(host) {
  const m = /^([0-9a-f]{24})--/.exec(host || '');
  return m ? { draft: true, id: m[1] } : LIVE_HOSTS.includes(host) ? { draft: false } : null;
}

async function listFiles(deployId) {
  const files = {};
  for (let page = 1; page < 50; page++) {
    const list = await netlify(`/deploys/${deployId}/files?page=${page}&per_page=500`);
    list.forEach((f) => { files[f.id] = f.sha; });
    if (list.length < 500) break;
  }
  return files;
}

function checkContent(site) {
  const need = ['images', 'team', 'services', 'industries', 'clients'];
  if (!site || typeof site !== 'object' || need.some((k) => !site[k])) throw Object.assign(new Error('The content is incomplete.'), { status: 400 });
  if (!site.services.length || !site.industries.length) throw Object.assign(new Error('At least one service and one industry are needed.'), { status: 400 });
}

async function save(body, host) {
  const base = baseDeployFor(host);
  if (!base) throw Object.assign(new Error('Saving only works on the website itself.'), { status: 400 });
  checkContent(body.site);
  const uploads = body.files || {};
  for (const [p, s] of Object.entries(uploads)) if (!UPLOAD_PATH.test(p) || !/^[0-9a-f]{40}$/.test(s)) throw Object.assign(new Error('Bad upload: ' + p), { status: 400 });

  const baseId = base.draft ? base.id : (await netlify(`/sites/${SITE_ID}`)).published_deploy.id;
  const baseDeploy = await netlify(`/deploys/${baseId}`);
  const functions = Object.fromEntries((baseDeploy.available_functions || []).map((f) => [f.n, f.d]));
  if (!functions.admin) throw Object.assign(new Error('Could not find the admin function in the current deploy.'), { status: 500 });
  const files = await listFiles(baseId);

  // Rebuild the pages from the new content.
  const changed = {};
  for (const page of ['index.html', 'careers.html']) {
    const r = await fetch(`https://${baseId}--${SITE_NAME}.netlify.app/${page}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw Object.assign(new Error(`Could not read ${page} (${r.status}).`), { status: 502 });
    changed['/' + page] = Buffer.from(render(await r.text(), body.site));
  }
  changed['/content/site.json'] = Buffer.from(JSON.stringify(body.site, null, 2) + '\n');
  for (const [p, buf] of Object.entries(changed)) files[p] = sha1(buf);
  for (const [p, s] of Object.entries(uploads)) files['/' + p] = s;

  const deploy = await netlify(`/sites/${SITE_ID}/deploys`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, functions, draft: base.draft, title: 'Website admin: content update' }),
  });
  const required = new Set(deploy.required || []);
  for (const [p, buf] of Object.entries(changed)) {
    if (!required.has(sha1(buf))) continue;
    await netlify(`/deploys/${deploy.id}/files${encodeURI(p)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
    required.delete(sha1(buf));
  }
  const needUploads = Object.entries(uploads).filter(([, s]) => required.has(s)).map(([p]) => p);
  return { deployId: deploy.id, upload: needUploads, url: base.draft ? `https://${deploy.id}--${SITE_NAME}.netlify.app` : 'https://www.sysmpl.com' };
}

async function upload(body) {
  const p = String(body.path || '');
  if (!UPLOAD_PATH.test(p) || !/^[0-9a-f]{24}$/.test(body.deployId || '')) throw Object.assign(new Error('Bad upload.'), { status: 400 });
  const buf = Buffer.from(String(body.content || ''), 'base64');
  await netlify(`/deploys/${body.deployId}/files/${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
  return { ok: true };
}

async function status(body) {
  if (!/^[0-9a-f]{24}$/.test(body.deployId || '')) throw Object.assign(new Error('Bad deploy id.'), { status: 400 });
  const d = await netlify(`/deploys/${body.deployId}`);
  return { state: d.state, error: d.error_message || null };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return fail(405, 'Use POST.');
  connectLambda(event);
  const store = getStore('admin');
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'Bad request.'); }
  const host = (event.headers['x-forwarded-host'] || event.headers.host || '').toLowerCase();

  try {
    const auth = await store.get('auth', { type: 'json' });
    if (!auth) return fail(503, 'The admin password has not been set up yet.');

    if (body.action === 'login') {
      if (!checkPassword(auth, body.password)) { await sleep(800); return fail(401, 'Wrong password.'); }
      return json(200, { token: makeSession(auth), connected: !!process.env.ADMIN_NETLIFY_TOKEN });
    }

    const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!checkSession(auth, token)) return fail(401, 'Your login has expired. Please log in again.');

    if (body.action === 'password') {
      if (!checkPassword(auth, body.current)) { await sleep(800); return fail(401, 'The current password is wrong.'); }
      if (String(body.next || '').length < 10) return fail(400, 'Please use at least 10 characters.');
      const next = hashPassword(String(body.next));
      await store.setJSON('auth', next);
      return json(200, { token: makeSession(next) });
    }
    if (body.action === 'save') return json(200, await save(body, host));
    if (body.action === 'upload') return json(200, await upload(body));
    if (body.action === 'status') return json(200, await status(body));
    return fail(400, 'Unknown action.');
  } catch (e) {
    return fail(e.status || 500, e.message || 'Something went wrong.');
  }
};

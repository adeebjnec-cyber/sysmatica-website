/* SysMatica — connect the website admin to Netlify and set (or reset) the admin password.
   Run in this folder:   node scripts/netlify-admin-setup.mjs
   It asks for:
     1. a Netlify personal access token (Netlify → User settings → Applications → New access token)
     2. the admin password, twice (at least 10 characters)
   Nothing you type is shown or written to disk. The token is saved as the site's
   ADMIN_NETLIFY_TOKEN environment variable (functions only); the password is stored as a
   PBKDF2 hash in Netlify Blobs. Redeploy the site afterwards so the function picks up the token.
   Options:  --password-only   keep the saved token, only reset the password */
import { createInterface } from 'node:readline';
import { getStore } from '@netlify/blobs';
import { hashPassword } from '../netlify/functions/admin.mjs';

const SITE_ID = 'dcf3697b-3917-4a6a-be29-7e9baf8e4d86';
const API = 'https://api.netlify.com/api/v1';
const passwordOnly = process.argv.includes('--password-only');

function ask(q) {
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { rl.output.write(s.includes(q) ? s : s.replace(/[^\r\n]/g, '*')); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); ok(a.trim()); });
  });
}
const stop = (msg) => { console.error('\n' + msg); process.exit(1); };

const token = await ask('Paste the Netlify access token (hidden): ');
if (!token) stop('No token given.');
const api = async (path, opts = {}) => {
  const r = await fetch(API + path, { ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok && !(opts.okStatus || []).includes(r.status)) stop(`Netlify said ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 || !r.headers.get('content-type')?.includes('json') ? null : r.json();
};
const site = await api(`/sites/${SITE_ID}`);
console.log(`Token works — site "${site.name}".`);

const password = await ask('New admin password (hidden): ');
if (password.length < 10) stop('Please use at least 10 characters (a short sentence works well).');
if ((await ask('Type it again: ')) !== password) stop('The two passwords do not match.');

if (!passwordOnly) {
  const q = `?site_id=${SITE_ID}`;
  await api(`/accounts/${site.account_id}/env/ADMIN_NETLIFY_TOKEN${q}`, { method: 'DELETE', okStatus: [404] });
  await api(`/accounts/${site.account_id}/env${q}`, {
    method: 'POST',
    body: JSON.stringify([{ key: 'ADMIN_NETLIFY_TOKEN', scopes: ['functions'], values: [{ value: token, context: 'all' }] }]),
  });
  console.log('Saved the token as the site setting ADMIN_NETLIFY_TOKEN.');
}

await getStore({ name: 'admin', siteID: SITE_ID, token }).setJSON('auth', hashPassword(password));
console.log('Admin password set.');
if (!passwordOnly) console.log('\nDone. Claude (or: npx netlify-cli deploy --prod) now needs to redeploy the site once so the admin can use the token.');

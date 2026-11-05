/* SysMatica — set (or change) the website admin password.
   Writes admin/config.json: the GitHub connection details encrypted with the password,
   so the password is never stored anywhere and the admin works on any static host.

   Password only (test on this computer):
     node scripts/admin-setup.mjs
   Connect saving to GitHub (live site):
     node scripts/admin-setup.mjs --repo OWNER/REPO --branch main --token github_pat_...
   The token must be a fine-grained token for that one repository with
   "Contents: Read and write" permission only. */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { webcrypto as crypto } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ITER = 600000;
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : undefined; };

function ask(q, hidden) {
  if (!hidden || !process.stdin.isTTY) {
    return new Promise((ok) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); ok(a); }); });
  }
  // Hidden input: read raw keystrokes ourselves and echo only "*", so nothing typed or pasted is ever shown.
  return new Promise((ok) => {
    let value = '';
    process.stdout.write(q);
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk.replace(/\x1b\[[0-9;]*[~A-Za-z]/g, '')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause();
          process.stdout.write('\n'); ok(value); return;
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        if (ch >= ' ') { value += ch; process.stdout.write('*'); }
      }
    };
    process.stdin.on('data', onData);
  });
}

const repo = arg('repo'), branch = arg('branch') || 'main';
let token = arg('token');
if (token && !repo) { console.error('Give --repo with --token to connect GitHub.'); process.exit(1); }
if (repo && !token) token = (await ask('Paste the GitHub token (it stays hidden): ', true)).trim();
if (repo && !/^(github_pat_|ghp_)/.test(token)) { console.error('That does not look like a GitHub token (it should start with github_pat_).'); process.exit(1); }

let password = arg('password');
if (!password) {
  password = await ask('New admin password: ', true);
  const again = await ask('Type it again: ', true);
  if (again !== password) { console.error('The two passwords do not match.'); process.exit(1); }
}
if (password.length < 10) { console.error('Please use at least 10 characters (a short sentence works well).'); process.exit(1); }

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const secret = { ok: true, github: repo ? { repo, branch, token } : null };
const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(secret)));
const b64 = (u) => Buffer.from(u).toString('base64');

writeFileSync(join(ROOT, 'admin/config.json'), JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) }, null, 2) + '\n');
console.log(`Saved admin/config.json — ${repo ? `saving goes to GitHub ${repo} (${branch}).` : 'password set; saving works with the local admin server (node scripts/admin-server.mjs).'}`);

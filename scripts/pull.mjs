/* SysMatica — bring the owner's admin edits from the live website into this folder.
   Run this BEFORE deploying from this computer, otherwise a deploy would undo them.
   Downloads content/site.json and any uploaded images it uses that are missing here. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.env.LIVE_URL || 'https://www.sysmpl.com';

const r = await fetch(`${LIVE}/content/site.json?t=${Date.now()}`, { cache: 'no-store' });
if (!r.ok) throw new Error(`Could not read the live content (${r.status}).`);
const text = await r.text();
JSON.parse(text);
const file = join(ROOT, 'content/site.json');
const same = existsSync(file) && readFileSync(file, 'utf8') === text;
if (!same) writeFileSync(file, text);
console.log(`content/site.json: ${same ? 'already up to date' : 'updated from the live site'}`);

let got = 0;
for (const p of new Set(text.match(/assets\/img\/uploads\/[a-z0-9-]+\.(?:webp|png|svg)/g) || [])) {
  const out = join(ROOT, p);
  if (existsSync(out)) continue;
  const img = await fetch(`${LIVE}/${p}`);
  if (!img.ok) { console.warn(`  could not download ${p} (${img.status})`); continue; }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(await img.arrayBuffer()));
  got++;
}
console.log(`uploaded images downloaded: ${got}`);

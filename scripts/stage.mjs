/* SysMatica — copy the public website files into _site (what Netlify publishes).
   Scripts, the admin function's source, node_modules and notes stay out of the public site. */
import { cpSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const SKIP = new Set(['_site', 'node_modules', 'netlify', 'scripts', 'netlify.toml', 'package.json', 'package-lock.json', 'ADMIN.md', '_backup']);

rmSync(OUT, { recursive: true, force: true });
let n = 0;
for (const name of readdirSync(ROOT)) {
  if (name.startsWith('.') || SKIP.has(name)) continue;
  cpSync(join(ROOT, name), join(OUT, name), { recursive: true });
  n++;
}
console.log(`_site: copied ${n} top-level items`);

/* SysMatica — rebuild the editable parts of the pages from content/site.json.
   Each editable part sits between <!-- cms:NAME --> and <!-- /cms:NAME --> markers;
   everything outside the markers is left exactly as it is.
   Run:  node scripts/build.mjs        (no dependencies, Node 18+) */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'));
const themes = JSON.parse(readFileSync(join(ROOT, 'content/themes.json'), 'utf8'));

for (const page of ['index.html', 'careers.html', '404.html']) {
  const file = join(ROOT, page);
  const before = readFileSync(file, 'utf8');
  const after = render(before, site, themes);
  if (after !== before) writeFileSync(file, after);
  console.log(`${page}: ${after === before ? 'unchanged' : 'updated'}`);
}

/* SysMatica — renders the editable (<!-- cms:NAME -->) parts of the pages from the site content.
   Used by scripts/build.mjs (on this computer) and by the admin Netlify function (live saves). */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (n) => String(n).padStart(2, '0');
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const thumb = (im) => im.thumb || im.src;
// Simple formatting for descriptions typed in the admin: "### Heading", "- bullet", **bold**, blank line = new paragraph.
const md = (text) => {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const out = []; let list = null, para = [];
  const endPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const endList = () => { if (list) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`); list = null; } };
  const flush = () => { endPara(); endList(); };
  String(text || '').replace(/\r/g, '').split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    const hd = line.match(/^#{1,6}\s+(.*)$/), li = line.match(/^[-*•]\s+(.*)$/);
    if (hd) { flush(); out.push(`<b class="md-h">${inline(hd[1])}</b>`); }
    else if (li) { endPara(); (list = list || []).push(li[1]); }
    else { endList(); para.push(line); }
  });
  flush();
  return out.join('');
};
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const ARROW = '<svg aria-hidden="true"><use href="#i-arrow"/></svg>';
const LINKEDIN = '<svg aria-hidden="true" viewBox="0 0 16 16"><path fill="currentColor" d="M3.6 5.6h2.1v6.8H3.6zM4.65 2.2a1.22 1.22 0 1 1 0 2.44 1.22 1.22 0 0 1 0-2.44zM7 5.6h2v.93h.03c.28-.53.97-1.09 2-1.09 2.13 0 2.53 1.4 2.53 3.23v3.73h-2.1V9.1c0-.79-.02-1.8-1.1-1.8-1.1 0-1.27.86-1.27 1.74v3.36H7z"/></svg>';
const MAIL = '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2 4h12v8H2zM2.5 4.5L8 9l5.5-4.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const EXT = '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M5 3h8v8M13 3L4 12" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';


function makeBlocks(site, themes) {
const S = site.services, I = site.images;
return {
  'hero-image': () => `<img src="${esc(I.hero.src)}" alt="${esc(I.hero.alt)}" fetchpriority="high">`,
  'about-image': () => `
            <img src="${esc(I.about.src)}" alt="${esc(I.about.alt)}" loading="lazy">
            <figcaption class="micro">${esc(I.about.caption)}</figcaption>
          `,
  // colour theme chosen in the admin (content/themes.json); the default blue needs no overrides
  theme: () => {
    const t = (themes || []).find((x) => x.id === site.theme);
    if (!t || t.id === 'blue') return '';
    const L = t.light, D = t.dark;
    return `<style id="site-theme">:root{--ink:${L.ink};--accent:${L.accent};--tint:${L.tint};--panel:${L.panel};--soft:${L.soft};--muted:${L.muted}}`
      + `.hero,.industries,.contact{--bg:${D.bg};--accent:${D.accent};--tint:${D.tint};--panel:${D.panel};--muted:${D.muted}}</style>`;
  },
  // visitor statistics (GoatCounter: no cookies, no personal data). Events: enquiries, applications,
  // service pop-ups opened, phone / email / WhatsApp clicks.
  analytics: () => {
    const code = site.analytics && site.analytics.goatcounter;
    if (!code || !/^[a-z0-9-]+$/.test(code)) return '';
    return `
  <script data-goatcounter="https://${code}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>
  <script>
    window.scTrack = function (path, title) { try { if (window.goatcounter && goatcounter.count) goatcounter.count({ path: path, title: title || path, event: true }); } catch (e) {} };
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me/"]');
      if (!a) return;
      var h = a.getAttribute('href');
      scTrack(h.indexOf('tel:') === 0 ? 'click-phone' : h.indexOf('mailto:') === 0 ? 'click-email' : 'click-whatsapp');
    });
  </script>
  `;
  },
  'company-photo': () => {
    const p = I.company;
    if (!p || !p.src) return '';
    return `<figure class="ct-photo" data-in style="--i:3"><img src="${esc(p.src)}" alt="${esc(p.alt || 'SysMatica Mechatronics')}" loading="lazy">${p.caption ? `<figcaption class="micro">${esc(p.caption)}</figcaption>` : ''}</figure>`;
  },
  // live Google Map of the company location (no API key needed)
  map: () => {
    const m = site.map;
    if (!m || !m.query || m.show === false) return '';
    const q = encodeURIComponent(m.query);
    return `<div class="ct-map" data-in style="--i:4"><iframe src="https://maps.google.com/maps?q=${q}&amp;z=${+m.zoom || 15}&amp;output=embed" title="Map: ${esc(m.query)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe><a class="ct-map-link" href="https://www.google.com/maps/search/?api=1&amp;query=${q}" target="_blank" rel="noopener">Open in Google Maps ↗</a></div>`;
  },
  'contact-image': () => `<img src="${esc(I.contact.src)}" alt="" loading="lazy">`,
  'careers-hero-image': () => `<img src="${esc(I.careersHero.src)}" alt="">`,
  'count-services': () => `<span class="v tnum" data-count="${S.length}">${S.length}</span>`,
  'services-count-word': () => `${WORDS[S.length] || S.length} services.`,

  team: () => site.team.map((m, i) => `
          <article class="member" data-in style="--i:${i % 2}">
            <div class="m-photo has-img"><img src="${esc(m.photo)}" alt="${esc(`${m.name}, ${m.roleLong || m.role}, SysMatica Mechatronics`)}" loading="lazy"${m.photoW ? ` width="${m.photoW}" height="${m.photoH}"` : ''}></div>
            <div class="m-txt">
              <h3>${esc(m.name)}</h3>
              <span class="micro m-role">${esc(m.role)}</span>
              <p>${esc(m.bio)}</p>${m.tags?.length ? `
              <ul class="m-tags">${m.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
              <div class="m-links">${m.linkedin ? `
                <a class="m-mail" href="${esc(m.linkedin)}" target="_blank" rel="noopener">${LINKEDIN}LinkedIn</a>` : ''}${m.email ? `
                <a class="m-mail m-email" href="mailto:${esc(m.email)}" data-copy-email="${esc(m.email)}" aria-label="Email ${esc(m.email)} (copies the address)">${MAIL}<span class="lbl">${esc(m.email)}</span></a>` : ''}
              </div>
            </div>
          </article>`).join('') + '\n        ',

  'services-cards': () => S.map((s, i) => `
          <li><button class="svc" type="button" data-svc="${esc(s.id)}" aria-haspopup="dialog" aria-controls="svc-modal" data-in style="--i:${i % 3}">
            <span class="svc-pic${s.card.cut ? ' cut' : ''}"><img src="${esc(s.card.src)}" alt="" loading="lazy"></span>
            <span class="svc-body">
              <span class="svc-top"><span class="svc-n">${pad(i + 1)}</span><span class="micro">${esc(s.category)}</span></span>
              <span class="svc-t">${esc(s.title)}</span>
              <span class="svc-d">${esc(s.short)}</span>
              <span class="svc-more">View details${ARROW}</span>
            </span>
          </button></li>`).join('') + '\n        ',

  'services-modal': () => S.map((s, i) => {
    const n = s.images.length;
    const main = s.images.map((im, k) => `<img class="${[im.cut ? 'cut' : '', k === 0 ? 'on' : ''].filter(Boolean).join(' ')}" src="${esc(im.src)}" alt="${esc(k === 0 ? s.title : `${s.title} — image ${k + 1}`)}" loading="lazy" data-k="${k}">`).join('');
    const thumbs = n > 1 ? `<div class="m-thumbs" role="group" aria-label="Images">${s.images.map((im, k) => `<button type="button" aria-pressed="${k === 0}" data-k="${k}" aria-label="${esc(im.label || `Show image ${k + 1} of ${n}`)}"><span class="th"><img class="${im.cut ? 'cut' : ''}" src="${esc(im.cut ? im.src : thumb(im))}" alt="" loading="lazy"></span>${im.label ? `<span class="tl">${esc(im.label)}</span>` : ''}</button>`).join('')}</div>` : '';
    const caps = s.images.some((im) => im.label || im.desc) ? `<div class="m-caps" aria-live="polite">${s.images.map((im, k) => `<div class="m-cap${k === 0 ? ' on' : ''}" data-k="${k}">${im.label ? `<b>${esc(im.label)}</b>` : ''}${im.desc ? `<div class="md">${md(im.desc)}</div>` : ''}</div>`).join('')}</div>` : '';
    return `
        <article class="m-prod" id="svc-${esc(s.id)}" data-id="${esc(s.id)}" aria-labelledby="mt-${esc(s.id)}">
          <div class="m-media"><div class="m-main">${main}${n > 1 ? `<button type="button" class="m-arr prev" data-dir="-1" aria-label="Previous image">${ARROW}</button><button type="button" class="m-arr next" data-dir="1" aria-label="Next image">${ARROW}</button><span class="m-pos" aria-hidden="true"><b>1</b> / ${n}</span>` : ''}</div>${thumbs}${caps}</div>
          <div class="m-info">
            <span class="micro m-fam">${pad(i + 1)} / ${pad(S.length)} · ${esc(s.category)}</span>
            <h3 id="mt-${esc(s.id)}">${esc(s.title)}</h3>
            <p class="m-tag">${esc(s.tagline)}</p>
            <p class="m-intro">${esc(s.intro)}</p>${s.applications?.length ? `
            <h4>Applications</h4>
            <ol class="m-apps">${s.applications.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}
            ${s.types?.length ? `<h4>Types</h4><div class="m-types">${s.types.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
            <a class="btn btn--sm btn--cyan" href="#contact" data-interest="${esc(s.title)}" data-close>Enquire about ${esc(s.shortName || s.title)}${ARROW}</a>
          </div>
        </article>`;
  }).join('') + '\n    ',

  'interest-options': () => `<option value="" selected disabled>Choose a product line</option>${S.map((s) => `<option>${esc(s.title)}</option>`).join('')}<option>Something else</option>`,

  'industries-bgs': () => site.industries.map((d, k) => `<img class="${k === 0 ? 'on' : ''}" src="${esc(d.image)}" alt="" loading="lazy" data-k="${k}">`).join(''),
  'industries-list': () => site.industries.map((d, k) => `<li class="${k === 0 ? 'on' : ''}" data-k="${k}"><button type="button" aria-expanded="${k === 0}"><span class="n">${pad(k + 1)}</span><span class="t">${esc(d.name)}</span><span class="sv">${d.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</span></button></li>`).join(''),

  facilities: () => (site.facilities || []).map((f, i) => {
    const ims = f.images?.length ? f.images : (f.image ? [{ src: f.image }] : []);
    const n = ims.length;
    const main = ims.map((im, k) => `<img class="${[im.cut ? 'cut' : '', k === 0 ? 'on' : ''].filter(Boolean).join(' ')}" src="${esc(im.src)}" alt="${esc(im.label || (n > 1 ? `${f.name} — photo ${k + 1}` : f.name))}" loading="lazy" data-k="${k}">`).join('');
    const thumbs = n > 1 ? `<div class="fac-thumbs" role="group" aria-label="${esc(f.name)} photos">${ims.map((im, k) => `<button type="button" aria-pressed="${k === 0}" data-k="${k}" aria-label="${esc(im.label || `Photo ${k + 1} of ${n}`)}"><img class="${im.cut ? 'cut' : ''}" src="${esc(im.cut ? im.src : thumb(im))}" alt="" loading="lazy"></button>`).join('')}</div>` : '';
    const caps = ims.some((im) => im.label || im.desc) ? `<div class="fac-caps" aria-live="polite">${ims.map((im, k) => `<div class="fac-cap${k === 0 ? ' on' : ''}" data-k="${k}">${im.label ? `<b>${esc(im.label)}</b>` : ''}${im.desc ? `<div class="md">${md(im.desc)}</div>` : ''}</div>`).join('')}</div>` : '';
    return `
          <li data-in style="--i:${i % 3}">
            <article class="fac">
              <div class="fac-pic">${main}${n > 1 ? `<span class="fac-count">${n} photos</span>` : ''}</div>${thumbs}${caps}
              <div class="fac-body">
                <span class="fac-n">${pad(i + 1)}</span>
                <h3>${esc(f.name)}</h3>${f.desc ? `
                <div class="md">${md(f.desc)}</div>` : ''}${f.specs?.length ? `
                <ul>${f.specs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
              </div>
            </article>
          </li>`;
  }).join('') + '\n        ',

  clients: () => site.clients.map((c, i) => `
          <li data-in style="--i:${i % 6}">
            <a class="client" href="${esc(c.url)}" target="_blank" rel="noopener" aria-label="${esc(`${c.name} — visit ${host(c.url)} (opens in a new tab)`)}">
              <span class="c-rank">${pad(i + 1)}</span>
              <span class="c-logo${c.tall ? ' tall' : ''}"><img src="${esc(c.logo)}" alt="${esc(c.name)} logo"${c.logoW ? ` width="${c.logoW}" height="${c.logoH}"` : ''} loading="lazy"></span>
              <span class="c-name">${esc(c.name)}</span>
              <span class="c-what">${esc(c.what)}</span>
              <span class="c-link" title="${esc(host(c.url))}">Visit website${EXT}</span>
            </a>
          </li>`).join('') + '\n        ',
};
}

// Fixed page texts: every element marked data-t="key" gets its wording from site.text[key].
function renderTexts(html, text) {
  if (!text) return html;
  html = html.replace(/<meta([^>]*?) data-ta="content:([^"]+)"([^>]*)>/g, (all, a, key, b) => {
    if (text[key] == null) return all;
    return `<meta${a.replace(/ content="[^"]*"/, '')} content="${esc(text[key])}" data-ta="content:${key}"${b.replace(/ content="[^"]*"/, '')}>`;
  });
  const open = /<([a-z0-9]+)\b[^>]*\sdata-t="([^"]+)"[^>]*>/g;
  let out = '', pos = 0, m;
  while ((m = open.exec(html))) {
    const tag = m[1], key = m[2], start = m.index + m[0].length;
    // find the matching closing tag
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g'); re.lastIndex = start;
    let depth = 1, t, end = -1;
    while ((t = re.exec(html))) { depth += t[1] ? -1 : 1; if (!depth) { end = t.index; break; } }
    if (end < 0) throw new Error(`No closing </${tag}> for text "${key}"`);
    if (text[key] == null) continue;
    const inner = html.slice(start, end), lead = inner.match(/^\s*/)[0], trail = inner.match(/\s*$/)[0];
    let head = m[0];
    const num = String(text[key]).replace(/<[^>]+>/g, '').trim();
    if (/\sdata-count="/.test(head) && /^\d+$/.test(num)) head = head.replace(/data-count="\d*"/, `data-count="${num}"`);
    out += html.slice(pos, m.index) + head + lead + text[key] + trail;
    pos = end; open.lastIndex = end;
  }
  return out + html.slice(pos);
}

export function render(html, site, themes) {
  const blocks = makeBlocks(site, themes);
  html = html.replace(/(<!-- cms:([a-z-]+) -->)([\s\S]*?)(<!-- \/cms:\2 -->)/g, (all, open, name, _old, close) => {
    if (!blocks[name]) throw new Error(`Unknown cms block "${name}"`);
    return open + blocks[name]() + close;
  });
  // the Facilities section and its menu links only show once a facility has been added
  const hasFac = (site.facilities || []).length > 0;
  html = html.replace(/<([a-z]+)([^>]*?) data-fac( hidden)?([^>]*)>/g, (all, tag, a, _h, b) => `<${tag}${a} data-fac${hasFac ? '' : ' hidden'}${b}>`);
  return renderTexts(html, site.text);
}

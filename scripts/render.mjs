/* SysMatica — renders the editable (<!-- cms:NAME -->) parts of the pages from the site content.
   Used by scripts/build.mjs (on this computer) and by the admin Netlify function (live saves). */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (n) => String(n).padStart(2, '0');
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const thumb = (im) => im.thumb || im.src;
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const ARROW = '<svg aria-hidden="true"><use href="#i-arrow"/></svg>';
const LINKEDIN = '<svg aria-hidden="true" viewBox="0 0 16 16"><path fill="currentColor" d="M3.6 5.6h2.1v6.8H3.6zM4.65 2.2a1.22 1.22 0 1 1 0 2.44 1.22 1.22 0 0 1 0-2.44zM7 5.6h2v.93h.03c.28-.53.97-1.09 2-1.09 2.13 0 2.53 1.4 2.53 3.23v3.73h-2.1V9.1c0-.79-.02-1.8-1.1-1.8-1.1 0-1.27.86-1.27 1.74v3.36H7z"/></svg>';
const MAIL = '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2 4h12v8H2zM2.5 4.5L8 9l5.5-4.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const EXT = '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M5 3h8v8M13 3L4 12" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';


function makeBlocks(site) {
const S = site.services, I = site.images;
return {
  'hero-image': () => `<img src="${esc(I.hero.src)}" alt="${esc(I.hero.alt)}" fetchpriority="high">`,
  'about-image': () => `
            <img src="${esc(I.about.src)}" alt="${esc(I.about.alt)}" loading="lazy">
            <figcaption class="micro">${esc(I.about.caption)}</figcaption>
          `,
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
    const thumbs = n > 1 ? `<div class="m-thumbs" role="group" aria-label="Images">${s.images.map((im, k) => `<button type="button" aria-pressed="${k === 0}" data-k="${k}" aria-label="${esc(im.label || `Show image ${k + 1} of ${n}`)}"><img class="${im.cut ? 'cut' : ''}" src="${esc(im.cut ? im.src : thumb(im))}" alt="" loading="lazy"></button>`).join('')}</div>` : '';
    return `
        <article class="m-prod" id="svc-${esc(s.id)}" data-id="${esc(s.id)}" aria-labelledby="mt-${esc(s.id)}">
          <div class="m-media"><div class="m-main">${main}</div>${thumbs}</div>
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

export function render(html, site) {
  const blocks = makeBlocks(site);
  return html.replace(/(<!-- cms:([a-z-]+) -->)([\s\S]*?)(<!-- \/cms:\2 -->)/g, (all, open, name, _old, close) => {
    if (!blocks[name]) throw new Error(`Unknown cms block "${name}"`);
    return open + blocks[name]() + close;
  });
}

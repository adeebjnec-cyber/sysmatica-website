/* SysMatica — website admin.
   On the website, the password is checked and changes are published by the Netlify function
   netlify/functions/admin.mjs. On this computer (node scripts/admin-server.mjs) changes are
   saved straight into the files instead. Content lives in content/site.json; scripts/render.mjs
   turns it into the editable parts of index.html and careers.html. */
(function () {
  'use strict';
  var $ = function (s, c) { return (c || document).querySelector(s); };

  /* ---------- small helpers ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  var b64 = {
    from: function (buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); },
    to: function (str) { var s = atob(str), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; },
    utf8: function (text) { return b64.from(new TextEncoder().encode(text)); },
  };
  var toastT;
  function toast(msg, bad) {
    var t = $('#toast'); t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, bad ? 7000 : 4000);
  }
  function slug(s) { return String(s || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image'; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- live website: Netlify function ---------- */
  var FN = '/.netlify/functions/admin';
  var session = null;
  function callFn(body) {
    return fetch(FN, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: session ? 'Bearer ' + session : '' }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 && body.action !== 'login' && body.action !== 'password') { session = null; throw new Error('Your login has expired. Please copy any unsaved text, then reload the page and log in again.'); }
          if (!r.ok) throw new Error(j.error || 'The admin service is not available (' + r.status + ').');
          return j;
        });
      });
  }
  function sha1Hex(b64str) {
    return crypto.subtle.digest('SHA-1', b64.to(b64str)).then(function (buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return x.toString(16).padStart(2, '0'); }).join(''); });
  }
  function netlifyBackend() {
    return {
      name: 'live website',
      load: function () { return fetch('/content/site.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }); },
      save: async function (files, message, progress) {
        var uploads = {}, byPath = {};
        for (var i = 0; i < files.length; i++) {
          if (files[i].path === 'content/site.json') continue;
          uploads[files[i].path] = await sha1Hex(files[i].content); byPath[files[i].path] = files[i].content;
        }
        progress('Publishing…');
        var r = await callFn({ action: 'save', site: data, files: uploads });
        for (var k = 0; k < r.upload.length; k++) {
          progress('Uploading image ' + (k + 1) + ' of ' + r.upload.length + '…');
          await callFn({ action: 'upload', deployId: r.deployId, path: r.upload[k], content: byPath[r.upload[k]] });
        }
        progress('Going live…');
        for (var t = 0; t < 45; t++) {
          var st = await callFn({ action: 'status', deployId: r.deployId });
          if (st.state === 'ready') return /--/.test(location.hostname) ? 'Saved to this preview copy: ' + r.url : 'Saved. The website is updated — reload it to see the changes.';
          if (st.state === 'error') throw new Error('Netlify could not publish the change: ' + (st.error || 'unknown error'));
          await new Promise(function (ok) { setTimeout(ok, 2000); });
        }
        return 'Saved. Netlify is still publishing — the website updates within a minute.';
      },
    };
  }

  function localBackend() {
    return {
      name: 'this computer',
      load: function () { return fetch('/content/site.json', { cache: 'no-store' }).then(function (r) { return r.json(); }); },
      save: function (files) {
        return fetch('/__admin/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: files }) })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Save failed'); return 'Saved on this computer and the pages were rebuilt.'; }); });
      },
    };
  }

  /* ---------- image processing ---------- */
  var pending = {};   // path -> { content: base64, url: objectURL }
  function srcFor(path) { return !path ? '' : pending[path] ? pending[path].url : (/^(https?:|data:|blob:)/.test(path) ? path : '/' + path); }

  function loadImg(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { ok(im); }; im.onerror = function () { bad(new Error('That file is not an image the browser can read.')); };
      im.src = url;
    });
  }
  function canvasOut(im, maxW, type, q) {
    var w = im.naturalWidth, hgt = im.naturalHeight, s = Math.min(1, maxW / w);
    var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(hgt * s);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return new Promise(function (ok) { c.toBlob(function (b) { ok({ blob: b, w: c.width, h: c.height }); }, type, q); });
  }
  function addPending(path, blob) {
    return blob.arrayBuffer().then(function (buf) { pending[path] = { content: b64.from(buf), url: URL.createObjectURL(blob) }; return path; });
  }
  // kind: 'logo' (keep transparency, png/svg), 'photo' (webp), 'gallery' (webp + small thumbnail)
  async function processUpload(file, kind, name) {
    if (file.size > 25 * 1024 * 1024) throw new Error('That image is over 25 MB. Please use a smaller file.');
    var stamp = Date.now().toString(36), base = 'assets/img/uploads/' + slug(name) + '-' + stamp;
    if (/svg/.test(file.type) || /\.svg$/i.test(file.name)) {
      var p = await addPending(base + '.svg', file);
      var im0 = await loadImg(file);
      return { src: p, w: im0.naturalWidth || undefined, h: im0.naturalHeight || undefined };
    }
    var im = await loadImg(file);
    if (kind === 'logo') {
      var lo = await canvasOut(im, 900, 'image/png');
      return { src: await addPending(base + '.png', lo.blob), w: lo.w, h: lo.h };
    }
    var big = await canvasOut(im, 1800, 'image/webp', 0.86);
    var out = { src: await addPending(base + '.webp', big.blob), w: big.w, h: big.h };
    if (kind === 'gallery') { var sm = await canvasOut(im, 480, 'image/webp', 0.82); out.thumb = await addPending(base + '-sm.webp', sm.blob); }
    return out;
  }
  function pickFile() {
    return new Promise(function (ok) {
      var inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml,image/avif,image/gif' });
      inp.addEventListener('change', function () { ok(inp.files[0] || null); });
      inp.click();
    });
  }

  /* ---------- state ---------- */
  var backend, data, saved, current = 'clients';
  function isDirty() { return JSON.stringify(data) !== saved; }
  function changed() {
    var d = isDirty();
    $('#save').disabled = !d || backend.readOnly;
    var st = $('#status'); st.textContent = d ? 'Unsaved changes' : 'All changes saved'; st.classList.toggle('dirty', d);
  }
  addEventListener('beforeunload', function (e) { if (data && isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- field widgets ---------- */
  function textField(obj, key, label, opts) {
    opts = opts || {};
    var input = h(opts.multiline ? 'textarea' : 'input', { type: opts.multiline ? null : (opts.type || 'text'), placeholder: opts.placeholder || '' });
    input.value = obj[key] == null ? '' : obj[key];
    var wrap = h('label', { class: 'fld' + (opts.full ? ' full' : '') }, [h('span', {}, [label, opts.hint ? h('span', { class: 'hint', text: ' — ' + opts.hint }) : null]), input]);
    input.addEventListener('input', function () {
      var v = input.value;
      if (opts.optional && !v.trim()) delete obj[key]; else obj[key] = v;
      wrap.classList.toggle('bad', !!opts.required && !v.trim());
      if (opts.onInput) opts.onInput(v);
      changed();
    });
    return wrap;
  }
  function checkField(obj, key, label, onChange) {
    var input = h('input', { type: 'checkbox' }); input.checked = !!obj[key];
    input.addEventListener('change', function () { obj[key] = input.checked; if (onChange) onChange(); changed(); });
    return h('label', { class: 'check full' }, [input, label]);
  }
  function listField(obj, key, label, hint) {
    obj[key] = obj[key] || [];
    var box = h('div', { class: 'strl' });
    function draw() {
      box.innerHTML = '';
      obj[key].forEach(function (v, i) {
        var inp = h('input', { type: 'text' }); inp.value = v;
        inp.addEventListener('input', function () { obj[key][i] = inp.value; changed(); });
        box.appendChild(h('div', { class: 'row' }, [inp,
          h('button', { class: 'icon-btn', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: function () { move(obj[key], i, -1); draw(); changed(); } }, '↑'),
          h('button', { class: 'icon-btn', type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: function () { obj[key].splice(i, 1); draw(); changed(); } }, '✕')]));
      });
      box.appendChild(h('div', {}, [h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: function () { obj[key].push(''); draw(); changed(); box.querySelectorAll('input')[obj[key].length - 1].focus(); } }, '+ Add line')]));
    }
    draw();
    return h('div', { class: 'fld full' }, [h('span', {}, [label, hint ? h('span', { class: 'hint', text: ' — ' + hint }) : null]), box]);
  }
  // image stored as a path in obj[key]; dims optionally written to obj[wKey]/obj[hKey]
  function imageField(obj, key, label, kind, opts) {
    opts = opts || {};
    var pv = h('div', { class: 'pv' + (kind === 'photo' ? ' photo' : '') });
    var path = h('span', { class: 'path' });
    function draw() { pv.style.backgroundImage = obj[key] ? 'url("' + srcFor(obj[key]) + '")' : ''; path.textContent = obj[key] || 'No image yet'; }
    var btn = h('button', { class: 'btn btn--sm', type: 'button', onclick: async function () {
      var f = await pickFile(); if (!f) return;
      btn.disabled = true; btn.textContent = 'Processing…';
      try {
        var r = await processUpload(f, kind, opts.name ? opts.name() : label);
        obj[key] = r.src;
        if (opts.wKey) { if (r.w) { obj[opts.wKey] = r.w; obj[opts.hKey] = r.h; } else { delete obj[opts.wKey]; delete obj[opts.hKey]; } }
        draw(); changed(); if (opts.onChange) opts.onChange();
      } catch (e) { toast(e.message, true); }
      btn.disabled = false; btn.textContent = 'Replace image';
    } }, obj[key] ? 'Replace image' : 'Upload image');
    draw();
    return h('div', { class: 'fld full' }, [h('span', {}, [label, opts.hint ? h('span', { class: 'hint', text: ' — ' + opts.hint }) : null]),
      h('div', { class: 'imgf' }, [pv, h('div', { class: 'act' }, [btn, path])])]);
  }
  function galleryField(s, title) {
    var box = h('div', { class: 'gal' });
    function draw() {
      box.innerHTML = '';
      s.images.forEach(function (im, i) {
        var lab = h('input', { type: 'text', placeholder: 'Caption (optional)' }); lab.value = im.label || '';
        lab.addEventListener('input', function () { if (lab.value.trim()) im.label = lab.value; else delete im.label; changed(); });
        var cut = h('input', { type: 'checkbox' }); cut.checked = !!im.cut;
        cut.addEventListener('change', function () { im.cut = cut.checked; draw(); changed(); });
        box.appendChild(h('div', { class: 'g' }, [
          h('div', { class: 'pv' + (im.cut ? ' cut' : ''), style: 'background-image:url("' + srcFor(im.thumb || im.src) + '")' }),
          h('label', { class: 'check small' }, [cut, 'Cut-out (transparent background)']),
          lab,
          h('div', { class: 'ctrl' }, [
            h('span', {}, [
              h('button', { class: 'icon-btn', type: 'button', title: 'Move left', 'aria-label': 'Move left', disabled: i === 0, onclick: function () { move(s.images, i, -1); draw(); changed(); } }, '←'),
              h('button', { class: 'icon-btn', type: 'button', title: 'Move right', 'aria-label': 'Move right', disabled: i === s.images.length - 1, onclick: function () { move(s.images, i, 1); draw(); changed(); } }, '→')]),
            h('button', { class: 'icon-btn', type: 'button', title: 'Remove image', 'aria-label': 'Remove image', disabled: s.images.length === 1, onclick: function () { s.images.splice(i, 1); draw(); changed(); } }, '✕')]),
        ]));
      });
      box.appendChild(h('button', { class: 'add', type: 'button', onclick: async function () {
        var f = await pickFile(); if (!f) return;
        try { var r = await processUpload(f, 'gallery', title()); s.images.push({ src: r.src, thumb: r.thumb, cut: false }); draw(); changed(); }
        catch (e) { toast(e.message, true); }
      } }, '+ Add image'));
    }
    draw();
    return h('div', { class: 'fld full' }, [h('span', {}, ['Gallery images', h('span', { class: 'hint', text: ' — shown in the pop-up; the first one is the main image' })]), box]);
  }
  function move(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }

  /* ---------- list editor (clients, team, services, industries) ---------- */
  function listEditor(arr, cfg) {
    var wrap = h('div');
    var openIdx = null;
    function draw() {
      wrap.innerHTML = '';
      arr.forEach(function (item, i) {
        var el = h('div', { class: 'item' + (openIdx === i ? ' open' : '') });
        var thumb = h('div', { class: 'thumb' + (cfg.photoThumb ? ' photo' : '') });
        var ttl = h('div', { class: 'ttl' }, [h('b'), h('span')]);
        function refresh() {
          var img = cfg.thumb(item); thumb.style.backgroundImage = img ? 'url("' + srcFor(img) + '")' : '';
          ttl.firstChild.textContent = cfg.title(item) || '(untitled)'; ttl.lastChild.textContent = cfg.sub(item) || '';
        }
        refresh();
        var head = h('div', { class: 'item-h', onclick: function (e) { if (e.target.closest('.ctrl')) return; openIdx = openIdx === i ? null : i; draw(); } }, [
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'), h('span', { class: 'n' }, String(i + 1).padStart(2, '0')), thumb, ttl,
          h('span', { class: 'ctrl' }, [
            h('button', { class: 'icon-btn', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: function () { move(arr, i, -1); if (openIdx === i) openIdx--; draw(); changed(); } }, '↑'),
            h('button', { class: 'icon-btn', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === arr.length - 1, onclick: function () { move(arr, i, 1); if (openIdx === i) openIdx++; draw(); changed(); } }, '↓'),
            h('button', { class: 'icon-btn', type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: function () {
              if (arr.length <= (cfg.min || 0)) { toast('At least ' + cfg.min + ' needed.', true); return; }
              if (!confirm('Delete "' + (cfg.title(item) || 'this item') + '"?')) return;
              arr.splice(i, 1); openIdx = null; draw(); changed();
            } }, '🗑')]),
        ]);
        el.appendChild(head);
        var body = h('div', { class: 'item-b' });
        if (openIdx === i) cfg.fields(item, refresh).forEach(function (f) { body.appendChild(f); });
        el.appendChild(body);
        wrap.appendChild(el);
      });
      wrap.appendChild(h('button', { class: 'btn', type: 'button', onclick: function () { arr.push(cfg.blank()); openIdx = arr.length - 1; draw(); changed(); wrap.lastChild.previousSibling.scrollIntoView({ block: 'center' }); } }, '+ Add ' + cfg.noun));
    }
    draw();
    return wrap;
  }

  /* ---------- sections ---------- */
  var SECTIONS = {
    clients: { label: 'Clients', title: 'Clients', desc: 'The "Trusted by industry leaders" cards. Use the arrows to change the order.', render: function () {
      return listEditor(data.clients, {
        noun: 'client', title: function (c) { return c.name; }, sub: function (c) { return c.what; }, thumb: function (c) { return c.logo; },
        blank: function () { return { name: '', url: 'https://', logo: '', tall: false, what: '' }; },
        fields: function (c, refresh) { return [
          textField(c, 'name', 'Company name', { required: true, onInput: refresh }),
          textField(c, 'url', 'Website address', { type: 'url', placeholder: 'https://…' }),
          textField(c, 'what', 'What they do', { full: true, onInput: refresh }),
          imageField(c, 'logo', 'Logo', 'logo', { hint: 'PNG or SVG with a transparent background works best', wKey: 'logoW', hKey: 'logoH', name: function () { return 'client-' + c.name; }, onChange: refresh }),
          checkField(c, 'tall', 'Square or tall logo (show it bigger)'),
        ]; },
      });
    } },
    services: { label: 'Services', title: 'Services', desc: 'Service cards and their detail pop-ups. The contact form\'s "Product line" list and the service count update automatically.', render: function () {
      return listEditor(data.services, {
        noun: 'service', min: 1, title: function (s) { return s.title; }, sub: function (s) { return s.category; }, thumb: function (s) { return s.card && s.card.src; },
        blank: function () { return { id: 'svc-' + Date.now().toString(36), title: '', category: 'Machines & Automation', short: '', card: { src: '', cut: false }, tagline: '', intro: '', applications: [], types: [], images: [] }; },
        fields: function (s, refresh) {
          var nm = function () { return s.title || 'service'; };
          return [
            textField(s, 'title', 'Service name', { required: true, onInput: refresh }),
            textField(s, 'category', 'Category', { hint: 'small label above the name', onInput: refresh }),
            textField(s, 'short', 'Card text', { multiline: true, full: true, hint: 'one or two sentences on the card' }),
            imageField(s.card, 'src', 'Card image', 'photo', { name: nm, onChange: refresh }),
            checkField(s.card, 'cut', 'Card image is a cut-out (transparent background)'),
            textField(s, 'tagline', 'Pop-up tagline', { full: true }),
            textField(s, 'intro', 'Pop-up description', { multiline: true, full: true }),
            listField(s, 'applications', 'Applications'),
            listField(s, 'types', 'Types', 'optional'),
            galleryField(s, nm),
            textField(s, 'shortName', 'Short name for the "Enquire about…" button', { optional: true, hint: 'optional, e.g. SPM' }),
          ];
        },
      });
    } },
    team: { label: 'Team', title: 'Team', desc: 'The "Meet the team" cards.', render: function () {
      return listEditor(data.team, {
        noun: 'team member', photoThumb: true, title: function (m) { return m.name; }, sub: function (m) { return m.role; }, thumb: function (m) { return m.photo; },
        blank: function () { return { name: '', role: '', photo: '', bio: '', tags: [], linkedin: '', email: '' }; },
        fields: function (m, refresh) { return [
          textField(m, 'name', 'Name', { required: true, onInput: refresh }),
          textField(m, 'role', 'Job title', { onInput: refresh }),
          imageField(m, 'photo', 'Photo', 'photo', { hint: 'portrait photo, roughly square', wKey: 'photoW', hKey: 'photoH', name: function () { return 'team-' + m.name; }, onChange: refresh }),
          textField(m, 'bio', 'About', { multiline: true, full: true }),
          listField(m, 'tags', 'Qualifications & skills', 'small tags under the text'),
          textField(m, 'linkedin', 'LinkedIn link', { type: 'url', placeholder: 'https://www.linkedin.com/in/…' }),
          textField(m, 'email', 'Email', { type: 'email' }),
        ]; },
      });
    } },
    industries: { label: 'Industries', title: 'Industries', desc: 'The "Where our work runs" list. Each industry shows its background photo when selected.', render: function () {
      return listEditor(data.industries, {
        noun: 'industry', min: 1, photoThumb: true, title: function (d) { return d.name; }, sub: function (d) { return (d.tags || []).join(' · '); }, thumb: function (d) { return d.image; },
        blank: function () { return { name: '', tags: [], image: '' }; },
        fields: function (d, refresh) { return [
          textField(d, 'name', 'Industry name', { required: true, full: true, onInput: refresh }),
          listField(d, 'tags', 'Services used', 'small tags on the right'),
          imageField(d, 'image', 'Background photo', 'photo', { name: function () { return 'industry-' + d.name; }, onChange: refresh }),
        ]; },
      });
    } },
    images: { label: 'Section images', title: 'Section images', desc: 'The large photos used in other sections of the website.', render: function () {
      var I = data.images, box = h('div', { class: 'item open' }), body = h('div', { class: 'item-b' });
      [imageField(I.hero, 'src', 'Home page — top banner photo', 'photo', { name: function () { return 'hero'; } }),
        textField(I.hero, 'alt', 'Banner photo description', { full: true, hint: 'for screen readers and Google' }),
        imageField(I.about, 'src', 'About section photo', 'photo', { name: function () { return 'about'; } }),
        textField(I.about, 'alt', 'About photo description'),
        textField(I.about, 'caption', 'About photo caption'),
        imageField(I.contact, 'src', 'Contact section background', 'photo', { name: function () { return 'contact'; } }),
        imageField(I.careersHero, 'src', 'Careers page — top banner photo', 'photo', { name: function () { return 'careers'; } }),
      ].forEach(function (f) { body.appendChild(f); });
      box.appendChild(body);
      return box;
    } },
  };

  function showSection(key) {
    current = key;
    Array.prototype.forEach.call($('#tabs').children, function (b) { b.setAttribute('aria-selected', String(b.dataset.k === key)); });
    var S = SECTIONS[key], p = $('#panel');
    p.innerHTML = '';
    p.appendChild(h('div', { class: 'panel-head' }, [h('div', {}, [h('h2', { text: S.title }), h('p', { text: S.desc })])]));
    p.appendChild(S.render());
  }

  /* ---------- save ---------- */
  function validate() {
    var bad = [];
    data.clients.forEach(function (c, i) { if (!c.name.trim()) bad.push('Client ' + (i + 1) + ' has no name'); if (!c.logo) bad.push('Client "' + c.name + '" has no logo'); });
    data.services.forEach(function (s, i) {
      if (!s.title.trim()) bad.push('Service ' + (i + 1) + ' has no name');
      if (!s.card.src) bad.push('Service "' + s.title + '" has no card image');
      if (!s.images.length) bad.push('Service "' + s.title + '" needs at least one gallery image');
    });
    data.team.forEach(function (m, i) { if (!m.name.trim()) bad.push('Team member ' + (i + 1) + ' has no name'); if (!m.photo) bad.push('Team member "' + m.name + '" has no photo'); });
    data.industries.forEach(function (d, i) { if (!d.name.trim()) bad.push('Industry ' + (i + 1) + ' has no name'); if (!d.image) bad.push('Industry "' + d.name + '" has no photo'); });
    return bad;
  }
  async function save() {
    var bad = validate();
    if (bad.length) { toast('Please fix: ' + bad.slice(0, 3).join('; ') + (bad.length > 3 ? '…' : ''), true); return; }
    var btn = $('#save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var json = JSON.stringify(data, null, 2) + '\n';
      var files = [{ path: 'content/site.json', content: b64.utf8(json) }];
      Object.keys(pending).forEach(function (p) { if (json.indexOf('"' + p + '"') > -1) files.push({ path: p, content: pending[p].content }); });
      var msg = await backend.save(files, 'Website admin: update content', function (t) { btn.textContent = t; });
      saved = JSON.stringify(data);
      Object.keys(pending).forEach(function (p) { if (json.indexOf('"' + p + '"') === -1) delete pending[p]; });
      toast(msg);
    } catch (e) { toast(e.message, true); }
    btn.textContent = 'Save changes'; changed();
  }

  /* ---------- start ---------- */
  async function isLocal() {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return false;
    try { var r = await fetch('/__admin/ping', { cache: 'no-store' }); return r.ok; } catch (e) { return false; }
  }
  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var err = $('#login-err'), btn = $('#login-btn');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Checking…';
    try {
      if (await isLocal()) backend = localBackend();
      else {
        var r = await callFn({ action: 'login', password: $('#pw').value });
        session = r.token; backend = netlifyBackend();
        $('#chpw').hidden = false;
      }
      data = await backend.load();
      saved = JSON.stringify(data);
      $('#pw').value = '';
      $('#login').hidden = true; $('#app').hidden = false;
      if (backend.name === 'this computer') { var n = $('#notice'); n.hidden = false; n.textContent = 'Test mode on this computer: saves go into the local files, not the live website.'; }
      Object.keys(SECTIONS).forEach(function (k) { $('#tabs').appendChild(h('button', { type: 'button', role: 'tab', 'data-k': k, onclick: function () { showSection(k); } }, SECTIONS[k].label)); });
      showSection(current); changed();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    btn.disabled = false; btn.textContent = 'Log in';
  });

  /* ---------- change password ---------- */
  var dlg = $('#pw-dlg');
  $('#chpw').addEventListener('click', function () { $('#pw-form').reset(); $('#pw-err').hidden = true; dlg.showModal(); });
  $('#pw-cancel').addEventListener('click', function () { dlg.close(); });
  $('#pw-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var err = $('#pw-err'), btn = $('#pw-ok'), cur = $('#pw-cur').value, nx = $('#pw-new').value;
    err.hidden = true;
    if (nx.length < 10) { err.textContent = 'Please use at least 10 characters (a short sentence works well).'; err.hidden = false; return; }
    if (nx !== $('#pw-again').value) { err.textContent = 'The two new passwords do not match.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Changing…';
    try { var r = await callFn({ action: 'password', current: cur, next: nx }); session = r.token; dlg.close(); toast('Password changed. Use the new password next time you log in.'); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    btn.disabled = false; btn.textContent = 'Change password';
  });

  $('#save').addEventListener('click', save);
  $('#logout').addEventListener('click', function () { if (isDirty() && !confirm('You have unsaved changes. Log out anyway?')) return; data = null; location.reload(); });
  addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 's' && data) { e.preventDefault(); if (!$('#save').disabled) save(); } });
})();

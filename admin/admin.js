/* SysMatica — website admin.
   The password unlocks admin/config.json (AES-GCM, key from PBKDF2), which holds a GitHub token
   for this one repository. Edits are committed to GitHub as content/site.json plus any uploaded
   images; the GitHub Actions workflow then rebuilds the pages and publishes the site.
   On this computer (node scripts/admin-server.mjs) saves go straight into the local files. */
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

  /* ---------- password → credentials ---------- */
  async function unlock(password) {
    var res = await fetch('/admin/config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('The admin has not been set up yet (admin/config.json is missing).');
    var cfg = await res.json();
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64.to(cfg.salt), iterations: cfg.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    try {
      var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.to(cfg.iv) }, key, b64.to(cfg.data));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (e) { return null; }
  }

  /* ---------- storage backends ---------- */
  function githubBackend(gh) {
    var api = function (path, opts) {
      opts = opts || {};
      return fetch('https://api.github.com/repos/' + gh.repo + path, {
        method: opts.method || 'GET',
        headers: { Authorization: 'Bearer ' + gh.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: 'no-store',
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error('GitHub ' + r.status + ': ' + t.slice(0, 200)); });
        return r.json();
      });
    };
    var loadedSha = null;
    return {
      name: 'live website',
      load: function () {
        return api('/contents/content/site.json?ref=' + encodeURIComponent(gh.branch)).then(function (f) {
          loadedSha = f.sha;
          return JSON.parse(new TextDecoder().decode(b64.to(f.content.replace(/\s/g, ''))));
        });
      },
      save: async function (files, message) {
        var cur = await api('/contents/content/site.json?ref=' + encodeURIComponent(gh.branch));
        if (loadedSha && cur.sha !== loadedSha && !confirm('The content was changed somewhere else since you opened the admin. Save anyway and overwrite those changes?')) throw new Error('Save cancelled.');
        var ref = await api('/git/ref/heads/' + encodeURIComponent(gh.branch));
        var head = await api('/git/commits/' + ref.object.sha);
        var tree = [];
        for (var i = 0; i < files.length; i++) {
          var blob = await api('/git/blobs', { method: 'POST', body: { content: files[i].content, encoding: 'base64' } });
          tree.push({ path: files[i].path, mode: '100644', type: 'blob', sha: blob.sha });
        }
        var t = await api('/git/trees', { method: 'POST', body: { base_tree: head.tree.sha, tree: tree } });
        var c = await api('/git/commits', { method: 'POST', body: { message: message, tree: t.sha, parents: [ref.object.sha] } });
        await api('/git/refs/heads/' + encodeURIComponent(gh.branch), { method: 'PATCH', body: { sha: c.sha } });
        var after = await api('/contents/content/site.json?ref=' + c.sha);
        loadedSha = after.sha;
        return 'Saved. The live website updates in about 1–2 minutes.';
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
  var backend, data, saved, current = 'stats';
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
        var lab = h('input', { type: 'text', placeholder: 'Image title, e.g. Leak Test SPM' }); lab.value = im.label || '';
        lab.addEventListener('input', function () { if (lab.value.trim()) im.label = lab.value; else delete im.label; changed(); });
        var dsc = h('textarea', { rows: 3, placeholder: 'Description shown when this image is selected (optional)' }); dsc.value = im.desc || '';
        dsc.addEventListener('input', function () { if (dsc.value.trim()) im.desc = dsc.value; else delete im.desc; changed(); });
        var cut = h('input', { type: 'checkbox' }); cut.checked = !!im.cut;
        cut.addEventListener('change', function () { im.cut = cut.checked; draw(); changed(); });
        box.appendChild(h('div', { class: 'g' }, [
          h('div', { class: 'pv' + (im.cut ? ' cut' : ''), style: 'background-image:url("' + srcFor(im.thumb || im.src) + '")' }),
          h('label', { class: 'check small' }, [cut, 'Cut-out (transparent background)']),
          lab, dsc,
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
    return h('div', { class: 'fld full' }, [h('span', {}, ['Gallery images', h('span', { class: 'hint', text: ' — shown in the pop-up; the first one is the main image. Give each type its own image, title and description.' })]), box]);
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

  /* ---------- page texts ---------- */
  var textFields = null;
  function loadTextFields() {
    return fetch('/content/text-fields.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; }).then(function (f) { textFields = f; });
  }
  var ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': '\u00a0' };
  function decode(s) { return String(s).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, function (m) { return ENT[m]; }); }
  function encode(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function plain(s) { return decode(String(s).replace(/<[^>]+>/g, '')); }
  function pageTextField(f) {
    var raw = data.text[f.key], rich = /<[a-z!/]/i.test(raw);
    var long = plain(raw).length > 70;
    var input = h(long ? 'textarea' : 'input', long ? { rows: Math.min(6, Math.ceil(plain(raw).length / 80) + 1) } : { type: 'text' });
    input.value = rich ? raw : decode(raw);
    var wrap = h('label', { class: 'fld full' }, [h('span', {}, [f.label, rich ? h('span', { class: 'hint', text: ' — keep the parts in < > as they are: they style the text' }) : null]), input]);
    input.addEventListener('input', function () {
      data.text[f.key] = rich ? input.value : encode(input.value);
      wrap.classList.toggle('bad', !input.value.trim());
      changed();
    });
    return wrap;
  }


  /* ---------- visitor statistics (GoatCounter) ---------- */
  var statsPeriod = 30, statsCache = {};
  function gcApi(path) {
    var st = creds.stats;
    return fetch('https://' + st.code + '.goatcounter.com/api/v0' + path, { headers: { Authorization: 'Bearer ' + st.token, 'Content-Type': 'application/json' }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('GoatCounter refused the API key. Check that it has "Read statistics" permission, then connect again.');
        if (r.status === 429) throw new Error('Too many requests to GoatCounter. Wait a minute and try again.');
        if (!r.ok) throw new Error('GoatCounter error ' + r.status + '.');
        return r.json();
      });
  }
  function sleep(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function hourIso(d) { d = new Date(d); d.setMinutes(0, 0, 0); return d.toISOString().replace('.000Z', 'Z'); }
  async function loadStats(days) {
    var end = new Date(Date.now() + 3600e3), start = new Date();
    if (days === 1) start.setHours(0, 0, 0, 0); else { start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0); }
    var q = '?start=' + encodeURIComponent(hourIso(start)) + '&end=' + encodeURIComponent(hourIso(end));
    var out = {};
    var calls = [['total', '/stats/total' + q], ['hits', '/stats/hits' + q + '&limit=100'], ['refs', '/stats/toprefs' + q + '&limit=10'],
      ['locations', '/stats/locations' + q + '&limit=10'], ['sizes', '/stats/sizes' + q], ['browsers', '/stats/browsers' + q + '&limit=8'], ['systems', '/stats/systems' + q + '&limit=8']];
    for (var i = 0; i < calls.length; i++) { out[calls[i][0]] = await gcApi(calls[i][1]); await sleep(300); }   // GoatCounter allows ~4 requests a second
    return out;
  }
  function fmt(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function eventName(path) {
    if (path === 'form-sent/enquiry') return 'Enquiry form sent';
    if (path === 'form-sent/job-application') return 'Job application sent';
    if (path === 'click-phone') return 'Phone number tapped';
    if (path === 'click-email') return 'Email address clicked';
    if (path === 'click-whatsapp') return 'WhatsApp clicked';
    if (path.indexOf('service/') === 0) {
      var id = path.slice(8), s = (data.services || []).filter(function (x) { return x.id === id; })[0];
      return 'Service opened: ' + (s ? s.title : id);
    }
    return path;
  }
  function pageName(p) {
    p = p.replace(/^https?:\/\/[^/]+/, '');
    if (p === '/' || p === '/index.html') return 'Home page';
    if (/careers/.test(p)) return 'Careers page';
    return p;
  }
  var SIZE = { phone: 'Phone', largephone: 'Large phone', tablet: 'Tablet', desktop: 'Computer', desktophd: 'Large computer', unknown: 'Unknown' };
  function barList(title, rows, empty) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.n; }).concat([1]));
    return h('div', { class: 'st-card' }, [h('h3', { text: title }), rows.length ? h('ol', { class: 'st-list' }, rows.map(function (r) {
      return h('li', {}, [h('span', { class: 'st-bar', style: 'width:' + Math.max(2, Math.round(r.n / max * 100)) + '%' }), h('span', { class: 'st-l', text: r.l }), h('b', { text: fmt(r.n) })]);
    })) : h('p', { class: 'muted small', text: empty || 'No data for this period yet.' })]);
  }
  function chart(stats, days) {
    var pts = (stats || []).map(function (s) { return { d: s.day, n: days === 1 ? 0 : s.daily, hourly: s.hourly }; });
    if (days === 1 && stats && stats.length) pts = stats[stats.length - 1].hourly.map(function (n, i) { return { d: i + ':00', n: n }; });
    var W = 900, H = 180, max = Math.max.apply(null, pts.map(function (p) { return p.n; }).concat([1]));
    var bw = W / Math.max(pts.length, 1);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + (H + 22) + '" class="st-chart" role="img" aria-label="Visitors per ' + (days === 1 ? 'hour' : 'day') + '">';
    pts.forEach(function (p, i) {
      var hh = Math.round(p.n / max * H), x = i * bw;
      svg += '<rect x="' + (x + bw * 0.15) + '" y="' + (H - hh) + '" width="' + (bw * 0.7) + '" height="' + Math.max(hh, p.n ? 2 : 0) + '" rx="2"><title>' + p.d + ': ' + p.n + ' visitors</title></rect>';
    });
    var lab = function (i) { var p = pts[i]; if (!p) return ''; return days === 1 ? p.d : new Date(p.d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
    if (pts.length) svg += '<text x="0" y="' + (H + 16) + '">' + lab(0) + '</text><text x="' + W + '" y="' + (H + 16) + '" text-anchor="end">' + lab(pts.length - 1) + '</text>';
    svg += '</svg>';
    var box = h('div', { class: 'st-card wide' }, [h('h3', { text: (days === 1 ? 'Visitors per hour today' : 'Visitors per day') + ' · busiest: ' + max })]);
    box.insertAdjacentHTML('beforeend', svg);
    return box;
  }
  function statsConnectForm() {
    var code = h('input', { type: 'text', placeholder: 'e.g. sysmatica', value: (data.analytics && data.analytics.goatcounter) || '' });
    var key = h('input', { type: 'password', placeholder: 'Paste the API key', autocomplete: 'off' });
    var pw = h('input', { type: 'password', placeholder: 'Admin password', autocomplete: 'current-password' });
    var err = h('p', { class: 'err', hidden: true });
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Connect statistics');
    var form = h('form', { class: 'st-connect' }, [
      h('p', {}, ['Visitor statistics come from ', h('a', { href: 'https://www.goatcounter.com', target: '_blank', rel: 'noopener', text: 'GoatCounter' }), ', a free analytics service that uses no cookies and stores no personal data, so the website needs no cookie banner. One-time setup:']),
      h('ol', {}, [
        h('li', {}, ['Sign up free at ', h('a', { href: 'https://www.goatcounter.com/signup', target: '_blank', rel: 'noopener', text: 'goatcounter.com/signup' }), ' with a company email. The "Code" you choose becomes your stats address, for example ', h('b', { text: 'sysmatica' }), '.goatcounter.com.']),
        h('li', {}, ['In GoatCounter open your user name (top right) → ', h('b', { text: 'API' }), ' → ', h('b', { text: 'New API key' }), '. Tick only ', h('b', { text: 'Read statistics' }), ', create it and copy the key.']),
        h('li', { text: 'Fill in the boxes below and press Connect. The key is stored encrypted with your admin password, like the GitHub connection.' }),
      ]),
      h('label', { class: 'fld' }, [h('span', { text: 'GoatCounter code' }), code]),
      h('label', { class: 'fld' }, [h('span', { text: 'API key' }), key]),
      h('label', { class: 'fld' }, [h('span', { text: 'Admin password (to store the key safely)' }), pw]),
      err, btn,
    ]);
    form.addEventListener('submit', async function (e) {
      e.preventDefault(); err.hidden = true;
      var c = code.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.goatcounter\.com.*$/, '');
      try {
        if (!/^[a-z0-9-]+$/.test(c)) throw new Error('The code should look like "sysmatica" (letters, numbers and dashes).');
        if (key.value.trim().length < 10) throw new Error('Please paste the whole API key.');
        if (isDirty()) throw new Error('Please save or undo your other changes first.');
        btn.disabled = true; btn.textContent = 'Checking…';
        if (!(await unlock(pw.value))) throw new Error('The admin password is wrong.');
        var trial = Object.assign({}, creds, { stats: { code: c, token: key.value.trim() } });
        var keep = creds; creds = trial;
        try { await gcApi('/me'); } catch (ex) { creds = keep; throw ex; }
        btn.textContent = 'Saving…';
        data.analytics = { goatcounter: c };
        var json = JSON.stringify(data, null, 2) + '\n';
        var cfg = await encryptConfig(creds, pw.value);
        await backend.save([{ path: 'admin/config.json', content: b64.utf8(cfg) }, { path: 'content/site.json', content: b64.utf8(json) }], 'Website admin: connect visitor statistics', function () {});
        saved = JSON.stringify(data); changed();
        toast('Statistics connected. Visitor counting starts on the website in 1–2 minutes.');
        showSection('stats');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      btn.disabled = false; btn.textContent = 'Connect statistics';
    });
    return form;
  }
  function renderStats() {
    var wrap = h('div');
    if (!creds || !creds.stats || !creds.stats.token) { wrap.appendChild(statsConnectForm()); return wrap; }
    var periods = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '3 months'], [365, '12 months']];
    var bar = h('div', { class: 'st-periods', role: 'group', 'aria-label': 'Period' }, periods.map(function (p) {
      return h('button', { type: 'button', class: 'btn btn--sm' + (p[0] === statsPeriod ? '' : ' btn--ghost'), onclick: function () { statsPeriod = p[0]; showSection('stats'); } }, p[1]);
    }).concat([h('a', { class: 'btn btn--sm btn--ghost', href: 'https://' + creds.stats.code + '.goatcounter.com', target: '_blank', rel: 'noopener' }, 'Full dashboard ↗'),
      h('button', { type: 'button', class: 'btn btn--sm btn--ghost', onclick: function () { delete statsCache[statsPeriod]; showSection('stats'); } }, 'Refresh')]));
    var body = h('div', { class: 'st-body' }, [h('p', { class: 'muted', text: 'Loading statistics…' })]);
    wrap.appendChild(bar); wrap.appendChild(body);
    var period = statsPeriod;
    (statsCache[period] ? Promise.resolve(statsCache[period]) : loadStats(period)).then(function (s) {
      statsCache[period] = s;
      if (current !== 'stats' || statsPeriod !== period) return;
      var pages = [], events = [];
      (s.hits.hits || []).forEach(function (x) { (x.event ? events : pages).push(x); });
      var evCount = function (pred) { return events.filter(function (x) { return pred(x.path); }).reduce(function (a, x) { return a + x.count; }, 0); };
      var visitors = (s.total.total || 0) - (s.total.total_events || 0);
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'st-kpis' }, [
        h('div', { class: 'st-kpi' }, [h('b', { text: fmt(visitors) }), h('span', { text: 'Visitors' })]),
        h('div', { class: 'st-kpi' }, [h('b', { text: fmt(pages.reduce(function (a, x) { return a + x.count; }, 0)) }), h('span', { text: 'Page visits' })]),
        h('div', { class: 'st-kpi' }, [h('b', { text: fmt(evCount(function (p) { return p === 'form-sent/enquiry'; })) }), h('span', { text: 'Enquiries sent' })]),
        h('div', { class: 'st-kpi' }, [h('b', { text: fmt(evCount(function (p) { return p === 'form-sent/job-application'; })) }), h('span', { text: 'Job applications' })]),
        h('div', { class: 'st-kpi' }, [h('b', { text: fmt(evCount(function (p) { return /^click-/.test(p); })) }), h('span', { text: 'Phone / email clicks' })]),
      ]));
      body.appendChild(chart(s.total.stats, period));
      var grid = h('div', { class: 'st-grid' });
      grid.appendChild(barList('Pages visited', pages.map(function (x) { return { l: pageName(x.path), n: x.count }; })));
      grid.appendChild(barList('Services viewed', events.filter(function (x) { return x.path.indexOf('service/') === 0; }).map(function (x) { return { l: eventName(x.path).replace('Service opened: ', ''), n: x.count }; }), 'No service pop-ups opened in this period.'));
      grid.appendChild(barList('Where visitors came from', (s.refs.stats || []).map(function (x) { return { l: x.name || 'Direct / unknown', n: x.count }; })));
      grid.appendChild(barList('Countries', (s.locations.stats || []).map(function (x) { return { l: x.name || 'Unknown', n: x.count }; })));
      grid.appendChild(barList('Devices', (s.sizes.stats || []).map(function (x) { return { l: SIZE[x.id] || x.name || x.id || 'Unknown', n: x.count }; })));
      grid.appendChild(barList('Browsers', (s.browsers.stats || []).map(function (x) { return { l: x.name || 'Unknown', n: x.count }; })));
      grid.appendChild(barList('Operating systems', (s.systems.stats || []).map(function (x) { return { l: x.name || 'Unknown', n: x.count }; })));
      grid.appendChild(barList('Actions', events.filter(function (x) { return x.path.indexOf('service/') !== 0; }).map(function (x) { return { l: eventName(x.path), n: x.count }; }), 'No form sends or contact clicks in this period.'));
      body.appendChild(grid);
      body.appendChild(h('p', { class: 'muted small', text: 'Visitors are counted once per day per page, without cookies. Visits from people who block trackers are not counted, so real numbers are a little higher.' }));
    }).catch(function (e) {
      body.innerHTML = '';
      body.appendChild(h('p', { class: 'err', text: e.message }));
      body.appendChild(h('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: function () { creds.stats = null; showSection('stats'); } }, 'Connect again'));
    });
    return wrap;
  }


  /* ---------- colour theme ---------- */
  var themeList = null;
  function rgb(v, a) { return /^#/.test(v) ? v : 'rgb(' + v + (a != null ? ' / ' + a : '') + ')'; }
  function renderTheme() {
    var wrap = h('div');
    if (!themeList) {
      wrap.appendChild(h('p', { text: 'Loading themes…' }));
      fetch('/content/themes.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (t) { themeList = t; if (current === 'theme') showSection('theme'); })
        .catch(function () { wrap.textContent = 'The themes could not be loaded. Reload the page and try again.'; });
      return wrap;
    }
    var cur = data.theme || 'blue';
    var grid = h('div', { class: 'th-grid', role: 'radiogroup', 'aria-label': 'Colour theme' });
    themeList.forEach(function (t) {
      var L = t.light, D = t.dark;
      var pv = h('div', { class: 'th-pv', 'aria-hidden': 'true' });
      pv.innerHTML =
        '<div class="th-dark" style="background:' + rgb(D.bg) + '"><i style="background:' + rgb(D.accent) + '"></i><b style="background:rgba(255,255,255,.9)"></b><b style="background:rgba(255,255,255,.5);width:40%"></b></div>' +
        '<div class="th-light" style="background:linear-gradient(180deg,' + rgb(L.soft) + ',#fff)">' +
          '<span style="background:#fff;box-shadow:inset 0 0 0 1px ' + rgb(L.ink, .12) + '"><em style="background:' + rgb(L.tint) + '"></em><b style="background:' + rgb(L.ink) + '"></b><b style="background:' + L.muted + ';width:70%"></b></span>' +
          '<span style="background:#fff;box-shadow:inset 0 0 0 1px ' + rgb(L.ink, .12) + '"><em style="background:' + rgb(L.tint) + '"></em><b style="background:' + rgb(L.ink) + '"></b><i style="background:' + rgb(L.accent) + '"></i></span>' +
        '</div>';
      var card = h('button', { type: 'button', role: 'radio', 'aria-checked': String(t.id === cur), class: 'th-card' + (t.id === cur ? ' on' : ''), onclick: function () { data.theme = t.id; changed(); showSection('theme'); } }, [
        pv,
        h('div', { class: 'th-meta' }, [
          h('div', { class: 'th-sw' }, [L.ink, L.accent, D.bg, D.accent, L.tint].map(function (c) { return h('span', { style: 'background:' + rgb(c) }); })),
          h('b', { text: t.name }), h('span', { text: t.id === cur ? 'Selected' : t.note }),
        ]),
      ]);
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    wrap.appendChild(h('p', { class: 'muted small', text: 'Pick a theme, then press "Save changes". The whole website (buttons, headings, dark sections, cards and highlights) switches to the new colours in 1–2 minutes. The logo keeps its own colours.' }));
    return wrap;
  }

  /* ---------- sections ---------- */
  var SECTIONS = {
    stats: { label: 'Stats', title: 'Website statistics', desc: 'How many people visit the website, what they look at, where they come from, and how many enquiries and applications it brings in.', render: renderStats },
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
    facilities: { label: 'Facilities', title: 'Our Facilities', desc: 'Machines and equipment shown in the "Our facilities" section. The section (and its menu link) appears on the website once at least one facility is added.', render: function () {
      data.facilities = data.facilities || [];
      return listEditor(data.facilities, {
        noun: 'facility', photoThumb: true, title: function (f) { return f.name; }, sub: function (f) { return f.desc; }, thumb: function (f) { return f.image; },
        blank: function () { return { name: '', image: '', desc: '', specs: [] }; },
        fields: function (f, refresh) { return [
          textField(f, 'name', 'Machine / facility name', { required: true, full: true, onInput: refresh }),
          imageField(f, 'image', 'Photo', 'photo', { hint: 'a clear photo of the machine', name: function () { return 'facility-' + f.name; }, onChange: refresh }),
          textField(f, 'desc', 'Description', { multiline: true, full: true, onInput: refresh }),
          listField(f, 'specs', 'Key specifications', 'optional, e.g. "Table size: 1000 × 500 mm"'),
        ]; },
      });
    } },
    text: { label: 'Page text', title: 'Page text', desc: 'Every other wording on the website: headings, paragraphs, buttons, menu, footer, form labels and the Careers page. Search to find a text quickly.', render: function () {
      var wrap = h('div');
      if (!textFields) { wrap.appendChild(h('p', { text: 'Loading…' })); loadTextFields().then(function () { if (current === 'text') showSection('text'); }); return wrap; }
      if (!textFields.length) { wrap.appendChild(h('p', { text: 'The list of page texts could not be loaded. Reload the page and try again.' })); return wrap; }
      data.text = data.text || {};
      var q = h('input', { type: 'search', placeholder: 'Search the website text…', class: 'tsearch' });
      var list = h('div');
      wrap.appendChild(q); wrap.appendChild(list);
      var groups = [], byName = {};
      textFields.forEach(function (f) {
        if (data.text[f.key] == null) return;
        var g = f.page + ' · ' + f.group;
        if (!byName[g]) { byName[g] = { name: g, items: [] }; groups.push(byName[g]); }
        byName[g].items.push(f);
      });
      var openG = {};
      function draw() {
        var term = q.value.trim().toLowerCase();
        list.innerHTML = '';
        groups.forEach(function (g) {
          var items = g.items.filter(function (f) { return !term || plain(data.text[f.key]).toLowerCase().indexOf(term) > -1 || f.label.toLowerCase().indexOf(term) > -1; });
          if (!items.length) return;
          var isOpen = !!term || openG[g.name];
          var el = h('div', { class: 'item' + (isOpen ? ' open' : '') });
          el.appendChild(h('div', { class: 'item-h', onclick: function () { openG[g.name] = !openG[g.name]; draw(); } }, [
            h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'), h('div', { class: 'ttl' }, [h('b', { text: g.name }), h('span', { text: items.length + ' text' + (items.length > 1 ? 's' : '') })])]));
          var body = h('div', { class: 'item-b' });
          if (isOpen) items.forEach(function (f) { body.appendChild(pageTextField(f)); });
          el.appendChild(body);
          list.appendChild(el);
        });
        if (!list.children.length) list.appendChild(h('p', { text: 'No text matches "' + q.value + '".' }));
      }
      var t; q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(draw, 200); });
      draw();
      return wrap;
    } },
    theme: { label: 'Theme', title: 'Colour theme', desc: 'Choose the colours of the whole website.', render: renderTheme },
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
    (data.facilities || []).forEach(function (f, i) { if (!f.name.trim()) bad.push('Facility ' + (i + 1) + ' has no name'); if (!f.image) bad.push('Facility "' + f.name + '" has no photo'); });
    if (Object.keys(data.text || {}).some(function (k) { return !String(data.text[k]).trim(); })) bad.push('a box under "Page text" is empty (it is outlined in red)');
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
  var creds = null;
  async function chooseBackend(c) {
    if (c.github && c.github.token && c.github.repo) return githubBackend(c.github);
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      try { var r = await fetch('/__admin/ping', { cache: 'no-store' }); if (r.ok) return localBackend(); } catch (e) {}
    }
    return { name: 'not connected', readOnly: true, load: localBackend().load, save: function () { return Promise.reject(new Error('Saving is not connected yet.')); } };
  }
  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var err = $('#login-err'), btn = $('#login-btn');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Checking…';
    try {
      creds = await unlock($('#pw').value);
      if (!creds) { await new Promise(function (ok) { setTimeout(ok, 600); }); throw new Error('Wrong password.'); }
      backend = await chooseBackend(creds);
      data = await backend.load();
      saved = JSON.stringify(data);
      $('#pw').value = '';
      $('#login').hidden = true; $('#app').hidden = false;
      $('#chpw').hidden = !!backend.readOnly;
      var n = $('#notice');
      if (backend.readOnly) { n.hidden = false; n.textContent = 'Saving is not connected yet, so you can look around but changes cannot be saved.'; }
      else if (backend.name === 'this computer') { n.hidden = false; n.textContent = 'Test mode on this computer: saves go into the local files, not the live website.'; }
      Object.keys(SECTIONS).forEach(function (k) { $('#tabs').appendChild(h('button', { type: 'button', role: 'tab', 'data-k': k, onclick: function () { showSection(k); } }, SECTIONS[k].label)); });
      loadTextFields(); showSection(current); changed();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    btn.disabled = false; btn.textContent = 'Log in';
  });

  /* ---------- change password: re-encrypt admin/config.json with the new password ---------- */
  async function encryptConfig(secret, password) {
    var iter = 600000, salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    var enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(secret)));
    return JSON.stringify({ v: 1, iter: iter, salt: b64.from(salt), iv: b64.from(iv), data: b64.from(enc) }, null, 2) + '\n';
  }
  var dlg = $('#pw-dlg');
  $('#chpw').addEventListener('click', function () {
    if (isDirty()) { toast('Please save or undo your changes first, then change the password.', true); return; }
    $('#pw-form').reset(); $('#pw-err').hidden = true; dlg.showModal();
  });
  $('#pw-cancel').addEventListener('click', function () { dlg.close(); });
  $('#pw-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var err = $('#pw-err'), btn = $('#pw-ok'), cur = $('#pw-cur').value, nx = $('#pw-new').value;
    err.hidden = true;
    if (nx.length < 10) { err.textContent = 'Please use at least 10 characters (a short sentence works well).'; err.hidden = false; return; }
    if (nx !== $('#pw-again').value) { err.textContent = 'The two new passwords do not match.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Changing…';
    try {
      if (!(await unlock(cur))) throw new Error('The current password is wrong.');
      var cfg = await encryptConfig(creds, nx);
      await backend.save([{ path: 'admin/config.json', content: b64.utf8(cfg) }], 'Website admin: change password', function () {});
      dlg.close(); toast('Password changed. It takes effect when the website finishes updating (1–2 minutes).');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    btn.disabled = false; btn.textContent = 'Change password';
  });

  $('#save').addEventListener('click', save);
  $('#logout').addEventListener('click', function () { if (isDirty() && !confirm('You have unsaved changes. Log out anyway?')) return; data = null; location.reload(); });
  addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 's' && data) { e.preventDefault(); if (!$('#save').disabled) save(); } });
})();

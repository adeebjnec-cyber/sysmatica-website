/* SysMatica — service cards open a detail panel (gallery, applications, types). */
(function () {
  'use strict';
  var root = document.documentElement;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var box = $('#svc-modal'), scrim = $('#m-scrim');
  if (!box) return;
  var prods = $$('.m-prod', box), ids = prods.map(function (p) { return p.getAttribute('data-id'); });
  var cur = 0, lastFocus = null;

  function show(i) {
    cur = (i + ids.length) % ids.length;
    prods.forEach(function (p, k) { p.classList.toggle('on', k === cur); });
    $('#m-count').textContent = ('0' + (cur + 1)).slice(-2) + ' / ' + ('0' + ids.length).slice(-2);
    $('#m-scroll').scrollTop = 0;
  }
  function open(id) {
    lastFocus = document.activeElement;
    show(Math.max(0, ids.indexOf(id)));
    root.classList.add('m-open');
    box.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $('#m-close').focus(); }, 300);
  }
  function close(restoreFocus) {
    root.classList.remove('m-open');
    box.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (restoreFocus !== false && lastFocus) lastFocus.focus({ preventScroll: true });
  }

  $$('[data-svc]').forEach(function (b) { b.addEventListener('click', function () { open(b.getAttribute('data-svc')); }); });
  $('#m-close').addEventListener('click', function () { close(); });
  scrim.addEventListener('click', function () { close(); });
  $('#m-next').addEventListener('click', function () { show(cur + 1); });
  $('#m-prev').addEventListener('click', function () { show(cur - 1); });
  $$('[data-close]', box).forEach(function (a) { a.addEventListener('click', function () { close(false); }); });

  addEventListener('keydown', function (e) {
    if (!root.classList.contains('m-open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(cur + 1);
    else if (e.key === 'ArrowLeft') show(cur - 1);
    else if (e.key === 'Tab') { // keep focus inside the panel
      var f = $$('button, a[href]', box).filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  // gallery thumbnails
  prods.forEach(function (p) {
    var imgs = $$('.m-main img', p), th = $$('.m-thumbs button', p);
    th.forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-k');
        imgs.forEach(function (im) { im.classList.toggle('on', im.getAttribute('data-k') === k); });
        th.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      });
    });
  });

  // links like index.html#svc-hydraulics open that service directly
  if (location.hash.indexOf('#svc-') === 0) {
    var id = location.hash.slice(5);
    if (ids.indexOf(id) > -1) setTimeout(function () { $('#services').scrollIntoView(); open(id); }, 400);
  }
})();

/* Team email buttons: copy the address (works even without an email app), then open the mail app if one exists. */
(function () {
  'use strict';
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext !== false) return navigator.clipboard.writeText(text).catch(fallback);
    fallback(); return Promise.resolve();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
    }
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-copy-email]'), function (a) {
    var tip = document.createElement('span'); tip.className = 'tip'; tip.textContent = 'Email copied'; tip.setAttribute('aria-live', 'polite'); a.appendChild(tip);
    a.addEventListener('click', function () {
      copy(a.getAttribute('data-copy-email'));
      a.classList.add('copied');
      clearTimeout(a._t); a._t = setTimeout(function () { a.classList.remove('copied'); }, 2200);
      // the default mailto navigation continues, opening the visitor's email app if they have one
    });
  });
})();


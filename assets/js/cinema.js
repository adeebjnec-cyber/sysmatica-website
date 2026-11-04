/* SysMatica — Premium C · Cinema */
(function () {
  'use strict';
  var root = document.documentElement;
  var motion = root.classList.contains('motion');
  var fine = matchMedia('(pointer: fine)').matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var clamp = function (v) { return Math.max(0, Math.min(1, v)); };
  var vh = innerHeight;

  /* ---------- Intro ---------- */
  var hi = $('.hero .bg img');
  Promise.race([
    Promise.all([document.fonts ? document.fonts.ready : 0, hi && hi.decode ? hi.decode().catch(function () {}) : 0]),
    new Promise(function (r) { setTimeout(r, 1200); })
  ]).then(function () { setTimeout(function () { root.classList.add('loaded'); }, 30); });

  /* ---------- Manifesto: split into words ---------- */
  var man = $('#manifesto'), words = [];
  if (man) {
    (function split(el, key) {
      Array.prototype.slice.call(el.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var f = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { f.appendChild(document.createTextNode(part)); return; }
            var s = document.createElement('span'); s.className = 'wd' + (key ? ' k' : ''); s.textContent = part; f.appendChild(s);
          });
          n.parentNode.replaceChild(f, n);
        } else if (n.nodeType === 1) split(n, key || n.classList.contains('k'));
      });
    })(man, false);
    words = $$('.wd', man);
    if (!motion) words.forEach(function (w) { w.classList.add('on'); });
  }

  /* ---------- Reveals + counters ---------- */
  function countUp(el) {
    var to = +el.getAttribute('data-count'), t0 = null;
    el.textContent = '0';
    requestAnimationFrame(function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / 1500);
      el.textContent = Math.round((1 - Math.pow(1 - p, 3)) * to);
      if (p < 1) requestAnimationFrame(step);
    });
  }
  var targets = $$('[data-in], .vis');
  if (motion && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        $$('[data-count]', en.target).forEach(countUp);
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.1 });
    targets.forEach(function (el) { io.observe(el); });
  } else { targets.forEach(function (el) { el.classList.add('in'); }); }

  /* ---------- Industries ---------- */
  var items = $$('#ilist li'), bgs = $$('.industries .bgs img');
  function setInd(k) {
    items.forEach(function (li, i) { var on = i === k; li.classList.toggle('on', on); $('button', li).setAttribute('aria-expanded', String(on)); });
    bgs.forEach(function (im, i) { im.classList.toggle('on', i === k); });
  }
  items.forEach(function (li, k) {
    $('button', li).addEventListener('click', function () { setInd(k); });
    li.addEventListener('mouseenter', function () { if (fine) setInd(k); });
  });

  /* ---------- Enquire buttons pre-select the product line ---------- */
  $$('[data-interest]').forEach(function (a) {
    a.addEventListener('click', function () { var s = $('#q-interest'); if (s) s.value = a.getAttribute('data-interest'); });
  });

  /* ---------- Scroll-linked ---------- */
  var header = $('#header'), bar = $('.progress'), now = $('#now'), rail = $('#rail');
  var railLinks = $$('#rail a');
  var chapters = $$('.ch'), labeled = $$('[data-label]');
  var navLinks = $$('.nav a').filter(function (a) { return a.getAttribute('href').charAt(0) === '#'; }), navSecs = navLinks.map(function (a) { return $(a.getAttribute('href')); });
  var vis = motion ? $$('.vis') : [];
  var ptrack = $('#ptrack'), psteps = $$('#ptrack li');
  var solutions = $('#solutions'), industries = $('#capabilities');
  var lastLabel = '';

  function frame() {
    var y = scrollY, max = document.documentElement.scrollHeight - vh;
    bar.style.setProperty('--pg', max > 0 ? (y / max).toFixed(4) : 0);
    header.classList.toggle('solid', y > 40);

    // manifesto words
    if (man && motion) {
      var r = man.getBoundingClientRect();
      var p = clamp((vh * 0.8 - r.top) / (r.height + vh * 0.3));
      var n = Math.round(p * words.length);
      for (var i = 0; i < words.length; i++) words[i].classList.toggle('on', i < n);
    }

    // chapter rail + label
    var line = vh * 0.45, curCh = -1;
    chapters.forEach(function (c, i) { var b = c.getBoundingClientRect(); if (b.top <= line && b.bottom > line) curCh = i; });
    railLinks.forEach(function (a, i) { if (i === curCh) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    if (rail && solutions && industries) {
      var sTop = solutions.getBoundingClientRect().top, iTop = industries.getBoundingClientRect().top;
      rail.classList.toggle('on', sTop < vh * 0.5 && iTop > vh * 0.5);
    }
    var lab = '';
    labeled.forEach(function (s) { var b = s.getBoundingClientRect(); if (b.top <= line && b.bottom > line) lab = s.getAttribute('data-label'); });
    if (lab !== lastLabel && now) {
      lastLabel = lab;
      var parts = lab.split(' — ');
      now.innerHTML = parts.length > 1 ? '<b>' + parts[0] + '</b> ' + parts[1] : lab;
    }

    // parallax inside each chapter composition
    vis.forEach(function (v) {
      var b = v.getBoundingClientRect();
      if (b.bottom < -100 || b.top > vh + 100) return;
      var p = (b.top + b.height / 2 - vh / 2) / vh;
      var main = $('.main', v); if (main) main.style.transform = 'translate3d(0,' + (p * -24).toFixed(1) + 'px,0)';
      $$('.sub', v).forEach(function (s, k) { s.style.transform = 'translate3d(0,' + (p * (k ? -60 : 70)).toFixed(1) + 'px,0)'; });
    });

    // process line
    if (ptrack) {
      var t = ptrack.getBoundingClientRect();
      var tp = clamp((vh * 0.75 - t.top) / (t.height + vh * 0.25));
      ptrack.style.setProperty('--tp', motion ? tp : 1);
      psteps.forEach(function (li, i) { li.classList.toggle('on', !motion || tp >= (i + 0.5) / psteps.length); });
    }

    var c = 0;
    navSecs.forEach(function (s, i) { if (s && s.getBoundingClientRect().top < vh * 0.4) c = i; });
    navLinks.forEach(function (a, i) { if (i === c) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
  }
  var ticking = false;
  addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(function () { frame(); ticking = false; }); } }, { passive: true });
  addEventListener('resize', function () { vh = innerHeight; frame(); });
  frame();

  /* ---------- Mobile menu ---------- */
  var mb = $('.menu-btn'), mnav = $('#mnav'), ml = $('.ml');
  function setMenu(open) {
    mnav.classList.toggle('open', open); mnav.setAttribute('aria-hidden', String(!open));
    mb.setAttribute('aria-expanded', String(open)); ml.textContent = open ? 'Close' : 'Menu';
    document.body.style.overflow = open ? 'hidden' : '';
  }
  if (mb) {
    mb.addEventListener('click', function () { setMenu(!mnav.classList.contains('open')); });
    mnav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    addEventListener('keydown', function (e) { if (e.key === 'Escape' && mnav.classList.contains('open')) { setMenu(false); mb.focus(); } });
  }

  var yr = $('#year'); if (yr) yr.textContent = new Date().getFullYear();
})();

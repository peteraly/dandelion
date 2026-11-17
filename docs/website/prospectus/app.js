/*!
 * Dandelion Foundation prospectus: page behaviour.
 *
 * One scheduler drives everything that moves: the opening film, the plates
 * further down the page, and the print register of the headings. Nothing
 * typed into the page is sent, stored or put in the address bar.
 *
 * No dependencies. Needs stage.js and figure.js to be loaded first.
 */
(function () {
  'use strict';

  var S = window.DFStage, Fig = window.DFFigure;
  var doc = document.documentElement;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function idle(fn) { if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 1200 }); else setTimeout(fn, 120); }
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  var state = {
    filmOn: false, layout: 'stack', p: 0, slip: 0, locked: false, time: 0,
    group: 'community', ring: null, zoom: 0, zoomTo: 0, topic: 'all', topicA: 0, box: null,
    lastY: window.pageYOffset || 0, lastT: 0, raf: 0, sizeDirty: false
  };

  /* ------------------------------------------------------ small things */

  $$('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
  $$('.misreg, .term-no').forEach(function (el) { el.setAttribute('data-print', el.textContent.replace(/\s+/g, ' ').trim()); });

  (function menu() {
    var btn = $('[data-menu-btn]'), nav = $('[data-menu]');
    if (!btn || !nav) return;
    function set(open) {
      if (open) nav.setAttribute('data-open', ''); else nav.removeAttribute('data-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? 'Close' : 'Menu';
    }
    btn.addEventListener('click', function () { set(!nav.hasAttribute('data-open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.hasAttribute('data-open')) { set(false); btn.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (nav.hasAttribute('data-open') && !e.target.closest('[data-masthead]')) set(false);
    });
  })();

  /* ------------------------------------------------------------ plates */

  var film = $('[data-film]'), stageEl = $('[data-stage]'), filmPlateEl = $('[data-film-plate]');
  var beats = $$('[data-beat]'), cover = beats[0];
  var filmHost = { el: filmPlateEl, still: $('.plate-still', filmPlateEl), sheet: 'vision', film: true };
  var plates = $$('.plate[data-plate]').map(function (el) {
    return {
      el: el, still: $('.plate-still', el), frame: el.getAttribute('data-plate'), pan: el.getAttribute('data-pan'),
      sheet: el.getAttribute('data-sheet'), role: el.getAttribute('data-role') || '',
      release: parseFloat(el.getAttribute('data-release') || '0'),
      stillOnly: el.hasAttribute('data-still-only') || !!el.closest('.beat'), near: false
    };
  });
  var stage = null, live = null, wanted = {}, canPaint = !!S;

  function fxFor(pl) {
    var fx = {};
    if (pl.release) fx.release = pl.release;
    if (pl.role === 'partners') { var sp = S.SPOTS[state.group]; fx.reticle = [sp[0], sp[1], sp[2], 1]; }
    if (pl.role === 'shelves' && state.topic !== 'all') fx.box = S.SHELVES[state.topic].concat([1]);
    if (pl.role === 'evening') fx.glow = [S.LANTERN[0], S.LANTERN[1], 0.8];
    return fx;
  }
  function drawStill(pl) {
    if (!canPaint || !S.has(pl.sheet)) return;
    var w = pl.el.clientWidth, h = pl.el.clientHeight;
    if (!w || !h) return;
    S.still(pl.still, S.frameCam(S.FRAMES[pl.frame], { w: w, h: h }), fxFor(pl));
  }
  function drawStills(role) {
    plates.forEach(function (pl) { if (pl.near && pl !== live && (!role || pl.role === role)) drawStill(pl); });
  }

  /* Each painting is fetched once, when something on screen (or about to be) needs it. */
  function need(name) {
    if (!canPaint || wanted[name]) return;
    wanted[name] = true;
    var src = $('.plate[data-sheet="' + name + '"] img') || $('img', filmPlateEl);
    var img = new Image();
    img.decoding = 'async';
    if (src.getAttribute('sizes')) img.sizes = src.getAttribute('sizes');
    if (src.getAttribute('srcset')) img.srcset = src.getAttribute('srcset');
    img.onload = function () {
      S.setImage(name, img);
      plates.forEach(function (pl) { if (pl.sheet === name && pl.near) drawStill(pl); });
      if (name === 'vision' && state.filmOn) need('table');
      requestTick();
    };
    img.onerror = function () { if (name === 'vision' && state.filmOn) setFilm(false); };
    img.src = src.getAttribute('src');
  }
  $$('.plate img').forEach(function (img) {
    img.addEventListener('error', function () { var f = img.closest('figure'); if (f) f.hidden = true; });
  });

  if (canPaint && 'IntersectionObserver' in window) {
    var plateIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var pl = plates.filter(function (q) { return q.el === en.target; })[0];
        if (!pl) return;
        pl.near = en.isIntersecting;
        if (pl.near) { need(pl.sheet); drawStill(pl); requestTick(); }
      });
    }, { rootMargin: '900px 0px' });
    plates.forEach(function (pl) { plateIO.observe(pl.el); });
  } else if (canPaint) {
    plates.forEach(function (pl) { pl.near = true; need(pl.sheet); });
  }

  /* -------------------------------------------------------------- film */

  var M = null, activeBeat = 0, lastOut = -1, figBtns = $$('[data-goto]'), toggle = $('[data-film-toggle]');
  var STARTS = [0, 0.2, 0.445, 0.64, 0.875];              // where each scene's text takes over
  var CARDS = [[-1, 0.085], [0.215, 0.405], [0.455, 0.615], [0.645, 0.8], [0.885, 2]];
  var GOTO = [0, 0.31, 0.53, 0.72, 0.97];

  function measureFilm() {
    if (!state.filmOn) return;
    state.layout = (getComputedStyle(film).getPropertyValue('--film-layout') || 'stack').trim() || 'stack';
    var r = film.getBoundingClientRect(), split = state.layout === 'split';
    var w = filmPlateEl.clientWidth, h = filmPlateEl.clientHeight;
    M = { top: r.top + (window.pageYOffset || 0), range: Math.max(1, film.offsetHeight - stageEl.clientHeight), w: w, h: h };
    var host = { w: w, h: h }, tall = !split;
    var coverFocus = split ? [Math.min(cover.offsetWidth / w, 0.62), 0, 1, 1] : [0, 0, 1, 1];
    var cardFocus = split ? [0.4, 0, 1, 0.95] : [0, 0, 1, 1];
    var zoom = split ? 1.5 : 2.6;
    function cam(name, focus, z) { return S.frameCam(S.FRAMES[name], host, { focus: focus, tall: tall, maxZoom: z }); }
    function shift(c, dx, dy) { return { cx: c.cx + dx / c.s, cy: c.cy + dy / c.s, s: c.s }; }
    var ground = cam('ground', cardFocus, zoom), plan = cam('plan', cardFocus, split ? 1.3 : 2.2);
    M.keys = [
      [0, cam('cover', coverFocus, split ? 1.25 : 2.2)],
      [0.05, cam('cover', coverFocus, split ? 1.25 : 2.2)],
      [0.17, split ? cam('wide', [0, 0, 1, 1], 1) : cam('wide', cardFocus, 1.9)],
      [0.27, ground],
      [0.4, shift(ground, split ? -26 : -14, 0)],
      [0.48, cam('stemA', cardFocus, zoom)],
      [0.6, cam('stemB', cardFocus, zoom)],
      [0.665, cam('clock', cardFocus, zoom)],
      [0.78, cam('clockB', cardFocus, zoom)],
      [0.905, plan],
      [1, shift(plan, split ? 22 : 12, 0)]
    ];
  }
  function filmCam(p) {
    var k = M.keys, i = 0;
    while (i < k.length - 2 && p > k[i + 1][0]) i++;
    return S.mixCam(k[i][1], k[i + 1][1], smooth((p - k[i][0]) / (k[i + 1][0] - k[i][0])));
  }
  function updateFilm() {
    var p = clamp(((window.pageYOffset || 0) - M.top) / M.range, 0, 1);
    state.p = p;
    var out = smooth((p - 0.045) / 0.1);
    if (out !== lastOut) { stageEl.style.setProperty('--out', out.toFixed(4)); lastOut = out; }
    var scene = 0, act = -1, i;
    for (i = 0; i < STARTS.length; i++) if (p >= STARTS[i]) scene = i;
    if (state.layout === 'split') { for (i = 1; i < CARDS.length; i++) if (p >= CARDS[i][0] && p <= CARDS[i][1]) act = i; if (p < CARDS[0][1]) act = 0; }
    else act = scene;
    if (act !== activeBeat) {
      beats.forEach(function (b, n) { b.classList.toggle('is-active', n === act); });
      activeBeat = act;
    }
    figBtns.forEach(function (b, n) { if (n === scene) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  }
  function gotoScene(n) {
    if (!state.filmOn || !M) return;
    window.scrollTo({ top: Math.round(M.top + GOTO[n] * M.range), behavior: reduce.matches ? 'auto' : 'smooth' });
  }
  figBtns.forEach(function (b, n) { b.addEventListener('click', function () { gotoScene(n); }); });

  /* The cover headline is set like a broadside: each line is fitted to the full measure. */
  var poster = $('.poster'), coverText = $('.cover-text');
  function fitPoster() {
    if (!poster) return;
    var lines = $$('.fit:not(.fit-into)', poster);
    poster.style.fontSize = ''; lines.forEach(function (l) { l.style.fontSize = ''; });
    var W = coverText.clientWidth;
    if (!W) return;
    var sizes = lines.map(function (l) {
      l.style.fontSize = '100px';
      var w = l.getBoundingClientRect().width || 1;
      return 100 * (W - 6) / w;
    });
    var cap = Math.max(40, Math.min(window.innerHeight * 0.23, 190));
    function apply(k) {
      var small = Infinity;
      lines.forEach(function (l, n) { var s = Math.min(sizes[n], cap) * k; small = Math.min(small, s); l.style.fontSize = s.toFixed(2) + 'px'; });
      poster.style.fontSize = small.toFixed(2) + 'px';
    }
    apply(1);
    if (state.filmOn) {
      /* keep the whole cover inside its slip of paper */
      var room = cover.clientHeight - (state.layout === 'split' ? 70 : 22), k = 1, guard = 0;
      while (coverText.scrollHeight > room && k > 0.5 && guard++ < 12) { k -= 0.05; apply(k); }
    }
  }

  function setFilm(on) {
    on = !!on && canPaint && !!filmPlateEl;
    var scene = 0, i;
    if (state.filmOn && M) { for (i = 0; i < STARTS.length; i++) if (state.p >= STARTS[i]) scene = i; }
    else { beats.forEach(function (b, n) { if (b.getBoundingClientRect().top < window.innerHeight * 0.5) scene = n; }); }
    var inFilm = film.getBoundingClientRect().bottom > 0 && (window.pageYOffset || 0) > 4;
    state.filmOn = on;
    doc.classList.toggle('film-on', on);
    if (toggle) {
      $('[data-long]', toggle).textContent = on ? 'Read as a still page' : 'Play the scenes as you scroll';
      $('[data-short]', toggle).textContent = on ? 'Still page' : 'Play scenes';
    }
    if (on) {
      if (!stage) stage = new S.Stage({ onChange: requestTick });
      need('vision');
      if (S.has('vision')) need('table');
      measureFilm(); fitPoster(); measureFilm();
      activeBeat = -2; lastOut = -1; updateFilm();
      if (inFilm) window.scrollTo(0, Math.round(M.top + GOTO[scene] * M.range));
    } else {
      if (stage) { stage.attach(null); stage.last = null; }
      live = null; M = null;
      beats.forEach(function (b) { b.classList.remove('is-active'); });
      stageEl.style.removeProperty('--out');
      fitPoster();
      plates.forEach(function (pl) { pl.near = pl.near || !('IntersectionObserver' in window); });
      drawStills();
      if (inFilm && beats[scene]) window.scrollTo(0, Math.max(0, Math.round(beats[scene].getBoundingClientRect().top + (window.pageYOffset || 0) - 90)));
    }
    state.sizeDirty = true;
    requestTick();
  }
  if (toggle) toggle.addEventListener('click', function () { setFilm(!state.filmOn); });

  /* keep keyboard focus and the picture together */
  if (cover) cover.addEventListener('focusin', function () {
    if (state.filmOn && state.p > 0.06) window.scrollTo(0, Math.round(M.top));
  });

  /* ------------------------------------------- the stage, frame by frame */

  function motion() { return state.filmOn && !state.locked ? 1 : 0; }
  function progress(r) { return clamp((window.innerHeight - r.top) / (window.innerHeight + r.height), 0, 1); }

  function renderLive(now) {
    if (!stage) return false;
    var vh = window.innerHeight, best = null, bestA = 0;
    if (S.has('vision')) {
      var fr = stageEl.getBoundingClientRect(), fv = Math.min(fr.bottom, vh) - Math.max(fr.top, 0);
      if (fv > 0) { best = filmHost; bestA = fv * fr.width * 1.4; }
    }
    plates.forEach(function (pl) {
      if (pl.stillOnly || !pl.near || !S.has(pl.sheet)) return;
      var r = pl.el.getBoundingClientRect(), h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (h > 0 && r.width > 0 && h * r.width > bestA) { best = pl; bestA = h * r.width; }
    });
    if (!best) return false;
    if (live !== best) {
      if (live && stage.last) stage.freeze(live.still);
      live = best; stage.attach(best.el); stage.last = null;
    } else if (state.sizeDirty) stage.measure();
    state.sizeDirty = false;

    var host = { w: stage.w, h: stage.h }, cam, anim = false;
    var fx = { time: state.time, motion: motion() };
    if (best.film) {
      if (!M) return false;
      cam = filmCam(state.p);
      fx.release = clamp((state.p - 0.66) / 0.245, 0, 1) * 1.32;
      anim = fx.release > 0.02 && fx.release < 1.3 && motion() > 0;
    } else {
      var a = S.frameCam(S.FRAMES[best.frame], host);
      var q = progress(best.el.getBoundingClientRect());
      cam = best.pan ? S.mixCam(a, S.frameCam(S.FRAMES[best.pan], host), smooth(q)) : a;
      if (best.release) fx.release = best.release;
      if (best.role === 'partners') {
        var sec = best.el.closest('section'), qs = sec ? progress(sec.getBoundingClientRect()) : q;
        var k = 1 - smooth((qs - 0.8) / 0.2);            /* back to neutral as the section leaves */
        var to = S.SPOTS[state.group], g = state.ring || (state.ring = to.slice());
        var d = Math.abs(to[0] - g[0]) + Math.abs(to[1] - g[1]) + Math.abs(state.zoomTo - state.zoom) * 100;
        var e = motion() ? 0.16 : 1;
        g[0] += (to[0] - g[0]) * e; g[1] += (to[1] - g[1]) * e; g[2] += (to[2] - g[2]) * e;
        state.zoom += (state.zoomTo - state.zoom) * e;
        cam = S.nudgeCam(cam, g, 1.34, state.zoom * k);
        fx.reticle = [g[0], g[1], g[2], k];
        anim = d > 0.6;
      } else if (best.role === 'shelves') {
        var t = state.topic === 'all' ? 0 : 1;
        if (t) state.box = S.SHELVES[state.topic];
        state.topicA += (t - state.topicA) * (motion() ? 0.2 : 1);
        if (state.box && state.topicA > 0.01) fx.box = state.box.concat([state.topicA]);
        anim = Math.abs(t - state.topicA) > 0.01;
      } else if (best.role === 'evening') {
        fx.glow = [S.LANTERN[0], S.LANTERN[1], 0.78 + 0.22 * Math.sin(state.time * 2.3) * motion()];
        if (motion()) { fx.drift = [3600 + 1080, 250, 0.9]; anim = true; }
      }
    }
    var px = state.slip * 4.2 / cam.s;
    stage.render(cam, fx, [px, -px * 0.62]);
    return anim;
  }

  /* the headings slip out of register with the plates */
  var printed = [];
  if ('IntersectionObserver' in window) {
    var typeIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var i = printed.indexOf(en.target);
        if (en.isIntersecting && i < 0) printed.push(en.target);
        if (!en.isIntersecting && i >= 0) { printed.splice(i, 1); en.target.style.removeProperty('--slip'); }
      });
    }, { rootMargin: '80px 0px' });
    $$('.misreg, .term-no').forEach(function (el) { typeIO.observe(el); });
  }
  var shownSlip = 0;
  function printSlip(v) {
    v = Math.round(v * 100) / 100;
    if (v === shownSlip) return;
    shownSlip = v;
    printed.forEach(function (el) { if (v) el.style.setProperty('--slip', String(v)); else el.style.removeProperty('--slip'); });
  }

  function tick(now) {
    state.raf = 0;
    var dt = state.lastT ? Math.min(64, now - state.lastT) : 16;
    state.lastT = now;
    var y = window.pageYOffset || 0, vel = Math.abs(y - state.lastY) / dt;
    state.lastY = y;
    if (motion()) state.time += dt / 1000;
    var target = motion() ? clamp(vel / 3, 0, 1) : 0;
    state.slip += (target - state.slip) * (target > state.slip ? 0.3 : 0.12);
    if (state.slip < 0.004) state.slip = 0;
    printSlip(state.slip);
    var more = state.slip > 0;
    if (state.filmOn) {
      if (M) updateFilm();
      more = renderLive(now) || more;
    }
    if (more) requestTick(); else state.lastT = 0;
  }
  function requestTick() { if (!state.raf) state.raf = window.requestAnimationFrame(tick); }

  window.addEventListener('scroll', requestTick, { passive: true });
  var resizeTimer = 0, lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var widthChanged = window.innerWidth !== lastW;
      lastW = window.innerWidth;
      state.sizeDirty = true;
      if (state.filmOn) { measureFilm(); if (widthChanged) { fitPoster(); measureFilm(); } activeBeat = -2; lastOut = -1; }
      else if (widthChanged) fitPoster();
      drawStills();
      if (widthChanged) drawFigures(true);
      requestTick();
    }, 140);
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { state.lastT = 0; requestTick(); } });

  /* ----------------------------------------------- the printed figures */

  var figs = $$('canvas[data-figure]'), figDone = {}, figTimer = 0;
  function drawFigures(force) {
    if (!Fig) return;
    figs.forEach(function (c) {
      var key = c.clientWidth + 'x' + c.clientHeight;
      if (!c._near || (!force && figDone[c.getAttribute('data-figure')] === key) || !c.clientWidth) return;
      try {
        Fig.snapshot(c, Fig.FRAMES[c.getAttribute('data-figure')], { release: 0 });
        figDone[c.getAttribute('data-figure')] = key;
      } catch (e) { var f = c.closest('figure'); if (f) f.hidden = true; }
    });
    clearTimeout(figTimer);
    figTimer = setTimeout(function () { Fig.release(); }, 2500);
  }
  if (Fig && figs.length && 'IntersectionObserver' in window) {
    var figIO = new IntersectionObserver(function (entries) {
      var any = false;
      entries.forEach(function (en) { if (en.isIntersecting) { en.target._near = true; any = true; } });
      if (any) idle(function () { drawFigures(false); });
    }, { rootMargin: '1100px 0px' });
    figs.forEach(function (c) { figIO.observe(c); });
  } else if (!Fig) {
    figs.forEach(function (c) { var f = c.closest('figure'); if (f) f.hidden = true; });
  }

  /* ---------------------------------------------------------- partners */

  (function partners() {
    var list = $('[data-tablist]');
    if (!list) return;
    var tabs = $$('[data-tab]', list), panels = $$('[data-panel]');
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-orientation', 'vertical');
    function select(id, focus, byUser) {
      tabs.forEach(function (t) {
        var on = t.getAttribute('data-tab') === id;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      panels.forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== id; });
      state.group = id;
      if (byUser) state.zoomTo = 1;
      if (state.filmOn) requestTick(); else drawStills('partners');
    }
    tabs.forEach(function (t, n) {
      var id = t.getAttribute('data-tab'), panel = document.getElementById('panel-' + id);
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-controls', 'panel-' + id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', t.id);
      panel.tabIndex = 0;
      t.addEventListener('click', function () { select(id, false, true); });
      t.addEventListener('keydown', function (e) {
        var to = -1;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = (n + 1) % tabs.length;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = (n + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = tabs.length - 1;
        if (to >= 0) { e.preventDefault(); select(tabs[to].getAttribute('data-tab'), true, true); }
      });
    });
    select('community', false, false);
  })();

  /* --------------------------------------------------------- resources */

  (function resources() {
    var root = $('[data-resources]');
    if (!root) return;
    var q = $('#res-q'), chips = $$('[data-topic]', $('[data-finder]')), items = $$('[data-res]', root);
    var count = $('[data-count]', root), empty = $('[data-empty]', root), list = $('[data-list]', root);
    var text = items.map(function (li) { return li.textContent.toLowerCase(); });
    function apply() {
      var term = q.value.trim().toLowerCase(), shown = 0;
      items.forEach(function (li, n) {
        var ok = (state.topic === 'all' || li.getAttribute('data-topic') === state.topic) && (!term || text[n].indexOf(term) >= 0);
        li.hidden = !ok;
        if (ok) shown++;
      });
      count.textContent = 'Showing ' + shown + ' of ' + items.length + ' resources';
      empty.hidden = shown > 0;
      list.hidden = shown === 0;
      if (state.filmOn) requestTick(); else drawStills('shelves');
    }
    function topic(t) {
      state.topic = t;
      chips.forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-topic') === t ? 'true' : 'false'); });
      apply();
    }
    chips.forEach(function (c) { c.addEventListener('click', function () { topic(c.getAttribute('data-topic')); }); });
    q.addEventListener('input', apply);
    $$('[data-reset]', root).forEach(function (b) { b.addEventListener('click', function () { q.value = ''; topic('all'); q.focus(); }); });
    $('[data-finder]').addEventListener('submit', function (e) { e.preventDefault(); });
  })();

  /* ------------------------------------------- the local brief (sends nothing) */

  (function brief() {
    var form = $('[data-brief]');
    if (!form) return;
    var f = { org: $('#brief-org'), area: $('#brief-area'), priority: $('#brief-priority'), help: $('#brief-help') };
    var status = $('[data-status]', form), manual = $('[data-manual]', form), manualTa = $('#brief-manual');
    var MSG = {
      org: 'Add your organization or team.',
      area: 'Choose an area of work.',
      priority: 'Describe the priority you are working on.',
      help: 'Say where a small collaboration might help.'
    };
    function say(t) { status.textContent = ''; setTimeout(function () { status.textContent = t; }, 30); }
    function valid() {
      var first = null;
      Object.keys(f).forEach(function (k) {
        var el = f[k], err = document.getElementById(el.id + '-err'), bad = !el.value.trim();
        el.setAttribute('aria-invalid', bad ? 'true' : 'false');
        err.textContent = bad ? MSG[k] : '';
        err.hidden = !bad;
        if (bad && !first) first = el;
      });
      if (first) { first.focus(); say('The brief is not ready yet. ' + MSG[Object.keys(f).filter(function (k) { return f[k] === first; })[0]]); }
      return !first;
    }
    Object.keys(f).forEach(function (k) {
      f[k].addEventListener('input', function () {
        if (f[k].getAttribute('aria-invalid') === 'true' && f[k].value.trim()) {
          f[k].setAttribute('aria-invalid', 'false');
          var err = document.getElementById(f[k].id + '-err'); err.textContent = ''; err.hidden = true;
        }
      });
    });
    function text() {
      var d = new Date(), date;
      try { date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { date = d.toDateString(); }
      return [
        'DANDELION FOUNDATION',
        'Exploratory collaboration brief',
        'Prepared ' + date + ' (local date)',
        '',
        'ORGANIZATION OR TEAM',
        f.org.value.trim(),
        '',
        'AREA OF WORK',
        f.area.value.trim(),
        '',
        'PRIORITY WE ARE WORKING ON',
        f.priority.value.trim(),
        '',
        'WHERE A SMALL COLLABORATION MIGHT HELP',
        f.help.value.trim(),
        '',
        'SUGGESTED NEXT STEP',
        'Agree one useful task, decide who does what, and review the result together before committing to more.',
        '',
        'STATUS',
        'Exploratory only. This brief is not an agreement, an application, or a partnership.',
        '',
        'DELIVERY',
        'No message was sent. This brief was prepared in the browser and stays on this device until you share it.',
        'Please leave out student names and confidential health data.',
        ''
      ].join('\n');
    }
    function showManual(t) {
      manual.hidden = false; manualTa.value = t; manualTa.focus(); manualTa.select();
    }
    $('[data-copy]', form).addEventListener('click', function (e) {
      if (!valid()) return;
      var t = text(), btn = e.currentTarget;
      function fallback() {
        showManual(t);
        var done = false;
        try { done = document.execCommand('copy'); } catch (err) { done = false; }
        if (done) { manual.hidden = true; btn.focus(); say('Copied to clipboard.'); }
        else say('Copying was blocked here. The brief is shown below: select it and copy it, or use Download .txt.');
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(function () { manual.hidden = true; say('Copied to clipboard.'); }, fallback);
      } else fallback();
    });
    $('[data-download]', form).addEventListener('click', function () {
      if (!valid()) return;
      var t = text(), d = new Date();
      var stamp = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      try {
        var url = URL.createObjectURL(new Blob([t], { type: 'text/plain;charset=utf-8' }));
        var a = document.createElement('a');
        a.href = url; a.download = 'dandelion-collaboration-brief-' + stamp + '.txt';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        say('Download started. If no file appears, this browser or viewer blocked it: use Copy formatted brief instead.');
      } catch (err) {
        showManual(t);
        say('This browser could not create the file. The brief is shown below: select it and copy it.');
      }
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    /* a group's button on the page picks the matching area of work */
    $$('[data-brief-area]').forEach(function (a) {
      a.addEventListener('click', function () {
        f.area.value = a.getAttribute('data-brief-area');
        f.area.setAttribute('aria-invalid', 'false');
        var err = document.getElementById('brief-area-err'); err.textContent = ''; err.hidden = true;
        say('Area of work set to ' + f.area.value + '.');
      });
    });

    /* nothing moves while someone is writing */
    var box = form.closest('.brief'), focused = false, centred = false;
    function lock() {
      var l = focused || centred;
      if (l === state.locked) return;
      state.locked = l;
      if (l) { state.slip = 0; printSlip(0); }
      requestTick();
    }
    form.addEventListener('focusin', function () { focused = true; lock(); });
    form.addEventListener('focusout', function () { setTimeout(function () { focused = form.contains(document.activeElement); lock(); }, 0); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { centred = en[0].isIntersecting; lock(); }, { rootMargin: '-45% 0px -45% 0px' }).observe(box);
    }
  })();

  /* ------------------------------------------------------------- start */

  function start() {
    var roomy = window.innerHeight >= 520 && window.innerWidth >= 300;
    setFilm(!reduce.matches && roomy);
    if (!state.filmOn) { fitPoster(); need('vision'); }
    /* the headline is fitted to the measure, so fit it again whenever a typeface arrives */
    function refit() { fitPoster(); if (state.filmOn) { measureFilm(); activeBeat = -2; lastOut = -1; } requestTick(); }
    if (document.fonts) {
      if (document.fonts.load) {
        Promise.all([document.fonts.load('900 1em Besley'), document.fonts.load('italic 500 1em Besley'), document.fonts.load('400 1em "Libre Franklin"')]).then(refit, refit);
      }
      if (document.fonts.ready) document.fonts.ready.then(refit);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', refit);
    }
    window.addEventListener('load', refit);
    requestTick();
  }
  start();
})();

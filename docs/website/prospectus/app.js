/*!
 * Dandelion Foundation prospectus: page behaviour.
 *
 * One painted scene stays behind the whole page. Each block of text (a
 * "track") names the part of the scene it belongs to; as the page scrolls,
 * the camera holds on that part while the text is read and travels on when
 * the text leaves. The camera's place depends only on how far the page has
 * scrolled, so scrolling back plays the journey backwards.
 *
 * One scheduler drives everything that moves. Nothing typed into the page is
 * sent, stored or put in the address bar.
 *
 * No dependencies. Needs stage.js to be loaded first.
 */
(function () {
  'use strict';

  var S = window.DFStage;
  var doc = document.documentElement;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function scrollY() { return window.pageYOffset || 0; }
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  var state = {
    filmOn: false, wide: false, slip: 0, locked: false, time: 0, frame: 0, cam: null,
    group: 'community', ring: null, zoom: 0, zoomTo: 0, topic: 'all', topicA: 0, box: null,
    lastY: scrollY(), lastT: 0, raf: 0
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

  /* ---------------------------------------------------- the paintings */

  var canPaint = !!S, wanted = {};
  var stagefix = $('[data-stagefix]'), stageHost = $('[data-stage-plate]'), tracksEl = $('.tracks');
  var plates = $$('.plate[data-plate]').map(function (el) {
    return {
      el: el, still: $('.plate-still', el), frame: el.getAttribute('data-plate'), sheet: el.getAttribute('data-sheet'),
      role: el.getAttribute('data-role') || '', release: parseFloat(el.getAttribute('data-release') || '0'), near: false
    };
  });

  /* Each painting is fetched once. The scene needs all of them, in order. */
  function need(name) {
    if (!canPaint || wanted[name] || !S.SHEETS[name]) return;
    wanted[name] = true;
    var src = $('.plate[data-sheet="' + name + '"] img') || $('img', stageHost);
    var img = new Image();
    img.decoding = 'async';
    if (src.getAttribute('sizes')) img.sizes = src.getAttribute('sizes');
    if (src.getAttribute('srcset')) img.srcset = src.getAttribute('srcset');
    img.onload = function () {
      S.setImage(name, img);
      plates.forEach(function (pl) { if (pl.sheet === name && pl.near) drawStill(pl); });
      if (state.filmOn) needNext();
      requestTick();
    };
    img.onerror = function () { if (name === 'vision' && state.filmOn) setFilm(false); };
    img.src = src.getAttribute('src');
  }
  function needNext() { for (var n in S.SHEETS) if (!wanted[n]) { need(n); return; } }
  $$('.plate img').forEach(function (img) {
    img.addEventListener('error', function () { var f = img.closest('figure'); if (f) f.hidden = true; });
  });

  /* still pictures, for the page read without the moving scene */
  function fxFor(pl) {
    var fx = {};
    if (pl.release) fx.release = pl.release;
    if (pl.role === 'partners') { var sp = S.SPOTS[state.group]; fx.reticle = [sp[0], sp[1], sp[2], 1]; }
    if (pl.role === 'shelves' && state.topic !== 'all') fx.box = S.SHELVES[state.topic].concat([1]);
    if (pl.role === 'terms') fx.marks = 1;
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
    plates.forEach(function (pl) { if (pl.near && (!role || pl.role === role)) drawStill(pl); });
  }
  if (canPaint && 'IntersectionObserver' in window) {
    var plateIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var pl = plates.filter(function (q) { return q.el === en.target; })[0];
        if (!pl) return;
        pl.near = en.isIntersecting;
        if (pl.near) { need(pl.sheet); drawStill(pl); }
      });
    }, { rootMargin: '900px 0px' });
    plates.forEach(function (pl) { plateIO.observe(pl.el); });
  } else if (canPaint) {
    plates.forEach(function (pl) { pl.near = true; need(pl.sheet); });
  }

  /* --------------------------------------------------------- the scene */

  var stage = null, keys = [], lastProg = -1;
  var tracks = $$('[data-track]').map(function (el) {
    var slip = $('[data-slip]', el), img = $('.track-fig img', el);
    /* when the picture is behind the text and not in the page, its description goes with the text */
    if (img && img.getAttribute('alt')) {
      var p = document.createElement('p');
      p.className = 'sr scene-alt';
      p.textContent = img.getAttribute('alt');
      slip.insertBefore(p, slip.firstChild);
    }
    return {
      el: el, slip: slip, shot: el.getAttribute('data-shot'), to: el.getAttribute('data-shot-to') || el.getAttribute('data-shot'),
      role: el.getAttribute('data-role') || '', side: el.getAttribute('data-side') || 'left',
      cover: slip.classList.contains('slip-cover'), panel: slip.classList.contains('slip-panel')
    };
  });
  function byRole(r) { return tracks.filter(function (t) { return t.role === r; })[0] || null; }
  var tClock = byRole('clock'), tPlan = byRole('plan'), tTerms = byRole('terms'), tPartners = byRole('partners');
  var tShelves = byRole('shelves'), tBrief = byRole('brief'), tEvening = byRole('evening');

  /* Read where every slip sits, then work out the camera's stops from it. */
  function measure() {
    if (!state.filmOn) return;
    var vh = window.innerHeight, y = scrollY();
    state.wide = (getComputedStyle(tracksEl).getPropertyValue('--film-layout') || '').trim() === 'split';
    var hr = stageHost.getBoundingClientRect(), host = { w: hr.width, h: hr.height }, headH = hr.top;
    doc.classList.add('measuring');      /* slips are laid out in place, so their natural positions can be read */
    tracks.forEach(function (t) {
      t.slip.classList.remove('is-tall');
      var r = t.el.getBoundingClientRect(), sr = t.slip.getBoundingClientRect();
      t.top = r.top + y; t.height = r.height; t.padB = parseFloat(getComputedStyle(t.el).paddingBottom) || 0;
      t.slipTop = sr.top + y; t.h = sr.height; t.left = sr.left; t.right = sr.right;
    });
    doc.classList.remove('measuring');

    var zoom = state.wide ? 1.5 : 1.9;
    keys = [];
    tracks.forEach(function (t, n) {
      var stick = t.cover ? (state.wide ? headH : vh - t.h) : vh - t.h - (state.wide ? vh * 0.09 : 14);
      t.sticky = !t.panel && stick >= headH - 1;
      var focus;
      if (t.sticky) {
        t.slip.style.setProperty('--slip-top', Math.round(stick) + 'px');
        t.a = t.slipTop - stick;
        t.b = Math.max(t.a, t.top + t.height - t.padB - t.h - stick);
      } else {
        if (!t.panel) t.slip.classList.add('is-tall');
        t.a = t.slipTop - vh * 0.62;
        t.b = Math.max(t.a + 1, t.slipTop + t.h - vh * 0.42);
      }
      if (n === 0) t.a = Math.min(0, t.b);
      if (state.wide) focus = t.side === 'right' ? [0, 0, clamp((t.left - 26) / host.w, 0.3, 1), 1] : [clamp((t.right + 26) / host.w, 0, 0.7), 0, 1, 1];
      else focus = t.sticky ? [0, 0, 1, clamp((stick - headH - 10) / host.h, 0.32, 1)] : [0, 0, 1, 0.6];
      t.focus = focus;
      t.A = S.frameCam(S.FRAMES[t.shot], host, { focus: focus, tall: !state.wide, maxZoom: zoom });
      t.B = S.frameCam(S.FRAMES[t.to], host, { focus: focus, tall: !state.wide, maxZoom: zoom });
      keys.push([t.a, t.A], [t.b, t.B]);
    });
    for (var i = 1; i < keys.length; i++) if (keys[i][0] < keys[i - 1][0]) keys[i][0] = keys[i - 1][0];
    state.host = host;
    state.ramp = vh * 0.34;
  }
  function camAt(s) {
    var k = keys;
    if (s <= k[0][0]) return k[0][1];
    for (var i = 0; i < k.length - 1; i++) {
      if (s < k[i + 1][0]) return S.mixCam(k[i][1], k[i + 1][1], smooth((s - k[i][0]) / Math.max(1, k[i + 1][0] - k[i][0])));
    }
    return k[k.length - 1][1];
  }
  /* 1 while a track's text is being read, falling to 0 as the camera leaves */
  function near(t, s) {
    if (!t) return 0;
    if (s < t.a) return 1 - clamp((t.a - s) / state.ramp, 0, 1);
    if (s > t.b) return 1 - clamp((s - t.b) / state.ramp, 0, 1);
    return 1;
  }

  /* The cover headline is set like a broadside: each line is fitted to the full measure. */
  var poster = $('.poster'), coverText = $('.cover-text'), coverSlip = $('.slip-cover');
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
      var k = 1, guard = 0, wide = (getComputedStyle(tracksEl).getPropertyValue('--film-layout') || '').trim() === 'split';
      var fits = function () { return wide ? coverText.scrollHeight <= coverSlip.clientHeight - 30 : coverSlip.offsetHeight <= window.innerHeight * 0.6; };
      while (!fits() && k > 0.5 && guard++ < 12) { k -= 0.05; apply(k); }
    }
  }

  var toggle = $('[data-film-toggle]');
  function setFilm(on) {
    on = !!on && canPaint && !!stageHost;
    /* stay with whatever text is in the middle of the window */
    var mid = window.innerHeight / 2, keep = null, best = 1e9, atTop = scrollY() < 8;
    tracks.forEach(function (t) {
      var r = t.slip.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (r.height && d < best) { best = d; keep = t; }
    });
    state.filmOn = on;
    doc.classList.toggle('film-on', on);
    if (toggle) { toggle.textContent = on ? 'Still page' : 'Play the scene'; toggle.setAttribute('aria-pressed', on ? 'false' : 'true'); }
    if (on) {
      if (!stage) stage = new S.Stage({ onChange: requestTick });
      stage.attach(stageHost);
      need('vision');
      fitPoster(); measure(); fitPoster(); measure();
      state.cam = null;
    } else {
      if (stage) stage.attach(null);
      stageHost.classList.remove('is-live');
      tracks.forEach(function (t) { t.slip.style.removeProperty('--slip-top'); t.slip.classList.remove('is-tall'); });
      fitPoster();
      drawStills();
    }
    if (!atTop && keep) {
      var was = doc.style.scrollBehavior;
      doc.style.scrollBehavior = 'auto';
      keep.slip.scrollIntoView({ block: 'center' });
      doc.style.scrollBehavior = was;
    }
    requestTick();
  }
  if (toggle) toggle.addEventListener('click', function () { setFilm(!state.filmOn); });

  /* ------------------------------------------- the stage, frame by frame */

  function motion() { return state.filmOn && !state.locked ? 1 : 0; }

  function renderScene() {
    if (!stage || !keys.length || !S.has('vision')) return;
    var s = scrollY(), host = state.host, mo = motion();
    var frozen = state.locked && state.cam && near(tBrief, s) > 0.5;      /* nothing moves while someone is writing */
    var target = camAt(s);
    if (tPartners) {
      var kp = near(tPartners, s);
      var to = S.SPOTS[state.group], g = state.ring || (state.ring = to.slice()), e = mo ? 0.16 : 1;
      g[0] += (to[0] - g[0]) * e; g[1] += (to[1] - g[1]) * e; g[2] += (to[2] - g[2]) * e;
      state.zoom += (state.zoomTo - state.zoom) * e;
      if (kp > 0.01 && state.zoom > 0.01) target = S.clampCam(S.aimCam(target, g, 1.3, host, tPartners.focus, state.zoom * kp), host, 'table');
    }
    var cam = target;
    if (frozen) cam = state.cam;
    else if (state.cam && mo) {
      /* follow the target a little behind it, so nothing ever jumps */
      var f = 0.24, c = state.cam;
      cam = { cx: c.cx + (target.cx - c.cx) * f, cy: c.cy + (target.cy - c.cy) * f, s: c.s + (target.s - c.s) * f };
      if (Math.abs(cam.cx - target.cx) < 0.05 && Math.abs(cam.cy - target.cy) < 0.05) cam = target;
    }
    state.cam = cam;

    var fx = { time: state.time, motion: frozen ? 0 : mo, dust: frozen ? 0 : mo, glow: [S.LANTERN[0], S.LANTERN[1], 0.8 + 0.2 * Math.sin(state.time * 2.3) * (frozen ? 0 : mo)] };
    if (tClock && tPlan) fx.release = clamp((s - tClock.a) / Math.max(1, tPlan.a - tClock.a), 0, 1) * 1.32;
    if (tTerms) fx.marks = near(tTerms, s);
    if (tPartners && state.ring) fx.reticle = [state.ring[0], state.ring[1], state.ring[2], near(tPartners, s)];
    if (tShelves) {
      var want = state.topic === 'all' ? 0 : 1;
      if (want) state.box = S.SHELVES[state.topic];
      state.topicA += (want - state.topicA) * (mo ? 0.2 : 1);
      if (state.box && state.topicA > 0.01) fx.box = state.box.concat([state.topicA * near(tShelves, s)]);
    }
    if (tEvening && mo && !frozen) { var ke = near(tEvening, s); if (ke > 0.02) fx.drift = [S.SHEETS.veranda.x + 1080, 250, 0.9 * ke]; }

    var px = state.slip * 4.2 / cam.s;
    stage.render(cam, fx, [px, -px * 0.62]);
    if (!stageHost.classList.contains('is-live')) stageHost.classList.add('is-live');
  }

  /* the headings slip out of register with the scene */
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

  var progressEl = $('[data-progress]');
  function tick(now) {
    state.raf = 0;
    var dt = state.lastT ? Math.min(64, now - state.lastT) : 16;
    state.lastT = now;
    var y = scrollY(), moved = y !== state.lastY, vel = Math.abs(y - state.lastY) / dt;
    state.lastY = y;
    var mo = motion();
    if (mo) state.time += dt / 1000;
    var target = mo ? clamp(vel / 3, 0, 1) : 0;
    state.slip += (target - state.slip) * (target > state.slip ? 0.3 : 0.12);
    if (state.slip < 0.004) state.slip = 0;
    printSlip(state.slip);
    if (state.filmOn) {
      /* when nothing but the background's own slow movement is happening, draw every other frame */
      state.frame++;
      if (moved || state.slip > 0 || state.frame % 2 === 0) renderScene();
      if (progressEl) {
        var prog = Math.round(clamp(y / Math.max(1, doc.scrollHeight - window.innerHeight), 0, 1) * 1000) / 1000;
        if (prog !== lastProg) { progressEl.style.setProperty('--prog', String(prog)); lastProg = prog; }
      }
    }
    if (mo || state.slip > 0) requestTick(); else state.lastT = 0;
  }
  function requestTick() { if (!state.raf) state.raf = window.requestAnimationFrame(tick); }

  window.addEventListener('scroll', requestTick, { passive: true });
  var resizeTimer = 0, remeasureTimer = 0;
  function relayout() {
    if (state.filmOn) { fitPoster(); measure(); if (stage) stage.measure(); }
    else { fitPoster(); drawStills(); }
    requestTick();
  }
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(relayout, 140); });
  /* text that opens, closes or filters changes where later slips sit: read the page again, quietly */
  function remeasure() {
    clearTimeout(remeasureTimer);
    remeasureTimer = setTimeout(function () { if (state.filmOn) { measure(); requestTick(); } }, 80);
  }
  document.addEventListener('toggle', remeasure, true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { state.lastT = 0; requestTick(); } });

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
      if (state.filmOn) { remeasure(); requestTick(); } else drawStills('partners');
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
      if (state.filmOn) { remeasure(); requestTick(); } else drawStills('shelves');
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
    function say(t) { status.textContent = ''; setTimeout(function () { status.textContent = t; remeasure(); }, 30); }
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
      var name = 'dandelion-collaboration-brief-' + stamp + '.txt';
      /* Some viewers that embed a page do not allow ordinary downloads and offer their own
         save dialog instead. A host page may supply one as window.DFHost.saveFile(name, text),
         returning a promise. It is optional; without it the browser's own download is used. */
      var host = window.DFHost && typeof window.DFHost.saveFile === 'function' ? window.DFHost.saveFile : null;
      if (host) {
        Promise.resolve().then(function () { return host(name, t); }).then(function () {
          say('Download started.');
        }, function (err) {
          if (err && err.code === 'declined') { say('Download cancelled.'); return; }
          showManual(t);
          say('The file could not be saved here. The brief is shown below: select it and copy it.');
        });
        return;
      }
      try {
        var url = URL.createObjectURL(new Blob([t], { type: 'text/plain;charset=utf-8' }));
        var a = document.createElement('a');
        a.href = url; a.download = name;
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
    /* the scene needs a window it can sit behind: not a tiny one, and not a frame as tall as the whole page */
    var roomy = window.innerHeight >= 520 && window.innerHeight <= 2600 && window.innerWidth >= 300;
    setFilm(!reduce.matches && roomy);
    if (!state.filmOn) { fitPoster(); need('vision'); }
    /* the headline is fitted to the measure, so fit it again whenever a typeface arrives */
    function refit() { relayout(); }
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

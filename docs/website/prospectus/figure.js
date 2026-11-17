/*!
 * Dandelion Foundation prospectus: the printed figures.
 *
 * Original artwork drawn in code: one printed sheet showing a dandelion above
 * a coast, its root below ground, and an inset plan. Small crops of it are
 * used as the numbered figures beside the text. It is symbolic. It is not
 * impact data and it does not document any place, person or delivery.
 *
 * How it is printed: four tone maps (gold, cobalt, red ochre, key) are drawn
 * once at low resolution, then screened into halftone dots by a small WebGL
 * shader, each ink at its own screen angle and slightly out of register. Key
 * line work is stroked as vectors so it stays sharp at any size. Without
 * WebGL the same tone maps print as flat lithographic tints.
 *
 * No dependencies. Exposes window.DFFigure.
 */
(function (root) {
  'use strict';

  const W = 2000, H = 2800;        // plate size, in plate units
  const GROUND = 1800, HZ = 1490;  // soil surface and sea horizon
  const TS = 0.4;                  // tone-map pixels per plate unit
  const CELL = 11;                 // halftone cell, in plate units
  const TAU = Math.PI * 2;
  const HEAD = { x: 860, y: 740, r: 300 };
  const BASE = { x: 800, y: GROUND };
  const INSET = { x: 1190, y: 2070, w: 730, h: 540 };

  /* Framings of the sheet, in plate units: [x, y, width, height]. */
  const FRAMES = {
    sheet: [-110, -110, W + 220, H + 220],
    root: [520, 1790, 600, 600],
    scape: [560, 1040, 600, 600],
    clock: [520, 400, 680, 680],
    plan: [1165, 2045, 780, 590]
  };

  /* Ink sets. Each ink is a multiplicative filter over the paper. */
  const INKS = {
    day: {
      paper: [0.980, 0.976, 0.965],
      y: [0.848, 0.623, 0.215],   // burnished gold
      b: [0.231, 0.455, 0.722],   // cobalt
      r: [0.706, 0.325, 0.165],   // red ochre
      k: [0.070, 0.062, 0.055]    // key
    },
    dusk: {
      paper: [0.980, 0.976, 0.965],
      y: [0.870, 0.560, 0.300],   // amber
      b: [0.200, 0.215, 0.470],   // indigo
      r: [0.720, 0.330, 0.470],   // rose
      k: [0.070, 0.062, 0.055]
    }
  };

  /* ---------------------------------------------------------------- utils */

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function noise1(seed) {
    const r = mulberry(seed), v = [];
    for (let i = 0; i < 256; i++) v.push(r());
    return function (x) {
      const i = Math.floor(x); let f = x - i;
      const a = v[i & 255], b = v[(i + 1) & 255];
      f = f * f * (3 - 2 * f);
      return a + (b - a) * f;
    };
  }
  function gray(t) { const g = Math.round(clamp(t, 0, 1) * 255); return 'rgb(' + g + ',' + g + ',' + g + ')'; }
  function css(c, a) {
    return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a === undefined ? 1 : a) + ')';
  }
  function rectPath(x, y, w, h) { const p = new Path2D(); p.rect(x, y, w, h); return p; }
  function polyPath(pts, close) {
    const p = new Path2D();
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    if (close) p.closePath();
    return p;
  }
  function addSmooth(path, pts) {
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      path.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    }
    const l = pts[pts.length - 1];
    path.lineTo(l[0], l[1]);
  }
  function ellipsePath(x, y, rx, ry, rot) {
    const p = new Path2D();
    p.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
    return p;
  }
  function cubic(P0, P1, P2, P3, t) {
    const m = 1 - t;
    return [
      m * m * m * P0[0] + 3 * m * m * t * P1[0] + 3 * m * t * t * P2[0] + t * t * t * P3[0],
      m * m * m * P0[1] + 3 * m * m * t * P1[1] + 3 * m * t * t * P2[1] + t * t * t * P3[1]
    ];
  }
  function cubicTan(P0, P1, P2, P3, t) {
    const m = 1 - t;
    return [
      3 * m * m * (P1[0] - P0[0]) + 6 * m * t * (P2[0] - P1[0]) + 3 * t * t * (P3[0] - P2[0]),
      3 * m * m * (P1[1] - P0[1]) + 6 * m * t * (P2[1] - P1[1]) + 3 * t * t * (P3[1] - P2[1])
    ];
  }

  /* ------------------------------------------------------------ tone maps */

  function Tones() {
    const w = Math.round(W * TS), h = Math.round(H * TS);
    this.w = w; this.h = h; this.ctx = {}; this.cv = {};
    ['y', 'b', 'r', 'k'].forEach((ch) => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const x = cv.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
      x.setTransform(TS, 0, 0, TS, 0, 0);
      this.ctx[ch] = x; this.cv[ch] = cv;
    });
  }
  /* mode 'set' replaces the tone, 'add' prints more ink, 'sub' removes a share of it */
  Tones.prototype.paint = function (path, tones, mode) {
    for (const ch in tones) {
      const x = this.ctx[ch], t = tones[ch];
      x.globalAlpha = 1;
      x.globalCompositeOperation = mode === 'add' ? 'lighter' : 'source-over';
      x.fillStyle = mode === 'sub' ? 'rgba(0,0,0,' + clamp(t, 0, 1) + ')' : gray(t);
      x.fill(path);
    }
  };
  Tones.prototype.gradient = function (ch, mode, g, stops, path) {
    const x = this.ctx[ch];
    const gr = g[0] === 'lin' ? x.createLinearGradient(g[1], g[2], g[3], g[4]) : x.createRadialGradient(g[1], g[2], g[3], g[1], g[2], g[4]);
    stops.forEach((s) => { gr.addColorStop(s[0], mode === 'sub' ? 'rgba(0,0,0,' + clamp(s[1], 0, 1) + ')' : gray(s[1])); });
    x.globalAlpha = 1;
    x.globalCompositeOperation = mode === 'add' ? 'lighter' : 'source-over';
    x.fillStyle = gr; x.fill(path);
  };
  /* a soft elliptical patch, strongest at its centre */
  Tones.prototype.blob = function (ch, mode, cx, cy, rx, ry, t) {
    const x = this.ctx[ch];
    x.save();
    x.translate(cx, cy); x.scale(1, ry / rx);
    const gr = x.createRadialGradient(0, 0, 0, 0, 0, rx);
    if (mode === 'sub') { gr.addColorStop(0, 'rgba(0,0,0,' + t + ')'); gr.addColorStop(0.55, 'rgba(0,0,0,' + t * 0.6 + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); }
    else { gr.addColorStop(0, gray(t)); gr.addColorStop(0.55, gray(t * 0.6)); gr.addColorStop(1, gray(0)); }
    x.globalAlpha = 1;
    x.globalCompositeOperation = mode === 'add' ? 'lighter' : 'source-over';
    x.fillStyle = gr; x.fillRect(-rx, -rx, rx * 2, rx * 2);
    x.restore();
  };
  Tones.prototype.pixels = function () {
    const n = this.w * this.h, out = new Uint8Array(n * 4);
    ['y', 'b', 'r', 'k'].forEach((ch, c) => {
      const x = this.ctx[ch];
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
      const d = x.getImageData(0, 0, this.w, this.h).data;
      x.restore();
      for (let i = 0; i < n; i++) out[i * 4 + c] = d[i * 4];
    });
    return out;
  };

  /* ------------------------------------------------------- key line work */

  const STY = {
    hairlite: { w: 0.75, a: 0.34 },
    hair: { w: 0.9, a: 0.62 },
    fine: { w: 1.5, a: 0.88 },
    med: { w: 2.4, a: 1 },
    bold: { w: 4.4, a: 1 }
  };
  const BUCKET = {
    sky: [-140, -140, W + 280, GROUND + 180],
    soil: [-60, GROUND - 100, W + 120, H - GROUND + 160],
    inset: [INSET.x - 30, INSET.y - 30, INSET.w + 60, INSET.h + 60],
    frame: null
  };
  /* An ordered list of drawing operations. A "knock" erases whatever key
     lines lie behind a shape, so nearer leaves hide farther ones. */
  function Ink() { this.ops = []; this.open = {}; }
  Ink.prototype.stroke = function (bucket, style) {
    const k = bucket + '|' + style; let o = this.open[k];
    if (!o) { o = { t: 's', bucket: bucket, style: style, path: new Path2D() }; this.ops.push(o); this.open[k] = o; }
    return o.path;
  };
  Ink.prototype.fill = function (bucket, alpha) {
    const k = bucket + '|f' + alpha; let o = this.open[k];
    if (!o) { o = { t: 'f', bucket: bucket, alpha: alpha, path: new Path2D() }; this.ops.push(o); this.open[k] = o; }
    return o.path;
  };
  Ink.prototype.knock = function (bucket, path) {
    this.ops.push({ t: 'k', bucket: bucket, path: path });
    for (const k in this.open) if (k.indexOf(bucket + '|') === 0) delete this.open[k];
  };

  /* --------------------------------------------------------- the artwork */

  function buildWorld() {
    const T = new Tones(), ink = new Ink();
    const R = mulberry(71117), n1 = noise1(9), n2 = noise1(23), n3 = noise1(51);
    const hit = document.createElement('canvas').getContext('2d');
    const occl = new Path2D();
    let i, x, y;

    /* ---- sky: cobalt above, warm low light from the west (left) */
    const sky = rectPath(0, 0, W, HZ + 4);
    T.gradient('b', 'set', ['lin', 0, 0, 0, HZ], [[0, 0.56], [0.45, 0.38], [1, 0.13]], sky);
    T.gradient('y', 'add', ['rad', 200, HZ - 20, 0, 1080], [[0, 0.36], [0.55, 0.13], [1, 0]], sky);
    T.gradient('r', 'add', ['lin', 0, HZ - 330, 0, HZ], [[0, 0], [1, 0.15]], sky);
    [[380, 290, 540, 96], [1420, 200, 660, 116], [1680, 540, 430, 74], [230, 760, 380, 62], [1300, 1010, 540, 66], [600, 1210, 430, 50], [1740, 1250, 390, 46]].forEach((c) => {
      const n = 6 + Math.floor(R() * 4);
      for (let j = 0; j < n; j++) {
        const t = j / (n - 1);
        const ex = c[0] + (t - 0.5) * c[2] + (R() - 0.5) * 50;
        const ey = c[1] - Math.sin(t * Math.PI) * c[3] * 0.4 + (R() - 0.5) * c[3] * 0.3;
        const rx = c[2] * (0.17 + R() * 0.12), ry = c[3] * (0.5 + R() * 0.35);
        T.blob('b', 'sub', ex, ey, rx, ry, 0.74);
        T.blob('y', 'add', ex, ey + ry * 0.35, rx * 0.9, ry * 0.7, 0.06);
      }
      const p = ink.stroke('sky', 'hairlite');
      for (let j = 0; j < 4; j++) {
        const yy = c[1] + c[3] * (0.3 + j * 0.17);
        const x0 = c[0] - c[2] * (0.4 - j * 0.07), x1 = c[0] + c[2] * (0.36 - j * 0.09);
        p.moveTo(x0, yy); p.quadraticCurveTo((x0 + x1) / 2, yy + 7, x1, yy - 2);
      }
    });

    /* ---- far hills on the left */
    function ridge(x0, x1, amp, nz, f) {
      const pts = [];
      for (let xx = x0; xx <= x1; xx += 20) {
        const u = (xx - x0) / (x1 - x0);
        pts.push([xx, HZ - amp * Math.sin(Math.PI * Math.pow(u, 0.72)) * (0.5 + 0.5 * nz(xx * f))]);
      }
      return pts;
    }
    const r1 = ridge(-20, 1160, 170, n1, 0.0055), r2 = ridge(-20, 800, 96, n2, 0.011);
    T.paint(polyPath(r1.concat([[1160, HZ + 4], [-20, HZ + 4]]), true), { b: 0.34, k: 0.04, y: 0.07, r: 0.05 });
    T.paint(polyPath(r2.concat([[800, HZ + 4], [-20, HZ + 4]]), true), { b: 0.42, k: 0.12, y: 0.2, r: 0.04 });
    addSmooth(ink.stroke('sky', 'hair'), r1);
    addSmooth(ink.stroke('sky', 'hair'), r2);
    (function () {
      const p = ink.stroke('sky', 'hairlite');
      r2.forEach((pt, j) => {
        if (j % 2 || pt[1] > HZ - 12) return;
        const len = (HZ - pt[1]) * 0.7;
        p.moveTo(pt[0] + 4, pt[1] + 6); p.lineTo(pt[0] + 4 + len * 0.35, pt[1] + 6 + len);
      });
    })();

    /* ---- the bay */
    function coastY(xx) {
      const u = clamp((xx - 700) / 1300, 0, 1);
      return HZ + 178 * Math.pow(u, 1.55) + (n3(xx * 0.02) - 0.5) * 14 * u;
    }
    const cpts = [];
    for (x = W; x >= 700; x -= 20) cpts.push([x, coastY(x)]);
    const sea = polyPath([[700, HZ], [W, HZ]].concat(cpts), true);
    T.paint(sea, { y: 0.03, r: 0.02, k: 0 });
    T.gradient('b', 'set', ['lin', 0, HZ, 0, HZ + 185], [[0, 0.5], [1, 0.76]], sea);
    T.gradient('k', 'add', ['lin', 0, HZ, 0, HZ + 185], [[0, 0.02], [1, 0.12]], sea);
    for (i = 0; i < 30; i++) {
      const gx = 770 + R() * 1200, gy = HZ + 8 + R() * 150;
      if (gy < coastY(gx) - 8) T.blob('b', 'sub', gx, gy, 30 + R() * 64, 2.6 + R() * 2.4, 0.62);
    }
    (function () {
      const hl = ink.stroke('sky', 'fine'); hl.moveTo(700, HZ); hl.lineTo(W, HZ);
      const wv = ink.stroke('sky', 'hairlite');
      for (let j = 0; j < 46; j++) {
        const wx = 760 + R() * 1200, wy = HZ + 10 + R() * 150, wl = 14 + R() * 30;
        if (wy < coastY(wx + wl / 2) - 6) { wv.moveTo(wx, wy); wv.lineTo(wx + wl, wy); }
      }
    })();

    /* ---- the land, from the shore to the foreground */
    const land = polyPath([[0, HZ], [700, HZ]].concat(cpts.slice().reverse()).concat([[W, GROUND + 4], [0, GROUND + 4]]), true);
    T.paint(land, { y: 0.44, r: 0.2, b: 0.06, k: 0.01 });
    T.gradient('r', 'add', ['lin', 0, HZ, 0, GROUND], [[0, 0], [1, 0.15]], land);
    T.gradient('k', 'add', ['lin', 0, HZ + 140, 0, GROUND], [[0, 0], [1, 0.07]], land);
    for (i = 0; i < 34; i++) {
      x = R() * W; y = HZ + 22 + R() * (GROUND - HZ - 34);
      if (x < 700 || y > coastY(x) + 22) {
        const rx = 70 + R() * 170, ry = 9 + R() * 20;
        T.blob('b', 'add', x, y, rx, ry, 0.24);
        T.blob('y', 'add', x, y, rx, ry, 0.12);
      }
    }
    (function () {
      const cl = ink.stroke('sky', 'fine');
      addSmooth(cl, cpts.slice().reverse());
      const fl = ink.stroke('sky', 'hairlite');
      for (let j = 0; j < 60; j++) {
        const fx = R() * W, fy = HZ + 26 + R() * (GROUND - HZ - 50), flen = 30 + R() * 90;
        if (fx < 700 || fy > coastY(fx) + 26) { fl.moveTo(fx, fy); fl.lineTo(fx + flen, fy + (R() - 0.5) * 3); }
      }
    })();

    /* ---- a few distant flat-roofed houses */
    [[232, 1588, 92, 44], [342, 1580, 70, 52], [430, 1594, 112, 40]].forEach((b) => {
      const p = rectPath(b[0], b[1] - b[3], b[2], b[3]);
      T.paint(p, { y: 0.2, r: 0.09, b: 0, k: 0 });
      T.paint(rectPath(b[0] + b[2] * 0.62, b[1] - b[3], b[2] * 0.38, b[3]), { k: 0.13, r: 0.17 });
      ink.knock('sky', p);
      const s = ink.stroke('sky', 'fine');
      s.rect(b[0], b[1] - b[3], b[2], b[3]);
      s.moveTo(b[0] - 5, b[1] - b[3]); s.lineTo(b[0] + b[2] + 5, b[1] - b[3]);
      const f = ink.fill('sky', 0.82);
      f.rect(b[0] + b[2] * 0.2, b[1] - b[3] * 0.56, 9, b[3] * 0.56);
      f.rect(b[0] + b[2] * 0.52, b[1] - b[3] * 0.72, 8, 8);
    });

    /* ---- palms along the shore */
    function palm(px, py, h, lean) {
      const tx = px + lean, ty = py - h;
      const s = ink.stroke('sky', 'med');
      s.moveTo(px, py); s.quadraticCurveTo(px + lean * 0.15, py - h * 0.55, tx, ty);
      const fr = ink.stroke('sky', 'fine'), hr = ink.stroke('sky', 'hair');
      const n = 9;
      for (let j = 0; j < n; j++) {
        const a = -Math.PI * (0.03 + 0.94 * j / (n - 1)) + (R() - 0.5) * 0.22;
        const L = h * (0.4 + R() * 0.16);
        const ex = tx + Math.cos(a) * L, ey = ty + Math.sin(a) * L * 0.7 + L * 0.46;
        const cx = tx + Math.cos(a) * L * 0.55, cy = ty + Math.sin(a) * L * 0.9 - L * 0.1;
        fr.moveTo(tx, ty); fr.quadraticCurveTo(cx, cy, ex, ey);
        for (let k = 1; k <= 6; k++) {
          const t = k / 7, m = 1 - t;
          const qx = m * m * tx + 2 * m * t * cx + t * t * ex, qy = m * m * ty + 2 * m * t * cy + t * t * ey;
          hr.moveTo(qx, qy); hr.lineTo(qx + (R() - 0.5) * 6, qy + L * 0.15);
        }
      }
      T.blob('b', 'add', tx, ty + h * 0.1, h * 0.38, h * 0.24, 0.32);
      T.blob('y', 'add', tx, ty + h * 0.1, h * 0.38, h * 0.24, 0.3);
      T.blob('k', 'add', tx, ty + h * 0.12, h * 0.24, h * 0.14, 0.12);
    }
    [[1010, 132, -10], [1118, 170, 14], [1236, 124, -6], [1432, 150, 12], [1604, 186, -14], [1700, 140, 8], [1884, 196, 16]].forEach((q) => {
      palm(q[0], coastY(q[0]) + 16, q[1], q[2]);
    });

    /* ---- two dhows on the horizon */
    function dhow(dx, dy, sc) {
      const sail = polyPath([[dx - 4 * sc, dy - 6 * sc], [dx + 46 * sc, dy - 78 * sc], [dx + 30 * sc, dy - 6 * sc]], true);
      T.paint(sail, { b: 0, y: 0.02, r: 0, k: 0 });
      ink.knock('sky', sail);
      const ds = ink.stroke('sky', 'fine');
      ds.addPath(sail);
      ds.moveTo(dx + 12 * sc, dy - 4 * sc); ds.lineTo(dx + 17 * sc, dy - 52 * sc);
      const hull = ink.fill('sky', 0.9);
      hull.moveTo(dx - 24 * sc, dy - 7 * sc);
      hull.quadraticCurveTo(dx + 8 * sc, dy + 10 * sc, dx + 48 * sc, dy - 9 * sc);
      hull.lineTo(dx + 38 * sc, dy + 2 * sc);
      hull.quadraticCurveTo(dx + 6 * sc, dy + 9 * sc, dx - 15 * sc, dy + 1 * sc);
      hull.closePath();
    }
    dhow(1520, HZ + 4, 1);
    dhow(1806, HZ + 2, 0.56);

    /* ---- soil, in three strata */
    function b1(xx) { return GROUND + 150 + (n1(xx * 0.004 + 7) - 0.5) * 70; }
    function b2(xx) { return GROUND + 570 + (n2(xx * 0.003 + 3) - 0.5) * 130; }
    function band(fa, fb) {
      const top = [], bot = [];
      for (let xx = 0; xx <= W; xx += 25) { top.push([xx, fa(xx)]); bot.push([xx, fb(xx)]); }
      return polyPath(top.concat(bot.reverse()), true);
    }
    const flatG = () => GROUND, flatH = () => H;
    T.paint(band(flatG, b1), { y: 0.56, r: 0.46, k: 0.36, b: 0.07 });
    T.paint(band(b1, b2), { y: 0.55, r: 0.6, k: 0.07, b: 0 });
    T.paint(band(b2, flatH), { y: 0.4, r: 0.4, k: 0.2, b: 0.15 });
    T.gradient('k', 'add', ['lin', 0, GROUND, 0, H], [[0, 0], [1, 0.14]], rectPath(0, GROUND, W, H - GROUND));
    (function () {
      const sl = ink.stroke('soil', 'hair'), p1 = [], p2 = [];
      for (let xx = 0; xx <= W; xx += 25) { p1.push([xx, b1(xx)]); p2.push([xx, b2(xx)]); }
      addSmooth(sl, p1); addSmooth(sl, p2);
    })();

    /* ---- the inset plan: knocked out of the soil, then drawn as a map */
    const insetPath = rectPath(INSET.x, INSET.y, INSET.w, INSET.h);
    occl.addPath(rectPath(INSET.x - 14, INSET.y - 14, INSET.w + 28, INSET.h + 28));
    T.paint(insetPath, { y: 0, b: 0, r: 0, k: 0 });
    const M = { x: INSET.x + 34, y: INSET.y + 34, w: INSET.w - 68, h: INSET.h - 68 };
    const mapRect = rectPath(M.x, M.y, M.w, M.h);
    T.paint(mapRect, { y: 0.3, r: 0.11, b: 0.02, k: 0 });
    function shoreX(yy) {
      const v = (yy - M.y) / M.h;
      return M.x + M.w * (0.6 + 0.09 * Math.sin(v * 5.2 + 0.6) - 0.05 * Math.sin(v * 11) + 0.1 * v);
    }
    const shore = [];
    for (y = M.y; y <= M.y + M.h + 0.5; y += 12) shore.push([shoreX(y), y]);
    const mapSea = polyPath(shore.concat([[M.x + M.w, M.y + M.h], [M.x + M.w, M.y]]), true);
    T.paint(mapSea, { y: 0.03, r: 0, b: 0.4, k: 0 });
    T.gradient('b', 'add', ['lin', M.x + M.w * 0.6, 0, M.x + M.w, 0], [[0, 0], [1, 0.16]], mapSea);
    const island = ellipsePath(M.x + M.w * 0.86, M.y + M.h * 0.6, 26, 15, -0.5);
    T.paint(island, { y: 0.3, r: 0.11, b: 0.02 });
    const MARK = [
      [M.x + M.w * 0.16, M.y + M.h * 0.3],
      [M.x + M.w * 0.38, M.y + M.h * 0.6],
      [shoreX(M.y + M.h * 0.4) - 20, M.y + M.h * 0.4]
    ];
    (function () {
      ink.knock('inset', insetPath);
      const hl = ink.stroke('inset', 'hairlite');
      for (let gx = M.x + 91; gx < M.x + M.w - 4; gx += 91) { hl.moveTo(gx, M.y); hl.lineTo(gx, M.y + M.h); }
      for (let gy = M.y + 91; gy < M.y + M.h - 4; gy += 91) { hl.moveTo(M.x, gy); hl.lineTo(M.x + M.w, gy); }
      for (let j = 0; j < 26; j++) {
        const wy = M.y + 14 + R() * (M.h - 28), wx = shoreX(wy) + 16 + R() * (M.x + M.w - shoreX(wy) - 50), wl = 12 + R() * 22;
        if (wx + wl < M.x + M.w - 6) { hl.moveTo(wx, wy); hl.lineTo(wx + wl, wy); }
      }
      const fn = ink.stroke('inset', 'fine');
      addSmooth(fn, shore);
      fn.addPath(island);
      /* contours inland */
      const hr = ink.stroke('inset', 'hair');
      [[0.2, 0.74, 96, 56], [0.2, 0.74, 62, 34], [0.2, 0.74, 30, 15], [0.4, 0.17, 66, 30], [0.4, 0.17, 34, 14]].forEach((c) => {
        const cx = M.x + M.w * c[0], cy = M.y + M.h * c[1];
        for (let k = 0; k <= 40; k++) {
          const a = k / 40 * TAU, rr = 1 + 0.16 * Math.sin(a * 3 + c[2]);
          const qx = cx + Math.cos(a) * c[2] * rr, qy = cy + Math.sin(a) * c[3] * rr;
          if (k === 0) hr.moveTo(qx, qy); else hr.lineTo(qx, qy);
        }
      });
      /* a river down to the shore */
      const rv = [], ry0 = M.y + M.h * 0.9;
      for (let k = 0; k <= 22; k++) {
        const t = k / 22, rx = lerp(M.x + 6, shoreX(M.y + M.h * 0.8), t);
        rv.push([rx, lerp(ry0, M.y + M.h * 0.8, t) + Math.sin(t * 9) * 12 * (1 - t)]);
      }
      addSmooth(ink.stroke('inset', 'fine'), rv);
      /* the route between the three markers, as dashes */
      const med = ink.stroke('inset', 'med');
      for (let s = 0; s < 2; s++) {
        const A = MARK[s], B = MARK[s + 1];
        const C = [(A[0] + B[0]) / 2 + (s ? 26 : -18), (A[1] + B[1]) / 2 + (s ? -44 : 40)];
        for (let k = 1; k < 15; k++) {
          const t0 = k / 16, t1 = t0 + 0.034;
          const q = (t) => [(1 - t) * (1 - t) * A[0] + 2 * (1 - t) * t * C[0] + t * t * B[0], (1 - t) * (1 - t) * A[1] + 2 * (1 - t) * t * C[1] + t * t * B[1]];
          const a = q(t0), b = q(t1);
          med.moveTo(a[0], a[1]); med.lineTo(b[0], b[1]);
        }
      }
      /* markers: one, two and three stones */
      const dots = ink.fill('inset', 1);
      MARK.forEach((m, n) => {
        for (let k = 0; k <= n; k++) {
          const ox = (k - n / 2) * 15, oy = (k % 2) * -7;
          dots.moveTo(m[0] + ox + 7, m[1] + oy); dots.ellipse(m[0] + ox, m[1] + oy, 7, 5.6, 0.3, 0, TAU);
        }
        hr.moveTo(m[0] + 30, m[1] + 2); hr.ellipse(m[0], m[1] - 2, 30, 20, 0, 0, TAU);
      });
      /* compass rose over the sea */
      const cx = M.x + M.w - 62, cy = M.y + 64, cr = 40;
      hr.moveTo(cx + cr, cy); hr.arc(cx, cy, cr, 0, TAU);
      hr.moveTo(cx + cr * 0.62, cy); hr.arc(cx, cy, cr * 0.62, 0, TAU);
      const star = ink.fill('inset', 1), sl = ink.stroke('inset', 'hair');
      for (let k = 0; k < 8; k++) {
        const a = k * TAU / 8 - Math.PI / 2, L = k % 2 ? cr * 0.56 : cr * 1.16, wdt = 0.26;
        const tip = [cx + Math.cos(a) * L, cy + Math.sin(a) * L];
        const l = [cx + Math.cos(a - wdt) * cr * 0.2, cy + Math.sin(a - wdt) * cr * 0.2];
        const r = [cx + Math.cos(a + wdt) * cr * 0.2, cy + Math.sin(a + wdt) * cr * 0.2];
        star.moveTo(cx, cy); star.lineTo(l[0], l[1]); star.lineTo(tip[0], tip[1]); star.closePath();
        sl.moveTo(cx, cy); sl.lineTo(r[0], r[1]); sl.lineTo(tip[0], tip[1]); sl.lineTo(l[0], l[1]);
      }
      /* scale bar: no units, the plan is conceptual */
      const sb = ink.fill('inset', 1), sx = M.x + 18, sy = M.y + M.h - 22;
      for (let k = 0; k < 5; k++) if (k % 2 === 0) sb.rect(sx + k * 26, sy, 26, 6);
      fn.rect(sx, sy, 130, 6);
      /* fold lines of the sheet */
      const fd = ink.stroke('inset', 'hairlite');
      fd.moveTo(M.x + M.w / 3, M.y); fd.lineTo(M.x + M.w / 3, M.y + M.h);
      fd.moveTo(M.x + M.w * 2 / 3, M.y); fd.lineTo(M.x + M.w * 2 / 3, M.y + M.h);
      fd.moveTo(M.x, M.y + M.h / 2); fd.lineTo(M.x + M.w, M.y + M.h / 2);
      med.rect(M.x, M.y, M.w, M.h);
      /* four river stones holding the corners down */
      [[M.x + 4, M.y + 6, 0.4], [M.x + M.w - 6, M.y + M.h - 2, -0.3], [M.x + 2, M.y + M.h - 4, -0.5], [M.x + M.w * 0.52, M.y + 2, 0.15]].forEach((s, n) => {
        const rx = 30 + (n % 2) * 6, ry = 21 + (n % 3) * 3;
        const st = ellipsePath(s[0], s[1], rx, ry, s[2]);
        T.paint(st, { y: 0.1, r: 0.07, b: 0.1, k: 0.1 });
        T.blob('k', 'add', s[0] + rx * 0.3, s[1] + ry * 0.4, rx * 0.8, ry * 0.7, 0.3);
        ink.knock('inset', st);
        ink.stroke('inset', 'med').addPath(st);
        const sh = ink.stroke('inset', 'hair');
        sh.moveTo(s[0] - rx * 0.5, s[1] + ry * 0.2); sh.quadraticCurveTo(s[0], s[1] + ry * 0.62, s[0] + rx * 0.6, s[1] + ry * 0.1);
      });
      const bd = ink.stroke('inset', 'bold'); bd.rect(INSET.x, INSET.y, INSET.w, INSET.h);
      const bd2 = ink.stroke('inset', 'hair'); bd2.rect(INSET.x + 10, INSET.y + 10, INSET.w - 20, INSET.h - 20);
    })();

    /* ---- the taproot */
    const tap = [], tl = [], tr = [];
    for (i = 0; i <= 44; i++) {
      const t = i / 44, ty = GROUND - 6 + t * 880;
      const cx = BASE.x + Math.sin(t * 2.6) * 26 + t * 16 + (n3(t * 6) - 0.5) * 10;
      const hw = lerp(24, 1.4, Math.pow(t, 0.78)) * (1 + (n1(t * 14 + 2) - 0.5) * 0.24);
      tap.push([cx, ty, hw]); tl.push([cx - hw, ty]); tr.push([cx + hw, ty]);
    }
    function tapX(yy) { const t = clamp((yy - GROUND + 6) / 880, 0, 1); return tap[Math.round(t * 44)][0]; }
    const tapPath = polyPath(tl.concat(tr.slice().reverse()), true);
    occl.addPath(tapPath);
    T.paint(tapPath, { y: 0.2, r: 0.1, k: 0.02, b: 0 });
    T.paint(polyPath(tap.map((p) => [p[0] + p[2] * 0.25, p[1]]).concat(tr.slice().reverse()), true), { k: 0.2, r: 0.24 });
    (function () {
      const o = ink.stroke('soil', 'fine');
      addSmooth(o, tl); addSmooth(o, tr);
      const wr = ink.stroke('soil', 'hair');
      tap.forEach((p, j) => {
        if (j % 2 === 0 || j > 36 || j < 2) return;
        wr.moveTo(p[0] - p[2] * 0.8, p[1]); wr.quadraticCurveTo(p[0], p[1] + p[2] * 0.4, p[0] + p[2] * (0.2 + R() * 0.6), p[1] - 1);
      });
    })();

    /* ---- lateral roots */
    function styleFor(w) { return w >= 3.2 ? 'bold' : w >= 1.9 ? 'med' : w >= 1.1 ? 'fine' : 'hair'; }
    function grow(gx, gy, ang, len, w, depth) {
      const pts = [[gx, gy]], steps = Math.max(3, Math.floor(len / 13));
      let a = ang;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        a += (R() - 0.5) * 0.5;
        a += (Math.PI / 2 - a) * 0.035;
        gx += Math.cos(a) * 13; gy += Math.sin(a) * 13;
        if (gx < 30 || gx > W - 30 || gy > H - 30 || gy < GROUND + 14) break;
        if (gx > INSET.x - 30 && gx < INSET.x + INSET.w + 30 && gy > INSET.y - 30 && gy < INSET.y + INSET.h + 30) break;
        pts.push([gx, gy]);
        if (depth < 3 && s > 2 && R() < 0.09 + depth * 0.03) {
          grow(gx, gy, a + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6), len * (0.34 + R() * 0.3) * (1 - t * 0.5), w * (1 - t * 0.8) * 0.62, depth + 1);
        }
      }
      if (pts.length < 3) return;
      const third = Math.ceil(pts.length / 3);
      [1, 0.6, 0.32].forEach((k, n) => {
        const seg = pts.slice(Math.max(0, n * third - 1), Math.min(pts.length, (n + 1) * third + 1));
        if (seg.length > 1) addSmooth(ink.stroke('soil', styleFor(w * k)), seg);
      });
    }
    for (i = 0; i < 13; i++) {
      const t = 0.05 + i * 0.07, side = i % 2 ? 1 : -1;
      const p = tap[Math.round(t * 44)];
      const a0 = 0.22 + t * 0.55 + R() * 0.2;
      grow(p[0] + side * p[2] * 0.9, p[1], side > 0 ? a0 : Math.PI - a0, lerp(540, 150, t) * (0.8 + R() * 0.4), lerp(4.4, 1.6, t), 0);
    }

    /* ---- pebbles */
    for (i = 0; i < 64; i++) {
      x = 40 + R() * (W - 80);
      y = b1(x) + 34 + R() * (H - b1(x) - 80);
      const rx = 12 + R() * 30, ry = rx * (0.55 + R() * 0.3), rot = (R() - 0.5) * 0.9;
      if (Math.abs(x - tapX(y)) < 64 + rx) continue;
      if (x > INSET.x - 60 && x < INSET.x + INSET.w + 60 && y > INSET.y - 50 && y < INSET.y + INSET.h + 50) continue;
      const p = ellipsePath(x, y, rx, ry, rot);
      T.paint(p, { y: 0.13, r: 0.08, k: 0.03, b: 0.04 });
      T.paint(ellipsePath(x + rx * 0.22, y + ry * 0.3, rx * 0.66, ry * 0.56, rot), { k: 0.2, b: 0.1 });
      occl.addPath(p);
      ink.stroke('soil', 'fine').addPath(p);
      const hl = ink.stroke('soil', 'hair');
      hl.moveTo(x - rx * 0.5, y - ry * 0.25); hl.quadraticCurveTo(x - rx * 0.1, y - ry * 0.66, x + rx * 0.34, y - ry * 0.5);
    }

    /* ---- soil hatching, kept clear of roots, stones and the inset */
    (function () {
      const ht = ink.stroke('soil', 'hairlite'), hd = ink.stroke('soil', 'hair');
      for (let j = 0; j < 1500; j++) {
        const hx = R() * W, hy = GROUND + 8 + R() * (H - GROUND - 16), len = 10 + R() * 28;
        if (hit.isPointInPath(occl, hx, hy) || hit.isPointInPath(occl, hx + len, hy)) continue;
        ht.moveTo(hx, hy); ht.lineTo(hx + len, hy + (R() - 0.5) * 4);
      }
      for (let j = 0; j < 520; j++) {
        const hx = R() * W, hy = GROUND + 6 + R() * (b1(hx) - GROUND - 10), len = 8 + R() * 16;
        if (hit.isPointInPath(occl, hx, hy)) continue;
        hd.moveTo(hx, hy); hd.lineTo(hx + len * 0.6, hy + len);
      }
    })();

    /* ---- the ground line and its grass */
    (function () {
      const gl = [];
      for (let xx = 0; xx <= W; xx += 20) gl.push([xx, GROUND + (n2(xx * 0.012) - 0.5) * 9]);
      addSmooth(ink.stroke('sky', 'med'), gl);
      const bl = ink.stroke('sky', 'fine'), bh = ink.stroke('sky', 'hair');
      for (let gx = 16; gx < W; gx += 24 + R() * 30) {
        if (Math.abs(gx - BASE.x) < 70 || R() < 0.18) continue;
        const n = 3 + Math.floor(R() * 4), gh = 26 + R() * 46;
        for (let k = 0; k < n; k++) {
          const bx = gx + (k - n / 2) * 5, lean = (R() - 0.5) * 34, hh = gh * (0.6 + R() * 0.5);
          const pth = k % 2 ? bl : bh;
          pth.moveTo(bx, GROUND + 2); pth.quadraticCurveTo(bx + lean * 0.2, GROUND - hh * 0.6, bx + lean, GROUND - hh);
        }
        T.blob('b', 'add', gx, GROUND - 12, 30, 16, 0.26);
        T.blob('y', 'add', gx, GROUND - 12, 30, 16, 0.2);
      }
    })();

    /* ---- the rosette of toothed leaves */
    function leaf(side, ang, len, width) {
      const P0 = [BASE.x + side * 7, GROUND - 5];
      const dx = side * Math.cos(ang), dy = -Math.sin(ang);
      const P2 = [P0[0] + dx * len, Math.min(GROUND - 8, P0[1] + dy * len + len * 0.24)];
      const P1 = [P0[0] + dx * len * 0.52, P0[1] + dy * len * 0.52 - len * 0.17];
      const lobes = 6 + Math.floor(R() * 2), n = lobes * 6 + 8;
      const L = [], Rr = [], mid = [], ph = R() * 0.3;
      for (let j = 0; j <= n; j++) {
        const t = j / n, m = 1 - t;
        const mx = m * m * P0[0] + 2 * m * t * P1[0] + t * t * P2[0];
        const my = m * m * P0[1] + 2 * m * t * P1[1] + t * t * P2[1];
        const tx = 2 * m * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]), ty = 2 * m * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
        const tlen = Math.hypot(tx, ty) || 1, nx = -ty / tlen, ny = tx / tlen;
        const env = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.82)), 0.72) * (0.5 + 0.5 * t);
        const tooth = (q) => {
          if (t > 0.84) return 1;
          const f = (t * lobes + q) % 1;
          return f < 0.2 ? lerp(0.34, 1, f / 0.2) : lerp(1, 0.34, (f - 0.2) / 0.8);
        };
        const wl = width * env * tooth(ph), wr = width * env * tooth(ph + 0.37);
        mid.push([mx, my]); L.push([mx + nx * wl, my + ny * wl]); Rr.push([mx - nx * wr, my - ny * wr]);
      }
      const outline = polyPath(L.concat(Rr.slice().reverse()), true);
      T.paint(outline, { y: 0.8, b: 0.5, r: 0.04, k: 0.02 });
      T.paint(polyPath(mid.concat((side > 0 ? L : Rr).slice().reverse()), true), { k: 0.13, b: 0.6 });
      ink.knock('sky', outline);
      ink.stroke('sky', 'fine').addPath(outline);
      addSmooth(ink.stroke('sky', 'fine'), mid);
      const v = ink.stroke('sky', 'hair');
      for (let j = 6; j < n - 4; j += 6) {
        v.moveTo(mid[j][0], mid[j][1]); v.lineTo(L[Math.max(0, j - 3)][0], L[Math.max(0, j - 3)][1]);
        v.moveTo(mid[j][0], mid[j][1]); v.lineTo(Rr[Math.max(0, j - 3)][0], Rr[Math.max(0, j - 3)][1]);
      }
    }
    [84, 66, 50, 36, 23, 11].forEach((deg, n) => {
      [-1, 1].forEach((side) => {
        leaf(side, (deg + (R() - 0.5) * 8) * Math.PI / 180, lerp(250, 480, n / 5) * (0.9 + R() * 0.2), lerp(32, 50, n / 5));
      });
    });

    /* ---- the scapes: the tall one to the clock, one to a flower, one to a bud */
    function scape(P0, P1, P2, P3, w0, w1) {
      const L = [], Rr = [], C = [];
      for (let j = 0; j <= 36; j++) {
        const t = j / 36, p = cubic(P0, P1, P2, P3, t), tn = cubicTan(P0, P1, P2, P3, t);
        const l = Math.hypot(tn[0], tn[1]) || 1, nx = -tn[1] / l, ny = tn[0] / l, hw = lerp(w0, w1, t);
        C.push(p); L.push([p[0] + nx * hw, p[1] + ny * hw]); Rr.push([p[0] - nx * hw, p[1] - ny * hw]);
      }
      const path = polyPath(L.concat(Rr.slice().reverse()), true);
      T.paint(path, { y: 0.5, b: 0.22, r: 0.22, k: 0.02 });
      /* shade the side away from the western light */
      const sh = L[0][0] > Rr[0][0] ? L : Rr;
      T.paint(polyPath(C.map((p, j) => [lerp(p[0], sh[j][0], 0.3), lerp(p[1], sh[j][1], 0.3)]).concat(sh.slice().reverse()), true), { k: 0.2, r: 0.3 });
      ink.knock('sky', path);
      const o = ink.stroke('sky', 'fine');
      addSmooth(o, L); addSmooth(o, Rr);
      addSmooth(ink.stroke('sky', 'hairlite'), C.map((p, j) => [lerp(p[0], sh[j][0], 0.45), lerp(p[1], sh[j][1], 0.45)]));
      return C;
    }
    const FLOWER = { x: 540, y: 1342 }, BUD = { x: 1006, y: 1576 };
    scape([BASE.x - 10, GROUND - 6], [760, 1640], [612, 1560], [FLOWER.x + 10, FLOWER.y + 50], 11, 8);
    scape([BASE.x + 14, GROUND - 6], [850, 1700], [962, 1690], [BUD.x - 8, BUD.y + 34], 9, 6.5);
    scape([BASE.x + 3, GROUND - 6], [768, 1500], [906, 1230], [HEAD.x, HEAD.y + 44], 15, 9.5);

    /* ---- the flower: three rings of strap-shaped florets */
    (function () {
      const tilt = -0.26, rx = 114, ry = 66, ct = Math.cos(tilt), st = Math.sin(tilt);
      const at = (u, v) => [FLOWER.x + ct * u * rx - st * v * ry, FLOWER.y + st * u * rx + ct * v * ry];
      const cup = polyPath([at(-0.5, 0.2), at(-0.36, 0.98), at(0.36, 0.98), at(0.5, 0.2)], true);
      T.paint(cup, { y: 0.62, b: 0.46, k: 0.08, r: 0.04 });
      ink.knock('sky', cup);
      ink.stroke('sky', 'fine').addPath(cup);
      const br = ink.stroke('sky', 'hair');
      for (let k = -2; k <= 2; k++) { const a = at(k * 0.16, 0.3), b = at(k * 0.13, 0.95); br.moveTo(a[0], a[1]); br.lineTo(b[0], b[1]); }
      T.blob('y', 'add', FLOWER.x, FLOWER.y, rx * 1.5, ry * 1.6, 0.2);
      [{ n: 46, r0: 0.34, r1: 1, y: 0.94, r: 0.05 }, { n: 34, r0: 0.18, r1: 0.74, y: 1, r: 0.14 }, { n: 22, r0: 0.04, r1: 0.46, y: 1, r: 0.26 }].forEach((ring, q) => {
        const knock = new Path2D(), lines = [];
        for (let k = 0; k < ring.n; k++) {
          const a = k / ring.n * TAU + q * 0.31 + (R() - 0.5) * 0.06, da = Math.PI / ring.n * 0.92;
          const r1 = ring.r1 * (0.9 + R() * 0.14);
          const pts = [
            at(Math.cos(a) * ring.r0, Math.sin(a) * ring.r0),
            at(Math.cos(a - da) * lerp(ring.r0, r1, 0.6), Math.sin(a - da) * lerp(ring.r0, r1, 0.6)),
            at(Math.cos(a - da * 0.7) * r1, Math.sin(a - da * 0.7) * r1),
            at(Math.cos(a + da * 0.7) * r1, Math.sin(a + da * 0.7) * r1),
            at(Math.cos(a + da) * lerp(ring.r0, r1, 0.6), Math.sin(a + da) * lerp(ring.r0, r1, 0.6))
          ];
          const p = polyPath(pts, true);
          T.paint(p, { y: ring.y, r: ring.r, b: 0, k: 0 });
          knock.addPath(p); lines.push(p);
        }
        ink.knock('sky', knock);
        const s = ink.stroke('sky', 'hair');
        lines.forEach((p) => s.addPath(p));
      });
    })();

    /* ---- the bud */
    (function () {
      const bud = ellipsePath(BUD.x, BUD.y, 20, 40, 0.3);
      T.paint(bud, { y: 0.66, b: 0.48, k: 0.06, r: 0.03 });
      T.blob('y', 'add', BUD.x + 12, BUD.y - 34, 12, 12, 0.5);
      ink.knock('sky', bud);
      ink.stroke('sky', 'fine').addPath(bud);
      const s = ink.stroke('sky', 'hair');
      for (let k = -1; k <= 1; k++) { s.moveTo(BUD.x - 10 + k * 8, BUD.y + 34); s.quadraticCurveTo(BUD.x + k * 12, BUD.y, BUD.x + 11 + k * 3, BUD.y - 37); }
    })();

    /* ---- the clock: a sphere of seeds, each on its own parachute */
    T.blob('b', 'sub', HEAD.x, HEAD.y, HEAD.r * 1.12, HEAD.r * 1.12, 0.86);
    T.blob('y', 'add', HEAD.x, HEAD.y, HEAD.r * 1.02, HEAD.r * 1.02, 0.17);
    T.blob('k', 'add', HEAD.x + HEAD.r * 0.2, HEAD.y + HEAD.r * 0.25, HEAD.r * 0.9, HEAD.r * 0.9, 0.05);
    const recept = ellipsePath(HEAD.x, HEAD.y, 30, 28, 0);
    T.paint(recept, { y: 0.5, r: 0.3, k: 0.24, b: 0.05 });
    const N = 170, K = 11, cone = 0.95, seeds = [], flying = [];
    for (i = 0; i < N; i++) {
      const v = 1 - 2 * (i + 0.5) / N, rr = Math.sqrt(1 - v * v), phi = i * 2.399963229728653;
      const d = [rr * Math.cos(phi), -v, rr * Math.sin(phi)];
      if (d[1] > 0.8) continue;
      let u = [d[1], -d[0], 0];
      let ul = Math.hypot(u[0], u[1]);
      if (ul < 0.05) { u = [1, 0, 0]; ul = 1; }
      u = [u[0] / ul, u[1] / ul, 0];
      const vv = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
      const tipR = HEAD.r * (0.68 + R() * 0.05), Lp = HEAD.r * (0.29 + R() * 0.04);
      const tip = [HEAD.x + d[0] * tipR, HEAD.y + d[1] * tipR];
      const fil = [], a0 = R() * TAU;
      for (let k = 0; k < K; k++) {
        const al = a0 + k * TAU / K, ca = Math.cos(al), sa = Math.sin(al), cc = Math.cos(cone), sc = Math.sin(cone);
        fil.push([tip[0] + (d[0] * cc + (u[0] * ca + vv[0] * sa) * sc) * Lp, tip[1] + (d[1] * cc + (u[1] * ca + vv[1] * sa) * sc) * Lp]);
      }
      seeds.push({ d: d, tip: tip, fil: fil, a: [HEAD.x + d[0] * HEAD.r * 0.14, HEAD.y + d[1] * HEAD.r * 0.14], b: [HEAD.x + d[0] * HEAD.r * 0.215, HEAD.y + d[1] * HEAD.r * 0.215] });
    }
    seeds.sort((p, q) => p.d[2] - q.d[2]);
    /* seeds on the upper right, facing the viewer, are the ones that leave */
    const leaving = seeds.filter((s) => s.d[2] > -0.15 && s.d[0] > 0.1 && s.d[1] < 0.42);
    leaving.sort((p, q) => Math.atan2(p.d[1], p.d[0]) - Math.atan2(q.d[1], q.d[0]));
    const pick = new Set();
    for (i = 0; i < leaving.length; i += Math.max(1, Math.floor(leaving.length / 26))) pick.add(leaving[i]);
    seeds.forEach((s) => {
      if (pick.has(s)) return;
      const front = s.d[2] > 0;
      const st = ink.stroke('sky', front ? 'hair' : 'hairlite');
      st.moveTo(s.b[0], s.b[1]); st.lineTo(s.tip[0], s.tip[1]);
      s.fil.forEach((f) => { st.moveTo(s.tip[0], s.tip[1]); st.lineTo(f[0], f[1]); });
      const ac = ink.fill('sky', front ? 0.82 : 0.4);
      const nx = -(s.b[1] - s.a[1]), ny = s.b[0] - s.a[0], nl = Math.hypot(nx, ny) || 1, wd = 3.1;
      ac.moveTo(s.a[0], s.a[1]);
      ac.quadraticCurveTo((s.a[0] + s.b[0]) / 2 + nx / nl * wd, (s.a[1] + s.b[1]) / 2 + ny / nl * wd, s.b[0], s.b[1]);
      ac.quadraticCurveTo((s.a[0] + s.b[0]) / 2 - nx / nl * wd, (s.a[1] + s.b[1]) / 2 - ny / nl * wd, s.a[0], s.a[1]);
    });
    (function () {
      ink.knock('sky', recept);
      ink.stroke('sky', 'fine').addPath(recept);
      const dm = ink.fill('sky', 0.5);
      for (let k = 0; k < 16; k++) { const a = k * 2.4, rr = 5 + (k % 5) * 5; dm.moveTo(HEAD.x + Math.cos(a) * rr + 1.6, HEAD.y + Math.sin(a) * rr * 0.9); dm.arc(HEAD.x + Math.cos(a) * rr, HEAD.y + Math.sin(a) * rr * 0.9, 1.6, 0, TAU); }
    })();

    /* where each leaving seed comes down */
    const targets = [];
    MARK.forEach((m) => targets.push([m[0] + 4, m[1] - 34, 0]));
    for (i = 0; i < 9; i++) targets.push([1040 + i * 104 + R() * 40, GROUND - 6, (R() - 0.5) * 0.5]);
    for (i = 0; i < 6; i++) targets.push([1120 + R() * 760, 1570 + R() * 150, (R() - 0.5) * 0.4]);
    for (i = 0; i < 9; i++) targets.push([W + 160 + R() * 420, 520 + R() * 900, (R() - 0.5) * 0.6]);
    let ti = 0;
    Array.from(pick).forEach((s, n, all) => {
      const tg = targets[(ti++ * 7) % targets.length];
      const d2 = Math.hypot(s.d[0], s.d[1]);
      flying.push({
        tip: s.tip,
        phi0: Math.atan2(s.d[1], s.d[0]) + Math.PI / 2,
        fore: clamp(d2, 0.25, 1),
        at: 0.04 + 0.6 * (n / all.length) + R() * 0.05,
        dur: 0.34 + R() * 0.16,
        P1: [s.tip[0] + 150 + R() * 170, s.tip[1] - 130 - R() * 170],
        P2: [tg[0] - 170 - R() * 210, tg[1] - 270 - R() * 250],
        P3: [tg[0], tg[1]],
        tilt: tg[2], ph: R() * TAU
      });
    });

    /* ---- the frame of the plate and its register marks */
    (function () {
      const b = ink.stroke('frame', 'bold'); b.rect(0, 0, W, H);
      const h = ink.stroke('frame', 'hair'); h.rect(-16, -16, W + 32, H + 32);
      const f = ink.stroke('frame', 'fine');
      [[-78, -78], [W + 78, -78], [-78, H + 78], [W + 78, H + 78]].forEach((c) => {
        f.moveTo(c[0] + 17, c[1]); f.arc(c[0], c[1], 17, 0, TAU);
        f.moveTo(c[0] - 32, c[1]); f.lineTo(c[0] + 32, c[1]);
        f.moveTo(c[0], c[1] - 32); f.lineTo(c[0], c[1] + 32);
      });
    })();

    const world = { ink: ink, flying: flying, tw: T.w, th: T.h, pixels: T.pixels(), layers: {} };
    /* the tone canvases are no longer needed once packed */
    ['y', 'b', 'r', 'k'].forEach((ch) => { T.cv[ch].width = 0; T.cv[ch].height = 0; });
    return world;
  }

  let WORLD = null;
  function world() { if (!WORLD) WORLD = buildWorld(); return WORLD; }

  /* ----------------------------------------------------- WebGL: the press */

  const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const FRAG = [
    'precision highp float;',
    'uniform vec2 uRes; uniform vec2 uOrigin; uniform float uUpp; uniform vec2 uPlate; uniform float uCell;',
    'uniform sampler2D uTone; uniform vec2 uOff[4]; uniform vec3 uInk[4]; uniform vec3 uPaper; uniform vec4 uReveal;',
    'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'float screenDot(vec2 w, vec2 cs, vec2 off, vec4 mask, float seed){',
    '  vec2 p = w - off;',
    '  vec2 r = vec2(cs.x * p.x + cs.y * p.y, -cs.y * p.x + cs.x * p.y) / uCell;',
    '  vec2 id = floor(r);',
    '  vec2 cc = (id + 0.5) * uCell;',
    '  vec2 cw = vec2(cs.x * cc.x - cs.y * cc.y, cs.y * cc.x + cs.x * cc.y);',
    '  vec2 uv = cw / uPlate;',
    '  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);',
    '  float tone = dot(texture2D(uTone, clamp(uv, 0.0, 1.0)), mask) * inside;',
    '  tone *= 0.9 + 0.2 * vnoise(cw / 64.0 + seed);',
    '  float rad = mix(sqrt(tone / 3.14159), 0.74, smoothstep(0.55, 1.0, tone)) * (0.93 + 0.14 * hash(id + seed));',
    '  float d = length(fract(r) - 0.5);',
    '  float aa = 0.75 * uUpp / uCell;',
    '  return (1.0 - smoothstep(rad - aa, rad + aa, d)) * step(0.006, tone);',
    '}',
    'void main(){',
    '  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);',
    '  vec2 w = uOrigin + px * uUpp;',
    '  float aY = screenDot(w, vec2(1.0, 0.0), uOff[0], vec4(1.0, 0.0, 0.0, 0.0), 3.1) * uReveal.x;',
    '  float aB = screenDot(w, vec2(0.9659258, 0.2588190), uOff[1], vec4(0.0, 1.0, 0.0, 0.0), 7.7) * uReveal.y;',
    '  float aR = screenDot(w, vec2(0.2588190, 0.9659258), uOff[2], vec4(0.0, 0.0, 1.0, 0.0), 13.3) * uReveal.z;',
    '  float aK = screenDot(w, vec2(0.7071068, 0.7071068), uOff[3], vec4(0.0, 0.0, 0.0, 1.0), 19.9) * uReveal.w;',
    '  vec3 col = uPaper * (1.0 - 0.018 * vnoise(w / 7.0));',
    '  col *= mix(vec3(1.0), uInk[0], aY * 0.97);',
    '  col *= mix(vec3(1.0), uInk[1], aB * 0.95);',
    '  col *= mix(vec3(1.0), uInk[2], aR * 0.95);',
    '  col *= mix(vec3(1.0), uInk[3], aK * 0.9);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function GLPress(canvas, wd) {
    let gl = null;
    try {
      const opt = { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
      gl = canvas.getContext('webgl', opt) || canvas.getContext('experimental-webgl', opt);
    } catch (e) { gl = null; }
    if (!gl) return null;
    const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    if (!hp || hp.precision < 23) return null;
    function sh(type, src) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    }
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, wd.tw, wd.th, 0, gl.RGBA, gl.UNSIGNED_BYTE, wd.pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const U = {};
    ['uRes', 'uOrigin', 'uUpp', 'uPlate', 'uCell', 'uTone', 'uOff', 'uInk', 'uPaper', 'uReveal'].forEach((n) => { U[n] = gl.getUniformLocation(pr, n); });
    gl.uniform1i(U.uTone, 0);
    gl.uniform2f(U.uPlate, W, H);
    gl.uniform1f(U.uCell, CELL);
    this.gl = gl;
    this.draw = function (o) {
      gl.viewport(0, 0, o.w, o.h);
      gl.uniform2f(U.uRes, o.w, o.h);
      gl.uniform2f(U.uOrigin, o.ox, o.oy);
      gl.uniform1f(U.uUpp, o.upp);
      gl.uniform2fv(U.uOff, o.off);
      gl.uniform3fv(U.uInk, [].concat(o.inks.y, o.inks.b, o.inks.r, o.inks.k));
      gl.uniform3fv(U.uPaper, o.inks.paper);
      gl.uniform4fv(U.uReveal, o.reveal);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    this.lost = function () { return gl.isContextLost(); };
    this.release = function () { const e = gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); };
  }

  /* ------------------------------------- without WebGL: flat litho tints */

  function FlatPress(canvas, wd) {
    const ctx = canvas.getContext('2d');
    function layers(inks, key) {
      if (wd.layers[key]) return wd.layers[key];
      const out = {};
      ['y', 'b', 'r', 'k'].forEach((ch, c) => {
        const cv = document.createElement('canvas'); cv.width = wd.tw; cv.height = wd.th;
        const x = cv.getContext('2d'), im = x.createImageData(wd.tw, wd.th), d = im.data, col = inks[ch];
        for (let i = 0, n = wd.tw * wd.th; i < n; i++) {
          d[i * 4] = col[0] * 255; d[i * 4 + 1] = col[1] * 255; d[i * 4 + 2] = col[2] * 255;
          d[i * 4 + 3] = wd.pixels[i * 4 + c] * (ch === 'k' ? 0.8 : 0.88);
        }
        x.putImageData(im, 0, 0);
        out[ch] = cv;
      });
      wd.layers[key] = out;
      return out;
    }
    this.draw = function (o) {
      const L = layers(o.inks, o.inkKey || 'day'), s = 1 / (TS * o.upp);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = css(o.inks.paper); ctx.fillRect(0, 0, o.w, o.h);
      ctx.globalCompositeOperation = 'multiply';
      ctx.imageSmoothingEnabled = true;
      ['y', 'b', 'r', 'k'].forEach((ch, c) => {
        ctx.globalAlpha = o.reveal[c];
        ctx.setTransform(s, 0, 0, s, (o.off[c * 2] - o.ox) / o.upp, (o.off[c * 2 + 1] - o.oy) / o.upp);
        ctx.drawImage(L[ch], 0, 0);
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    };
    this.lost = function () { return false; };
    this.release = function () {};
  }

  /* --------------------------------------------- key lines and the seeds */

  function hits(view, b) { return !b || !(b[0] > view[0] + view[2] || b[0] + b[2] < view[0] || b[1] > view[1] + view[3] || b[1] + b[3] < view[1]); }

  function drawSeed(ctx, x, y, phi, beak, open, alpha) {
    const c = Math.cos(phi), s = Math.sin(phi), Lp = 86, n = 11;
    const P = (u, v) => [x + c * u - s * v, y + s * u + c * v];
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const tip = P(0, 0), ach = P(0, beak);
    ctx.moveTo(ach[0], ach[1]); ctx.lineTo(tip[0], tip[1]);
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (k / (n - 1) - 0.5) * 2 * open;
      const e = P(Math.cos(a) * Lp, Math.sin(a) * Lp), m = P(Math.cos(a) * Lp * 0.5, Math.sin(a) * Lp * 0.5 - 5);
      ctx.moveTo(tip[0], tip[1]); ctx.quadraticCurveTo(m[0], m[1], e[0], e[1]);
    }
    ctx.stroke();
    const a0 = P(0, beak), a1 = P(0, beak + 20), q1 = P(4.2, beak + 10), q2 = P(-4.2, beak + 10);
    ctx.beginPath();
    ctx.moveTo(a0[0], a0[1]); ctx.quadraticCurveTo(q1[0], q1[1], a1[0], a1[1]); ctx.quadraticCurveTo(q2[0], q2[1], a0[0], a0[1]);
    ctx.fill();
  }

  function drawInk(ctx, wd, o) {
    const s = 1 / o.upp, view = [o.ox, o.oy, o.w * o.upp, o.h * o.upp], minW = 0.85 * o.upp, col = css(o.inks.k);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, o.w, o.h);
    ctx.setTransform(s, 0, 0, s, (o.off[6] - o.ox) * s, (o.off[7] - o.oy) * s);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = col; ctx.fillStyle = col;
    const ops = wd.ink.ops, k = o.reveal[3];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!hits(view, BUCKET[op.bucket])) continue;
      if (op.t === 'k') {
        ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1; ctx.fill(op.path);
        ctx.globalCompositeOperation = 'source-over';
      } else if (op.t === 's') {
        const st = STY[op.style];
        ctx.lineWidth = Math.max(st.w, minW); ctx.globalAlpha = st.a * k * clamp(st.w / minW, 0.34, 1); ctx.stroke(op.path);
      } else { ctx.globalAlpha = op.alpha * k; ctx.fill(op.path); }
    }
    /* the seeds that leave the clock */
    const rel = o.release || 0, tm = o.time || 0;
    ctx.lineWidth = Math.max(0.95, minW);
    for (let i = 0; i < wd.flying.length; i++) {
      const f = wd.flying[i], u = clamp((rel - f.at) / f.dur, 0, 1), e = smooth(u);
      let px, py, phi, beak;
      if (u <= 0) {
        px = f.tip[0]; py = f.tip[1]; phi = f.phi0; beak = 136 * f.fore;
      } else {
        const p = cubic(f.tip, f.P1, f.P2, f.P3, e);
        const sway = u < 1 ? Math.sin(tm * 1.3 + f.ph) * 0.13 * o.motion : 0;
        px = p[0] + (u < 1 ? Math.sin(tm * 0.9 + f.ph * 2) * 7 * o.motion : 0); py = p[1];
        phi = lerp(f.phi0, f.tilt * (u >= 1 ? 1 : 0.4), smooth(clamp(u / 0.22, 0, 1))) + sway;
        beak = lerp(136 * f.fore, 120, smooth(clamp(u / 0.3, 0, 1)));
      }
      if (px < view[0] - 160 || px > view[0] + view[2] + 160 || py < view[1] - 200 || py > view[1] + view[3] + 200) continue;
      drawSeed(ctx, px, py, phi, beak, lerp(0.95, 1.25, e), 0.78 * k);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /* -------------------------------------------------------------- stills */

  const REG = [-2.4, 1.7, 2.0, -1.5, 1.0, 2.3, 0, 0];   // resting misregistration, plate units
  const DIR = [-1, 0.7, 0.8, -0.6, 0.4, 0.9, 0, 0];     // how each plate slips under way

  function offsets(slip) {
    const out = new Float32Array(8);
    for (let i = 0; i < 8; i++) out[i] = REG[i] + DIR[i] * (slip || 0);
    return out;
  }

  /* Fit a framing rectangle into the free part of a viewport.
     free = [left, top, right, bottom] as fractions of the viewport. */
  function camFor(rect, vw, vh, free) {
    const f = free || [0, 0, 1, 1];
    const fw = (f[2] - f[0]) * vw, fh = (f[3] - f[1]) * vh;
    const s = Math.min(fw / rect[2], fh / rect[3]);
    return {
      s: s,
      cx: rect[0] + rect[2] / 2 - ((f[0] + f[2]) / 2 - 0.5) * vw / s,
      cy: rect[1] + rect[3] / 2 - ((f[1] + f[3]) / 2 - 0.5) * vh / s
    };
  }
  function coverFor(rect, vw, vh) {
    const s = Math.max(vw / rect[2], vh / rect[3]);
    return { s: s, cx: rect[0] + rect[2] / 2, cy: rect[1] + rect[3] / 2 };
  }

  function makePress(canvas, wd, forceFlat) {
    let p = null;
    if (!forceFlat) { try { p = new GLPress(canvas, wd); if (!p.draw) p = null; } catch (e) { p = null; } }
    if (p) return { press: p, mode: 'webgl' };
    return { press: new FlatPress(canvas, wd), mode: 'flat' };
  }

  /* Print one still frame into an ordinary canvas. */
  let SNAP = null;
  function snapshot(target, rect, opts) {
    const wd = world(), o = opts || {};
    const bw = target.clientWidth || target.width, bh = target.clientHeight || target.height;
    if (!bw || !bh) return false;
    const ratio = Math.min(o.dpr || root.devicePixelRatio || 1, 2);
    const pw = Math.round(bw * ratio), ph = Math.round(bh * ratio);
    if (!SNAP) {
      const pc = document.createElement('canvas'), ic = document.createElement('canvas');
      SNAP = { pc: pc, ic: ic, made: makePress(pc, wd, o.flat), ictx: ic.getContext('2d') };
    }
    SNAP.pc.width = pw; SNAP.pc.height = ph; SNAP.ic.width = pw; SNAP.ic.height = ph;
    const cam = o.contain ? camFor(rect, bw, bh) : coverFor(rect, bw, bh);
    const frame = {
      w: pw, h: ph, upp: 1 / (cam.s * ratio), ox: cam.cx - bw / 2 / cam.s, oy: cam.cy - bh / 2 / cam.s,
      off: offsets(0), inks: o.inks || INKS.day, inkKey: o.inkKey || 'day', reveal: [1, 1, 1, 1],
      release: o.release || 0, time: 0, motion: 0, idle: 0
    };
    if (SNAP.made.press.lost()) { SNAP.made = makePress(SNAP.pc, wd, true); }
    SNAP.made.press.draw(frame);
    drawInk(SNAP.ictx, wd, frame);
    target.width = pw; target.height = ph;
    const t = target.getContext('2d');
    t.drawImage(SNAP.pc, 0, 0); t.drawImage(SNAP.ic, 0, 0);
    return true;
  }
  function releaseSnapshots() {
    if (!SNAP) return;
    SNAP.made.press.release();
    SNAP.pc.width = SNAP.pc.height = SNAP.ic.width = SNAP.ic.height = 0;
    SNAP = null;
  }

  root.DFFigure = { W: W, H: H, FRAMES: FRAMES, INKS: INKS, snapshot: snapshot, release: releaseSnapshots };
})(window);

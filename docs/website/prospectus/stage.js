/*!
 * Dandelion Foundation prospectus: the painted scene.
 *
 * The supplied paintings are joined side by side into one long scene, and a
 * slow rostrum camera travels across it as the page scrolls. The paintings
 * are shown as they are: nothing in them is redrawn or regenerated. What
 * moves is the camera, a few drawn seeds and motes of dust, the printing
 * register (which slips a little while the page is moving), and a handful of
 * small places where the painted surface itself stirs by a pixel or two: the
 * seed head, open water, the boats on it.
 *
 * The scene is measured in painting pixels (each plate is 1672 x 941 units,
 * whatever the file's real size). The joins are hidden by things already in
 * the paintings: the sandstone pillar on the left edge of "table", and the
 * cedar posts where "table" meets "veranda". The camera crosses a join when it
 * travels from one plate to the next; while text is being read it stays on
 * one plate, except where the text itself covers the join. It never shows
 * more than one plate's width at once. To add a painting, add it to SHEETS at
 * the next position and give it framings in FRAMES.
 *
 * No dependencies. Exposes window.DFStage.
 */
(function (root) {
  'use strict';

  const PW = 1672, PH = 941, TAU = Math.PI * 2;
  const SHEETS = {
    vision: { x: 0, w: PW, h: PH },        // the hillside
    table: { x: 1672, w: PW, h: PH },      // its left-hand pillar meets the edge of "vision"
    veranda: { x: 3344, w: PW, h: PH }     // its left-hand post meets the post at the edge of "table"
  };
  /* the whole scene, end to end */
  const WORLD = (function () {
    let x0 = Infinity, x1 = -Infinity;
    for (const n in SHEETS) { x0 = Math.min(x0, SHEETS[n].x); x1 = Math.max(x1, SHEETS[n].x + SHEETS[n].w); }
    return { x: x0, y: 0, w: x1 - x0, h: PH };
  })();

  /* Framings: [x, y, width, height] inside a plate, for wide ("land") and
     tall ("port") windows. Faces, hands and the map stay inside each one. */
  const F = (sheet, land, port) => ({ sheet: sheet, land: land, port: port || land });
  const FRAMES = {
    /* the hillside */
    cover: F('vision', [800, 0, 872, 941], [1010, 0, 460, 560]),
    wide: F('vision', [0, 0, 1672, 941], [700, 0, 760, 760]),
    ground: F('vision', [470, 480, 760, 461], [500, 440, 430, 430]),
    groundB: F('vision', [560, 500, 760, 441], [760, 470, 430, 430]),
    stemA: F('vision', [1000, 380, 460, 561], [1010, 420, 430, 440]),
    stemB: F('vision', [1000, 140, 460, 561], [1010, 180, 430, 440]),
    clock: F('vision', [990, 0, 540, 470], [1010, 0, 460, 470]),
    clockB: F('vision', [1130, 0, 542, 520], [1060, 0, 460, 470]),
    /* the table */
    plan: F('table', [110, 230, 1100, 700], [170, 300, 420, 400]),
    planB: F('table', [170, 250, 1100, 680], [330, 320, 420, 400]),
    termsA: F('table', [130, 560, 760, 381], [170, 600, 420, 330]),
    termsB: F('table', [560, 520, 520, 421], [640, 560, 420, 330]),
    partners: F('table', [70, 150, 1580, 791], [300, 240, 660, 700]),
    shelvesA: F('table', [900, 0, 772, 760], [1060, 40, 560, 600]),
    shelvesB: F('table', [1040, 0, 632, 720], [1100, 100, 560, 600]),
    /* the veranda */
    wallA: F('veranda', [0, 100, 900, 720], [40, 300, 460, 420]),
    wallB: F('veranda', [60, 140, 900, 700], [80, 320, 460, 420]),
    wallC: F('veranda', [120, 180, 860, 660], [100, 330, 460, 420]),
    arches: F('veranda', [430, 40, 940, 780], [520, 120, 500, 560]),
    coastA: F('veranda', [520, 30, 1152, 850], [1040, 100, 540, 640]),
    coastB: F('veranda', [860, 150, 812, 791], [1140, 280, 500, 540]),
    /* still crops, used when the page is read without the moving scene */
    stillGround: F('vision', [430, 460, 1000, 481]),
    stillStem: F('vision', [960, 120, 520, 821]),
    stillClock: F('vision', [960, 0, 640, 640]),
    stillTerms: F('table', [120, 440, 960, 501]),
    stillShelves: F('table', [1040, 0, 632, 760]),
    stillWall: F('veranda', [40, 120, 980, 700])
  };

  /* Where things are in the scene, in scene units. */
  const HEAD = { x: 1240, y: 190, r: 222 };
  const SPOTS = {
    community: [1672 + 410, 470, 150],
    schools: [1672 + 835, 520, 118],
    health: [1672 + 1330, 260, 150],
    business: [1672 + 995, 690, 128],
    supporters: [1672 + 318, 250, 118]
  };
  const SHELVES = {
    health: [1672 + 1098, 50, 524, 152],
    learning: [1672 + 1100, 196, 520, 142],
    skills: [1672 + 1312, 346, 310, 268]
  };
  /* the three terms, pinned to things on the table: the river stone that holds
     the map down (one task), the compass (who goes which way), and the basket
     of finished cloth (what was delivered) */
  const MARKS = [[1672 + 285, 688, '1'], [1672 + 822, 788, '2'], [1672 + 990, 668, '3']];
  const LANTERN = [3344 + 1272, 690];

  /* Places where the painted surface itself may stir a little, in plate pixels:
     [centre x, centre y, radius x, radius y, kind, strength in pixels].
     kind 1 sways (the seed head), kind 2 shimmers in rows (open water),
     kind 3 rides a slow swell (a boat). None of them covers a person.
     At most three per plate. */
  const STIR = {
    vision: [[1240, 190, 226, 226, 1, 1.9], [1562, 640, 118, 28, 2, 1.1]],
    table: [[180, 385, 58, 52, 2, 0.8], [482, 382, 82, 36, 2, 0.8], [182, 303, 38, 40, 3, 1.3]],
    veranda: [[1440, 575, 180, 100, 2, 1.2], [1366, 446, 42, 44, 3, 1.4], [1537, 447, 24, 24, 3, 1.1]]
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function cubic(P0, P1, P2, P3, t) {
    const m = 1 - t;
    return [
      m * m * m * P0[0] + 3 * m * m * t * P1[0] + 3 * m * t * t * P2[0] + t * t * t * P3[0],
      m * m * m * P0[1] + 3 * m * m * t * P1[1] + 3 * m * t * t * P2[1] + t * t * t * P3[1]
    ];
  }

  /* ------------------------------------------------------------- camera */

  function bounds(name) { const s = SHEETS[name]; return { x: s.x, y: 0, w: s.w, h: s.h }; }

  /* Frame a rectangle of one plate inside a host box. The painting always
     covers the whole host. focus is the part of the host where the subject
     should sit, as [left, top, right, bottom] fractions of the host; the rest
     is covered by text. */
  function frameCam(frame, host, opts) {
    const o = opts || {}, tall = host.w / host.h < 1.15;
    const r = (o.tall === undefined ? tall : o.tall) ? frame.port : frame.land;
    const b = bounds(frame.sheet);
    const rect = [b.x + r[0], r[1], r[2], r[3]];
    const f = o.focus || [0, 0, 1, 1];
    const fw = (f[2] - f[0]) * host.w, fh = (f[3] - f[1]) * host.h;
    const sCover = Math.max(host.w / b.w, host.h / b.h);
    let s = Math.max(Math.min(fw / rect[2], fh / rect[3]), sCover);
    if (o.maxZoom) s = Math.min(s, sCover * o.maxZoom);
    const cx = rect[0] + rect[2] / 2 - ((f[0] + f[2]) / 2 - 0.5) * host.w / s;
    const cy = rect[1] + rect[3] / 2 - ((f[1] + f[3]) / 2 - 0.5) * host.h / s;
    return clampCam({ cx: cx, cy: cy, s: s }, host, frame.sheet);
  }
  function mixCam(a, b, t) {
    return { cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), t)) };
  }
  /* lean a camera toward a place, so that it sits in the free part of the window */
  function aimCam(cam, spot, zoom, host, focus, w) {
    if (!w) return cam;
    const f = focus || [0, 0, 1, 1], s = cam.s * zoom;
    const tx = spot[0] - ((f[0] + f[2]) / 2 - 0.5) * host.w / s, ty = spot[1] - ((f[1] + f[3]) / 2 - 0.5) * host.h / s;
    return { s: Math.exp(lerp(Math.log(cam.s), Math.log(s), w)), cx: lerp(cam.cx, tx, w * 0.8), cy: lerp(cam.cy, ty, w * 0.8) };
  }

  /* Keep a view on its own plate. It may run over a join into the next plate
     only where text covers the window (outside focus), so a subject near a
     plate's edge can still sit in the clear part, and never past either end
     of the scene. Without a sheet, the view is kept inside the whole scene. */
  function clampCam(cam, host, sheet, focus) {
    const b = sheet ? bounds(sheet) : WORLD, f = focus || [0, 0, 1, 1];
    const hw = host.w / 2 / cam.s, hh = host.h / 2 / cam.s, ux = host.w / cam.s;
    const minX = Math.max(b.x + hw - f[0] * ux, WORLD.x + hw), maxX = Math.min(b.x + b.w - hw + (1 - f[2]) * ux, WORLD.x + WORLD.w - hw);
    const minY = hh, maxY = PH - hh;
    return {
      s: cam.s,
      cx: minX <= maxX ? clamp(cam.cx, minX, maxX) : (minX + maxX) / 2,
      cy: minY <= maxY ? clamp(cam.cy, minY, maxY) : (minY + maxY) / 2
    };
  }

  /* ------------------------------------------------------------- images */

  const images = {};
  const listeners = [];
  function setImage(name, img) {
    if (images[name] === img) return;
    images[name] = img;
    listeners.forEach((fn) => fn(name, img));
  }
  function has(name) { return !!images[name]; }

  /* ----------------------------------------------------------- painters */

  const VS = 'attribute vec2 a; uniform vec4 uRect; varying vec2 vUv; void main(){ vUv = a; gl_Position = vec4(mix(uRect.xy, uRect.zw, a), 0.0, 1.0); }';
  const FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 vUv; uniform sampler2D uTex; uniform vec2 uSlip; uniform vec2 uTexel; uniform float uSharp;',
    'uniform vec4 uZone[3]; uniform vec3 uZoneP[3]; uniform float uTime; uniform vec2 uPlatePx;',
    /* a small, slow displacement inside a few soft-edged zones: the seed head sways, open water shimmers */
    'vec2 stir(vec2 uv){',
    '  vec2 d = vec2(0.0);',
    '  for (int i = 0; i < 3; i++) {',
    '    vec3 p = uZoneP[i];',
    '    if (p.x < 0.5) continue;',
    '    vec2 q = (uv - uZone[i].xy) / uZone[i].zw;',
    '    float m = 1.0 - smoothstep(0.5, 1.0, length(q));',
    '    if (p.x < 1.5) {',
    '      float a = sin(uTime * 0.62 + p.z) * 0.6 + sin(uTime * 1.07 + q.y * 3.0) * 0.4;',
    '      d += m * length(q) * p.y * vec2(a, 0.4 * sin(uTime * 0.83 + q.x * 2.0));',
    '    } else if (p.x < 2.5) {',
    '      d += m * p.y * vec2(sin(uTime * 1.5 + uv.y / uPlatePx.y * 0.85 + p.z), 0.0);',
    '    } else {',
    '      d += m * p.y * vec2(0.5 * q.y * sin(uTime * 0.7 + p.z), sin(uTime * 0.9 + p.z + 1.0));',
    '    }',
    '  }',
    '  return d * uPlatePx;',
    '}',
    'void main(){',
    '  vec2 uv = vUv + stir(vUv);',
    '  vec3 c0 = texture2D(uTex, uv).rgb;',
    /* each printing colour is laid down a little off the others */
    '  vec3 col = vec3(texture2D(uTex, uv + uSlip).r, c0.g, texture2D(uTex, uv - uSlip).b);',
    '  if (uSharp > 0.0) {',
    '    vec3 n = texture2D(uTex, uv + vec2(uTexel.x, 0.0)).rgb + texture2D(uTex, uv - vec2(uTexel.x, 0.0)).rgb',
    '           + texture2D(uTex, uv + vec2(0.0, uTexel.y)).rgb + texture2D(uTex, uv - vec2(0.0, uTexel.y)).rgb;',
    '    col += (c0 - n * 0.25) * uSharp;',
    '  }',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  function GLPainter(canvas) {
    const opt = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    let gl = canvas.getContext('webgl2', opt), v2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', opt) || canvas.getContext('experimental-webgl', opt);
    if (!gl) throw new Error('WebGL is not available');
    function sh(type, src) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    }
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('program did not link');
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'a');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['uRect', 'uTex', 'uSlip', 'uTexel', 'uSharp', 'uZone', 'uZoneP', 'uTime', 'uPlatePx'].forEach((n) => { U[n] = gl.getUniformLocation(pr, n); });
    gl.uniform1i(U.uTex, 0);
    const tex = {};
    /* throws when the browser will not let scripts read the image (for example a page opened straight from disk) */
    this.upload = function (name, img) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (v2) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('texture upload failed');
      tex[name] = { t: t, w: img.naturalWidth || PW, h: img.naturalHeight || PH };
    };
    this.draw = function (v) {
      gl.viewport(0, 0, v.w, v.h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      for (const name in SHEETS) {
        const T = tex[name]; if (!T) continue;
        const s = SHEETS[name];
        const x0 = (s.x - v.ox) / v.upp, x1 = (s.x + s.w - v.ox) / v.upp, y0 = -v.oy / v.upp, y1 = (s.h - v.oy) / v.upp;
        if (x1 < 0 || x0 > v.w || y1 < 0 || y0 > v.h) continue;
        gl.bindTexture(gl.TEXTURE_2D, T.t);
        gl.uniform4f(U.uRect, x0 / v.w * 2 - 1, 1 - y0 / v.h * 2, x1 / v.w * 2 - 1, 1 - y1 / v.h * 2);
        gl.uniform2f(U.uSlip, v.slip[0] / s.w, v.slip[1] / s.h);
        gl.uniform2f(U.uTexel, 1 / T.w, 1 / T.h);
        gl.uniform1f(U.uSharp, v.sharp);
        const zs = STIR[name] || [], z = new Float32Array(12), zp = new Float32Array(9);
        for (let i = 0; i < 3 && i < zs.length; i++) {
          z[i * 4] = zs[i][0] / s.w; z[i * 4 + 1] = zs[i][1] / s.h; z[i * 4 + 2] = zs[i][2] / s.w; z[i * 4 + 3] = zs[i][3] / s.h;
          zp[i * 3] = v.stir > 0 ? zs[i][4] : 0; zp[i * 3 + 1] = zs[i][5] * v.stir; zp[i * 3 + 2] = i * 1.7;
        }
        gl.uniform4fv(U.uZone, z); gl.uniform3fv(U.uZoneP, zp);
        gl.uniform1f(U.uTime, v.time || 0);
        gl.uniform2f(U.uPlatePx, 1 / s.w, 1 / s.h);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
    this.lost = function () { return gl.isContextLost(); };
    this.kind = 'webgl';
  }

  function paintSheets(ctx, v) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const name in SHEETS) {
      const img = images[name]; if (!img) continue;
      const s = SHEETS[name];
      const x0 = (s.x - v.ox) / v.upp, y0 = -v.oy / v.upp, w = s.w / v.upp, h = s.h / v.upp;
      if (x0 + w < 0 || x0 > v.w || y0 + h < 0 || y0 > v.h) continue;
      ctx.drawImage(img, x0, y0, w, h);
    }
  }
  function FlatPainter(canvas) {
    const ctx = canvas.getContext('2d');
    this.upload = function () {};
    this.draw = function (v) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, v.w, v.h); paintSheets(ctx, v); };
    this.lost = function () { return false; };
    this.kind = 'flat';
  }

  /* ----------------------------------------------- what is drawn on top */

  /* Seeds that leave the clock. A few come down on the map; the rest drift off into the sky. */
  const SEEDS = (function () {
    const R = mulberry(52611), out = [];
    const land = [[1672 + 330, 700], [1672 + 520, 742], [1672 + 655, 702], [1672 + 716, 742], [1672 + 232, 772]];
    for (let i = 0; i < 15; i++) {
      const a = -1.3 + (i / 14) * 1.8 + (R() - 0.5) * 0.12;
      const p0 = [HEAD.x + Math.cos(a) * HEAD.r * 0.94, HEAD.y + Math.sin(a) * HEAD.r * 0.94];
      const down = i % 3 === 1;
      const p3 = down ? land[(i / 3) | 0] : [1380 + R() * 380, -60 + R() * 330];
      out.push({
        p0: p0, p3: p3, down: down,
        p1: [p0[0] + 110 + R() * 130, p0[1] - 50 - R() * 110],
        /* seeds bound for the table come in low from the left, below the faces */
        p2: down ? [p3[0] - 400 - R() * 140, p3[1] - 90 - R() * 70] : [p3[0] - 120 - R() * 120, p3[1] + 60 - R() * 120],
        at: down ? 0.1 + R() * 0.3 : R() * 0.62,
        dur: down ? 0.78 + R() * 0.1 : 0.34 + R() * 0.2,
        phi0: a + Math.PI / 2, tilt: (R() - 0.5) * 0.7, ph: R() * TAU, size: 0.85 + R() * 0.35
      });
    }
    return out;
  })();

  /* [x, y, strength, size, speed, phase, sideways drift] for each mote */
  const DUST = (function () {
    const R = mulberry(8841), out = [];
    const beams = [[1672 + 900, 120, 230, 420], [3344 + 90, 150, 330, 330], [3344 + 520, 560, 420, 160]];
    beams.forEach((b) => { for (let i = 0; i < 13; i++) out.push([b[0] + R() * b[2], b[1] + R() * b[3], 0.25 + R() * 0.4, 0.8 + R() * 0.9, 0.12 + R() * 0.2, R() * TAU, 2 + R() * 4]); });
    return out;
  })();

  function strokeSeed(ctx, x, y, phi, size, alpha, lw) {
    const c = Math.cos(phi), s = Math.sin(phi), L = 34 * size, beak = 44 * size, n = 12;
    const P = (u, v) => [x + c * u - s * v, y + s * u + c * v];
    const tip = P(0, 0), ach = P(0, beak), end = P(0, beak + 10 * size);
    const path = new Path2D();
    path.moveTo(end[0], end[1]); path.lineTo(tip[0], tip[1]);
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (k / (n - 1) - 0.5) * 2.5;
      const e = P(Math.cos(a) * L, Math.sin(a) * L);
      path.moveTo(tip[0], tip[1]); path.lineTo(e[0], e[1]);
    }
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha * 0.42; ctx.strokeStyle = 'rgb(46,28,10)'; ctx.lineWidth = lw * 2.6; ctx.stroke(path);
    ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgb(255,250,236)'; ctx.lineWidth = lw; ctx.stroke(path);
    ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgb(214,160,62)'; ctx.lineWidth = lw * 2.2;
    ctx.beginPath(); ctx.moveTo(ach[0], ach[1]); ctx.lineTo(end[0], end[1]); ctx.stroke();
  }

  function drawOverlay(ctx, v, fx, keep) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!keep) ctx.clearRect(0, 0, v.w, v.h);
    if (!fx) return;
    const s = 1 / v.upp, px = v.upp, tm = fx.time || 0, mo = fx.motion === undefined ? 1 : fx.motion;
    ctx.setTransform(s, 0, 0, s, -v.ox * s, -v.oy * s);
    const vx0 = v.ox - 80, vx1 = v.ox + v.w * v.upp + 80, vy0 = v.oy - 100, vy1 = v.oy + v.h * v.upp + 100;

    if (fx.glow) {
      const g = fx.glow, r = 150;
      const gr = ctx.createRadialGradient(g[0], g[1], 0, g[0], g[1], r);
      gr.addColorStop(0, 'rgba(255,214,128,' + 0.5 * g[2] + ')'); gr.addColorStop(0.4, 'rgba(255,186,84,' + 0.18 * g[2] + ')'); gr.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1; ctx.fillStyle = gr;
      ctx.fillRect(g[0] - r, g[1] - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }

    if (fx.release !== undefined && fx.release > 0) {
      const lw = Math.max(1.15 * px, 1.0);
      for (let i = 0; i < SEEDS.length; i++) {
        const f = SEEDS[i], u = clamp((fx.release - f.at) / f.dur, 0, 1);
        if (u <= 0) continue;
        const e = smooth(u), p = cubic(f.p0, f.p1, f.p2, f.p3, e), moving = u < 1 ? mo : 0;
        const x = p[0] + Math.sin(tm * 0.9 + f.ph * 2) * 5 * moving, y = p[1] + Math.cos(tm * 0.7 + f.ph) * 3 * moving;
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
        let alpha = smooth(u / 0.08);
        if (!f.down) alpha *= 1 - smooth((u - 0.62) / 0.38);
        if (alpha <= 0.01) continue;
        const phi = lerp(f.phi0, f.tilt * (u >= 1 ? 1 : 0.35), smooth(u / 0.25)) + Math.sin(tm * 1.3 + f.ph) * 0.14 * moving;
        strokeSeed(ctx, x, y, phi, f.size, alpha, lw);
      }
    }

    if (fx.dust && fx.dust > 0.01) {
      /* motes in the shafts of light indoors */
      ctx.fillStyle = 'rgb(255,236,190)';
      for (let i = 0; i < DUST.length; i++) {
        const m = DUST[i];
        const x = m[0] + Math.sin(tm * m[4] + m[5]) * 26 + Math.sin(tm * 0.031 * m[6] + m[5] * 2.0) * 34, y = m[1] + Math.cos(tm * m[4] * 0.8 + m[5]) * 18 + Math.sin(tm * 0.043 * m[6] + m[5]) * 30;
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
        ctx.globalAlpha = fx.dust * m[2] * (0.55 + 0.45 * Math.sin(tm * 0.9 + m[5] * 3.0));
        ctx.beginPath(); ctx.arc(x, y, Math.max(m[3] * 1.5, 1.1 * px), 0, TAU); ctx.fill();
      }
    }

    if (fx.drift) {
      /* a few seeds crossing the evening sky; drawn only while motion is allowed */
      const lw = Math.max(1.15 * px, 1.0);
      for (let i = 0; i < 5; i++) {
        const t = ((tm * 0.016 + i * 0.21) % 1);
        const x = fx.drift[0] + lerp(-260, 700, t), y = fx.drift[1] + i * 46 - Math.sin(t * 3.1) * 130 + Math.sin(tm * 0.6 + i) * 10;
        const alpha = Math.sin(t * Math.PI) * fx.drift[2];
        if (alpha > 0.02) strokeSeed(ctx, x, y, Math.sin(tm * 0.8 + i * 2) * 0.22 + 0.2, 0.8 + (i % 3) * 0.15, alpha, lw);
      }
    }

    if (fx.box && fx.box[4] > 0.01) {
      const b = fx.box, r = 8;
      ctx.globalAlpha = b[4];
      ctx.beginPath();
      ctx.moveTo(b[0] + r, b[1]); ctx.arcTo(b[0] + b[2], b[1], b[0] + b[2], b[1] + b[3], r); ctx.arcTo(b[0] + b[2], b[1] + b[3], b[0], b[1] + b[3], r);
      ctx.arcTo(b[0], b[1] + b[3], b[0], b[1], r); ctx.arcTo(b[0], b[1], b[0] + b[2], b[1], r); ctx.closePath();
      ctx.fillStyle = 'rgba(232,176,72,0.16)'; ctx.fill();
      ctx.strokeStyle = 'rgba(30,18,6,0.55)'; ctx.lineWidth = Math.max(5 * px, 3.4); ctx.stroke();
      ctx.strokeStyle = 'rgb(240,186,84)'; ctx.lineWidth = Math.max(2.4 * px, 1.6); ctx.stroke();
    }

    if (fx.marks && fx.marks > 0.01) {
      const r = Math.max(21, 15 * px);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 ' + (r * 1.15).toFixed(1) + 'px Besley, Georgia, serif';
      for (let i = 0; i < MARKS.length; i++) {
        const m = MARKS[i];
        ctx.globalAlpha = fx.marks;
        ctx.beginPath(); ctx.arc(m[0], m[1], r, 0, TAU);
        ctx.fillStyle = 'rgb(240,186,84)'; ctx.fill();
        ctx.strokeStyle = 'rgb(11,10,9)'; ctx.lineWidth = Math.max(2 * px, 1.4); ctx.stroke();
        ctx.fillStyle = 'rgb(11,10,9)'; ctx.fillText(m[2], m[0], m[1] + r * 0.06);
      }
    }

    if (fx.reticle && fx.reticle[3] > 0.01) {
      const q = fx.reticle, r = q[2];
      const ring = new Path2D();
      ring.moveTo(q[0] + r, q[1]); ring.arc(q[0], q[1], r, 0, TAU);
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2;
        ring.moveTo(q[0] + Math.cos(a) * (r - 13), q[1] + Math.sin(a) * (r - 13)); ring.lineTo(q[0] + Math.cos(a) * (r + 15), q[1] + Math.sin(a) * (r + 15));
      }
      ctx.lineCap = 'butt'; ctx.globalAlpha = q[3];
      ctx.strokeStyle = 'rgba(30,18,6,0.6)'; ctx.lineWidth = Math.max(5.4 * px, 3.6); ctx.stroke(ring);
      ctx.strokeStyle = 'rgb(240,186,84)'; ctx.lineWidth = Math.max(2.6 * px, 1.7); ctx.stroke(ring);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /* -------------------------------------------------------------- stage */

  function viewOf(cam, w, h, dpr, slip, time, stir) {
    const m = cam.s * dpr;   // device pixels per painting pixel
    return {
      w: Math.max(1, Math.round(w * dpr)), h: Math.max(1, Math.round(h * dpr)),
      upp: 1 / m, ox: cam.cx - w / 2 / cam.s, oy: cam.cy - h / 2 / cam.s,
      slip: slip || [0, 0], sharp: clamp((m - 1) * 0.42, 0, 0.5), time: time || 0, stir: stir || 0
    };
  }
  function ratioFor(w, h) {
    let r = Math.min(root.devicePixelRatio || 1, 2);
    if (w * h * r * r > 5.6e6) r = Math.sqrt(5.6e6 / (w * h));
    return r;
  }

  function Stage(opts) {
    const self = this, o = opts || {};
    function canvas(cls) { const c = document.createElement('canvas'); c.className = cls; c.setAttribute('aria-hidden', 'true'); return c; }
    this.ink = canvas('plate-live plate-live-ink');
    this.ictx = this.ink.getContext('2d');
    this.host = null; this.w = 0; this.h = 0; this.dpr = 1; this.last = null;
    function flat() {
      const c = canvas('plate-live');
      if (self.plate && self.plate.parentNode) self.plate.parentNode.replaceChild(c, self.plate);
      self.plate = c; self.painter = new FlatPainter(c); self.mode = 'flat';
      c.width = self.ink.width; c.height = self.ink.height;
    }
    this.plate = canvas('plate-live');
    try {
      if (o.flat) throw new Error('flat requested');
      this.painter = new GLPainter(this.plate); this.mode = 'webgl';
      this.plate.addEventListener('webglcontextlost', function (e) { e.preventDefault(); flat(); if (o.onChange) o.onChange(); });
    } catch (e) { flat(); }
    function take(name, img) {
      try { self.painter.upload(name, img); }
      catch (e) { flat(); }
      if (o.onChange) o.onChange();
    }
    for (const n in images) take(n, images[n]);
    listeners.push(take);
  }
  Stage.prototype.attach = function (host) {
    if (this.host !== host) {
      this.host = host;
      if (host) { host.appendChild(this.plate); host.appendChild(this.ink); }
      else { if (this.plate.parentNode) this.plate.parentNode.removeChild(this.plate); if (this.ink.parentNode) this.ink.parentNode.removeChild(this.ink); }
    }
    if (host) this.measure();
  };
  Stage.prototype.measure = function () {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.w = w; this.h = h; this.dpr = ratioFor(w, h);
    const pw = Math.max(1, Math.round(w * this.dpr)), ph = Math.max(1, Math.round(h * this.dpr));
    if (this.plate.width !== pw || this.plate.height !== ph) { this.plate.width = pw; this.plate.height = ph; this.ink.width = pw; this.ink.height = ph; }
  };
  Stage.prototype.render = function (cam, fx, slip) {
    if (!this.host || !this.w || !this.h) return;
    const v = viewOf(cam, this.w, this.h, this.dpr, slip, fx && fx.time, fx && fx.motion ? 1 : 0);
    v.w = this.plate.width; v.h = this.plate.height;
    this.painter.draw(v);
    drawOverlay(this.ictx, v, fx);
    this.last = { cam: cam, fx: fx };
  };
  /* Print one still frame of the painted world into an ordinary canvas. */
  function still(target, cam, fx) {
    const w = target.clientWidth, h = target.clientHeight;
    if (!w || !h) return false;
    const dpr = ratioFor(w, h), v = viewOf(cam, w, h, dpr, [0, 0]);
    if (target.width !== v.w || target.height !== v.h) { target.width = v.w; target.height = v.h; }
    const ctx = target.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, v.w, v.h);
    paintSheets(ctx, v);
    drawOverlay(ctx, v, fx ? Object.assign({}, fx, { motion: 0 }) : null, true);
    return true;
  }

  root.DFStage = {
    PW: PW, PH: PH, SHEETS: SHEETS, WORLD: WORLD, FRAMES: FRAMES, SPOTS: SPOTS, SHELVES: SHELVES, MARKS: MARKS, LANTERN: LANTERN, STIR: STIR,
    frameCam: frameCam, mixCam: mixCam, aimCam: aimCam, clampCam: clampCam,
    Stage: Stage, still: still, setImage: setImage, has: has,
    clamp: clamp, lerp: lerp, smooth: smooth
  };
})(window);

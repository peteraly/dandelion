#!/usr/bin/env node
/*
 * Checks the prospectus site in a real browser (Chromium, through Playwright).
 *
 *   node verify.cjs
 *   CHROMIUM_PATH=/path/to/chromium node verify.cjs    (to choose the browser)
 *
 * It serves this folder on a local port, opens the page at several sizes and
 * settings, and prints one PASS or FAIL line per check. It exits with a
 * non-zero code if anything fails. It needs the "playwright" package (or
 * "@playwright/test") and a Chromium it can launch; nothing else.
 *
 * What it cannot tell you: how the page feels on a real phone, how it behaves
 * in Safari or Firefox, and whether the external links still work.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('@playwright/test')); }

const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const DELIVERY = 'Delivery note: A public inbox is not yet active—this tool prepares a local draft only and sends nothing. Omit student names or confidential health data, and copy or download your brief to save it.';
const ANCHORS = ['vision', 'terms', 'focus', 'partners', 'resources', 'approach', 'about', 'collaborate', 'questions', 'closing'];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '   [' + detail + ']' : ''));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, path.normalize(p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function open(browser, base, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({
    viewport: { width: o.w || 1440, height: o.h || 900 }, deviceScaleFactor: o.dsf || 1,
    reducedMotion: o.reduce ? 'reduce' : 'no-preference', javaScriptEnabled: o.js !== false,
    hasTouch: (o.w || 1440) < 700, acceptDownloads: true,
    permissions: o.clipboard === false ? [] : ['clipboard-read', 'clipboard-write']
  });
  const page = await ctx.newPage();
  const log = { errors: [], requests: [], posts: 0 };
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => log.errors.push('request failed: ' + r.url()));
  page.on('request', (r) => { log.requests.push(r.url()); if (r.method() !== 'GET') log.posts++; });
  if (o.init) await page.addInitScript(o.init);
  await page.goto(o.url || base + '/index.html', { waitUntil: 'load' });
  if (o.js !== false) await page.evaluate(() => (document.fonts && document.fonts.ready) || true);
  await wait(o.settle || 1400);
  return { ctx, page, log };
}
const filmTo = (page, p) => page.evaluate((q) => {
  document.documentElement.style.scrollBehavior = 'auto';
  const f = document.querySelector('[data-film]'), s = document.querySelector('[data-stage]');
  window.scrollTo(0, f.getBoundingClientRect().top + window.scrollY + q * (f.offsetHeight - s.clientHeight));
}, p);
const scene = (page) => page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('[data-goto]'));
  return { nav: b.findIndex((x) => x.getAttribute('aria-current') === 'true'), out: getComputedStyle(document.querySelector('[data-stage]')).getPropertyValue('--out').trim() };
});
const overflow = (page) => page.evaluate(async () => {
  document.documentElement.style.scrollBehavior = 'auto';
  const de = document.documentElement, worst = { over: 0, at: 0 };
  const max = de.scrollHeight - window.innerHeight;
  for (let i = 0; i <= 8; i++) {
    window.scrollTo(0, max * i / 8);
    await new Promise((r) => setTimeout(r, 120));
    const over = de.scrollWidth - de.clientWidth;
    if (over > worst.over) { worst.over = over; worst.at = Math.round(max * i / 8); }
  }
  window.scrollTo(0, 0);
  return worst;
});
async function painted(page, selector) {
  const el = await page.$(selector);
  if (!el) return 0;
  const box = await el.boundingBox();
  if (!box || box.width < 2 || box.height < 2) return 0;
  const shot = await page.screenshot({ clip: { x: box.x, y: Math.max(0, box.y), width: Math.min(box.width, 600), height: Math.min(box.height, 400) } });
  return shot.length;
}

/* contrast, from the colour tokens in styles.css */
function lum(hex) {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  /* set CHROMIUM_PATH to use a particular Chromium, for example when the installed Playwright expects a different build */
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const today = new Date();
  console.log('Checking ' + base + '  (' + browser.version() + ')\n');

  /* ---- every size: errors, sideways scrolling, the film in both directions */
  for (const [w, h, dsf] of [[320, 640, 2], [390, 844, 2], [768, 1024, 1], [1440, 900, 1]]) {
    const tag = w + 'x' + h;
    const { ctx, page, log } = await open(browser, base, { w, h, dsf });
    check(tag + ': no script errors or failed requests', log.errors.length === 0, log.errors.slice(0, 3).join(' | '));
    check(tag + ': opening film is on', await page.evaluate(() => document.documentElement.classList.contains('film-on')));
    const seen = [];
    for (const p of [0, 0.31, 0.53, 0.72, 0.97]) { await filmTo(page, p); await wait(520); seen.push((await scene(page)).nav); }
    check(tag + ': scenes 1 to 5 appear in order going forward', seen.join() === '0,1,2,3,4', seen.join());
    check(tag + ': the plate is painted on the last scene', (await painted(page, '[data-film-plate]')) > 30000);
    const back = [];
    for (const p of [0.72, 0.31, 0]) { await filmTo(page, p); await wait(520); back.push((await scene(page)).nav); }
    const end = await scene(page);
    check(tag + ': scenes return in order going back, cover restored', back.join() === '3,1,0' && parseFloat(end.out) === 0, back.join() + ' out=' + end.out);
    check(tag + ': the plate is painted on the cover', (await painted(page, '[data-film-plate]')) > 30000);
    const worst = await overflow(page);
    check(tag + ': no sideways scrolling anywhere on the page', worst.over <= 0, worst.over > 0 ? worst.over + 'px at y=' + worst.at : '');
    check(tag + ': every request stays on this site', log.requests.every((u) => u.startsWith(base)), log.requests.filter((u) => !u.startsWith(base)).slice(0, 2).join(' '));
    await ctx.close();
  }

  /* ---- structure and content */
  {
    const { ctx, page } = await open(browser, base, {});
    const info = await page.evaluate((anchors) => {
      const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
      const links = Array.from(document.querySelectorAll('a[href^="#"]')).map((a) => a.getAttribute('href').slice(1));
      return {
        dup, missing: anchors.filter((a) => !document.getElementById(a)), dead: links.filter((l) => l && !document.getElementById(l)),
        noAlt: Array.from(document.querySelectorAll('img')).filter((i) => !(i.getAttribute('alt') || '').trim()).length,
        h1: document.querySelectorAll('h1').length, year: (document.querySelector('[data-year]') || {}).textContent,
        delivery: (document.querySelector('.delivery') || {}).textContent, note: (document.querySelector('.artnote') || {}).textContent,
        faqs: document.querySelectorAll('.faq details').length, resources: document.querySelectorAll('[data-res]').length,
        external: Array.from(document.querySelectorAll('a[target="_blank"]')).every((a) => /noopener/.test(a.rel))
      };
    }, ANCHORS);
    check('every section anchor exists', info.missing.length === 0, info.missing.join());
    check('no duplicate ids', info.dup.length === 0, info.dup.join());
    check('every in-page link has a target', info.dead.length === 0, info.dead.join());
    check('one h1, every image has alt text', info.h1 === 1 && info.noAlt === 0, 'h1=' + info.h1 + ' noAlt=' + info.noAlt);
    check('copyright year is the current year', info.year === String(today.getFullYear()), info.year);
    check('delivery note is word for word', info.delivery === DELIVERY);
    check('artwork label is present', /symbolic artwork \/ not impact data/i.test(info.note || ''));
    check('six questions and five resources', info.faqs === 6 && info.resources === 5, info.faqs + ' / ' + info.resources);
    check('external links open safely (noopener)', info.external);

    /* partners */
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('#partners').scrollIntoView(); });
    await wait(500);
    const tabs = ['community', 'schools', 'health', 'business', 'supporters'];
    let tabsOk = true;
    for (const t of tabs) {
      await page.click('#tab-' + t);
      await wait(120);
      const st = await page.evaluate((id) => ({ sel: document.querySelector('#tab-' + id).getAttribute('aria-selected'), shown: Array.from(document.querySelectorAll('[data-panel]')).filter((p) => !p.hidden).map((p) => p.getAttribute('data-panel')).join() }), t);
      if (st.sel !== 'true' || st.shown !== t) tabsOk = false;
    }
    check('each partner tab shows only its own panel', tabsOk);
    await page.focus('#tab-supporters');
    await page.keyboard.press('ArrowDown');
    const wrapped = await page.evaluate(() => document.activeElement.id + '/' + document.querySelector('#tab-community').getAttribute('aria-selected'));
    await page.keyboard.press('End');
    const ended = await page.evaluate(() => document.activeElement.id);
    check('arrow keys and End move between partner tabs', wrapped === 'tab-community/true' && ended === 'tab-supporters', wrapped + ' ' + ended);
    await page.click('#tab-schools');
    await wait(900);
    check('the partner plate is painted', (await painted(page, '.partners-fig .plate')) > 30000);
    await page.click('#panel-schools [data-brief-area]');
    await wait(500);
    check('a group button sets the area of work in the brief', (await page.inputValue('#brief-area')) === 'Schools & educators');

    /* resources */
    await page.evaluate(() => document.querySelector('#resources').scrollIntoView());
    await wait(400);
    const count = () => page.textContent('[data-count]');
    await page.fill('#res-q', 'veta');
    const c1 = await count();
    await page.fill('#res-q', '');
    await page.click('[data-finder] [data-topic="learning"]');
    const c2 = await count();
    await page.fill('#res-q', 'zzzz');
    const emptyShown = await page.evaluate(() => !document.querySelector('[data-empty]').hidden && document.querySelector('[data-list]').hidden);
    await page.click('[data-empty] [data-reset]');
    const c3 = await count();
    const pressed = await page.getAttribute('[data-finder] [data-topic="all"]', 'aria-pressed');
    check('search narrows the list ("veta" leaves 1 of 5)', /Showing 1 of 5/.test(c1), c1);
    check('a topic filter narrows the list (Learning leaves 1 of 5)', /Showing 1 of 5/.test(c2), c2);
    check('a search with no match shows the empty state', emptyShown);
    check('Reset restores all five and All topics', /Showing 5 of 5/.test(c3) && pressed === 'true', c3);
    await page.click('#research summary');
    check('the research drawer opens', await page.evaluate(() => document.querySelector('#research').open));

    /* questions, by keyboard */
    await page.focus('.faq details:first-child summary');
    await page.keyboard.press('Enter');
    const opened = await page.evaluate(() => document.querySelector('.faq details').open);
    await page.keyboard.press('Enter');
    const closed = await page.evaluate(() => !document.querySelector('.faq details').open);
    check('a question opens and closes with the Enter key', opened && closed);
    await ctx.close();
  }

  /* ---- the brief tool */
  {
    const { ctx, page, log } = await open(browser, base, {});
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('#collaborate').scrollIntoView(); });
    await wait(500);
    const before = log.requests.length;
    await page.click('[data-copy]');
    await wait(200);
    const v = await page.evaluate(() => ({ invalid: document.querySelector('#brief-org').getAttribute('aria-invalid'), focus: document.activeElement.id, status: document.querySelector('[data-status]').textContent, err: document.querySelector('#brief-org-err').textContent }));
    check('an empty brief is not copied; the first missing field is named and focused', v.invalid === 'true' && v.focus === 'brief-org' && /not ready/.test(v.status) && v.err.length > 5, v.status);
    await page.fill('#brief-org', 'Example Secondary School <test>');
    await page.selectOption('#brief-area', { label: 'Schools & educators' });
    await page.fill('#brief-priority', 'Attendance in the second term.');
    await page.fill('#brief-help', 'Review one student-support resource.');
    await page.click('[data-copy]');
    await wait(400);
    const status = await page.textContent('[data-status]');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const dateWord = today.toLocaleDateString('en-US', { month: 'long' });
    check('Copy says exactly "Copied to clipboard."', status === 'Copied to clipboard.', status);
    check('the copied brief holds the entries, a date and the "no message was sent" line',
      clip.includes('Example Secondary School <test>') && clip.includes('Schools & educators') && clip.includes('Attendance in the second term.') && clip.includes('No message was sent') && clip.includes(String(today.getFullYear())) && /DANDELION FOUNDATION/.test(clip), dateWord);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-download]')]);
    const saved = fs.readFileSync(await dl.path(), 'utf8');
    check('Download gives a dated .txt with the same brief', /^dandelion-collaboration-brief-\d{4}-\d{2}-\d{2}\.txt$/.test(dl.suggestedFilename()) && saved === clip, dl.suggestedFilename());
    const after = await page.evaluate(() => ({ search: location.search, cookies: document.cookie, ls: localStorage.length, ss: sessionStorage.length, sent: /sent/i.test(document.querySelector('[data-status]').textContent) && !/Download started/.test(document.querySelector('[data-status]').textContent) }));
    check('nothing is sent: no new requests, no form data in the address', log.requests.length === before && log.posts === 0 && after.search === '', (log.requests.length - before) + ' new requests');
    check('nothing is stored: no cookies, local storage or session storage', after.cookies === '' && after.ls === 0 && after.ss === 0);
    check('no "sent" confirmation is ever shown', !after.sent);

    /* nothing moves while someone is writing */
    await page.focus('#brief-priority');
    await page.mouse.wheel(0, 260);
    await wait(250);
    await page.mouse.wheel(0, -260);
    await wait(120);
    const slipping = await page.evaluate(() => Array.from(document.querySelectorAll('.misreg, .term-no')).filter((e) => e.style.getPropertyValue('--slip')).length);
    check('with a brief field focused, scrolling does not move the print register', slipping === 0, slipping + ' headings slipping');
    await ctx.close();

    const blocked = await open(browser, base, { clipboard: false, init: () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) } }); document.execCommand = () => false; } });
    await blocked.page.fill('#brief-org', 'Org'); await blocked.page.selectOption('#brief-area', { index: 1 });
    await blocked.page.fill('#brief-priority', 'P'); await blocked.page.fill('#brief-help', 'H');
    await blocked.page.click('[data-copy]');
    await wait(400);
    const fb = await blocked.page.evaluate(() => ({ shown: !document.querySelector('[data-manual]').hidden, text: document.querySelector('#brief-manual').value, status: document.querySelector('[data-status]').textContent }));
    check('when copying is blocked, the brief is shown for manual copying and Download is offered', fb.shown && fb.text.includes('No message was sent') && /Download \.txt/.test(fb.status), fb.status);
    await blocked.ctx.close();

    /* a host page may supply its own way to save a file (some viewers do not allow ordinary downloads) */
    const hosted = await open(browser, base, { init: () => { window.DFHost = { saveFile: (name, text) => { window.__saved = [name, text]; return window.__decline ? Promise.reject({ code: 'declined' }) : Promise.resolve({ status: 'saved' }); } }; } });
    await hosted.page.fill('#brief-org', 'Org'); await hosted.page.selectOption('#brief-area', { index: 1 });
    await hosted.page.fill('#brief-priority', 'P'); await hosted.page.fill('#brief-help', 'H');
    await hosted.page.click('[data-download]');
    await wait(300);
    const hs = await hosted.page.evaluate(() => ({ saved: window.__saved, status: document.querySelector('[data-status]').textContent }));
    check('a host-supplied save is used when present, with the same file name and text', hs.saved && /^dandelion-collaboration-brief-\d{4}-\d{2}-\d{2}\.txt$/.test(hs.saved[0]) && hs.saved[1].includes('No message was sent') && hs.status === 'Download started.', hs.status);
    await hosted.page.evaluate(() => { window.__decline = true; });
    await hosted.page.click('[data-download]');
    await wait(300);
    const declined = await hosted.page.textContent('[data-status]');
    check('declining a host save says so and shows no error', declined === 'Download cancelled.', declined);
    await hosted.ctx.close();
  }

  /* ---- phone menu */
  {
    const { ctx, page } = await open(browser, base, { w: 390, h: 844, dsf: 2 });
    await page.click('[data-menu-btn]');
    const openNow = await page.evaluate(() => document.querySelector('[data-menu]').hasAttribute('data-open') && document.querySelector('[data-menu-btn]').getAttribute('aria-expanded') === 'true');
    await page.keyboard.press('Escape');
    const shut = await page.evaluate(() => !document.querySelector('[data-menu]').hasAttribute('data-open') && document.activeElement === document.querySelector('[data-menu-btn]'));
    check('phone menu opens, and Escape closes it and returns focus', openNow && shut);
    await ctx.close();
  }

  /* ---- reduced motion, and the still-page switch */
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const { ctx, page, log } = await open(browser, base, { w, h, reduce: true });
    const st = await page.evaluate(() => ({
      film: document.documentElement.classList.contains('film-on'),
      beats: Array.from(document.querySelectorAll('[data-beat]')).filter((b) => { const cs = getComputedStyle(b); return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) === 1 && b.getBoundingClientRect().height > 40; }).length,
      live: document.querySelectorAll('.plate-live').length,
      fits: (function () { const col = document.querySelector('.cover-text').getBoundingClientRect(); return Array.from(document.querySelectorAll('.poster .fit')).every((l) => l.getBoundingClientRect().right <= col.right + 1); })()
    }));
    check(w + 'x' + h + ' reduced motion: film is off, all five scenes read as a page, no live canvas', !st.film && st.beats === 5 && st.live === 0 && log.errors.length === 0, JSON.stringify(st));
    check(w + 'x' + h + ' reduced motion: the headline fits its column', st.fits);
    check(w + 'x' + h + ' reduced motion: still plates are painted', (await painted(page, '.beat-cover .plate')) > 20000);
    const worst = await overflow(page);
    check(w + 'x' + h + ' reduced motion: no sideways scrolling', worst.over <= 0, String(worst.over));
    await page.click('[data-film-toggle]');
    await wait(700);
    const on = await page.evaluate(() => document.documentElement.classList.contains('film-on'));
    await page.click('[data-film-toggle]');
    await wait(500);
    const off = await page.evaluate(() => !document.documentElement.classList.contains('film-on'));
    check(w + 'x' + h + ' the switch turns the film on and back off', on && off);
    await ctx.close();
  }

  /* ---- without JavaScript */
  {
    const { ctx, page } = await open(browser, base, { w: 390, h: 844, js: false });
    const text = await page.evaluate(() => document.body.innerText);
    const imgs = await page.evaluate(() => { const i = document.querySelector('.beat-cover img'); return i.complete && i.naturalWidth > 0; });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('without JavaScript: headline, terms, all five partner groups, resources and questions are readable',
      /Learning/.test(text) && /One task\. One scope\. One review\./.test(text) && /Supporters & funders/.test(text) && /Shule Direct/.test(text) && /Is the English tutoring business part of Dandelion\?/.test(text) && text.includes(DELIVERY));
    check('without JavaScript: the painting still shows and nothing scrolls sideways', imgs && over <= 0, 'over=' + over);
    await ctx.close();
  }

  /* ---- without WebGL, and opened straight from disk */
  {
    const noGL = await open(browser, base, { init: () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t) { return /webgl/.test(t) ? null : g.apply(this, arguments); }; } });
    await filmTo(noGL.page, 0.31); await wait(600);
    check('without WebGL: the film still runs on the plain painter', noGL.log.errors.length === 0 && (await painted(noGL.page, '[data-film-plate]')) > 30000 && (await scene(noGL.page)).nav === 1, noGL.log.errors.slice(0, 2).join(' | '));
    await noGL.page.evaluate(() => document.querySelector('#focus').scrollIntoView()); await wait(1600);
    check('without WebGL: the halftone figures still print as flat tints', (await painted(noGL.page, 'canvas[data-figure="root"]')) > 8000);
    await noGL.ctx.close();

    const disk = await open(browser, base, { url: 'file://' + path.join(ROOT, 'index.html') });
    await filmTo(disk.page, 0.53); await wait(700);
    /* browsers refuse to load local font files and to hand local images to WebGL; both are expected here */
    const errs = disk.log.errors.filter((e) => !/tainted|cross-origin|SecurityError|CORS policy|request failed: file:|ERR_FAILED/i.test(e));
    const mode = await disk.page.evaluate(() => (document.querySelector('.plate-live') || {}).tagName === 'CANVAS');
    check('opened straight from disk: the page still works (fallback typefaces, plain painter) and the plate is painted', errs.length === 0 && mode && (await painted(disk.page, '[data-film-plate]')) > 30000 && (await scene(disk.page)).nav === 2, errs.slice(0, 2).join(' | '));
    await disk.ctx.close();
  }

  /* ---- colour contrast of the text pairs in use (WCAG 2 ratio) */
  const pairs = [
    ['body text on paper', '#0B0A09', '#FAF9F6', 4.5], ['body text on tinted paper', '#0B0A09', '#F2F1ED', 4.5],
    ['muted text on paper', '#57524A', '#FAF9F6', 4.5], ['muted text on tinted paper', '#57524A', '#F2F1ED', 4.5],
    ['link blue on tinted paper', '#2A568D', '#F2F1ED', 4.5], ['ochre labels on paper', '#A8481F', '#FAF9F6', 4.5], ['ochre labels on tinted paper', '#A8481F', '#F2F1ED', 4.5],
    ['text on the dark sheet', '#F4F1E8', '#0B0A09', 4.5], ['muted text on the dark sheet', '#C9C3B4', '#0B0A09', 4.5], ['gold labels on the dark sheet', '#D49B35', '#0B0A09', 4.5]
  ];
  pairs.forEach(([name, fg, bg, min]) => { const r = ratio(fg, bg); check('contrast: ' + name + ' is at least ' + min + ':1', r >= min, r.toFixed(2) + ':1'); });

  await browser.close();
  srv.close();
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed.');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

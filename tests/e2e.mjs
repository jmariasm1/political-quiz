// End-to-end check of a real visit. Run with: npm run e2e
// Serves site/ locally, takes the quiz in both languages, and checks saving, filtering, colour views,
// PNGs, privacy, themes and phone layout. Answers here are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(SITE, p);
  if (!file.startsWith(SITE) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const model = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'model.json'), 'utf8'));
const subCount = model.clusters.flatMap((c) => c.children).length;
const leafCount = model.clusters.flatMap((c) => c.children).flatMap((s) => s.children).length;
const inGroup = (id) => model.parties.filter((p) => model.groupings.find((g) => g.id === id).countries.includes(p.country)).length;

const browser = await chromium.launch();
const issues = [];
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

async function newPage(options = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', ...options });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') issues.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => issues.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) issues.push(`${r.status()}: ${r.url()}`); });
  page.on('request', (r) => {
    if (!/^(data:|blob:)/.test(r.url()) && !r.url().startsWith(base)) issues.push(`external request: ${r.url()}`);
  });
  return page;
}
const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
const pngSize = (file) => {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

async function answerQuiz(page, value) {
  for (let s = 0; s < 5; s++) {
    await page.waitForSelector('.quiz-section');
    for (const fieldset of await page.$$('fieldset.q')) {
      const input = await fieldset.$(`input[value="${value}"]`);
      await input.check({ force: true });
    }
    await page.click('[data-next]');
  }
}

const tmp = fs.mkdtempSync(path.join(process.env.TEMP ?? '/tmp', 'compass-e2e-'));

console.log('English');
const page = await newPage();
await page.goto(`${base}/en/#/quiz`);
await ready(page);

await check('the quiz will not advance with statements unanswered', async () => {
  // The button is aria-disabled rather than disabled, so a click can guide you to the gap.
  await page.click('[data-next]', { force: true });
  assert.match(await page.textContent('.quiz-section'), /Section 1 \| Economics/);
  assert.match(await page.textContent('[data-hint]'), /remaining 4 statements/);
});

await check('the first section shows four statements on the five-point scale', async () => {
  assert.equal((await page.$$('fieldset.q')).length, 4);
  assert.match(await page.textContent('fieldset.q legend'), /Q01\. Higher taxes on high incomes/);
  assert.equal((await page.$$('fieldset.q:first-of-type input[type=radio]')).length, 5);
});

await check('progress survives a reload mid-quiz', async () => {
  await (await page.$('fieldset.q input[value="4"]')).check({ force: true });
  await page.reload();
  await ready(page);
  assert.match(await page.textContent('.quiz-count'), /1 \/ 20/);
  assert.ok(await page.$eval('fieldset.q input[value="4"]', (i) => i.checked));
});

await check('finishing the quiz opens one story, starting with a written headline and top parties', async () => {
  await answerQuiz(page, 4);
  await page.waitForSelector('.story-head h1');
  assert.match(page.url(), /#\/results\?r=r/);
  assert.match(await page.textContent('.story-head h1'), /^You sit closest to the /);
  assert.equal((await page.$$('.podium li')).length, 3);
  for (const id of ['s-closest', 's-dims', 's-tiers', 's-map', 's-compare', 's-all']) assert.ok(await page.$(`#${id}`), id);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gic.v1')));
  assert.equal(stored.results.length, 1);
  assert.equal(stored.results[0].answers.length, 20);
  assert.equal(stored.draft, null);
});

await check('the result is still there after leaving and coming back', async () => {
  await page.goto(`${base}/en/#/`);
  await page.reload();
  await ready(page);
  await page.waitForSelector('.saved');
  assert.match(await page.textContent('#saved-h'), /saved results/);
});

await check('a second attempt is kept alongside the first and can be compared', async () => {
  await page.goto(`${base}/en/#/quiz?new=1`);
  await answerQuiz(page, 2);
  await page.waitForSelector('.story-head h1');
  assert.equal((await page.$$('[data-switch] option')).length, 2);
  const labels = await page.$$eval('#s-compare [data-pick="a"] optgroup', (g) => g.map((x) => x.label));
  assert.ok(labels.includes('Past results'));
});

const tileCount = () => page.$$eval('#s-tiers .tile', (t) => t.length);

await check('fixed cutoffs are the default, and spread tiers are 5 or 10 points wide with no quota', async () => {
  await page.goto(`${base}/en/#/results`);
  await page.waitForSelector('#s-tiers .tile');
  assert.equal(await page.getAttribute('#s-tiers [data-mode="fixed"]', 'aria-pressed'), 'true');
  assert.match(await page.textContent('#s-tiers .tier-label span'), /70 and up/);
  assert.equal(await tileCount(), model.parties.length);
  await page.click('#s-tiers [data-mode="spread"]');
  assert.equal(await tileCount(), model.parties.length);
  const labels = await page.$$eval('#s-tiers .tier-label span', (s) => s.map((x) => x.textContent));
  const inner = labels.slice(1, -1).map((l) => l.match(/(\d+) to <(\d+)/).slice(1).map(Number));
  assert.equal(inner.length, 4);
  for (const [a, b] of inner) assert.ok([5, 10].includes(b - a), `${a} to ${b}`);
  await page.click('#s-tiers [data-mode="fixed"]');
});

await check('tier tiles switch between cluster and subgroup colours', async () => {
  const colours = () => page.$$eval('#s-tiers .tile', (t) => new Set(t.map((x) => x.style.getPropertyValue('--c'))).size);
  assert.equal(await colours(), model.clusters.length);
  await page.click('#s-tiers [data-color-by="leaf"]');
  assert.equal(await colours(), leafCount);
  assert.equal((await page.$$('#s-tiers .tile-key')).length, leafCount);
  await page.click('#s-tiers [data-color-by="sub"]');
  assert.equal(await colours(), subCount);
  assert.equal((await page.$$('#s-tiers .tile-key')).length, subCount);
});

await check('the map follows the same switch, with each subgroup in its own colour', async () => {
  const fills = () => page.$$eval('#s-map [data-party]', (n) => new Set(n.map((x) => x.getAttribute('fill'))).size);
  assert.equal(await fills(), subCount);
  await page.click('#s-map [data-color-by="leaf"]');
  assert.equal(await fills(), leafCount);
  assert.equal((await page.$$('#s-map .key-btn')).length, leafCount);
  await page.click('#s-map [data-color-by="cluster"]');
  assert.equal(await fills(), model.clusters.length);
  assert.equal((await page.$$('#s-map .key-btn')).length, model.clusters.length);
});

await check('one filter scopes every chart, by grouping and by country, without moving any party', async () => {
  const positions = () => page.$$eval('#s-map [data-party]', (n) => Object.fromEntries(n.map((e) => [e.dataset.party, e.getAttribute('d')])));
  const all = await positions();
  assert.equal(Object.keys(all).length, model.parties.length);
  await page.selectOption('.story-nav [data-scope-select]', 'g:g7');
  assert.equal(await tileCount(), inGroup('g7'));
  assert.match(page.url(), /scope=g(%3A|:)g7/);
  await page.selectOption('.story-nav [data-scope-select]', 'g:brics');
  assert.equal(await tileCount(), inGroup('brics'));
  const brics = await positions();
  for (const [id, d] of Object.entries(brics)) assert.equal(d, all[id], `${id} moved when the filter changed`);
  await page.selectOption('.story-nav [data-scope-select]', 'g:g20');
  assert.equal(await tileCount(), inGroup('g20'));
  await page.selectOption('.story-nav [data-scope-select]', 'c:SA');
  assert.equal(await tileCount(), 1);
  await page.selectOption('.story-nav [data-scope-select]', 'all');
  assert.equal(await tileCount(), model.parties.length);
});

await check('the map tooltip shows the logo, a small flag and the country name', async () => {
  await page.goto(`${base}/en/#/map`);
  await page.waitForSelector('[data-party]');
  const dot = await page.$('[data-party="br-pt"]');
  await dot.scrollIntoViewIfNeeded();
  const box = await dot.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('.tip:not([hidden])');
  const tip = await page.$eval('.tip', (t) => ({ text: t.textContent, images: [...t.querySelectorAll('img')].map((i) => i.getAttribute('src')) }));
  assert.match(tip.text, /Workers' Party/);
  assert.match(tip.text, /Brazil/);
  assert.ok(tip.images.some((s) => s.includes('/logos/br-pt')), 'logo');
  assert.ok(tip.images.some((s) => s.includes('/flags/br')), 'flag');
  await page.mouse.move(2, 2);
});

await check('the map page shows the person, the axis charts and the group table', async () => {
  const svg = await page.$eval('[data-chart="map"]', (n) => n.innerHTML);
  assert.ok(svg.includes('YOU'));
  assert.match(await page.textContent('[data-map-hidden]'), /parties have no label/);
  for (const key of ['loadings', 'circle', 'variance', 'you', 'heat']) assert.ok(await page.$(`[data-chart="${key}"] svg`), key);
});

await check('a crowded map can open wide enough to label more parties, and go back', async () => {
  const labelled = () => page.$$eval('[data-chart="map"] svg text', (n) => n.length);
  const fitted = await labelled();
  const width = () => page.$eval('[data-chart="map"] svg', (s) => s.getBoundingClientRect().width);
  const host = await page.$eval('[data-chart="map"]', (h) => h.clientWidth);
  await page.click('[data-map-toggle]');
  assert.ok((await width()) > host);
  assert.ok((await labelled()) > fitted);
  const svg = await page.$eval('[data-chart="map"]', (n) => n.innerHTML);
  assert.ok(svg.includes('CPC CA') && svg.includes('CPC CN'), 'parties sharing an abbreviation must be told apart');
  await page.click('[data-map-toggle]');
  assert.ok((await width()) <= host + 1);
});

await check('map labels never overlap, wherever the person lands, in all three colour views', async () => {
  const patterns = [
    Array(20).fill(3),
    model.questions.map((q) => (q.sign > 0 ? 5 : 1)),
    model.questions.map((q) => (q.sign > 0 ? 1 : 5)),
    model.questions.map((q) => (q.sign > 0 ? 4 : 2)),
    model.questions.map((q) => (q.sign > 0 ? 2 : 4)),
    model.questions.map((q, i) => (i < 4 ? (q.sign > 0 ? 5 : 1) : q.sign > 0 ? 2 : 4)),
    model.questions.map((q, i) => (i < 4 ? (q.sign > 0 ? 1 : 5) : q.sign > 0 ? 4 : 2)),
    model.questions.map((q, i) => (i >= 8 && i < 12 ? (q.sign > 0 ? 1 : 5) : q.sign > 0 ? 4 : 2)),
  ];
  const labelled = await newPage();
  for (const [i, answers] of patterns.entries()) {
    await labelled.goto(`${base}/en/#/`);
    await labelled.evaluate((a) => localStorage.setItem('gic.v1', JSON.stringify({ results: [{ id: 'r1', at: '2026-01-01T00:00:00Z', answers: a, version: 'x' }], activeId: 'r1', scope: 'all' })), answers);
    await labelled.goto(`${base}/en/#/map?pattern=${i}`);
    await labelled.reload();
    await labelled.waitForSelector('[data-party]');
    for (const view of ['cluster', 'sub', 'leaf']) {
      await labelled.click(`[data-color-by="${view}"]`);
      const clashes = await labelled.$eval('[data-chart="map"] svg', (svg) => {
        const boxes = [...svg.querySelectorAll('text')]
          .filter((t) => !t.hasAttribute('transform'))
          .map((t) => ({ label: t.textContent, b: t.getBoundingClientRect() }));
        const out = [];
        boxes.forEach((p, a) => {
          boxes.slice(a + 1).forEach((q) => {
            const dx = Math.min(p.b.right, q.b.right) - Math.max(p.b.left, q.b.left);
            const dy = Math.min(p.b.bottom, q.b.bottom) - Math.max(p.b.top, q.b.top);
            if (dx > 1 && dy > 3) out.push(`${p.label}/${q.label}`);
          });
        });
        return out;
      });
      assert.deepEqual(clashes, [], `pattern ${i} (${view}) has overlapping labels`);
    }
  }
  await labelled.context().close();
});

await check('compare shows the proximity score, radar, and agree or diverge rows', async () => {
  await page.goto(`${base}/en/#/compare?a=de-grune&b=us-gop`);
  await page.waitForSelector('.ad-row');
  assert.equal((await page.$$('.ad-row')).length, 5);
  assert.ok(await page.$('[data-chart="radar"] svg polygon'));
  await page.click('[data-swap]');
  assert.match(page.url(), /a=us-gop&b=de-grune/);
  assert.match(await page.textContent('.cmp-big'), /\/100/);
});

await check('selecting a party in the story scrolls to the comparison and fills it in', async () => {
  await page.goto(`${base}/en/#/results`);
  await page.waitForSelector('#s-tiers .tile');
  await page.click('#s-tiers .tile[data-compare-party="us-gop"]');
  assert.equal(await page.$eval('#s-compare [data-pick="b"]', (s) => s.value), 'us-gop');
  assert.match(page.url(), /#\/results/);
});

await check('every PNG button downloads a real image', async () => {
  for (const [hash, keys] of [
    ['#/results', ['profile', 'distance', 'top', 'best', 'tiers', 'map', 'interp', 'heat', 'compare']],
    ['#/method', ['sil']],
  ]) {
    await page.goto(`${base}/en/${hash}`);
    await page.waitForSelector(`[data-png="${keys[0]}"]`);
    for (const key of keys) {
      const wait = page.waitForEvent('download', { timeout: 30000 });
      await page.click(`[data-png="${key}"]`);
      const download = await wait;
      const file = path.join(tmp, download.suggestedFilename());
      await download.saveAs(file);
      const [w, h] = pngSize(file);
      assert.ok(w >= 1200 && h >= 400, `${key}: ${w}x${h}`);
      assert.ok(fs.statSync(file).size > 50_000, `${key} is suspiciously small`);
    }
  }
});

await check('the CSV download has one row per party', async () => {
  await page.goto(`${base}/en/#/results`);
  await page.waitForSelector('[data-csv]');
  const wait = page.waitForEvent('download');
  await page.click('[data-csv]');
  const file = path.join(tmp, 'ranking.csv');
  await (await wait).saveAs(file);
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\r\n').length, model.parties.length + 1);
});

await check('light is the default even on a dark-mode device, and the switch changes and remembers it', async () => {
  const visitor = await newPage({ colorScheme: 'dark' });
  const background = () => visitor.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const barColour = () => visitor.getAttribute('meta[name="theme-color"]', 'content');
  await visitor.goto(`${base}/en/#/`);
  await ready(visitor);
  await visitor.waitForSelector('[data-party]');
  assert.equal(await visitor.getAttribute('html', 'data-theme'), 'light');
  assert.equal(await background(), 'rgb(255, 255, 255)');
  assert.equal(await barColour(), '#ffffff');
  await visitor.click('[data-theme-toggle]');
  assert.equal(await visitor.getAttribute('html', 'data-theme'), 'dark');
  assert.equal(await background(), 'rgb(22, 22, 22)');
  assert.equal(await barColour(), '#161616');
  await visitor.reload();
  await ready(visitor);
  assert.equal(await visitor.getAttribute('html', 'data-theme'), 'dark');
  assert.equal(await barColour(), '#161616');
  await visitor.click('[data-theme-toggle]');
  await visitor.reload();
  await ready(visitor);
  assert.equal(await visitor.getAttribute('html', 'data-theme'), 'light');
  await visitor.context().close();
});

await check('deleting one result and then all data works', async () => {
  await page.goto(`${base}/en/#/`);
  await page.waitForSelector('[data-delete]');
  await page.click('[data-delete]');
  assert.equal((await page.$$('.saved')).length, 1);
  page.once('dialog', (d) => d.accept());
  await page.click('[data-delete-all]');
  await page.waitForFunction(() => !document.querySelector('.saved'));
  assert.equal(await page.evaluate(() => localStorage.getItem('gic.v1')), null);
});

await check('the results page invites you to the quiz when there is no result', async () => {
  await page.goto(`${base}/en/#/results`);
  await page.waitForSelector('.empty');
});

console.log('Spanish');
const es = await newPage({ locale: 'es-CO' });
await check('the site root sends a Spanish browser to the Spanish version', async () => {
  await es.goto(`${base}/`);
  await es.waitForURL(/\/es\//);
  await ready(es);
  assert.equal(await es.getAttribute('html', 'lang'), 'es');
});
await check('the quiz runs in Spanish and results read correctly, with a decimal comma', async () => {
  await es.goto(`${base}/es/#/quiz`);
  await es.waitForSelector('.quiz-section');
  assert.match(await es.textContent('.quiz-section'), /Sección 1 \| Economía/);
  assert.match(await es.textContent('fieldset.q legend'), /Q01\. Los impuestos más altos/);
  await answerQuiz(es, 5);
  await es.waitForSelector('.story-head h1');
  assert.match(await es.textContent('.story-head h1'), /^Estás más cerca (del|de la|de los) /);
  assert.match(await es.textContent('.podium-score'), /^\d+,\d\d$/);
});
await check('the language switch keeps the page you are on', async () => {
  await es.goto(`${base}/es/#/map`);
  await es.waitForSelector('[data-party]');
  await es.click('.lang a[data-lang="en"]');
  await es.waitForURL(/\/en\/#\/map/);
  await ready(es);
  assert.match(await es.textContent('h1'), /The party map/);
});
await check('the saved language wins over the browser language at the root', async () => {
  await es.goto(`${base}/`);
  await es.waitForURL(/\/en\//);
});

console.log('Phone');
const phone = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await check('no page scrolls sideways, in either language', async () => {
  await phone.goto(`${base}/en/#/quiz`);
  await ready(phone);
  await answerQuiz(phone, 3);
  await phone.waitForSelector('.story-head h1');
  for (const lang of ['en', 'es']) {
    for (const hash of ['#/', '#/quiz?new=1', '#/results', '#/map', '#/compare', '#/method']) {
      await phone.goto(`${base}/${lang}/${hash}`);
      await ready(phone);
      await phone.waitForTimeout(150);
      const extra = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(extra <= 0, `${lang} ${hash} overflows by ${extra}px`);
    }
  }
});
await check('the phone map opens fitted to the screen and can switch to all labels', async () => {
  await phone.goto(`${base}/en/#/map`);
  await phone.waitForSelector('[data-party]');
  const size = () => phone.$eval('[data-chart="map"] svg', (s) => s.getBoundingClientRect().width);
  const host = await phone.$eval('[data-chart="map"]', (h) => h.clientWidth);
  assert.ok((await size()) <= host + 1, 'overview should fit the screen');
  await phone.click('[data-map-toggle]');
  assert.ok((await size()) > host, 'all-labels mode should be wider than the screen');
  await phone.click('[data-map-toggle]');
  assert.ok((await size()) <= host + 1);
});
await check('all-neutral answers land on the midpoint', async () => {
  await phone.goto(`${base}/en/#/results`);
  await phone.waitForSelector('[data-chart="profile"] svg');
  const label = await phone.$eval('[data-chart="profile"] svg', (s) => s.getAttribute('aria-label'));
  assert.equal(label.match(/50\/100/g).length, 5);
});

console.log('Blocked storage');
const blocked = await newPage();
await blocked.addInitScript(() => {
  const fail = () => { throw new Error('blocked'); };
  Object.defineProperty(window, 'localStorage', { get: fail });
});
await check('the quiz still works when the browser blocks storage, and says so', async () => {
  await blocked.goto(`${base}/en/#/quiz`);
  await ready(blocked);
  await answerQuiz(blocked, 4);
  await blocked.waitForSelector('.story-head h1');
  assert.match(await blocked.textContent('.story-head'), /blocking saved data/);
});

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });

const unique = [...new Set(issues)];
if (unique.length) {
  console.error(`\nProblems seen during the run:\n${unique.join('\n')}`);
  process.exit(1);
}
console.log(`\n${passed} checks passed, with no console errors and no external requests.`);

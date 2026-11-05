// Run with: node --test tests/
// Expected values come from tests/golden.json, written by pipeline/test_build_model.py from an
// independent numpy calculation, so the browser code is checked against a second implementation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  agreement, allGroups, assign, componentPoles, contributions, convexHull, csvCell, fixedTier, leanOf, mapFidelity, mostDistinctive, normalizeScope,
  nearestGroup, project, rankParties, rmsd, scopeParties, scoreAnswers, similarity, spreadTiers,
} from '../site/assets/js/core.js';
import { STRINGS, createT } from '../site/assets/js/i18n.js';

const model = JSON.parse(readFileSync(new URL('../site/data/model.json', import.meta.url), 'utf8'));
const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));
// No usable logo could be found for these yet, so they show their abbreviation instead.
const NO_LOGO_FOUND = ['mu-fmp', 'pl-centrum', 'si-dem'];
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('every answer pattern scores like the questionnaire formula', () => {
  for (const c of golden.cases) {
    const s = scoreAnswers(c.answers, model.questions, model.dimensions);
    s.forEach((v, i) => close(v, c.scores[i]));
  }
});

test('neutral answers land on the midpoint of every dimension', () => {
  assert.deepEqual(scoreAnswers(Array(25).fill(3), model.questions, model.dimensions), [50, 50, 50, 50, 50]);
});

test('similarity is 100 minus 25 times the root-mean-square difference between answers', () => {
  assert.equal(similarity(Array(25).fill(3), Array(25).fill(3)), 100);
  assert.equal(similarity(Array(25).fill(1), Array(25).fill(5)), 0);
  assert.equal(similarity(Array(25).fill(3), Array(25).fill(4)), 75);
});

test('the score range is exactly 0 to 100', () => {
  const low = model.questions.map((q) => (q.sign > 0 ? 1 : 5));
  const high = model.questions.map((q) => (q.sign > 0 ? 5 : 1));
  assert.deepEqual(scoreAnswers(low, model.questions, model.dimensions), [0, 0, 0, 0, 0]);
  assert.deepEqual(scoreAnswers(high, model.questions, model.dimensions), [100, 100, 100, 100, 100]);
});

test('similarity matches numpy for every party', () => {
  for (const c of golden.cases) {
    for (const p of model.parties) close(similarity(c.answers, p.answers), c.similarity[p.id]);
  }
});

test('rankings are sorted and stable', () => {
  const ranked = rankParties(golden.cases[0].answers, model.parties);
  assert.equal(ranked.length, model.parties.length);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score);
  assert.deepEqual(ranked.map((r) => r.party.id), rankParties(golden.cases[0].answers, [...model.parties].reverse()).map((r) => r.party.id));
});

test('placement matches numpy: nearest main cluster, then subgroup inside it, then current inside that', () => {
  for (const c of golden.cases) {
    const a = assign(c.answers, model);
    assert.equal(a.main.id, c.main);
    assert.equal(a.sub?.id ?? null, c.sub);
    assert.equal(a.leaf?.id ?? null, c.leaf);
    assert.ok(a.sub.parent === a.main.id && (!a.leaf || a.leaf.parent === a.sub.id));
    assert.equal(nearestGroup(a).id, c.leaf ?? c.sub);
  }
});

test('PCA projection matches numpy, and contributions sum to the coordinate', () => {
  for (const c of golden.cases) {
    const [x, y] = project(c.scores, model.pca);
    close(x, c.pc[0], 1e-6);
    close(y, c.pc[1], 1e-6);
    close(contributions(c.scores, model.pca, 0).reduce((s, v) => s + v, 0), x);
    close(contributions(c.scores, model.pca, 1).reduce((s, v) => s + v, 0), y);
    close(mapFidelity(c.scores, model.pca), c.fidelity, 1e-6);
  }
});

test('party positions in the model equal projecting their own scores', () => {
  for (const p of model.parties) {
    const [x, y] = project(p.scores, model.pca);
    close(x, p.pc[0], 0.001);
    close(y, p.pc[1], 0.001);
  }
});

test('tiers follow the fixed cutoffs at their boundaries', () => {
  const id = (s) => fixedTier(s, model.tiers).id;
  assert.equal(id(70), 'S');
  assert.equal(id(69.99), 'A');
  assert.equal(id(65), 'A');
  assert.equal(id(60), 'B');
  assert.equal(id(50), 'C');
  assert.equal(id(45), 'D');
  assert.equal(id(44.99), 'F');
  assert.equal(id(0), 'F');
});

/** An independent exhaustive search over the same rule, as a check on spreadTiers. */
function bruteForceGap(scores, nTiers) {
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  let best = Infinity;
  const widths = nTiers - 2;
  for (let mask = 0; mask < 2 ** widths; mask++) {
    for (let top = Math.ceil(high) + 60; top > Math.floor(low) - 60; top--) {
      const cuts = [top];
      for (let i = 0; i < widths; i++) cuts.push(cuts[i] - ((mask >> i) & 1 ? 10 : 5));
      const counts = new Array(nTiers).fill(0);
      for (const s of scores) {
        const k = cuts.findIndex((c) => s >= c);
        counts[k < 0 ? nTiers - 1 : k]++;
      }
      best = Math.min(best, Math.max(...counts) - Math.min(...counts));
    }
  }
  return best;
}

test('spread tiers: inner widths are 5 or 10, every party has a tier, and no cutoffs give a smaller gap', () => {
  for (const c of golden.cases) {
    const scores = rankParties(c.answers, model.parties).map((r) => r.score);
    const spread = spreadTiers(scores, model.tiers);
    const mins = spread.tiers.map((t) => t.min);
    assert.equal(spread.tiers.length, model.tiers.length);
    for (let i = 0; i < mins.length - 2; i++) {
      assert.ok([5, 10].includes(mins[i] - mins[i + 1]), `widths: ${mins.join(',')}`);
    }
    const counts = Object.fromEntries(spread.tiers.map((t) => [t.id, 0]));
    for (const s of scores) counts[fixedTier(s, spread.tiers).id]++;
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), model.parties.length);
    assert.equal(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)), spread.gap);
    assert.equal(spread.gap, bruteForceGap(scores, model.tiers.length), 'a better split exists');
  }
});

test('spread tiers keep the highest scores on top and the tier colours in place', () => {
  const scores = rankParties(golden.cases[0].answers, model.parties).map((r) => r.score);
  const spread = spreadTiers(scores, model.tiers);
  assert.equal(fixedTier(Math.max(...scores), spread.tiers).id, 'S');
  assert.equal(fixedTier(Math.min(...scores), spread.tiers).id, 'F');
  spread.tiers.forEach((t, i) => assert.equal(t.color, model.tiers[i].color));
});

test('scopes filter by grouping and by country, and fall back to all', () => {
  assert.equal(scopeParties('all', model).length, model.parties.length);
  for (const g of model.groupings) {
    const parties = scopeParties(`g:${g.id}`, model);
    assert.ok(parties.length > 0);
    assert.ok(parties.every((p) => g.countries.includes(p.country)));
  }
  for (const c of model.countries) {
    const parties = scopeParties(`c:${c.code}`, model);
    assert.ok(parties.length > 0, c.code);
    assert.ok(parties.every((p) => p.country === c.code));
  }
  assert.equal(scopeParties('g:nope', model).length, model.parties.length);
  assert.equal(normalizeScope('g:nope', model), 'all');
  assert.equal(normalizeScope('c:<script>', model), 'all');
  assert.equal(normalizeScope(undefined, model), 'all');
  assert.equal(normalizeScope('c:US', model), 'c:US');
});

test('the G20 grouping exists and Saudi Arabia has only its Royal Family', () => {
  const g20 = model.groupings.find((g) => g.id === 'g20');
  assert.equal(g20.countries.length, 19);
  const parties = scopeParties('g:g20', model);
  assert.ok(parties.length > 0 && parties.length < model.parties.length);
  assert.ok(parties.every((p) => p.country !== 'TW' && p.country !== 'AT'));
  const saudi = scopeParties('c:SA', model);
  assert.equal(saudi.length, 1);
  assert.match(saudi[0].name.en, /Royal Family/);
});

test('agreement groups rows by the display thresholds', () => {
  const t = { agree_max: 10, diverge_min: 25 };
  const a = agreement([50, 50, 50, 50, 50], [50, 60, 61, 74, 75], model.dimensions, t);
  assert.deepEqual(a.agree.map((r) => r.gap), [0, 10]);
  assert.deepEqual(a.partial.map((r) => r.gap), [11, 24]);
  assert.deepEqual(a.diverge.map((r) => r.gap), [25]);
  assert.equal(leanOf(50), null);
  assert.equal(leanOf(56), 'high');
  assert.equal(leanOf(44), 'low');
});

test('the written takeaway picks the dimension where someone stands out most', () => {
  const edge = model.dimensions.map((d, i) => (i === 2 ? 100 : 50));
  const found = mostDistinctive(edge, model.parties, model.dimensions);
  assert.equal(found.lean, 'high');
  assert.ok(found.share > 0.5);
});

test('axis poles come from the two largest loadings, in both languages', () => {
  for (const lang of ['en', 'es']) {
    const poles = componentPoles(0, model.pca, model.dimensions, lang);
    assert.equal(poles.positive.split(' · ').length, 2);
    assert.notEqual(poles.positive, poles.negative);
  }
});

test('convex hull handles pairs, collinear points and ordinary shapes', () => {
  assert.equal(convexHull([[0, 0], [1, 1]]).length, 2);
  assert.equal(convexHull([[0, 0], [1, 1], [2, 2]]).length, 2);
  assert.equal(convexHull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]]).length, 4);
});

test('every group at every level is listed once, and each party sits in one group at each level', () => {
  const ids = allGroups(model).map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of model.parties) {
    assert.ok((p.leaf ?? p.sub).startsWith(p.sub) && p.sub.startsWith(p.cluster), p.id);
  }
});

test('rmsd is zero for identical profiles', () => assert.equal(rmsd([1, 2, 3], [1, 2, 3]), 0));

test('CSV cells are quoted, and spreadsheet formulas are defused', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell(77.43), '77.43');
});

test('both languages define the same strings with the same placeholders', () => {
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(STRINGS.en), keys(STRINGS.es));
  const sample = {
    names: 'x', n: 2, total: 3, a: 'A', b: 'B', d: 1, v: 1, k: 1, s: 1, p: 1, id: 'C1', date: 'x', name: 'x', party: 'x', country: 'x',
    score: 1, cluster: 'x', tier: 'S', pole: 'x', poleA: 'x', poleB: 'x', who: 'x', pos: 'x', neg: 'x', x: 1, y: 1, kmax: 12, min: 1, overall: 1, total: 25,
    draws: 1, boot: 1, version: 'x', parties: 1, countries: 1, scope: 'x', phrase: 'x', dim: 'x', top: 'x', topCountry: 'x', topScore: 1, far: 'x',
    farCountry: 'x', farScore: 1, group: 'x', leftRight: 'x', upDown: 'x', near: 'x',
  };
  for (const key of keys(STRINGS.en)) {
    for (const lang of ['en', 'es']) {
      const value = STRINGS[lang][key];
      const rendered = typeof value === 'function' ? value(sample) : value;
      const text = Array.isArray(rendered) ? rendered.join(' ') : rendered;
      assert.ok(typeof text === 'string' && text.length > 0, `${lang}.${key}`);
      assert.ok(!text.includes('undefined'), `${lang}.${key} uses a value the sample does not supply: ${text}`);
    }
  }
  assert.equal(STRINGS.en['method.limits'].length, STRINGS.es['method.limits'].length);
});

test('the Spanish headline contracts "de el" to "del"', () => {
  assert.equal(STRINGS.es['story.headline']({ phrase: 'el centro y la centroderecha' }), 'Estás más cerca del centro y la centroderecha');
  assert.equal(STRINGS.es['story.headline']({ phrase: 'la izquierda verde' }), 'Estás más cerca de la izquierda verde');
});

test('exact values keep up to two decimals, so gaps add up with the scores shown beside them', () => {
  const t = createT('en');
  assert.equal(t.exact(37.5), '37.5');
  assert.equal(t.exact(18.75), '18.75');
  assert.equal(t.exact(100), '100');
  assert.equal(createT('es').exact(33.25), '33,25');
});

test('number formats follow the language', () => {
  assert.equal(createT('en').num(77.43, 2), '77.43');
  assert.equal(createT('es').num(77.43, 2), '77,43');
  assert.equal(createT('en').signed(-0.37, 2), '−0.37');
});

test('the questionnaire has 25 statements, 5 per dimension, in both languages', () => {
  assert.equal(model.questions.length, 25);
  for (const d of model.dimensions) {
    const qs = model.questions.filter((q) => q.dim === d.id);
    assert.equal(qs.length, 5);
  }
  assert.ok(model.questions.every((q) => q.en && q.es));
  assert.equal(model.scale.en.length, 5);
  assert.equal(model.scale.es.length, 5);
});

test('every party has a usable logo, flag, label and position, and every group a sentence form', () => {
  const ids = new Set();
  const labels = new Set();
  for (const p of model.parties) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    assert.ok(!labels.has(p.label), `duplicate label ${p.label}`);
    ids.add(p.id);
    labels.add(p.label);
    assert.ok(p.name.en && p.name.es, p.id);
    if (!NO_LOGO_FOUND.includes(p.id)) assert.ok(p.logo && p.logoAspect > 0, `${p.id} has no logo`);
    assert.ok(model.flagAspect[p.flag] > 0, p.id);
    assert.ok(model.clusters.some((c) => c.id === p.cluster), p.id);
  }
  for (const c of model.clusters) {
    assert.ok(c.label.en && c.label.es && c.phrase.en && c.phrase.es && !c.auto, c.id);
    for (const s of c.children) {
      assert.ok(s.label.en && s.label.es && s.phrase.en && s.phrase.es && !s.auto, s.id);
      assert.equal(s.children.reduce((sum, leaf) => sum + leaf.n, 0) || s.n, s.n);
      for (const leaf of s.children) assert.ok(leaf.label.en && leaf.label.es && leaf.phrase.en && leaf.phrase.es && leaf.blurb.en && leaf.blurb.es && !leaf.auto, leaf.id);
    }
    assert.equal(c.children.reduce((sum, s) => sum + s.n, 0) || c.n, c.n);
  }
});

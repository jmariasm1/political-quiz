// Pure model logic: no DOM, no storage. Everything here is covered by tests/core.test.mjs.

/** Scoring from the questionnaire: recode reverse items as 6 - r, then 6.25 * (sum - 4). Unrounded. */
export function scoreAnswers(answers, questions, dimensions) {
  return dimensions.map((dim) => {
    let sum = 0;
    questions.forEach((q, i) => {
      if (q.dim === dim.id) sum += q.sign > 0 ? answers[i] : 6 - answers[i];
    });
    return 6.25 * (sum - 4);
  });
}

/** Root-mean-square difference across the five dimensions, equal weights. */
export function rmsd(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

export const similarity = (a, b) => 100 - rmsd(a, b);

/** Project a five-dimensional position with the fitted PCA. */
export function project(v, pca, n = 2) {
  return pca.components.slice(0, n).map((row) => row.reduce((s, w, i) => s + w * (v[i] - pca.mean[i]), 0));
}

/** How much of this position's distance from the sample mean the 2D map can show (0 to 1). */
export function mapFidelity(v, pca) {
  const total = v.reduce((s, x, i) => s + (x - pca.mean[i]) ** 2, 0);
  if (total === 0) return 1;
  const [a, b] = project(v, pca);
  return (a * a + b * b) / total;
}

/** Per-dimension contribution to a principal-component coordinate; they sum to the coordinate. */
export const contributions = (v, pca, comp) => pca.components[comp].map((w, i) => w * (v[i] - pca.mean[i]));

/** Nearest main cluster, then nearest subgroup inside it, then nearest current inside that. Same five-dimensional RMSD throughout. */
export function assign(v, model) {
  const mains = model.clusters
    .map((c) => ({ cluster: c, distance: rmsd(v, c.centroid) }))
    .sort((x, y) => x.distance - y.distance);
  const main = mains[0].cluster;
  const subs = main.children
    .map((c) => ({ cluster: c, distance: rmsd(v, c.centroid) }))
    .sort((x, y) => x.distance - y.distance);
  const leaves = (subs[0]?.cluster.children ?? [])
    .map((c) => ({ cluster: c, distance: rmsd(v, c.centroid) }))
    .sort((x, y) => x.distance - y.distance);
  return {
    main,
    mainDistance: mains[0].distance,
    sub: subs[0]?.cluster ?? null,
    subDistance: subs[0]?.distance ?? null,
    leaf: leaves[0]?.cluster ?? null,
    leafDistance: leaves[0]?.distance ?? null,
    mains,
  };
}

/** The most detailed group someone was placed in. */
export const nearestGroup = (placed) => placed.leaf ?? placed.sub ?? placed.main;
export const nearestDistance = (placed) => placed.leafDistance ?? placed.subDistance ?? placed.mainDistance;

/** Every group at every level, each parent followed by its children. */
export const allGroups = (model) => model.clusters.flatMap((c) => [c, ...c.children.flatMap((s) => [s, ...s.children])]);

/** The most detailed group a party belongs to. */
export const finestGroupOf = (party, model) => allGroups(model).find((g) => g.id === (party.leaf ?? party.sub ?? party.cluster));

/** All parties, closest first. Ties break on id so the order never flickers between renders. */
export function rankParties(v, parties) {
  return parties
    .map((party) => ({ party, score: similarity(v, party.scores) }))
    .sort((x, y) => y.score - x.score || (x.party.id < y.party.id ? -1 : 1));
}

/** `tiers` is ordered from highest to lowest minimum. */
export function fixedTier(score, tiers) {
  return tiers.find((t) => score >= t.min) ?? tiers[tiers.length - 1];
}

/**
 * Spread mode: no quota of parties per tier. The inner tiers are each 5 or 10 points wide, the top
 * and bottom tiers stay open-ended so every party has a place, and the cutoffs are the ones that make
 * the fullest and emptiest tiers as close in size as possible, over every whole-number starting point.
 * Ties go to the tiers whose open ends span the least, then to the most even sizes overall.
 * Always computed on the full party list, so a filter can hide parties but never moves them.
 */
export function spreadTiers(scores, tiers) {
  const sorted = [...scores].sort((a, b) => b - a);
  const low = sorted[sorted.length - 1];
  const high = sorted[0];
  const widths = tiers.length - 2;
  let best = null;
  for (let mask = 0; mask < 2 ** widths; mask++) {
    const steps = Array.from({ length: widths }, (_, i) => (mask >> i) & 1 ? 10 : 5);
    const span = steps.reduce((a, b) => a + b, 0);
    for (let top = Math.max(Math.ceil(high), Math.floor(low) - 1 + span); top - span >= Math.floor(low) - 1; top--) {
      const cuts = [top];
      for (const w of steps) cuts.push(cuts[cuts.length - 1] - w);
      const counts = new Array(tiers.length).fill(0);
      for (const s of sorted) {
        let k = cuts.findIndex((c) => s >= c);
        if (k < 0) k = tiers.length - 1;
        counts[k]++;
      }
      const gap = Math.max(...counts) - Math.min(...counts);
      const open = Math.max(0, high - top - 10) + Math.max(0, cuts[cuts.length - 1] - low - 10);
      const mean = sorted.length / tiers.length;
      const unevenness = counts.reduce((sum, c) => sum + (c - mean) ** 2, 0);
      const better = !best || gap < best.gap ||
        (gap === best.gap && (open < best.open || (open === best.open && (unevenness < best.unevenness ||
          (unevenness === best.unevenness && top > best.cuts[0])))));
      if (better) best = { gap, open, unevenness, cuts, counts };
    }
  }
  return {
    gap: best.gap,
    counts: best.counts,
    tiers: tiers.map((tier, i) => ({ ...tier, min: i < best.cuts.length ? best.cuts[i] : 0 })),
  };
}

/** Scope strings: 'all', 'g:<grouping id>', 'c:<country code>'. Unknown scopes fall back to all. */
export function scopeParties(scope, model) {
  const [kind, id] = String(scope).split(':');
  if (kind === 'g') {
    const grouping = model.groupings.find((g) => g.id === id);
    if (grouping) return model.parties.filter((p) => grouping.countries.includes(p.country));
  }
  if (kind === 'c' && model.countries.some((c) => c.code === id)) return model.parties.filter((p) => p.country === id);
  return model.parties;
}

export function normalizeScope(scope, model) {
  const [kind, id] = String(scope ?? 'all').split(':');
  if (kind === 'g' && model.groupings.some((g) => g.id === id)) return scope;
  if (kind === 'c' && model.countries.some((c) => c.code === id)) return scope;
  return 'all';
}

/** Which of a dimension's poles a score leans to; null inside the midpoint band. */
export const leanOf = (score, band = 5) => (score > 50 + band ? 'high' : score < 50 - band ? 'low' : null);

/** Per-dimension gaps between two profiles, sorted smallest first and grouped by the display thresholds. */
export function agreement(a, b, dimensions, thresholds) {
  const rows = dimensions
    .map((dim, i) => {
      const gap = Math.abs(a[i] - b[i]);
      const group = gap <= thresholds.agree_max ? 'agree' : gap >= thresholds.diverge_min ? 'diverge' : 'partial';
      return { dim, index: i, a: a[i], b: b[i], gap, group, leanA: leanOf(a[i]), leanB: leanOf(b[i]) };
    })
    .sort((x, y) => x.gap - y.gap || x.index - y.index);
  return {
    rows,
    agree: rows.filter((r) => r.group === 'agree'),
    partial: rows.filter((r) => r.group === 'partial'),
    diverge: rows.filter((r) => r.group === 'diverge'),
  };
}

/** The dimension where this person stands out most from the parties, for the written takeaways. */
export function mostDistinctive(scores, parties, dimensions) {
  let best = null;
  dimensions.forEach((dim, i) => {
    const values = parties.map((p) => p.scores[i]);
    const below = values.filter((v) => v < scores[i]).length / values.length;
    const above = values.filter((v) => v > scores[i]).length / values.length;
    const share = Math.max(below, above);
    if (!best || share > best.share) best = { dim, index: i, share, lean: below >= above ? 'high' : 'low' };
  });
  return best;
}

/** Plain-language poles of a component, taken from its two largest loadings so they follow the data. */
export function componentPoles(comp, pca, dimensions, lang) {
  const loadings = pca.components[comp];
  const top = loadings.map((w, i) => ({ w, i })).sort((x, y) => Math.abs(y.w) - Math.abs(x.w)).slice(0, 2);
  const side = (sign) => top.map(({ w, i }) => dimensions[i][w * sign > 0 ? 'high' : 'low'][lang]).join(' · ');
  return { positive: side(1), negative: side(-1) };
}

/** Convex hull (Andrew's monotone chain) of [x, y] pairs, returned counter-clockwise. */
export function convexHull(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** One row per party, for the CSV download. */
export function rankingRows(v, model, lang) {
  const ranked = rankParties(v, model.parties);
  const position = {};
  return ranked.map(({ party, score }, i) => {
    position[party.country] = (position[party.country] ?? 0) + 1;
    return {
      globalRank: i + 1,
      countryRank: position[party.country],
      country: model.countries.find((c) => c.code === party.country).name[lang],
      party: party.name[lang],
      abbrev: party.abbrev,
      cluster: party.cluster,
      subgroup: party.sub ?? '',
      current: party.leaf ?? '',
      similarity: score,
      scores: party.scores,
    };
  });
}

/** RFC 4180 quoting, plus a leading quote on anything a spreadsheet would run as a formula. */
export function csvCell(value) {
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

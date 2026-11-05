// The party map: the 2D PCA projection, drawn with either main clusters or subgroups, plus the person.
import { componentPoles, convexHull, project } from '../core.js';
import { T, clusterColor, el, g, line, markerPath, measure, partyColor, shapeOf, subColor, text, wrap } from './svg.js';

/** Equal scale on both axes, so the map doesn't distort distances between parties. */
function layout(model, extras, width, m, minAspect) {
  const pts = model.parties.map((p) => p.pc).concat(extras);
  const pad = 11;
  const x0 = Math.min(...pts.map((p) => p[0])) - pad;
  const x1 = Math.max(...pts.map((p) => p[0])) + pad;
  let y0 = Math.min(...pts.map((p) => p[1])) - pad;
  let y1 = Math.max(...pts.map((p) => p[1])) + pad;
  const need = (x1 - x0) * minAspect;
  if (y1 - y0 < need) {
    const extra = (need - (y1 - y0)) / 2;
    y0 -= extra;
    y1 += extra;
  }
  const s = (width - m.l - m.r) / (x1 - x0);
  const plotH = (y1 - y0) * s;
  return {
    x0, x1, y0, y1, s, plotH,
    height: m.t + plotH + m.b,
    px: (x) => m.l + (x - x0) * s,
    py: (y) => m.t + (y1 - y) * s,
  };
}

/** Hull of the points grown by a circle: a rounded outline that also works for a pair. */
export function hullPath(points, radius) {
  const grown = [];
  for (const [x, y] of points) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 2 * Math.PI;
      grown.push([x + radius * Math.cos(a), y + radius * Math.sin(a)]);
    }
  }
  const hull = convexHull(grown);
  return { d: `M${hull.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}Z`, hull };
}

const overlaps = (a, b, gap = 1) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/**
 * Greedy placement around each marker. A label with no free spot gets a leader line, or is left to the tooltip.
 * `item.near` keeps a label right beside its dot, so a crowded map drops labels rather than growing a web of lines.
 */
function placeLabels(items, obstacles, bounds, fontSize) {
  const placed = [];
  const taken = [...obstacles];
  const inBounds = (b) => b.x >= bounds.x0 && b.x + b.w <= bounds.x1 && b.y >= bounds.y0 && b.y + b.h <= bounds.y1;
  const angles = [-25, 25, 0, -155, 155, 180, -90, 90, -55, 55, -125, 125];
  for (const item of items) {
    const w = measure(item.text, fontSize, item.strong ? 700 : 500);
    const h = fontSize + 2;
    let best = null;
    for (const dist of item.near ? [item.r + 3, item.r + 7] : [item.r + 3, item.r + 7, item.r + 12, item.r + 19, item.r + 28, item.r + 40, item.r + 54]) {
      for (const deg of angles) {
        const a = (deg * Math.PI) / 180;
        const ax = item.x + dist * Math.cos(a);
        const ay = item.y + dist * Math.sin(a);
        const c = Math.cos(a);
        const box = {
          x: c > 0.25 ? ax : c < -0.25 ? ax - w : ax - w / 2,
          y: ay - h / 2 + Math.sin(a) * (h / 2),
          w,
          h,
        };
        if (inBounds(box) && !taken.some((o) => overlaps(box, o))) {
          best = { box, dist };
          break;
        }
      }
      if (best) break;
    }
    if (!best) continue;
    taken.push(best.box);
    placed.push({ item, ...best });
  }
  return placed;
}

/** The groups the current view draws. */
export function mapGroups(model, colorBy) {
  if (colorBy !== 'sub') {
    return model.clusters.map((c) => ({ ...c, color: clusterColor(c.id), parties: model.parties.filter((p) => p.cluster === c.id) }));
  }
  return model.clusters.flatMap((c) =>
    c.children.length
      ? c.children.map((s) => ({ ...s, color: subColor(s.id), parties: model.parties.filter((p) => p.sub === s.id) }))
      : [{ ...c, color: clusterColor(c.id), parties: model.parties.filter((p) => p.cluster === c.id) }],
  );
}

/**
 * @param o.visible   Set of party ids inside the current scope. The others stay as faint context,
 *                    so axes, groups and outlines never move when the filter changes.
 * @param o.you       { scores, label, closest: [party ids] } or null
 * @param o.past      earlier positions of the same person, drawn as hollow marks
 * @param o.colorBy   'cluster' or 'sub'
 * @param o.allLabels true when the map is drawn wide enough to try to label every party
 * @param o.mode      'screen' or 'export'
 */
export function pcaChart(o) {
  const { model, lang, t, width, visible, you = null, past = [], mode = 'screen', compact = false, colorBy = 'cluster', minimal = false, allLabels = false } = o;
  const big = mode === 'export';
  const m = big ? { l: 74, r: 24, t: 44, b: 92 } : compact ? { l: 32, r: 8, t: 12, b: 42 } : { l: 52, r: 16, t: 26, b: 72 };
  const youPc = you ? project(you.scores, model.pca) : null;
  const pastPcs = past.map((r) => project(r.scores, model.pca));
  const L = layout(model, [...(youPc ? [youPc] : []), ...pastPcs], width, m, compact ? 0.92 : 0.6);
  const { px, py } = L;
  const r = big ? 7 : compact ? 4 : 5;
  const fontSize = big ? 15.5 : compact ? 11 : 11.5;
  const plot = { x0: m.l, x1: width - m.r, y0: m.t, y1: m.t + L.plotH };
  const closest = you?.closest ?? [];
  const bySub = colorBy === 'sub';
  let body = '';

  // Grid
  const tick = 25;
  const tickSize = big ? 15 : compact ? 10 : 11;
  const showTick = (v) => !compact || v % 50 === 0;
  for (let v = Math.ceil(L.x0 / tick) * tick; v <= L.x1; v += tick) {
    const x = px(v);
    if (v !== 0) body += line(x, plot.y0, x, plot.y1, { stroke: T.row });
    if (showTick(v)) body += text(x, plot.y1 + (big ? 24 : compact ? 14 : 18), t.num(v, 0), { 'text-anchor': 'middle', 'font-size': tickSize, fill: T.muted, 'font-variant-numeric': 'tabular-nums' });
  }
  for (let v = Math.ceil(L.y0 / tick) * tick; v <= L.y1; v += tick) {
    const y = py(v);
    if (v !== 0) body += line(plot.x0, y, plot.x1, y, { stroke: T.row });
    if (showTick(v)) body += text(plot.x0 - (big ? 12 : compact ? 5 : 8), y + 4, t.num(v, 0), { 'text-anchor': 'end', 'font-size': tickSize, fill: T.muted, 'font-variant-numeric': 'tabular-nums' });
  }
  body += line(px(0), plot.y0, px(0), plot.y1, { stroke: T.lineStrong });
  body += line(plot.x0, py(0), plot.x1, py(0), { stroke: T.lineStrong });

  // Axis titles carry the variance, and the ends say what each direction means.
  const poles1 = componentPoles(0, model.pca, model.dimensions, lang);
  const poles2 = componentPoles(1, model.pca, model.dimensions, lang);
  const ex = model.pca.explained;
  const axisSize = big ? 17 : compact ? 11.5 : 12.5;
  const poleSize = big ? 15 : 12;
  const baseY = plot.y1 + (big ? 56 : compact ? 32 : 44);
  body += text((plot.x0 + plot.x1) / 2, baseY, t('map.axis', { n: 1, v: t.num(ex[0] * 100, 1) }), { 'text-anchor': 'middle', 'font-size': axisSize, 'font-weight': 600, fill: T.text });
  // On a phone the direction captions don't fit on the plot. The page repeats them under the map.
  if (!compact) {
    const poleY = baseY + (big ? 26 : 20);
    body += text(plot.x0, poleY, `← ${poles1.negative}`, { 'font-size': poleSize, fill: T.text3 });
    body += text(plot.x1, poleY, `${poles1.positive} →`, { 'font-size': poleSize, fill: T.text3, 'text-anchor': 'end' });
  }
  body += text(0, 0, t('map.axis', { n: 2, v: t.num(ex[1] * 100, 1) }), { transform: `translate(${big ? 16 : 10} ${(plot.y0 + plot.y1) / 2}) rotate(-90)`, 'text-anchor': 'middle', 'font-size': axisSize, 'font-weight': 600, fill: T.text });
  const up = `↑ ${poles2.positive}`;
  const down = `↓ ${poles2.negative}`;
  const upY = plot.y0 + (big ? 22 : 15);
  const downY = plot.y1 - (big ? 12 : 8);
  if (!compact) {
    body += text(plot.x0 + 8, upY, up, { 'font-size': poleSize, fill: T.text3 });
    body += text(plot.x0 + 8, downY, down, { 'font-size': poleSize, fill: T.text3 });
  }

  // Everything a label has to stay clear of
  const obstacles = compact ? [] : [
    { x: plot.x0 + 8, y: upY - poleSize, w: measure(up, poleSize), h: poleSize + 4 },
    { x: plot.x0 + 8, y: downY - poleSize, w: measure(down, poleSize), h: poleSize + 4 },
  ];
  const reserved = (x, y, half) => obstacles.push({ x: x - half, y: y - half, w: 2 * half, h: 2 * half });
  const clearest = (boxes) => {
    const inside = boxes.filter((b) => b.x >= plot.x0 + 2 && b.x + b.w <= plot.x1 - 2 && b.y >= plot.y0 + 2 && b.y + b.h <= plot.y1 - 2);
    const pool = inside.length ? inside : boxes;
    return pool.find((b) => !obstacles.some((ob) => overlaps(b, ob, 2))) ?? pool[0];
  };

  // Parties: faint context first, then the ones in scope
  const points = [];
  let ghosts = '';
  let dots = '';
  for (const p of model.parties) {
    const x = px(p.pc[0]);
    const y = py(p.pc[1]);
    points.push({ id: p.id, x, y });
    const groupId = bySub ? p.sub ?? p.cluster : p.cluster;
    if (!visible.has(p.id)) {
      ghosts += el('circle', { cx: x, cy: y, r: Math.max(2.2, r * 0.5), fill: T.lineStrong, 'fill-opacity': 0.55, 'data-group': groupId });
      continue;
    }
    if (closest.includes(p.id)) dots += el('circle', { cx: x, cy: y, r: r + (big ? 6 : 4), fill: 'none', stroke: T.you, 'stroke-width': big ? 2 : 1.5 });
    dots += el('path', {
      d: markerPath(bySub ? shapeOf(p.sub) : 'circle', x, y, r), fill: partyColor(p, colorBy), stroke: T.bg, 'stroke-width': big ? 2 : 1.5,
      'paint-order': 'stroke', 'stroke-linejoin': 'round', 'data-group': groupId, 'data-party': p.id,
    });
    reserved(x, y, r + 1.5);
  }

  // Earlier results, then the person
  let pastMarks = '';
  const youR = big ? 11 : compact ? 7 : 8.5;
  for (const [x, y] of pastPcs) {
    pastMarks += el('circle', { cx: px(x), cy: py(y), r: youR * 0.7, fill: T.bg, stroke: T.you, 'stroke-width': big ? 2.5 : 2 });
    reserved(px(x), py(y), youR);
  }
  let youLines = '';
  let youMark = '';
  let youX = null;
  if (youPc) {
    const x = px(youPc[0]);
    const y = py(youPc[1]);
    // Long lines here show where the flat map disagrees with the real five-dimensional distance.
    for (const id of closest) {
      const p = model.parties.find((q) => q.id === id);
      if (!p || !visible.has(id)) continue;
      youLines += line(x, y, px(p.pc[0]), py(p.pc[1]), { stroke: T.you, 'stroke-opacity': 0.6, 'stroke-width': big ? 1.75 : 1.25 });
    }
    youMark += el('circle', { cx: x, cy: y, r: youR * 1.9, fill: T.you, 'fill-opacity': 0.16 });
    youMark += el('circle', { cx: x, cy: y, r: youR, fill: T.you, stroke: T.bg, 'stroke-width': big ? 3 : 2.5 });
    reserved(x, y, youR * 1.9);
    youX = x;
  }

  // Main-cluster centres, only in the cluster view. They sit under the party markers.
  let centres = '';
  if (!bySub) {
    for (const c of model.clusters) {
      const x = px(c.pc[0]);
      const y = py(c.pc[1]);
      const s = big ? 11 : compact ? 6 : 8;
      const cross = `M${x - s} ${y}H${x + s}M${x} ${y - s}V${y + s}`;
      centres += el('path', { d: cross, stroke: T.bg, 'stroke-width': big ? 8 : 6, 'stroke-linecap': 'square' });
      centres += el('path', { d: cross, stroke: clusterColor(c.id), 'stroke-width': big ? 4 : 3, 'stroke-linecap': 'square' });
      reserved(x, y, s + 1);
    }
  }

  // Group outlines, each directly labelled in clear space outside its outline.
  let hulls = '';
  let names = '';
  const cx = px(0);
  const cy = py(0);
  const groups = mapGroups(model, colorBy);
  for (const group of groups) {
    const pts = group.parties.map((p) => [px(p.pc[0]), py(p.pc[1])]);
    const { d, hull } = hullPath(pts, big ? (bySub ? 20 : 26) : compact ? 9 : bySub ? 15 : 19);
    const any = group.parties.some((p) => visible.has(p.id));
    hulls += el('path', { d, fill: group.color, 'fill-opacity': any ? (bySub ? 0.14 : 0.1) : 0.03, stroke: group.color, 'stroke-opacity': any ? 0.55 : 0.15, 'stroke-width': big ? 1.75 : 1.25, 'data-group': group.id });
    if (minimal) continue;

    const size = big ? 17 : compact ? 9.5 : 12.5;
    const maxW = big ? 210 : 140;
    const lines = compact ? [group.id] : wrap(group.label[lang], maxW, size, 700);
    const lh = size * 1.14;
    const w = Math.max(...lines.map((l) => measure(l, size, 700)));
    const h = lines.length * lh;
    const hcx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
    const hcy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
    const spots = [];
    hull.forEach((p, i) => {
      const q = hull[(i + 1) % hull.length];
      const steps = Math.max(1, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / 14));
      for (let k = 0; k < steps; k++) spots.push([p[0] + ((q[0] - p[0]) * k) / steps, p[1] + ((q[1] - p[1]) * k) / steps]);
    });
    const candidates = spots
      .map(([x, y]) => {
        const n = Math.hypot(x - hcx, y - hcy) || 1;
        const ux = (x - hcx) / n;
        const uy = (y - hcy) / n;
        const off = (Math.abs(ux) * w) / 2 + (Math.abs(uy) * h) / 2 + 3;
        return { x: x + ux * off - w / 2, y: y + uy * off - h / 2, w, h, score: (x - cx) ** 2 + (y - cy) ** 2 };
      })
      .sort((a, b) => b.score - a.score);
    const box = clearest(candidates);
    obstacles.push(box);
    const lineEls = lines
      .map((l, i) => text(box.x + w / 2, box.y + lh * (i + 0.8), l, { 'text-anchor': 'middle', 'font-size': size, 'font-weight': 700, fill: T.text, stroke: T.bg, 'stroke-width': 3, 'paint-order': 'stroke' }))
      .join('');
    names += g({ 'data-group': group.id, opacity: any ? 1 : 0.4 }, lineEls);
  }

  if (youPc) {
    const x = px(youPc[0]);
    const y = py(youPc[1]);
    const halo = youR * 1.9;
    const size = big ? 27 : compact ? 15 : 19;
    const w = measure(you.label, size, 800, T.display);
    const h = size + 2;
    // Close spots first, then further out when the neighbourhood is crowded.
    const spots = [];
    for (const d of [halo, halo * 1.6, halo * 2.3, halo * 3.2]) {
      spots.push(
        { x: x + d + 5, y: y - h / 2, w, h }, { x: x - d - 5 - w, y: y - h / 2, w, h },
        { x: x - w / 2, y: y - d - 3 - h, w, h }, { x: x - w / 2, y: y + d + 3, w, h },
        { x: x + d * 0.75, y: y - d * 0.75 - h, w, h }, { x: x - d * 0.75 - w, y: y - d * 0.75 - h, w, h },
        { x: x + d * 0.75, y: y + d * 0.75, w, h }, { x: x - d * 0.75 - w, y: y + d * 0.75, w, h },
      );
    }
    const spot = clearest(spots);
    youMark += text(spot.x, spot.y + h * 0.82, you.label, { 'font-family': T.display, 'font-size': size, 'font-weight': 800, fill: T.you, stroke: T.bg, 'stroke-width': 3.5, 'paint-order': 'stroke' });
    obstacles.push(spot);
  }

  // Party labels. When most can fit, the most crowded points choose first, because they have the fewest options.
  // On a crowded map the outliers go first and everything else keeps its label only if it fits beside the dot.
  const inScope = model.parties.filter((p) => visible.has(p.id));
  const reach = 44 * (big ? 1.4 : 1);
  const neighbours = (p) => inScope.filter((q) => q !== p && Math.hypot(px(q.pc[0]) - px(p.pc[0]), py(q.pc[1]) - py(p.pc[1])) < reach).length;
  const overview = (compact && inScope.length > 14) || minimal;
  const crowded = !allLabels && !big && inScope.length > 60;
  const labelled = inScope
    .filter((p) => !overview || closest.includes(p.id))
    .map((p) => ({ p, crowd: neighbours(p), first: closest.includes(p.id) ? 0 : 1 }))
    .sort((a, b) => a.first - b.first || (crowded ? a.crowd - b.crowd : b.crowd - a.crowd))
    .map(({ p }) => ({ id: p.id, text: p.label, x: px(p.pc[0]), y: py(p.pc[1]), r, strong: closest.includes(p.id), near: crowded && !closest.includes(p.id) }));
  const placed = placeLabels(labelled, obstacles, { x0: plot.x0 + 2, x1: plot.x1 - 2, y0: plot.y0 + 2, y1: plot.y1 - 2 }, fontSize);
  let labels = '';
  for (const { item, box, dist } of placed) {
    const p = model.parties.find((q) => q.id === item.id);
    let inner = '';
    if (dist > item.r + 8) {
      const tx = Math.max(box.x, Math.min(box.x + box.w, item.x));
      const ty = Math.max(box.y, Math.min(box.y + box.h, item.y));
      inner += line(item.x, item.y, tx, ty, { stroke: T.muted, 'stroke-width': big ? 1 : 0.75 });
    }
    inner += text(box.x, box.y + box.h - (big ? 3 : 2.5), item.text, { 'font-size': fontSize, 'font-weight': item.strong ? 700 : 500, fill: item.strong ? T.text : T.text2 });
    labels += g({ 'data-group': bySub ? p.sub ?? p.cluster : p.cluster }, inner);
  }

  body += hulls + ghosts + youLines + centres + dots + labels + names + pastMarks + youMark;
  const shown = new Set(placed.map(({ item }) => item.id));
  return { body, width, height: L.height, points, youX, hiddenLabels: labelled.filter((l) => !shown.has(l.id)).map((l) => l.text) };
}

/** The key drawn into the PNG; the page uses an HTML key with the same content. */
export function pcaLegendSvg({ model, lang, width, colorBy, y = 0 }) {
  const colW = width / model.clusters.length;
  let body = '';
  let maxY = 0;
  model.clusters.forEach((c, i) => {
    const color = clusterColor(c.id);
    const x = i * colW;
    let yy = y + 20;
    if (colorBy !== 'sub') {
      body += el('path', { d: markerPath('circle', x + 9, yy - 6, 8), fill: color });
      body += text(x + 26, yy, `${c.label[lang]}  (${c.n})`, { 'font-size': 20, 'font-weight': 700, fill: T.text });
    } else {
      body += text(x, yy, `${c.label[lang]}  (${c.n})`, { 'font-size': 20, 'font-weight': 700, fill: T.text });
      yy += 10;
      for (const s of c.children) {
        yy += 27;
        body += el('path', { d: markerPath(shapeOf(s.id), x + 9, yy - 6, 7.5), fill: subColor(s.id) });
        body += text(x + 26, yy, `${s.label[lang]}  (${s.n})`, { 'font-size': 18, fill: T.text2 });
      }
    }
    maxY = Math.max(maxY, yy);
  });
  return { body, height: maxY - y + 8 };
}

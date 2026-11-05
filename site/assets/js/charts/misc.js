// Profile strip plot, comparison radar, ranked bars, group table and silhouette diagnostics.
import { T, bar, clusterColor, el, fit, inkOn, line, markerPath, measure, rect, shapeOf, subColor, text } from './svg.js';

/**
 * Five dimensions as strip plots: every party is a faint dot on the line and the person is the red
 * one, so a position reads against the field rather than as a grade.
 */
export function profileChart({ model, lang, t, width, scores, parties = model.parties, big = false }) {
  const rowH = big ? 118 : 96;
  const nameSize = big ? 23 : 15;
  const poleSize = big ? 18 : 13;
  const valueSize = big ? 40 : 28;
  const inset = big ? 13 : 10;
  const X = (v) => inset + (v / 100) * (width - 2 * inset);
  let body = '';
  model.dimensions.forEach((d, i) => {
    const y = i * rowH;
    const lineY = y + (big ? 44 : 36);
    const v = scores[i];
    body += text(0, y + nameSize, d.name[lang], { 'font-size': nameSize, 'font-weight': 700, fill: T.text });
    body += text(width, y + nameSize + (big ? 2 : 1), t.exact(v), { 'font-family': T.display, 'font-size': valueSize, 'font-weight': 800, fill: T.you, 'text-anchor': 'end' });
    body += line(X(0), lineY, X(100), lineY, { stroke: T.lineStrong, 'stroke-width': big ? 2 : 1.5 });
    body += line(X(50), lineY - (big ? 8 : 6), X(50), lineY + (big ? 8 : 6), { stroke: T.lineStrong, 'stroke-width': big ? 2 : 1.5 });
    for (const p of parties) {
      body += el('circle', { cx: X(p.scores[i]), cy: lineY, r: big ? 6 : 4.5, fill: T.dots, 'fill-opacity': 0.16 });
    }
    body += el('circle', { cx: X(v), cy: lineY, r: big ? 12 : 9, fill: T.you, stroke: T.bg, 'stroke-width': big ? 3.5 : 2.5, 'paint-order': 'stroke' });
    const py = lineY + (big ? 34 : 27);
    body += text(0, py, d.low[lang], { 'font-size': poleSize, fill: T.text3 });
    body += text(width, py, d.high[lang], { 'font-size': poleSize, fill: T.text3, 'text-anchor': 'end' });
  });
  return { body, width, height: model.dimensions.length * rowH - (big ? 22 : 16) };
}

/** Comparison radar: farther from the centre means a higher score. */
export function radarChart({ model, lang, t, a, b, width, big = false }) {
  const n = model.dimensions.length;
  const labelPad = big ? 58 : width < 340 ? 36 : 44;
  const sideRoom = big ? 104 : width < 340 ? 56 : 74;
  const R = Math.min(width / 2 - sideRoom, big ? 270 : 190);
  const cx = width / 2;
  const cy = R + labelPad;
  const point = (i, v) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + (v / 100) * R * Math.cos(ang), cy + (v / 100) * R * Math.sin(ang)];
  };
  const poly = (values) => values.map((v, i) => point(i, v).map((c) => c.toFixed(1)).join(',')).join(' ');
  let body = '';
  for (const ring of [100, 75, 50, 25]) {
    body += el('polygon', { points: poly(Array(n).fill(ring)), fill: 'none', stroke: ring === 100 ? T.lineStrong : T.line, 'stroke-width': 1 });
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = point(i, 100);
    body += line(cx, cy, x, y, { stroke: T.line });
  }
  const thick = big ? 3.5 : 2.5;
  body += el('polygon', { points: poly(b), fill: 'none', stroke: T.other, 'stroke-width': thick, 'stroke-linejoin': 'round' });
  body += el('polygon', { points: poly(a), fill: T.you, 'fill-opacity': 0.14, stroke: T.you, 'stroke-width': thick, 'stroke-linejoin': 'round' });
  b.forEach((v, i) => {
    const [x, y] = point(i, v);
    body += el('circle', { cx: x, cy: y, r: big ? 6 : 4.5, fill: T.bg, stroke: T.other, 'stroke-width': big ? 3 : 2.25 });
  });
  a.forEach((v, i) => {
    const [x, y] = point(i, v);
    body += el('circle', { cx: x, cy: y, r: big ? 6.5 : 5, fill: T.you, stroke: T.bg, 'stroke-width': 2, 'paint-order': 'stroke' });
  });
  // Ring values sit beside the top spoke, above the data shapes.
  for (const ring of [25, 50, 75, 100]) {
    const [x, y] = point(0, ring);
    body += text(x - 6, y + (big ? 5 : 4), t.num(ring, 0), { 'font-size': big ? 15 : 11, fill: T.muted, 'text-anchor': 'end', stroke: T.bg, 'stroke-width': 3, 'paint-order': 'stroke' });
  }
  model.dimensions.forEach((d, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const [x, y] = point(i, 100);
    const c = Math.cos(ang);
    const anchor = Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end';
    const lx = x + c * (big ? 18 : 12);
    const ly = y + Math.sin(ang) * (big ? 28 : 20) + (big ? 6 : 4);
    body += text(lx, ly, d.short[lang], { 'font-size': big ? 20 : 13.5, 'font-weight': 700, fill: T.text, 'text-anchor': anchor });
  });
  return { body, width, height: cy + R * Math.cos(Math.PI / n) + labelPad + (big ? 8 : 4) };
}

/** Phone layout of the ranked bars: the name on its own line, above a full-width bar. */
function stackedBars({ rows, width, max, t, flagUrl }) {
  const rowH = 44;
  const barH = 11;
  const valueW = 46;
  const plotW = width - valueW;
  let body = '';
  rows.forEach((row, i) => {
    const y = i * rowH;
    const flagW = row.flag ? 20 : 0;
    if (row.flag) body += el('image', { href: flagUrl(row.flag), x: 0, y: y + 3, width: 18, height: 12, preserveAspectRatio: 'xMidYMid slice' });
    body += text(flagW + (row.flag ? 3 : 0), y + 13, fit(row.label, width - flagW - 4, 13, 500), { 'font-size': 13, 'font-weight': 500, fill: T.text });
    const w = Math.max(1, (row.value / max) * plotW);
    body += bar(0, y + 21, w, barH, row.color, 2, { class: 'grow' });
    body += text(w + 6, y + 21 + barH - 1, t.num(row.value, row.digits ?? 2), { 'font-size': 13, 'font-weight': 700, fill: T.text, 'font-variant-numeric': 'tabular-nums' });
  });
  return { body, width, height: rows.length * rowH };
}

/** Horizontal ranked bars with the value at the tip. `rows`: { label, value, color, flag }. */
export function rankedBars({ rows, width, big = false, max = 100, t, flagUrl, labelMax = null }) {
  if (!big && width < 460) return stackedBars({ rows, width, max, t, flagUrl });
  const rowH = big ? 42 : 28;
  const barH = big ? 24 : 15;
  const fs = big ? 18 : 13;
  const flagW = big ? 33 : 20;
  const flagH = big ? 20 : 13;
  const valueW = big ? 72 : 48;
  const hasFlags = rows.some((r) => r.flag);
  const longest = Math.max(...rows.map((r) => measure(r.label, fs, 500)));
  const labelW = Math.min(labelMax ?? width * 0.46, longest + (hasFlags ? flagW + 10 : 0));
  const plotW = width - labelW - valueW - 10;
  const scale = plotW / max;
  let body = '';
  rows.forEach((row, i) => {
    const y = i * rowH;
    const cy = y + rowH / 2;
    if (row.flag) {
      body += el('image', { href: flagUrl(row.flag), x: 0, y: cy - flagH / 2, width: flagW, height: flagH, preserveAspectRatio: 'xMidYMid slice' });
    }
    const room = row.flag ? labelW - flagW - 8 : labelW - 2;
    body += text(row.flag ? flagW + 8 : 0, cy + fs * 0.36, fit(row.label, room, fs, 500), { 'font-size': fs, 'font-weight': 500, fill: T.text });
    const w = Math.max(1, row.value * scale);
    body += bar(labelW + 6, y + (rowH - barH) / 2, w, barH, row.color, 2, { class: 'grow', ...(row.id ? { 'data-party': row.id } : {}) });
    body += text(labelW + 6 + w + 7, cy + fs * 0.36, t.num(row.value, row.digits ?? 2), { 'font-size': fs, 'font-weight': 700, fill: T.text, 'font-variant-numeric': 'tabular-nums' });
  });
  return { body, width, height: rows.length * rowH };
}

/** A row of coloured dots naming the groups, for the bar-chart posters. Wraps to fit `width`. */
export function groupKey({ model, lang, colorBy, width }) {
  const items = colorBy === 'sub'
    ? model.clusters.flatMap((c) => c.children.map((s) => ({ label: s.label[lang], color: subColor(s.id) })))
    : model.clusters.map((c) => ({ label: c.label[lang], color: clusterColor(c.id) }));
  let x = 0;
  let y = 0;
  let body = '';
  for (const item of items) {
    const w = 27 + measure(item.label, 20) + 30;
    if (x > 0 && x + w > width) {
      x = 0;
      y += 34;
    }
    body += el('circle', { cx: x + 9, cy: y + 12, r: 9, fill: item.color });
    body += text(x + 27, y + 19, item.label, { 'font-size': 20, fill: T.text2 });
    x += w;
  }
  return { body, height: y + 42 };
}

/** One neutral ramp per theme: group colours keep their meaning, and the cells just show level. */
export function heatColor(v) {
  const s = T.mode === 'dark'
    ? [[34, 34, 34], [66, 66, 66], [110, 110, 110], [165, 165, 165], [225, 225, 225]]
    : [[244, 244, 241], [214, 214, 210], [160, 160, 156], [96, 96, 94], [34, 34, 34]];
  const pos = (Math.max(0, Math.min(100, v)) / 100) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(pos));
  const k = pos - i;
  const c = s[i].map((x, j) => Math.round(x + (s[i + 1][j] - x) * k));
  return `rgb(${c.join(',')})`;
}

/** What each main cluster and subgroup looks like, on all five dimensions. */
export function heatTable({ model, lang, t, width, big = false }) {
  const compact = !big && width < 620;
  const fs = big ? 18 : compact ? 11.5 : 13;
  const longest = Math.max(...model.clusters.flatMap((c) => [
    measure(`${c.label[lang]} (${c.n})`, fs + (big ? 1 : 0), 700),
    ...c.children.map((s) => measure(`${s.label[lang]} (${s.n})`, fs, 500) + (big ? 22 : 14)),
  ]));
  const labelW = compact ? Math.min(62, width * 0.2) : Math.min(longest + (big ? 40 : 30), width * 0.52);
  const cols = model.dimensions.length;
  // Rotated phone headers lean right, so they need room past the last column.
  const rightPad = compact ? 30 : 0;
  const cellW = (width - labelW - rightPad) / cols;
  const head = big ? 58 : compact ? 74 : 40;
  const rowH = big ? 46 : compact ? 32 : 32;
  let body = '';
  model.dimensions.forEach((d, c) => {
    const x = labelW + cellW * (c + 0.5);
    body += compact
      ? text(0, 0, d.short[lang], { transform: `translate(${x + 3} ${head - 8}) rotate(-52)`, 'font-size': fs, 'font-weight': 700, fill: T.text })
      : text(x, head - (big ? 16 : 12), d.short[lang], { 'text-anchor': 'middle', 'font-size': fs, 'font-weight': 700, fill: T.text });
  });
  let y = head;
  const row = (id, label, scores, isMain) => {
    const color = isMain ? clusterColor(id) : subColor(id);
    const indent = isMain ? 0 : big ? 22 : compact ? 8 : 14;
    const titleSize = isMain ? fs + (big ? 1 : 0) : fs;
    const available = labelW - indent - (big ? 34 : compact ? 16 : 24);
    const full = compact ? id : label;
    body += el('path', { d: markerPath(isMain ? 'circle' : shapeOf(id), indent + (big ? 8 : 6), y + rowH / 2, big ? 7 : 5), fill: color });
    body += text(indent + (big ? 24 : 16), y + rowH / 2 + fs * 0.36, fit(full, available, titleSize, isMain ? 700 : 500), { 'font-size': titleSize, 'font-weight': isMain ? 700 : 500, fill: isMain ? T.text : T.text2 });
    scores.forEach((v, c) => {
      const x = labelW + c * cellW;
      const fill = heatColor(v);
      body += rect(x + 1, y + 1, cellW - 2, rowH - 2, { fill });
      body += text(x + cellW / 2, y + rowH / 2 + fs * 0.36, t.num(Math.round(v), 0), { 'text-anchor': 'middle', 'font-size': fs, 'font-weight': isMain ? 700 : 500, fill: inkOn(fill), 'font-variant-numeric': 'tabular-nums' });
    });
    y += rowH;
  };
  for (const c of model.clusters) {
    row(c.id, `${c.label[lang]} (${c.n})`, c.centroid, true);
    for (const s of c.children) row(s.id, `${s.label[lang]} (${s.n})`, s.centroid, false);
    y += big ? 12 : 8;
  }
  return { body, width, height: y };
}

/** Silhouette against k, one small multiple per fit, on one shared y scale. */
export function silhouettePanels({ model, t, lang, width, big = false }) {
  const d = model.diagnostics;
  const panels = [
    { key: 'top', title: t('method.silAll'), grid: d.top.grid, k: d.top.selected_k, color: T.text },
    ...model.clusters.map((c) => ({
      key: c.id,
      title: c.label[lang],
      grid: d.sub[c.id].grid,
      k: d.sub[c.id].selected_k,
      color: clusterColor(c.id),
      reference: d.sub[c.id].reference,
    })),
  ];
  const stacked = !big && width < 760;
  const gap = big ? 34 : 20;
  const n = panels.length;
  const pw = stacked ? width : (width - gap * (n - 1)) / n;
  const ph = big ? 300 : 190;
  const ml = big ? 44 : 32;
  const mb = big ? 44 : 34;
  const mt = big ? 62 : 44;
  const yMin = 0.2;
  const yMax = 0.55;
  const fs = big ? 15 : 11;
  let body = '';
  panels.forEach((p, i) => {
    const ox = stacked ? 0 : i * (pw + gap);
    const oy = stacked ? i * (ph + mt + mb + 14) : 0;
    const iw = pw - ml - 8;
    const inset = big ? 22 : 16;
    const X = (k) => ox + ml + inset + ((k - 2) / 10) * (iw - inset - 6);
    const Y = (v) => oy + mt + (1 - (Math.max(yMin, v) - yMin) / (yMax - yMin)) * ph;
    body += text(ox, oy + (big ? 24 : 16), fit(p.title, pw - 4, big ? 18 : 13, 700), { 'font-size': big ? 18 : 13, 'font-weight': 700, fill: T.text });
    body += text(ox, oy + (big ? 48 : 33), t('method.silPicked', { k: p.k }), { 'font-size': big ? 15 : 11.5, fill: T.text3 });
    for (const v of [0.2, 0.3, 0.4, 0.5]) {
      body += line(ox + ml, Y(v), ox + pw - 8, Y(v), { stroke: T.row });
      body += text(ox + ml - 6, Y(v) + 4, t.num(v, 1), { 'text-anchor': 'end', 'font-size': fs, fill: T.muted });
    }
    if (p.reference) {
      body += rect(ox + ml, Y(p.reference.reference_p95), iw, Y(p.reference.reference_mean) - Y(p.reference.reference_p95), { fill: T.text3, 'fill-opacity': 0.14 });
      body += text(ox + pw - 10, Y(p.reference.reference_p95) - 5, t('method.silBand'), { 'text-anchor': 'end', 'font-size': fs, fill: T.text3 });
    }
    const pts = p.grid.map((g2) => `${X(g2.k).toFixed(1)},${Y(g2.silhouette).toFixed(1)}`).join(' ');
    body += el('polyline', { points: pts, fill: 'none', stroke: p.color, 'stroke-width': big ? 2.5 : 2, 'stroke-linejoin': 'round' });
    for (const row of p.grid) {
      const sel = row.k === p.k;
      const eligible = row.eligible !== false;
      body += el('circle', { cx: X(row.k), cy: Y(row.silhouette), r: sel ? (big ? 7.5 : 5.5) : big ? 4.5 : 3.5, fill: eligible ? p.color : T.bg, stroke: sel ? T.you : eligible ? T.bg : p.color, 'stroke-width': sel ? 2.5 : 1.5 });
      if (sel) body += text(X(row.k) + (big ? 11 : 8), Y(row.silhouette) - (big ? 10 : 8), t.num(row.silhouette, 3), { 'font-size': big ? 16 : 12, 'font-weight': 700, fill: T.text });
    }
    for (const k of [2, 4, 6, 8, 10, 12]) {
      body += text(X(k), oy + mt + ph + (big ? 22 : 16), k, { 'text-anchor': 'middle', 'font-size': fs, fill: T.muted });
    }
    body += text(ox + ml + iw / 2, oy + mt + ph + (big ? 42 : 30), t('method.silK'), { 'text-anchor': 'middle', 'font-size': fs, fill: T.text3 });
  });
  return { body, width, height: stacked ? n * (ph + mt + mb + 14) : ph + mt + mb };
}

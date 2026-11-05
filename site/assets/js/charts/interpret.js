// PCA interpretation panels: what each axis is made of, how much the map can show, and
// why this person lands where they do.
import { contributions } from '../core.js';
import { T, bar, el, line, text } from './svg.js';

/** Loadings of PC1 and PC2 as two aligned columns of diverging bars on one common scale. */
export function loadingsPanel({ model, lang, t, width, big = false, values = null, color = null }) {
  const dims = model.dimensions;
  const data = values ?? [model.pca.components[0], model.pca.components[1]];
  const stacked = !big && width < 470;
  const top = big ? 62 : 44;
  const rowH = big ? 56 : stacked ? 32 : 38;
  const labelW = stacked ? 78 : Math.min(big ? 230 : 130, width * 0.3);
  const gap = big ? 34 : 16;
  const colW = stacked ? width - labelW : (width - labelW - gap) / 2;
  const max = values ? Math.max(1, ...data.flat().map(Math.abs)) * 1.02 : 1;
  const barH = big ? 22 : 13;
  const fs = big ? 18 : 12.5;
  const blockH = top + dims.length * rowH + (big ? 12 : 8);
  const height = stacked ? 2 * blockH + 14 : blockH;
  const fill = color ?? T.bar;
  let body = '';

  [0, 1].forEach((pc) => {
    const oy = stacked && pc ? blockH + 14 : 0;
    const x0 = labelW + (pc && !stacked ? colW + gap : 0);
    const cx = x0 + colW / 2;
    const half = colW / 2 - (big ? 44 : 38);
    const scale = half / max;
    const title = values
      ? t('interp.colContrib', { n: pc + 1 })
      : t('interp.colLoad', { n: pc + 1, v: t.num(model.pca.explained[pc] * 100, 1) });
    body += text(cx, oy + (big ? 26 : 18), title, { 'text-anchor': 'middle', 'font-size': big ? 19 : 13, 'font-weight': 700, fill: T.text });
    if (!values) {
      for (const v of [-1, 1]) {
        body += text(cx + v * half, oy + top - (big ? 8 : 6), v > 0 ? '+1' : t.minus(1), { 'text-anchor': 'middle', 'font-size': big ? 14 : 10.5, fill: T.muted });
      }
    }
    body += line(cx, oy + top, cx, oy + top + dims.length * rowH, { stroke: T.lineStrong });
    dims.forEach((d, i) => {
      const w = data[pc][i];
      const y = oy + top + i * rowH + (rowH - barH) / 2;
      body += bar(cx, y, w * scale, barH, fill);
      const label = values ? t.signed(w, 1) : t.signed(w, 2);
      const tipX = cx + w * scale + (w >= 0 ? 6 : -6);
      body += text(tipX, y + barH / 2 + fs * 0.36, label, { 'text-anchor': w >= 0 ? 'start' : 'end', 'font-size': fs, 'font-weight': 600, fill: T.text, 'font-variant-numeric': 'tabular-nums' });
    });
  });
  for (const oy of stacked ? [0, blockH + 14] : [0]) {
    dims.forEach((d, i) => {
      const y = oy + top + i * rowH + rowH / 2 + fs * 0.36;
      body += text(0, y, d.short[lang], { 'font-size': big ? 19 : 13, 'font-weight': 600, fill: T.text2 });
      if (i > 0) body += line(0, oy + top + i * rowH, width, oy + top + i * rowH, { stroke: T.row });
    });
  }
  return { body, width, height };
}

/** Correlation-circle view of the same loadings: dimensions pointing the same way move together on the map. */
export function circlePanel({ model, lang, t, width, big = false }) {
  const size = Math.min(width, big ? 640 : 440);
  const marginX = big ? 124 : width < 360 ? 64 : 92;
  const R = (size - 2 * marginX) / 2;
  const height = 2 * R + (big ? 96 : 72);
  const cx = width / 2;
  const cy = R + (big ? 48 : 36);
  const fs = big ? 17 : 12;
  let body = '';
  for (const k of [0.25, 0.5, 0.75, 1]) {
    body += el('circle', { cx, cy, r: R * k, fill: 'none', stroke: k === 1 ? T.lineStrong : T.row });
  }
  body += line(cx - R, cy, cx + R, cy, { stroke: T.lineStrong });
  body += line(cx, cy - R, cx, cy + R, { stroke: T.lineStrong });
  body += text(cx - R - 7, cy + (fs - 1) * 0.36, t('common.pc', { n: 1 }), { 'text-anchor': 'end', 'font-size': fs - 1, fill: T.muted, 'font-weight': 700 });
  body += text(cx, cy + R + (big ? 24 : 18), t('common.pc', { n: 2 }), { 'text-anchor': 'middle', 'font-size': fs - 1, fill: T.muted, 'font-weight': 700 });

  const tips = model.dimensions.map((d, i) => {
    const a = model.pca.components[0][i];
    const b = model.pca.components[1][i];
    return { d, i, x: cx + a * R, y: cy - b * R, a, b };
  });
  // Labels sit past the arrow tip, then get pushed apart so they never collide.
  const labels = tips.map((tip) => {
    const norm = Math.hypot(tip.a, tip.b) || 1;
    const lx = tip.x + (tip.a / norm) * (big ? 14 : 10);
    const ly = tip.y - (tip.b / norm) * (big ? 14 : 10) + fs * 0.36;
    return { ...tip, lx, ly, ly0: ly, anchor: tip.a >= 0 ? 'start' : 'end' };
  });
  const minGap = fs + (big ? 8 : 5);
  for (const side of ['start', 'end']) {
    const column = labels.filter((l) => l.anchor === side).sort((p, q) => p.ly - q.ly);
    for (let i = 1; i < column.length; i++) {
      if (column[i].ly - column[i - 1].ly < minGap) column[i].ly = column[i - 1].ly + minGap;
    }
  }
  for (const tip of tips) {
    body += line(cx, cy, tip.x, tip.y, { stroke: T.bar, 'stroke-width': big ? 3 : 2, 'stroke-linecap': 'round' });
    body += el('circle', { cx: tip.x, cy: tip.y, r: big ? 5.5 : 4, fill: T.bar, stroke: T.bg, 'stroke-width': 2, 'paint-order': 'stroke' });
  }
  for (const l of labels) {
    // A label pushed away from its arrow keeps a thin line back to it.
    if (Math.abs(l.ly - l.ly0) > 2) {
      body += line(l.x, l.y, l.lx - (l.anchor === 'start' ? 2 : -2), l.ly - fs * 0.34, { stroke: T.muted, 'stroke-width': big ? 1.25 : 1 });
    }
    body += text(l.lx, l.ly, l.d.short[lang], { 'text-anchor': l.anchor, 'font-size': fs, 'font-weight': 600, fill: T.text });
  }
  return { body, width, height };
}

/** Share of the variance between parties on each component. */
export function variancePanel({ model, t, width, big = false }) {
  const v = model.pca.explained;
  const top = big ? 18 : 10;
  const rowH = big ? 44 : 28;
  const labelW = big ? 66 : 42;
  const valueW = big ? 86 : 54;
  const barH = big ? 22 : 13;
  const fs = big ? 18 : 12.5;
  const scale = (width - labelW - valueW) / Math.max(...v);
  let body = '';
  v.forEach((value, i) => {
    const y = top + i * rowH + (rowH - barH) / 2;
    const shown = i < 2;
    body += text(0, y + barH / 2 + fs * 0.36, t('common.pc', { n: i + 1 }), { 'font-size': fs, 'font-weight': shown ? 700 : 500, fill: shown ? T.text : T.muted });
    body += bar(labelW, y, Math.max(2, value * scale), barH, shown ? T.bar : T.lineStrong);
    body += text(labelW + value * scale + 7, y + barH / 2 + fs * 0.36, `${t.num(value * 100, 1)}%`, { 'font-size': fs, 'font-weight': 600, fill: shown ? T.text : T.muted, 'font-variant-numeric': 'tabular-nums' });
  });
  return { body, width, height: top + v.length * rowH + 4 };
}

/** The person's map coordinates, taken apart into what each dimension adds. */
export function youPanel({ model, lang, t, width, scores, big = false }) {
  const values = [contributions(scores, model.pca, 0), contributions(scores, model.pca, 1)];
  return loadingsPanel({ model, lang, t, width, big, values, color: T.you });
}

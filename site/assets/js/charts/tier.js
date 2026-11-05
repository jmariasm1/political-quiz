// The tier list poster keeps the meme look of the original chart in both themes: pastel tier blocks
// on a dark board, white logo tiles. The page uses a responsive HTML version of the same grouping.
import { fixedTier, spreadTiers } from '../core.js';
import { T, clusterColor, el, line, logoFit, measure, partyColor, rect, subColor, svgDoc, text, wrap } from './svg.js';

const BOARD = { bg: '#161616', row: '#272727', text: '#F5F5F5', text2: '#D0D0D0', text3: '#ADADAD', ink: '#121212' };

/** The tiers in use for this view: fixed cutoffs, or the most even 5-or-10-point cutoffs for this person. */
export function activeTiers({ ranked, tiers, mode }) {
  return mode === 'spread' ? spreadTiers(ranked.map((r) => r.score), tiers).tiers : tiers;
}

/** Split ranked parties into tiers. Hidden parties keep their tier; they just aren't listed. */
export function groupTiers({ ranked, tiers, visible }) {
  const groups = tiers.map((tier) => ({ tier, rows: [] }));
  for (const row of ranked) {
    const tier = fixedTier(row.score, tiers);
    if (visible.has(row.party.id)) groups.find((x) => x.tier.id === tier.id).rows.push(row);
  }
  return groups;
}

export function tierRange(tier, tiers, t) {
  const i = tiers.indexOf(tier);
  if (i === 0) return t('tiers.andUp', { v: tier.min });
  if (i === tiers.length - 1) return t('tiers.below', { v: tiers[i - 1].min });
  return t('tiers.range', { a: tier.min, b: tiers[i - 1].min });
}

/** The groups named in the key, in their tile colours. Tiles are white in both themes. */
export function tierKey(model, lang, colorBy) {
  return colorBy === 'sub'
    ? model.clusters.flatMap((c) => c.children.map((s) => ({ label: s.label[lang], color: subColor(s.id, 'light') })))
    : model.clusters.map((c) => ({ label: c.label[lang], color: clusterColor(c.id, 'light') }));
}

export function tierPoster({ model, lang, t, groups, tiers, colorBy, logoUrl, flagUrl, title, subtitle, eyebrow, url, flagAspect }) {
  const COLUMNS = 9;
  const margin = 54;
  const labelW = 190;
  const tileW = 176;
  const tileH = 156;
  const gap = 12;
  const inset = 16;
  const width = 2 * margin + labelW + 2 * inset + COLUMNS * tileW + (COLUMNS - 1) * gap;
  const heights = groups.map((g) => Math.max(1, Math.ceil(g.rows.length / COLUMNS)) * (tileH + gap) - gap + 2 * inset);

  let y = 44;
  let body = text(margin, y + 16, eyebrow.toUpperCase(), { 'font-size': 20, 'font-weight': 700, fill: BOARD.text3, 'letter-spacing': 1.2 });
  y += 26;
  for (const l of wrap(title, width - 2 * margin, 84, 800, T.display)) {
    y += 80;
    body += text(margin - 2, y, l, { 'font-family': T.display, 'font-size': 84, 'font-weight': 800, fill: BOARD.text });
  }
  y += 44;
  body += text(margin, y, subtitle, { 'font-size': 25, fill: BOARD.text2 });
  y += 46;
  // Key: wraps when subgroups need more than one line.
  let lx = margin;
  for (const item of tierKey(model, lang, colorBy)) {
    const w = 37 + measure(item.label, 21) + 34;
    if (lx > margin && lx + w > width - margin) {
      lx = margin;
      y += 38;
    }
    body += rect(lx, y - 18, 25, 25, { rx: 5, fill: '#fdfdfd', stroke: item.color, 'stroke-width': 4 });
    body += text(lx + 37, y + 2, item.label, { 'font-size': 21, fill: BOARD.text2 });
    lx += w;
  }
  y += 40;

  groups.forEach((group, row) => {
    const rowH = heights[row];
    body += rect(margin, y, width - 2 * margin, rowH, { rx: 14, fill: BOARD.row });
    body += rect(margin, y, labelW, rowH, { rx: 13, fill: group.tier.color });
    const cx = margin + labelW / 2;
    const cy = y + rowH / 2;
    body += text(cx, cy - 8, group.tier.id, { 'font-family': T.display, 'font-size': 84, 'font-weight': 800, fill: BOARD.ink, 'text-anchor': 'middle' });
    body += text(cx, cy + 30, tierRange(group.tier, tiers, t), { 'font-size': 22, 'font-weight': 700, fill: BOARD.ink, 'text-anchor': 'middle' });
    body += text(cx, cy + 58, t('tiers.entries', { n: group.rows.length }), { 'font-size': 17, fill: BOARD.ink, 'text-anchor': 'middle' });

    group.rows.forEach(({ party, score }, position) => {
      const gridRow = Math.floor(position / COLUMNS);
      const col = position % COLUMNS;
      const x = margin + labelW + inset + col * (tileW + gap);
      const top = y + inset + gridRow * (tileH + gap);
      body += rect(x, top, tileW, tileH, { rx: 9, fill: '#fdfdfd', stroke: partyColor(party, colorBy, 'light'), 'stroke-width': 4 });
      if (party.logo) {
        const zoneW = tileW - 22;
        const fit = logoFit(party.logoAspect, zoneW, 84);
        body += el('image', { href: logoUrl(party), x: x + 11 + (zoneW - fit.w) / 2, y: top + 8 + (84 - fit.h) / 2, width: fit.w, height: fit.h, preserveAspectRatio: 'xMidYMid meet' });
      } else {
        body += text(x + tileW / 2, top + 58, party.abbrev, { 'font-size': 31, 'font-weight': 700, fill: BOARD.ink, 'text-anchor': 'middle' });
      }
      body += line(x + 12, top + 96, x + tileW - 12, top + 96, { stroke: '#e1e6ee' });
      const scoreText = t.num(score, 2);
      const room = tileW - 24 - measure(scoreText, 19, 700) - 8;
      const abbrevSize = Math.min(22, 22 * (room / Math.max(1, measure(party.abbrev, 22, 700))));
      body += text(x + 12, top + 123, party.abbrev, { 'font-size': abbrevSize, 'font-weight': 700, fill: BOARD.ink });
      body += text(x + tileW - 12, top + 122, scoreText, { 'font-size': 19, 'font-weight': 700, fill: BOARD.ink, 'text-anchor': 'end', 'font-variant-numeric': 'tabular-nums' });
      const aspect = flagAspect[party.flag] ?? 1.5;
      const fh = 18;
      const fw = fh * aspect;
      body += el('image', { href: flagUrl(party.flag), x: x + 13, y: top + 130, width: fw, height: fh, preserveAspectRatio: 'none' });
      body += rect(x + 12.5, top + 129.5, fw + 1, fh + 1, { fill: 'none', stroke: '#a9b4c3', 'stroke-width': 1 });
    });
    y += rowH + 8;
  });

  y += 12;
  for (const l of wrap(t('tiers.note'), width - 2 * margin, 21)) {
    y += 30;
    body += text(margin, y, l, { 'font-size': 21, fill: BOARD.text2 });
  }
  y += 28;
  body += text(margin, y, url.replace(/^https?:\/\//, '').replace(/\/$/, ''), { 'font-size': 19, 'font-weight': 600, fill: BOARD.text3 });
  const height = y + 44;
  return { svg: svgDoc(width, height, rect(0, 0, width, height, { fill: BOARD.bg }) + body), width, height };
}

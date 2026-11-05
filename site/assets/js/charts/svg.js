// Shared drawing primitives. Every chart is an SVG string so the same code draws the page and the
// PNG. SVG used as an image cannot see the page's CSS, so colours are literal: T holds the active
// theme's values and is swapped by setChartTheme. Keep them in step with the tokens in app.css.

const THEMES = {
  light: {
    mode: 'light', bg: '#FFFFFF', panel: '#FFFFFF', row: '#EDEDEA', line: '#D9D9D6', lineStrong: '#9A9A96',
    text: '#121212', text2: '#3F3F3F', text3: '#5E5E5E', muted: '#6B6B6B', you: '#D0021B', other: '#121212',
    bar: '#121212', dots: '#121212',
  },
  dark: {
    mode: 'dark', bg: '#161616', panel: '#161616', row: '#272727', line: '#333333', lineStrong: '#6E6E6E',
    text: '#F2F2F2', text2: '#D0D0D0', text3: '#ADADAD', muted: '#9A9A9A', you: '#FF5A4F', other: '#F2F2F2',
    bar: '#F2F2F2', dots: '#F2F2F2',
  },
};

export const T = {
  font: "'Libre Franklin', 'Helvetica Neue', Arial, sans-serif",
  display: "'Fira Sans Extra Condensed', 'Arial Narrow', Impact, sans-serif",
  ink: '#121212',
  ...THEMES.light,
};

export function setChartTheme(name) {
  Object.assign(T, THEMES[name] ?? THEMES.light);
}

// Group colours as [on light, on dark]. Red is reserved for "you", so no group uses it.
const MAIN = [['#00897B', '#26B5A5'], ['#9B4FD1', '#B98AF0'], ['#B7791F', '#E0A93F'], ['#C2378A', '#F06BB5']];
const SUBS = [
  [['#00897B', '#26B5A5'], ['#1565C0', '#4C8FE8'], ['#3DA535', '#4FBF5C'], ['#2FA9DE', '#5CC6F2'],
   ['#3A2FA8', '#8F8CF5'], ['#93A800', '#B5CF2F'], ['#8A5A2B', '#C49A6C'], ['#1B9E8A', '#57D6C2']],
  [['#9B4FD1', '#B98AF0'], ['#E07A00', '#F59E2E'], ['#D6338F', '#F06BB5'], ['#A0702A', '#CFA24A'],
   ['#6B2F8A', '#A86BCB'], ['#B85C6E', '#E08DA0'], ['#C99700', '#E8C33A'], ['#7D3C98', '#C39BD3']],
  [['#B7791F', '#E0A93F'], ['#7C8A12', '#B3C03A'], ['#A0522D', '#D2916B'], ['#6E7F1F', '#A5B84E']],
  [['#C2378A', '#F06BB5'], ['#A0307A', '#D977B6'], ['#D15A9E', '#F09CC8'], ['#8E2F6B', '#C76FA6']],
];
// The third level, by main cluster and then subgroup. These colours can't all stay apart for every
// kind of colour vision, so they're spaced for full colour vision, with shape and direct names as backup.
const LEAVES = [
  [
    [['#00A084', '#14D8B8'], ['#206701', '#3E9A1F'], ['#9BC222', '#C4D142']],
    [['#52BCFC', '#7AD3FF'], ['#27588C', '#4F7FE8'], ['#816CE1', '#7B62F2']],
  ],
  [
    [['#851795', '#D86FE0'], ['#DA3D7E', '#D8487C'], ['#EF7CF3', '#FCB7EE']],
    [['#A25C00', '#A66F2C'], ['#FC8642', '#FF7A45']],
  ],
];
const pick = (pair, mode) => pair[(mode ?? T.mode) === 'dark' ? 1 : 0];
const parentIndex = (id) => (parseInt(String(id).slice(1), 10) - 1) % MAIN.length;

export const clusterColor = (id, mode) => pick(MAIN[parentIndex(id)], mode);
export function subColor(id, mode) {
  const family = SUBS[parentIndex(id)];
  return pick(family[(String(id).charCodeAt(2) - 97) % family.length], mode);
}
export function leafColor(id, mode) {
  const [, letter, number] = /^C\d+([a-z])(\d+)$/.exec(id);
  const family = LEAVES[parentIndex(id) % LEAVES.length];
  const tones = family[(letter.charCodeAt(0) - 97) % family.length];
  return pick(tones[(Number(number) - 1) % tones.length], mode);
}
/** Any group's colour, from its id: C1 is a main cluster, C1a a subgroup, C1a1 a current. */
export function groupColor(id, mode) {
  if (/^C\d+$/.test(id)) return clusterColor(id, mode);
  return /^C\d+[a-z]$/.test(id) ? subColor(id, mode) : leafColor(id, mode);
}
/** The group a party is shown in under the chosen view: 'cluster', 'sub' or 'leaf'. */
export function partyGroupId(party, colorBy) {
  if (colorBy === 'leaf') return party.leaf ?? party.sub ?? party.cluster;
  return colorBy === 'sub' ? party.sub ?? party.cluster : party.cluster;
}
export const partyColor = (party, colorBy, mode) => groupColor(partyGroupId(party, colorBy), mode);
/** The groups a view shows. A group that stayed whole stands in for the level below it. */
export function groupsAt(model, colorBy) {
  if (colorBy !== 'sub' && colorBy !== 'leaf') return model.clusters;
  return model.clusters.flatMap((c) => {
    if (!c.children.length) return [c];
    return c.children.flatMap((s) => (colorBy === 'leaf' && s.children.length ? s.children : [s]));
  });
}

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const attrs = (a) =>
  Object.entries(a)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ');

export const el = (name, a = {}, children = null) =>
  children === null ? `<${name} ${attrs(a)}/>` : `<${name} ${attrs(a)}>${children}</${name}>`;

export const g = (a, children) => el('g', a, children);
export const rect = (x, y, width, height, a = {}) => el('rect', { x, y, width, height, ...a });
export const line = (x1, y1, x2, y2, a = {}) => el('line', { x1, y1, x2, y2, stroke: T.line, 'stroke-width': 1, ...a });
export const text = (x, y, s, a = {}) =>
  el('text', { x, y, 'font-family': T.font, 'font-size': 13, fill: T.text2, ...a }, esc(s));

/** A bar with a rounded data end and a square baseline end. Direction follows `w`'s sign. */
export function bar(x, y, w, h, fill, r = 2, a = {}) {
  const width = Math.abs(w);
  if (width < 0.5) return '';
  const rr = Math.min(r, width, h / 2);
  const d =
    w >= 0
      ? `M${x} ${y}h${width - rr}q${rr} 0 ${rr} ${rr}v${h - 2 * rr}q0 ${rr} ${-rr} ${rr}h${rr - width}z`
      : `M${x} ${y}h${rr - width}q${-rr} 0 ${-rr} ${rr}v${h - 2 * rr}q0 ${rr} ${rr} ${rr}h${width - rr}z`;
  return el('path', { d, fill, ...a });
}

// Text measurement. Fonts are loaded before the first chart renders.
let ctx = null;
export function measure(s, size = 13, weight = 400, family = T.font) {
  if (typeof document === 'undefined') return String(s).length * size * 0.56;
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = `${weight} ${size}px ${family}`;
  return ctx.measureText(String(s)).width;
}

/** Greedy word wrap on measured width. */
export function wrap(s, maxWidth, size = 13, weight = 400, family = T.font) {
  const lines = [];
  let current = '';
  for (const word of String(s).split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, size, weight, family) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Shorten text to a measured width, ending in an ellipsis. */
export function fit(s, width, size, weight) {
  if (measure(s, size, weight) <= width) return s;
  let out = s;
  while (out.length > 3 && measure(`${out}…`, size, weight) > width) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

/** Best of near-black or white on a given #rrggbb or rgb() fill. */
export function inkOn(color) {
  const parts = color.startsWith('#')
    ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
    : color.match(/\d+/g).map(Number);
  const lin = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(parts[0]) + 0.7152 * lin(parts[1]) + 0.0722 * lin(parts[2]);
  return (L + 0.05) / 0.0585 > 1.05 / (L + 0.05) ? '#121212' : '#FFFFFF';
}

/**
 * Sizes a logo by area instead of filling its box, so dense marks don't shout next to thin
 * wordmarks. Returns the width and height to draw, inside a zone of zoneW by zoneH.
 */
export function logoFit(aspect, zoneW, zoneH, fill = 0.6) {
  const area = zoneW * zoneH * fill;
  let w = Math.sqrt(area * aspect);
  let h = w / aspect;
  if (w > zoneW) {
    w = zoneW;
    h = w / aspect;
  }
  if (h > zoneH) {
    h = zoneH;
    w = h * aspect;
  }
  return { w, h };
}

export const MARKERS = ['circle', 'square', 'diamond', 'triUp', 'triDown', 'hexagon', 'plus', 'triLeft'];

/** Subgroup colours can't all be told apart by every reader, so shape carries identity too. */
export function markerPath(shape, x, y, r) {
  const poly = (pts) => `M${pts.map((p) => p.map((v) => +v.toFixed(2)).join(' ')).join('L')}Z`;
  const around = (n, start = -Math.PI / 2, rad = r) =>
    Array.from({ length: n }, (_, i) => {
      const a = start + (i * 2 * Math.PI) / n;
      return [x + rad * Math.cos(a), y + rad * Math.sin(a)];
    });
  switch (shape) {
    case 'square': {
      const s = r * 0.9;
      return poly([[x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s]]);
    }
    case 'diamond':
      return poly(around(4, -Math.PI / 2, r * 1.25));
    case 'triUp':
      return poly(around(3, -Math.PI / 2, r * 1.35));
    case 'triDown':
      return poly(around(3, Math.PI / 2, r * 1.35));
    case 'triLeft':
      return poly(around(3, Math.PI, r * 1.35));
    case 'hexagon':
      return poly(around(6, 0, r * 1.12));
    case 'plus': {
      const a = r * 1.12;
      const b = r * 0.42;
      return poly([
        [x - b, y - a], [x + b, y - a], [x + b, y - b], [x + a, y - b], [x + a, y + b], [x + b, y + b],
        [x + b, y + a], [x - b, y + a], [x - b, y + b], [x - a, y + b], [x - a, y - b], [x - b, y - b],
      ]);
    }
    default:
      return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  }
}

export function shapeOf(id) {
  const parts = /^C\d+([a-z])(\d+)?$/.exec(id ?? '');
  if (!parts) return 'circle';
  const letter = parts[1].charCodeAt(0) - 97;
  return MARKERS[(parts[2] ? letter * 3 + Number(parts[2]) - 1 : letter) % MARKERS.length];
}

export function svgDoc(width, height, body, a = {}) {
  return el(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', 'xmlns:xlink': 'http://www.w3.org/1999/xlink', viewBox: `0 0 ${width} ${height}`, width, height, ...a },
    body,
  );
}

/** The frame every chart PNG shares: heavy headline, one plain line, the chart, notes, then the source. */
export function poster({ title, subtitle, brand, width, contentHeight, content, notes = [], url, pad = 56, titleSize = 72 }) {
  const titleLines = wrap(title, width - 2 * pad, titleSize, 800, T.display);
  const subLines = subtitle ? wrap(subtitle, width - 2 * pad, 24, 400) : [];
  let y = pad;
  let head = rect(pad, y, 90, 8, { fill: T.you });
  y += 8;
  for (const l of titleLines) {
    y += titleSize * 1.02;
    head += text(pad, y - titleSize * 0.06, l, { 'font-family': T.display, 'font-size': titleSize, 'font-weight': 800, fill: T.text });
  }
  y += 6;
  for (const l of subLines) {
    y += 33;
    head += text(pad, y - 4, l, { 'font-size': 24, fill: T.text2 });
  }
  const top = y + 32;
  let foot = '';
  let fy = top + contentHeight + 14;
  const noteLines = notes.flatMap((n) => wrap(n, width - 2 * pad, 18, 400));
  for (const l of noteLines) {
    fy += 27;
    foot += text(pad, fy, l, { 'font-size': 18, fill: T.text3 });
  }
  fy += 42;
  const site = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  foot += line(pad, fy - 26, width - pad, fy - 26, { stroke: T.lineStrong });
  foot += text(pad, fy, brand, { 'font-size': 18, 'font-weight': 700, fill: T.text });
  foot += text(width - pad, fy, site, { 'font-size': 18, fill: T.text3, 'text-anchor': 'end' });
  const height = fy + pad - 18;
  const body = rect(0, 0, width, height, { fill: T.bg }) + head + g({ transform: `translate(${pad} ${top})` }, content) + foot;
  return { svg: svgDoc(width, height, body), width, height };
}

// Turns any chart's SVG into a PNG download. Logos, flags and fonts are embedded first,
// because an SVG drawn as an image can't load anything from outside itself.

const cache = new Map();
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

async function asDataUrl(url) {
  if (!cache.has(url)) {
    cache.set(url, (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${url}`);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    })());
  }
  return cache.get(url);
}

const fontUrl = (name) => new URL(`../fonts/${name}.woff2`, import.meta.url).href;

async function face(family, file, weight) {
  const [latin, ext] = await Promise.all([asDataUrl(fontUrl(`${file}-latin`)), asDataUrl(fontUrl(`${file}-latin-ext`))]);
  return `@font-face{font-family:'${family}';src:url(${ext}) format('woff2');font-weight:${weight};unicode-range:${LATIN_EXT}}` +
    `@font-face{font-family:'${family}';src:url(${latin}) format('woff2');font-weight:${weight};unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215}`;
}

async function embedAssets(svg) {
  const urls = [...new Set([...svg.matchAll(/href="([^"#][^"]*)"/g)].map((m) => m[1]))].filter((u) => !u.startsWith('data:'));
  const pairs = await Promise.all(
    urls.map(async (u) => {
      try {
        return [u, await asDataUrl(u.replaceAll('&amp;', '&'))];
      } catch {
        return [u, null]; // A missing image shouldn't lose the whole chart.
      }
    }),
  );
  let out = svg;
  for (const [u, data] of pairs) if (data) out = out.split(`href="${u}"`).join(`href="${data}"`);
  const faces = await Promise.all([
    face('Fira Sans Extra Condensed', 'display-800', 800),
    ...[400, 500, 600, 700].map((w) => face('Libre Franklin', `text-${w}`, w)),
  ]);
  return out.replace(/(<svg[^>]*>)/, `$1<defs><style>${faces.join('')}</style></defs>`);
}

// iPhones and iPads refuse canvases above about 16.7 megapixels, and a long tier list can pass that at double size.
const MAX_CANVAS_PIXELS = 16_000_000;

export async function svgToPngBlob({ svg, width, height }, scale = 2) {
  const embedded = await embedAssets(svg);
  const image = new Image();
  image.decoding = 'sync';
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The chart could not be drawn as an image.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(embedded)}`;
  await loaded;
  // Safari can report the image as loaded before its embedded font is ready; a short wait
  // and a redraw give the same result everywhere without slowing other browsers noticeably.
  const canvas = document.createElement('canvas');
  const fitted = Math.min(scale, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
  canvas.width = Math.round(width * fitted);
  canvas.height = Math.round(height * fitted);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  await new Promise((r) => setTimeout(r, 60));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not create the PNG.'))), 'image/png');
  });
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

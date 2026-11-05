// Small shared UI pieces: chart mounting, PNG buttons, the scope and colour controls, and the tooltip.
import { normalizeScope, scopeParties } from './core.js';
import { esc, groupColor, logoFit, markerPath, shapeOf } from './charts/svg.js';
import { saveBlob, svgToPngBlob } from './export.js';

export const flagUrl = (flag) => `../assets/flags/${flag}.png`;
export const logoUrl = (party) => `../assets/logos/${party.logo}`;

const motionOk = () => typeof IntersectionObserver !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Charts ease in the first time they scroll into view. Without motion they're simply there. */
function revealOnce(host) {
  if (!motionOk()) return;
  host.classList.add('pre-reveal');
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    host.classList.remove('pre-reveal');
    host.classList.add('revealed');
    observer.disconnect();
  }, { threshold: 0.08 });
  observer.observe(host);
}

/** Render a chart at its container's width, and again whenever that width changes. */
export function mountChart(host, render) {
  let last = 0;
  const run = () => {
    const width = Math.floor(host.clientWidth);
    if (width > 0 && width !== last) {
      last = width;
      render(width);
    }
  };
  const observer = new ResizeObserver(run);
  observer.observe(host);
  run();
  revealOnce(host);
  return {
    refresh() {
      last = 0;
      run();
      host.classList.remove('updated');
      void host.offsetWidth;
      host.classList.add('updated');
    },
    destroy: () => observer.disconnect(),
  };
}

const downloadIcon =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"><path d="M8 2v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11"/></svg>';

export const iconButton = (attr, label) => `<button type="button" class="link-btn" ${attr}>${downloadIcon}<span>${esc(label)}</span></button>`;
export const pngButton = (key, t) => iconButton(`data-png="${esc(key)}"`, t('common.png'));

/** Wires every [data-png] button under root. Builders return { svg, width, height, filename, scale }. */
export function wirePng(root, builders, t) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-png]');
    if (!button || !builders[button.dataset.png]) return;
    const label = button.querySelector('span');
    const original = label.textContent;
    button.disabled = true;
    label.textContent = t('common.pngBusy');
    try {
      const poster = await builders[button.dataset.png]();
      const blob = await svgToPngBlob(poster, poster.scale ?? 2);
      saveBlob(blob, poster.filename);
      label.textContent = original;
    } catch (error) {
      console.error(error);
      label.textContent = t('common.pngFailed');
      setTimeout(() => (label.textContent = original), 4000);
    } finally {
      button.disabled = false;
    }
  });
}

export const scopeLabel = (scope, model, t) => {
  const [kind, id] = String(scope).split(':');
  if (kind === 'g') return model.groupings.find((g) => g.id === id)?.name[t.lang] ?? t('scope.all');
  if (kind === 'c') return model.countries.find((c) => c.code === id)?.name[t.lang] ?? t('scope.all');
  return t('scope.all');
};

export const scopeSlug = (scope) => String(scope).replace(':', '-').toLowerCase();

/** One control for every filter: all parties, a grouping, or a single country. */
function scopeSelect(app) {
  const { model, t, scope } = app;
  const opt = (value, label) => `<option value="${esc(value)}" ${scope === value ? 'selected' : ''}>${esc(label)}</option>`;
  const countries = model.countries.slice().sort((a, b) => a.name[t.lang].localeCompare(b.name[t.lang], t.lang));
  return `
  <label class="field">
    <span>${esc(t('scope.label'))}</span>
    <select data-scope-select>
      ${opt('all', t('scope.all'))}
      <optgroup label="${esc(t('scope.groups'))}">${model.groupings.map((g) => opt(`g:${g.id}`, g.name[t.lang])).join('')}</optgroup>
      <optgroup label="${esc(t('scope.countries'))}">${countries.map((c) => opt(`c:${c.code}`, c.name[t.lang])).join('')}</optgroup>
    </select>
  </label>`;
}

function colorSelect(app) {
  const { t, colorBy } = app;
  return `
  <label class="field">
    <span>${esc(t('colorBy.label'))}</span>
    <select data-color-select>
      ${['leaf', 'sub', 'cluster'].map((view) => `<option value="${view}" ${colorBy === view ? 'selected' : ''}>${esc(t(`colorBy.${view}`))}</option>`).join('')}
    </select>
  </label>`;
}

/** The two choices that apply to every chart on a page. They sit together in the page's top bar. */
export const filterFields = (app) => `<div class="filters">${scopeSelect(app)}${colorSelect(app)}</div>`;

export function wireFilters(root, app) {
  root.addEventListener('change', (event) => {
    if (event.target.matches('[data-scope-select]')) app.setScope(event.target.value);
    if (event.target.matches('[data-color-select]')) app.setColorBy(event.target.value);
  });
}

/** A two-way text switch. The chosen side is bold and underlined, and it's a real pressed button. */
export const toggle = (label, attr, options, current) => `
  <div class="toggle" role="group" aria-label="${esc(label)}">
    <span class="toggle-label">${esc(label)}</span>
    ${options.map(([value, text]) => `<button type="button" ${attr}="${esc(value)}" aria-pressed="${value === current}">${esc(text)}</button>`).join('')}
  </div>`;

export const syncToggle = (root, attr, current) =>
  root.querySelectorAll(`[${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === current)));

/** Extra explanation stays closed until someone asks for it. */
export const howTo = (t, body) => `<details class="howto"><summary>${esc(t('common.howto'))}</summary><div class="howto-body">${body}</div></details>`;

export const visibleSet = (app) => new Set(scopeParties(normalizeScope(app.scope, app.model), app.model).map((p) => p.id));

// One tooltip for the whole site. It adds detail but never holds the only copy of a value.
let tip = null;
export function showTip(html, x, y) {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'status');
    document.body.append(tip);
  }
  tip.innerHTML = html;
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  const left = x + 18 + box.width > window.innerWidth - 8 ? x - box.width - 14 : x + 18;
  const top = y + 16 + box.height > window.innerHeight ? y - box.height - 12 : y + 16;
  tip.style.transform = `translate(${Math.round(Math.max(8, left))}px, ${Math.round(Math.max(8, top))}px)`;
}
export function hideTip() {
  if (tip) tip.hidden = true;
}

export const groupIcon = (id, isSub, size = 14) =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 16 16"><path d="${markerPath(isSub ? shapeOf(id) : 'circle', 8, 8, 5.5)}" fill="${groupColor(id)}"/></svg>`;

export const partyLogo = (party, cls = 'logo') => {
  if (!party.logo) return `<span class="${cls}"><span class="logo-fallback">${esc(party.abbrev)}</span></span>`;
  const { w } = logoFit(party.logoAspect, 1.7, 1);
  return `<span class="${cls}"><img src="${esc(logoUrl(party))}" alt="" loading="lazy" decoding="async" style="width:${((w / 1.7) * 100).toFixed(1)}%"></span>`;
};

export const flagImg = (party, cls = 'flag') => `<img class="${cls}" src="${esc(flagUrl(party.flag))}" alt="" loading="lazy" decoding="async">`;

export const countryName = (code, app) => app.model.countries.find((c) => c.code === code)?.name[app.t.lang] ?? code;

export function emptyState(app) {
  const { t, store } = app;
  const old = store.legacy().at(-1);
  if (old) return `<div class="empty"><p>${esc(t('common.legacyResult'))}</p><a class="cta" href="#/quiz?finish=${esc(old.id)}">${esc(t('home.finish'))}</a></div>`;
  return `<div class="empty"><p>${esc(t('common.noResult'))}</p><a class="cta" href="#/quiz">${esc(t('common.takeQuiz'))}</a></div>`;
}

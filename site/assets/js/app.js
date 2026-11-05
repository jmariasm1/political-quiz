// Entry point: loads the model, then routes on the URL hash.
import { assign, normalizeScope, project, rankParties, scoreAnswers } from './core.js';
import { createT } from './i18n.js';
import { store } from './store.js';
import { esc, setChartTheme } from './charts/svg.js';
import { compareView } from './views/compare.js';
import { homeView } from './views/home.js';
import { mapView } from './views/map.js';
import { methodView } from './views/method.js';
import { quizView } from './views/quiz.js';
import { resultsView } from './views/results.js';

const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
const t = createT(lang);

const ROUTES = {
  '': homeView,
  quiz: quizView,
  results: resultsView,
  map: mapView,
  compare: compareView,
  method: methodView,
};
const NAV = [
  ['results', 'nav.results'],
  ['map', 'nav.map'],
  ['compare', 'nav.compare'],
  ['method', 'nav.method'],
];

const listeners = new Map();

const app = {
  model: null,
  t,
  store,
  scope: 'all',
  colorBy: 'cluster',
  tierMode: 'fixed',
  derive(result) {
    const scores = scoreAnswers(result.answers, this.model.questions, this.model.dimensions);
    return {
      result,
      scores,
      assign: assign(scores, this.model),
      ranked: rankParties(scores, this.model.parties),
      pc: project(scores, this.model.pca),
    };
  },
  /** Page sections subscribe here, so one control updates every chart it scopes. Cleared on each route. */
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  emit(event, value) {
    listeners.get(event)?.forEach((fn) => fn(value));
  },
  navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
  /** Keep the URL in step with on-page state, without adding a history entry or a re-render. */
  replaceHash(hash) {
    if (location.hash !== hash) history.replaceState(null, '', hash);
    updateLanguageLink();
  },
  setScope(scope) {
    this.scope = normalizeScope(scope, this.model);
    store.setScope(this.scope);
    const [path, query = ''] = location.hash.slice(1).split('?');
    const params = new URLSearchParams(query);
    if (this.scope === 'all') params.delete('scope');
    else params.set('scope', this.scope);
    const suffix = params.toString();
    this.replaceHash(`#${path || '/'}${suffix ? `?${suffix}` : ''}`);
    document.querySelectorAll('[data-scope-select]').forEach((s) => (s.value = this.scope));
    this.emit('scope', this.scope);
  },
  setColorBy(colorBy) {
    this.colorBy = colorBy === 'sub' || colorBy === 'leaf' ? colorBy : 'cluster';
    this.emit('color', this.colorBy);
  },
};

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { name: path.split('/')[0], params: Object.fromEntries(new URLSearchParams(query)) };
}

const currentTheme = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

function shell() {
  document.body.innerHTML = `
  <a class="skip" href="#main" data-skip>${esc(t('skip'))}</a>
  <header class="topbar">
    <div class="topbar-in">
      <a class="brand" href="#/">${esc(t('brand'))}</a>
      <nav aria-label="${esc(t('nav.menu'))}" class="nav" data-nav></nav>
      <div class="top-tools">
        <button type="button" class="icon-btn" data-theme-toggle></button>
        <div class="lang" role="group" aria-label="${esc(t('nav.language'))}">
          <a data-lang="en" href="../en/" hreflang="en" ${lang === 'en' ? 'aria-current="true"' : ''}>EN</a>
          <a data-lang="es" href="../es/" hreflang="es" ${lang === 'es' ? 'aria-current="true"' : ''}>ES</a>
        </div>
      </div>
    </div>
  </header>
  <main id="main" tabindex="-1"></main>
  <footer class="footer">
    <p>${esc(t('common.disclaimer'))} ${esc(t('common.privacy'))} <a href="#/method">${esc(t('nav.method'))}</a></p>
  </footer>`;
  document.querySelector('[data-skip]').addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('main').focus();
  });
  document.querySelectorAll('[data-lang]').forEach((link) => {
    link.addEventListener('click', () => {
      try {
        window.localStorage.setItem('gic.lang', link.dataset.lang);
      } catch {
        /* The choice just won't be remembered. */
      }
    });
  });
  document.querySelector('[data-theme-toggle]').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    try {
      window.localStorage.setItem('gic.theme', next);
    } catch {
      /* The choice just won't be remembered. */
    }
    applyTheme(next, true);
  });
  refreshThemeButton();
}

function refreshThemeButton() {
  const button = document.querySelector('[data-theme-toggle]');
  const dark = currentTheme() === 'dark';
  button.setAttribute('aria-label', t(dark ? 'theme.toLight' : 'theme.toDark'));
  button.title = t(dark ? 'theme.toLight' : 'theme.toDark');
  button.innerHTML = dark
    ? '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>'
    : '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>';
}

/** Charts carry literal colours, so a theme change redraws the current page in place. */
function applyTheme(theme, rerender) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#161616' : '#ffffff');
  setChartTheme(theme);
  refreshThemeButton();
  if (rerender) {
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  }
}

function refreshNav() {
  const { name } = parseHash();
  document.querySelector('[data-nav]').innerHTML = NAV.map(([key, label]) => (
    `<a href="#/${key}" ${key === name ? 'aria-current="page"' : ''}>${esc(t(label))}</a>`
  )).join('');
}

function updateLanguageLink() {
  document.querySelectorAll('[data-lang]').forEach((link) => {
    link.setAttribute('href', `../${link.dataset.lang}/${location.hash}`);
  });
}

let cleanup = null;

function route() {
  let { name, params } = parseHash();
  // The tier list now lives inside the results story.
  if (name === 'tiers') {
    name = 'results';
    params = { ...params, s: 'tiers' };
  }
  const view = ROUTES[name] ?? homeView;
  cleanup?.();
  cleanup = null;
  listeners.clear();
  if (params.scope) {
    app.scope = normalizeScope(params.scope, app.model);
    store.setScope(app.scope);
  }
  // Each view gets a fresh node, so its listeners can't outlive it.
  const main = document.getElementById('main');
  const root = document.createElement('div');
  root.className = `view view-${name || 'home'}`;
  main.replaceChildren(root);
  if (name === 'quiz' && params.new) history.replaceState(null, '', '#/quiz');
  cleanup = view(root, app, params) ?? null;
  refreshNav();
  updateLanguageLink();
  const titleKey = NAV.find(([key]) => key === name)?.[1];
  document.title = titleKey ? `${t(titleKey)} | ${t('brand')}` : t('brand');
  window.scrollTo(0, 0);
}

async function start() {
  setChartTheme(currentTheme());
  shell();
  const response = await fetch('../data/model.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`model.json: ${response.status}`);
  app.model = await response.json();
  app.scope = normalizeScope(store.scope(), app.model);
  await Promise.allSettled(['400 13px "Libre Franklin"', '500 13px "Libre Franklin"', '700 13px "Libre Franklin"', '800 20px "Fira Sans Extra Condensed"'].map((f) => document.fonts.load(f)));
  window.addEventListener('hashchange', route);
  route();
  document.documentElement.dataset.ready = 'true';
}

start().catch((error) => {
  console.error(error);
  document.getElementById('main').innerHTML = `<p class="note">${lang === 'es' ? 'No se pudieron cargar los datos. Recarga la página.' : 'The data could not be loaded. Please reload the page.'}</p>`;
});

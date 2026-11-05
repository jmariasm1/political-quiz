import { esc } from '../charts/svg.js';
import { flagImg, partyLogo } from '../ui.js';
import { mountMapFigure } from './map.js';

function savedRow(app, derived) {
  const { t } = app;
  const top = derived.ranked[0];
  const group = derived.assign.sub ?? derived.assign.main;
  return `
  <li class="saved">
    ${partyLogo(top.party, 'logo logo-small')}
    <div class="saved-body">
      <p class="saved-main"><b>${esc(group.label[t.lang])}</b></p>
      <p class="saved-sub">${esc(t.date(derived.result.at))} · ${flagImg(top.party, 'flag-inline')} ${esc(top.party.label)} ${esc(t.num(top.score, 2))}</p>
    </div>
    <a class="text-link" href="#/results?r=${esc(derived.result.id)}">${esc(t('home.open'))}</a>
    <button type="button" class="text-link quiet" data-delete="${esc(derived.result.id)}" aria-label="${esc(t('home.deleteNamed', { date: t.date(derived.result.at) }))}">${esc(t('home.delete'))}</button>
  </li>`;
}

export function homeView(root, app) {
  const { t, model, store } = app;
  let figure = null;
  const render = () => {
    figure?.destroy();
    const results = store.results();
    const draft = store.draft();
    const answered = draft ? draft.answers.filter(Boolean).length : 0;
    const latest = results.length ? results[results.length - 1] : null;
    const primaryHref = latest ? `#/results?r=${latest.id}` : '#/quiz';
    const primaryLabel = latest ? t('home.view') : answered ? t('home.resume', { n: answered }) : t('home.start');
    const secondary = latest
      ? `<a class="text-link" href="#/quiz?new=1">${esc(answered ? t('home.resume', { n: answered }) : t('home.retake'))}</a>`
      : `<a class="text-link" href="#/map">${esc(t('home.explore'))}</a>`;
    root.innerHTML = `
    <section class="hero">
      <h1>${esc(t('home.title'))}</h1>
      <div class="hero-side">
        <p class="deck">${esc(t('home.lead', { parties: model.parties.length }))}</p>
        <div class="actions">
          <a class="cta" href="${primaryHref}">${esc(primaryLabel)}</a>
          ${secondary}
        </div>
        <p class="meta">${esc(t('home.meta'))}</p>
      </div>
    </section>
    <figure class="fig hero-map">
      <div class="chart chart-map" data-home-map></div>
      <figcaption class="meta">${esc(t('home.mapCaption'))}</figcaption>
    </figure>
    ${
      results.length
        ? `<section class="sec" aria-labelledby="saved-h">
            <div class="sec-head"><h2 id="saved-h">${esc(t('home.saved'))}</h2></div>
            <ul class="saved-list">${results.slice().reverse().map((r) => savedRow(app, app.derive(r))).join('')}</ul>
            <button type="button" class="text-link quiet" data-delete-all>${esc(t('home.deleteAll'))}</button>
          </section>`
        : ''
    }`;
    figure = mountMapFigure(root.querySelector('[data-home-map]'), app, { you: null, hero: true });
  };
  render();
  root.addEventListener('click', (event) => {
    const del = event.target.closest('[data-delete]');
    if (del) {
      store.deleteResult(del.dataset.delete);
      render();
      return;
    }
    if (event.target.closest('[data-delete-all]') && window.confirm(t('home.deleteAllConfirm'))) {
      store.clearAll();
      render();
    }
  });
  return () => figure?.destroy();
}

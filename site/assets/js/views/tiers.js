import { activeTiers, groupTiers, tierKey, tierPoster, tierRange } from '../charts/tier.js';
import { esc, partyColor } from '../charts/svg.js';
import {
  countryName, emptyState, filterFields, flagImg, flagUrl, howTo, logoUrl, partyLogo, pngButton, scopeLabel, scopeSlug, syncToggle, toggle,
  visibleSet, wireFilters, wirePng,
} from '../ui.js';

/** The tier list, in the meme format of the original chart. */
export function tierSection(root, app, you, { story = false } = {}) {
  const { t, model } = app;
  const { ranked } = you;
  const lang = t.lang;

  const legend = () =>
    tierKey(model, lang, app.colorBy)
      .map((item) => `<span class="tile-key"><i style="--c:${item.color}"></i>${esc(item.label)}</span>`)
      .join('');

  const renderBoard = () => {
    const tiers = activeTiers({ ranked, tiers: model.tiers, mode: app.tierMode });
    const groups = groupTiers({ ranked, tiers, visible: visibleSet(app) });
    root.querySelector('[data-take]').textContent = t('tiers.take', { n: groups[0].rows.length });
    root.querySelector('[data-key]').innerHTML = legend();
    root.querySelector('[data-board]').innerHTML = `
      <div class="tier-board">
        ${groups
          .map(({ tier, rows }) => `
          <section class="tier-row" aria-label="${esc(tier.id)}">
            <div class="tier-label" style="--c:${tier.color}">
              <strong>${esc(tier.id)}</strong>
              <span>${esc(tierRange(tier, tiers, t))}</span>
              <small>${esc(t('tiers.entries', { n: rows.length }))}</small>
            </div>
            <div class="tier-tiles">
              ${
                rows.length
                  ? rows
                      .map(({ party, score }) => `
                <a class="tile" style="--c:${partyColor(party, app.colorBy, 'light')}" href="#/compare?a=you&b=${esc(party.id)}" data-compare-party="${esc(party.id)}"
                   aria-label="${esc(t('tiers.tileLabel', { party: party.name[lang], country: countryName(party.country, app), score: t.num(score, 2) }))}" title="${esc(party.name[lang])} · ${esc(countryName(party.country, app))}">
                  ${partyLogo(party, 'tile-logo')}
                  <span class="tile-meta"><b class="${party.abbrev.length > 6 ? 'long' : ''}">${esc(party.abbrev)}</b><b class="tile-score">${esc(t.num(score, 2))}</b></span>
                  ${flagImg(party)}
                </a>`)
                      .join('')
                  : `<p class="tier-none">${esc(t('tiers.noEntries'))}</p>`
              }
            </div>
          </section>`)
          .join('')}
      </div>`;
    syncToggle(root, 'data-mode', app.tierMode);
  };

  root.innerHTML = `
  <section class="sec" ${story ? 'id="s-tiers"' : ''}>
    <div class="sec-head">
      <h2>${esc(t('tiers.title'))}</h2>
      <p class="takeaway" data-take></p>
    </div>
    <div class="controls">
      ${toggle(t('tiers.modeLabel'), 'data-mode', [['fixed', t('tiers.fixed')], ['spread', t('tiers.spread')]], app.tierMode)}
      ${pngButton('tiers', t)}
    </div>
    <div class="tile-keys" data-key></div>
    <div data-board></div>
    ${howTo(t, `<p>${esc(t('tiers.fixedHelp'))}</p><p>${esc(t('tiers.spreadHelp'))}</p><p>${esc(t('tiers.note'))}</p>`)}
  </section>`;

  renderBoard();

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (button) {
      app.tierMode = button.dataset.mode;
      renderBoard();
    }
  });
  const off = [app.on('scope', renderBoard), app.on('color', renderBoard)];

  wirePng(root, {
    tiers: () => {
      const visible = visibleSet(app);
      const tiers = activeTiers({ ranked, tiers: model.tiers, mode: app.tierMode });
      const groups = groupTiers({ ranked, tiers, visible });
      const scope = app.scope === 'all' ? t('tiers.countries', { n: model.countries.length }) : scopeLabel(app.scope, model, t);
      const p = tierPoster({
        model, lang, t, groups, tiers, colorBy: app.colorBy, logoUrl, flagUrl, flagAspect: model.flagAspect,
        eyebrow: t('tiers.posterEyebrow'),
        title: t('tiers.posterTitle'),
        subtitle: t('tiers.posterSub', { parties: visible.size, scope }),
        url: model.site.url,
      });
      return { ...p, scale: 1.5, filename: `compass-tier-list-${app.tierMode}-${app.colorBy}-${scopeSlug(app.scope)}-${lang}.png` };
    },
  }, t);

  return () => off.forEach((f) => f());
}

export function tiersView(root, app) {
  const { t, store } = app;
  const active = store.active();
  if (!active) {
    root.innerHTML = `<header class="page-head"><h1>${esc(t('tiers.title'))}</h1></header>${emptyState(app)}`;
    return undefined;
  }
  root.innerHTML = `
  <header class="page-head">
    <h1>${esc(t('tiers.title'))}</h1>
  </header>
  <div class="filter-bar">${filterFields(app)}</div>
  <div data-body></div>`;
  wireFilters(root, app);
  const cleanup = tierSection(root.querySelector('[data-body]'), app, app.derive(active));
  // This page's headline already names the list.
  root.querySelector('[data-body] .sec-head h2').classList.add('sr-only');
  return cleanup;
}

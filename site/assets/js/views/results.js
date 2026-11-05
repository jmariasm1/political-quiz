// The results story: one scrolling page, from the written headline down to the full ranking.
import { allGroups, csvCell, mostDistinctive, nearestDistance, nearestGroup, rankingRows, rmsd, scopeParties } from '../core.js';
import { groupKey, profileChart, rankedBars } from '../charts/misc.js';
import { esc, groupColor, partyColor, poster, svgDoc } from '../charts/svg.js';
import { saveBlob } from '../export.js';
import {
  countryName, emptyState, flagImg, flagUrl, howTo, iconButton, mountChart, partyLogo, pngButton, scopeLabel, scopeSelect, scopeSlug,
  visibleSet, wirePng, wireScope,
} from '../ui.js';
import { compareSection } from './compare.js';
import { mapSection } from './map.js';
import { tierSection } from './tiers.js';

const TOP_N = 15;

export function resultsView(root, app, params) {
  const { t, model, store } = app;
  if (params.r && store.get(params.r)) store.setActive(params.r);
  const active = store.active();
  if (!active) {
    root.innerHTML = `<header class="page-head"><h1>${esc(t('nav.results'))}</h1></header>${emptyState(app)}`;
    return undefined;
  }
  const you = app.derive(active);
  const { assign: placed, ranked, scores } = you;
  const lang = t.lang;
  const all = store.results();
  const group = nearestGroup(placed);
  const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const standout = mostDistinctive(scores, model.parties, model.dimensions);
  const isMiddle = standout.share < 0.6;
  const standoutVars = {
    dim: standout.dim.name[lang].toLowerCase(),
    pole: lc(standout.dim[standout.lean][lang]),
    p: t.num(standout.share * 100, 0),
  };

  const scoped = () => {
    const visible = visibleSet(app);
    return ranked.filter((row) => visible.has(row.party.id));
  };
  const barRow = (party, score, label) => ({ id: party.id, label, value: score, color: partyColor(party, app.colorBy), flag: party.flag });
  const topRows = (rows) => rows.slice(0, TOP_N).map(({ party, score }) => barRow(party, score, `${party.label} · ${countryName(party.country, app)}`));
  const bestRows = (rows) => {
    const seen = new Set();
    const out = [];
    for (const { party, score } of rows) {
      if (seen.has(party.country)) continue;
      seen.add(party.country);
      out.push(barRow(party, score, `${countryName(party.country, app)} · ${party.abbrev}`));
    }
    return out;
  };
  const distanceRows = () => {
    const rows = allGroups(model).map((c) => ({ label: c.label[lang], value: rmsd(scores, c.centroid), color: groupColor(c.id), digits: 1 }));
    return rows.sort((a, b) => a.value - b.value);
  };
  const scopeNote = () => (app.scope === 'all' ? '' : ` · ${scopeLabel(app.scope, model, t)}`);
  const closestTake = () => {
    const rows = scoped();
    const first = rows[0];
    const last = rows[rows.length - 1];
    return t('closest.take', {
      top: first.party.name[lang], topCountry: countryName(first.party.country, app), topScore: t.num(first.score, 2),
      far: last.party.name[lang], farCountry: countryName(last.party.country, app), farScore: t.num(last.score, 2),
    });
  };

  const navItems = [['s-closest', 'story.navClosest'], ['s-dims', 'story.navDims'], ['s-tiers', 'story.navTiers'], ['s-map', 'story.navMap'], ['s-compare', 'story.navCompare'], ['s-all', 'story.navAll']];

  root.innerHTML = `
  <header class="story-head">
    <h1>${esc(t('story.headline', { phrase: group.phrase[lang] }))}</h1>
    <p class="deck">${esc(isMiddle ? t('story.deckMiddle') : standout.share >= 0.995 ? t('story.deckAll', standoutVars) : t('story.deck', standoutVars))}</p>
    <ol class="podium">
      ${ranked.slice(0, 3).map(({ party, score }) => `
        <li>
          <a href="#/compare?a=you&b=${esc(party.id)}" data-compare-party="${esc(party.id)}">
            ${partyLogo(party, 'logo logo-podium')}
            <span class="podium-score">${esc(t.num(score, 2))}</span>
            <span class="podium-name">${esc(party.name[lang])}</span>
            <span class="podium-country">${flagImg(party, 'flag-inline')} ${esc(countryName(party.country, app))}</span>
          </a>
        </li>`).join('')}
    </ol>
    <div class="story-meta">
      ${
        all.length > 1
          ? `<label class="field field-inline"><span>${esc(t('story.switch'))}</span>
              <select data-switch>${all.slice().reverse().map((r) => `<option value="${esc(r.id)}" ${r.id === active.id ? 'selected' : ''}>${esc(t.date(r.at))}</option>`).join('')}</select></label>`
          : `<span>${esc(t('story.taken', { date: t.date(active.at) }))}</span>`
      }
      <a class="text-link" href="#/quiz?new=1">${esc(t('story.retake'))}</a>
    </div>
    ${active.version !== model.version ? `<p class="note">${esc(t('common.dataChanged'))}</p>` : ''}
    ${store.isPersistent() ? '' : `<p class="note">${esc(t('common.storageOff'))}</p>`}
  </header>

  <nav class="story-nav" aria-label="${esc(t('nav.menu'))}">
    <div class="story-links">${navItems.map(([id, key]) => `<button type="button" data-jump="${id}">${esc(t(key))}</button>`).join('')}</div>
    ${scopeSelect(app)}
  </nav>

  <section class="sec" id="s-closest">
    <div class="sec-head">
      <h2>${esc(t('closest.title'))}</h2>
      <p class="takeaway" data-closest-take>${esc(closestTake())}</p>
    </div>
    <div class="fig-grid">
      <figure class="fig">
        <figcaption class="fig-title">${esc(t('closest.topTitle', { n: TOP_N }))} <span class="fig-tools">${pngButton('top', t)}</span></figcaption>
        <div class="chart" data-chart="top"></div>
      </figure>
      <figure class="fig">
        <figcaption class="fig-title">${esc(t('closest.bestTitle'))} <span class="fig-tools">${pngButton('best', t)}</span></figcaption>
        <div class="chart" data-chart="best"></div>
      </figure>
    </div>
    ${howTo(t, `<p>${esc(t('closest.how'))}</p>`)}
  </section>

  <section class="sec" id="s-dims">
    <div class="sec-head">
      <h2>${esc(t('dims.title'))}</h2>
      <p class="takeaway">${esc(isMiddle ? t('dims.takeMiddle') : t('dims.take', { dim: standoutVars.dim, pole: standoutVars.pole }))}</p>
    </div>
    <div class="controls">${pngButton('profile', t)}</div>
    <figure class="fig fig-narrow"><div class="chart" data-chart="profile"></div></figure>
    ${howTo(t, `<p>${esc(t('dims.how'))}</p>`)}
  </section>

  <div data-tiers></div>
  <div data-map></div>

  <section class="sec">
    <div class="sec-head">
      <h2>${esc(t('dist.title'))}</h2>
      <p class="takeaway">${esc(t('dist.take', { group: group.phrase[lang], d: t.num(nearestDistance(placed), 1) }))}</p>
    </div>
    <div class="controls">${pngButton('distance', t)}</div>
    <figure class="fig fig-narrow"><div class="chart" data-chart="distance"></div></figure>
    ${howTo(t, `<p>${esc(t('dist.how'))}</p>`)}
  </section>

  <div data-compare></div>

  <section class="sec" id="s-all">
    <div class="sec-head">
      <h2>${esc(t('all.title'))}</h2>
      <p class="takeaway">${esc(t('all.take'))}</p>
    </div>
    <div class="controls">${iconButton('data-csv', t('common.csv'))}</div>
    <div class="country-grid" data-tables></div>
  </section>`;

  const charts = {
    profile: (width) => {
      const c = profileChart({ model, lang, t, width, scores, parties: scopeParties(app.scope, model) });
      return svgDoc(c.width, c.height, c.body, { role: 'img', 'aria-label': model.dimensions.map((d, i) => `${d.name[lang]}: ${t.exact(scores[i])}/100`).join('. ') });
    },
    distance: (width) => {
      const rows = distanceRows();
      const c = rankedBars({ rows, width, t, max: Math.max(...rows.map((r) => r.value)) * 1.08, flagUrl, labelMax: width * 0.5 });
      return svgDoc(c.width, c.height, c.body, { role: 'img', 'aria-label': t('dist.title') });
    },
    top: (width) => {
      const c = rankedBars({ rows: topRows(scoped()), width, t, flagUrl });
      return svgDoc(c.width, c.height, c.body, { role: 'img', 'aria-label': t('closest.topTitle', { n: TOP_N }) });
    },
    best: (width) => {
      const c = rankedBars({ rows: bestRows(scoped()), width, t, flagUrl });
      return svgDoc(c.width, c.height, c.body, { role: 'img', 'aria-label': t('closest.bestTitle') });
    },
  };
  const mounts = Object.fromEntries(Object.entries(charts).map(([key, render]) => {
    const host = root.querySelector(`[data-chart="${key}"]`);
    return [key, mountChart(host, (width) => void (host.innerHTML = render(width)))];
  }));

  const renderTables = () => {
    const set = new Set(scopeParties(app.scope, model).map((p) => p.id));
    const codes = model.countries.map((c) => c.code).filter((code) => model.parties.some((p) => p.country === code && set.has(p.id)));
    const open = window.innerWidth >= 760 && codes.length <= 12;
    root.querySelector('[data-tables]').innerHTML = codes
      .map((code) => {
        const rows = ranked.filter((r) => r.party.country === code);
        return `
        <details class="country" ${open ? 'open' : ''}>
          <summary><span>${esc(countryName(code, app))}</span><small>${esc(t('all.parties', { n: rows.length }))}</small></summary>
          <table>
            <thead><tr><th scope="col">${esc(t('common.rank'))}</th><th scope="col">${esc(t('common.party'))}</th><th scope="col">${esc(t('common.group'))}</th><th scope="col" class="num">${esc(t('common.similarity'))}</th></tr></thead>
            <tbody>${rows
              .map((r, i) => `<tr>
                <td>${i + 1}</td>
                <td><b>${esc(r.party.abbrev)}</b><span class="party-full">${esc(r.party.name[lang])}</span></td>
                <td><span class="tag" style="--c:${partyColor(r.party, 'leaf')}">${esc(r.party.leaf ?? r.party.sub ?? r.party.cluster)}</span></td>
                <td class="num">${esc(t.num(r.score, 2))}</td>
              </tr>`)
              .join('')}</tbody>
          </table>
        </details>`;
      })
      .join('');
  };
  renderTables();

  const cleanups = [
    tierSection(root.querySelector('[data-tiers]'), app, you, { story: true }),
    mapSection(root.querySelector('[data-map]'), app, { params, you, story: true }),
    compareSection(root.querySelector('[data-compare]'), app, { story: true, params: { a: 'you', b: ranked[0].party.id } }),
    app.on('scope', () => {
      for (const key of ['top', 'best', 'profile']) mounts[key].refresh();
      root.querySelector('[data-closest-take]').textContent = closestTake();
      renderTables();
    }),
    app.on('color', () => {
      for (const key of ['top', 'best']) mounts[key].refresh();
    }),
  ];

  const POSTER_W = 1400;
  const CONTENT_W = POSTER_W - 112;
  const url = model.site.url;
  const brand = t('brand');
  const withKey = (c) => {
    const key = groupKey({ model, lang, colorBy: app.colorBy, width: CONTENT_W });
    return { height: key.height + c.height, content: `${key.body}<g transform="translate(0 ${key.height})">${c.body}</g>` };
  };
  wirePng(root, {
    profile: () => {
      const width = 1100;
      const c = profileChart({ model, lang, t, width: width - 112, scores, parties: scopeParties(app.scope, model), big: true });
      const p = poster({ title: t('dims.title'), subtitle: isMiddle ? t('dims.takeMiddle') : t('dims.take', { dim: standoutVars.dim, pole: standoutVars.pole }), brand, width, contentHeight: c.height, content: c.body, notes: [t('dims.how')], url });
      return { ...p, filename: `compass-profile-${lang}.png` };
    },
    distance: () => {
      const rows = distanceRows();
      const c = rankedBars({ rows, width: CONTENT_W, t, big: true, max: Math.max(...rows.map((r) => r.value)) * 1.08, flagUrl, labelMax: CONTENT_W * 0.42 });
      const p = poster({ title: t('dist.title'), subtitle: t('dist.how'), brand, width: POSTER_W, contentHeight: c.height, content: c.body, url });
      return { ...p, filename: `compass-distances-${lang}.png` };
    },
    top: () => {
      const c = withKey(rankedBars({ rows: topRows(scoped()), width: CONTENT_W, t, big: true, flagUrl }));
      const p = poster({ title: t('closest.topTitle', { n: TOP_N }) + scopeNote(), subtitle: closestTake(), brand, width: POSTER_W, contentHeight: c.height, content: c.content, url });
      return { ...p, filename: `compass-top-${scopeSlug(app.scope)}-${lang}.png` };
    },
    best: () => {
      const c = withKey(rankedBars({ rows: bestRows(scoped()), width: CONTENT_W, t, big: true, flagUrl }));
      const p = poster({ title: t('closest.bestTitle') + scopeNote(), brand, width: POSTER_W, contentHeight: c.height, content: c.content, url });
      return { ...p, filename: `compass-best-by-country-${scopeSlug(app.scope)}-${lang}.png` };
    },
  }, t);

  wireScope(root, app);

  const motion = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  const jump = (id) => {
    const target = root.querySelector(`#${id}`);
    if (target) target.scrollIntoView({ behavior: motion() });
  };
  root.addEventListener('change', (event) => {
    if (event.target.matches('[data-switch]')) app.navigate(`#/results?r=${event.target.value}`);
  });
  root.addEventListener('click', (event) => {
    const jumpButton = event.target.closest('[data-jump]');
    if (jumpButton) {
      jump(jumpButton.dataset.jump);
      return;
    }
    // Inside the story, choosing a party scrolls to the comparison instead of leaving the page.
    const partyLink = event.target.closest('[data-compare-party]');
    if (partyLink) {
      event.preventDefault();
      app.emit('compare', partyLink.dataset.compareParty);
      return;
    }
    if (!event.target.closest('[data-csv]')) return;
    const head = ['Global rank', 'Rank in country', 'Country', 'Party', 'Abbreviation', 'Main cluster', 'Subgroup', 'Current', 'Similarity', ...model.dimensions.map((d) => d.name[lang])];
    const lines = [head, ...rankingRows(scores, model, lang).map((r) => [r.globalRank, r.countryRank, r.country, r.party, r.abbrev, r.cluster, r.subgroup, r.current, r.similarity.toFixed(2), ...r.scores])];
    const csv = lines.map((row) => row.map(csvCell).join(',')).join('\r\n');
    saveBlob(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }), `compass-ranking-${lang}.csv`);
  });

  // Keeps the current section marked in the sticky bar as the reader scrolls.
  let spy = null;
  if (typeof IntersectionObserver !== 'undefined') {
    spy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        root.querySelectorAll('[data-jump]').forEach((b) => b.toggleAttribute('data-current', b.dataset.jump === entry.target.id));
      }
    }, { rootMargin: '-25% 0px -70% 0px' });
    navItems.forEach(([id]) => {
      const target = root.querySelector(`#${id}`);
      if (target) spy.observe(target);
    });
  }
  if (params.s) setTimeout(() => jump(`s-${params.s}`), 60);

  return () => {
    Object.values(mounts).forEach((m) => m.destroy());
    cleanups.forEach((f) => f?.());
    spy?.disconnect();
  };
}

import { componentPoles, finestGroupOf, mapFidelity, nearestGroup, project, similarity } from '../core.js';
import { circlePanel, loadingsPanel, variancePanel, youPanel } from '../charts/interpret.js';
import { heatTable } from '../charts/misc.js';
import { mapGroups, pcaChart, pcaLegendSvg } from '../charts/pca.js';
import { T, esc, g, poster, svgDoc, text } from '../charts/svg.js';
import {
  colorToggle, countryName, flagImg, groupIcon, hideTip, howTo, mountChart, partyLogo, pngButton, scopeLabel, scopeSelect, scopeSlug,
  showTip, syncToggle, visibleSet, wireColor, wirePng, wireScope,
} from '../ui.js';

// The map opens fitted to its column. A button switches to a wider version that pans sideways and
// has room for more labels. Below NARROW the fitted version is an overview with only the closest parties named.
const NARROW = 640;
const PAN_WIDTH = 720;
const PAN_PER_PARTY = 7;

/** Draws one interactive map into `host`. Used on the home page, the map page and the results story. */
export function mountMapFigure(host, app, { you = null, past = [], hero = false, onSelect = null, onRender = null } = {}) {
  const { t, model } = app;
  const lang = t.lang;
  let current = null;
  let panMode = false;
  const state = {
    get panMode() {
      return panMode;
    },
    togglePan() {
      panMode = !panMode;
      mount.refresh();
    },
  };
  const render = (hostWidth) => {
    const narrow = hostWidth < NARROW;
    const panWidth = Math.max(PAN_WIDTH, visibleSet(app).size * PAN_PER_PARTY);
    const pan = panMode && panWidth > hostWidth;
    const width = pan ? panWidth : hostWidth;
    current = pcaChart({ model, lang, t, width, visible: visibleSet(app), you, past, compact: narrow && !pan, colorBy: app.colorBy, minimal: false, allLabels: pan });
    const ex = model.pca.explained;
    host.innerHTML = svgDoc(current.width, current.height, current.body, {
      role: 'img',
      'aria-label': `${t('map.title')}. ${t('map.axis', { n: 1, v: t.num(ex[0] * 100, 1) })}; ${t('map.axis', { n: 2, v: t.num(ex[1] * 100, 1) })}.`,
    });
    // A panning map starts where the person is, or in the middle.
    host.scrollLeft = pan ? Math.max(0, (current.youX ?? width / 2) - hostWidth / 2) : 0;
    onRender?.({ narrow, pan, hidden: current.hiddenLabels, canPan: panWidth > hostWidth });
  };
  const mount = mountChart(host, render);

  const nearest = (event) => {
    if (!current) return null;
    const box = host.querySelector('svg').getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let best = null;
    let bestD = 26 ** 2; // the hit area is much larger than the mark
    const visible = visibleSet(app);
    for (const p of current.points) {
      if (!visible.has(p.id)) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? model.parties.find((q) => q.id === best.id) : null;
  };
  const groupName = (p) => finestGroupOf(p, model).label[lang];
  const tipFor = (p) => `
    <div class="tip-row">
      ${partyLogo(p, 'logo logo-tip')}
      <div>
        <p class="tip-name">${esc(p.name[lang])}</p>
        <p class="tip-country">${flagImg(p, 'flag-inline')} ${esc(countryName(p.country, app))}</p>
        <p class="tip-group">${esc(p.label)} · ${esc(groupName(p))}</p>
        ${you ? `<p class="tip-score"><b>${esc(t.num(similarity(you.answers, p.answers), 2))}</b> ${esc(t('map.closeness').toLowerCase())}</p>` : ''}
      </div>
    </div>`;
  const onMove = (event) => {
    if (event.pointerType === 'touch') return;
    const p = nearest(event);
    if (p) showTip(tipFor(p), event.clientX, event.clientY);
    else hideTip();
    host.style.cursor = p ? 'pointer' : 'default';
  };
  const onClick = (event) => {
    const p = nearest(event);
    onSelect?.(p);
    if (hero && p) app.navigate(`#/map?party=${p.id}`);
  };
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerleave', hideTip);
  host.addEventListener('click', onClick);

  const off = [app.on('scope', () => mount.refresh()), app.on('color', () => mount.refresh())];
  return {
    state,
    refresh: () => mount.refresh(),
    destroy() {
      mount.destroy();
      off.forEach((f) => f());
      hideTip();
    },
  };
}

/** The map, what its axes mean, and what each group looks like. */
export function mapSection(root, app, { params = {}, you = null, story = false } = {}) {
  const { t, model, store } = app;
  const lang = t.lang;
  const past = you ? store.results().filter((r) => r.id !== you.result.id).map((r) => ({ scores: app.derive(r).scores })) : [];
  const closest = you ? you.ranked.slice(0, 3).map((r) => r.party.id) : [];
  const youArg = you ? { scores: you.scores, answers: you.answers, label: t('common.youCaps'), closest } : null;
  const expl = model.pca.explained;
  const pctTwo = t.num((expl[0] + expl[1]) * 100, 1);
  const poles = [0, 1].map((c) => componentPoles(c, model.pca, model.dimensions, lang));
  let selected = params.party && model.parties.some((p) => p.id === params.party) ? params.party : null;

  const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const splitNote = (group, d, level) => {
    if (d.selected_k <= 1) return t(`map.whole${level}`, { name: group.label[lang] });
    const vars = { name: group.label[lang], k: d.selected_k, s: t.num(d.silhouette, 2), p: t.num(d.reference.p_value, 3) };
    return t(`${d.reference.p_value <= 0.05 ? 'map.strong' : 'map.weak'}${level}`, vars);
  };
  const legend = () => {
    return `<ul class="key">${mapGroups(model, app.colorBy)
      .map((group) => `
      <li><button type="button" class="key-btn" data-hl="${esc(group.id)}" title="${esc(group.blurb[lang])}">
        ${groupIcon(group.id, Boolean(group.parent), 14)}<span>${esc(group.label[lang])}</span><small>${group.n}</small>
      </button></li>`)
      .join('')}</ul>`;
  };
  const fidelityText = () => {
    if (!you) return '';
    const f = mapFidelity(you.scores, model.pca);
    return t(f < 0.8 ? 'map.fidelity' : 'map.fidelityHigh', { p: t.num(f * 100, 0) });
  };
  const tableRows = () => {
    const visible = visibleSet(app);
    return model.parties
      .filter((p) => visible.has(p.id))
      .map((p) => `<tr>
        <td><b>${esc(p.label)}</b><span class="party-full">${esc(p.name[lang])}</span></td>
        <td>${esc(countryName(p.country, app))}</td>
        <td>${esc(p.leaf ?? p.sub ?? p.cluster)}</td>
        <td class="num">${esc(t.num(p.pc[0], 1))}</td>
        <td class="num">${esc(t.num(p.pc[1], 1))}</td>
        ${you ? `<td class="num">${esc(t.num(similarity(you.answers, p.answers), 2))}</td>` : ''}
      </tr>`)
      .join('');
  };

  const nearestPhrase = you ? nearestGroup(you.assign).phrase[lang] : '';
  const largestSub = model.clusters.flatMap((c) => c.children).reduce((a, b) => (b.n > a.n ? b : a), { n: 0 });
  const headTag = story ? 'h2' : 'h2';

  root.innerHTML = `
  <section class="sec" ${story ? 'id="s-map"' : ''}>
    <div class="sec-head">
      <${headTag}>${esc(t('map.title'))}</${headTag}>
      <p class="takeaway">${esc(you ? t('map.take', { phrase: nearestPhrase }) : t('map.takeNoYou'))}</p>
    </div>
    <div class="controls">
      ${colorToggle(app)}
      <button type="button" class="link-btn" data-map-toggle hidden></button>
      ${pngButton('map', t)}
    </div>
    <figure class="fig">
      <div class="chart chart-map" data-chart="map"></div>
      <figcaption>
        <div data-key>${legend()}</div>
        <p class="meta" data-map-hint>${esc(window.matchMedia('(pointer:coarse)').matches ? t('map.tapHint') : t('map.hoverHint'))}</p>
        <p class="meta" data-map-hidden></p>
      </figcaption>
    </figure>
    <div data-detail></div>
    ${howTo(t, `
      <p>${esc(t('map.how'))}</p>
      ${you ? `<p>${esc(fidelityText())}</p>` : ''}
      ${model.clusters.map((c) => `<p>${esc(splitNote(c, model.diagnostics.sub[c.id], ''))}</p>`).join('')}
      ${model.clusters.flatMap((c) => c.children).map((s) => `<p>${esc(splitNote(s, model.diagnostics.leaf[s.id], 'Leaf'))}</p>`).join('')}
      <p>${esc(t('interp.right', { pos: poles[0].positive, neg: poles[0].negative }))} ${esc(t('interp.up', { pos: poles[1].positive, neg: poles[1].negative }))}</p>
      <details class="nested">
        <summary>${esc(t('map.tableTitle'))}</summary>
        <div class="table-scroll"><table>
          <thead><tr><th scope="col">${esc(t('common.party'))}</th><th scope="col">${esc(t('common.country'))}</th><th scope="col">${esc(t('common.group'))}</th><th scope="col" class="num">${esc(t('common.pc', { n: 1 }))}</th><th scope="col" class="num">${esc(t('common.pc', { n: 2 }))}</th>${you ? `<th scope="col" class="num">${esc(t('common.similarity'))}</th>` : ''}</tr></thead>
          <tbody data-map-table>${tableRows()}</tbody>
        </table></div>
      </details>`)}
  </section>

  <section class="sec">
    <div class="sec-head">
      <h2>${esc(t('interp.title'))}</h2>
      <p class="takeaway">${esc(t('interp.take', {
        leftRight: t('interp.vs', { a: lc(poles[0].positive.split(' · ')[0]), b: lc(poles[0].negative.split(' · ')[0]) }),
        upDown: t('interp.vs', { a: lc(poles[1].positive.split(' · ')[0]), b: lc(poles[1].negative.split(' · ')[0]) }),
      }))}</p>
    </div>
    <div class="controls">${pngButton('interp', t)}</div>
    <div class="fig-grid">
      <figure class="fig"><figcaption class="fig-title">${esc(t('interp.loadTitle'))}</figcaption><div class="chart" data-chart="loadings"></div></figure>
      <figure class="fig"><figcaption class="fig-title">${esc(t('interp.circleTitle'))}</figcaption><div class="chart" data-chart="circle"></div></figure>
      <figure class="fig"><figcaption class="fig-title">${esc(t('interp.varTitle'))}</figcaption><p class="meta">${esc(t('interp.varSub', { p: pctTwo }))}</p><div class="chart" data-chart="variance"></div></figure>
      ${
        you
          ? `<figure class="fig"><figcaption class="fig-title">${esc(t('interp.youTitle'))}</figcaption>
              <p class="meta">${esc(t('interp.youSub', { x: t.num(project(you.scores, model.pca)[0], 1), y: t.num(project(you.scores, model.pca)[1], 1) }))}</p>
              <div class="chart" data-chart="you"></div></figure>`
          : ''
      }
    </div>
    ${howTo(t, `<p>${esc(t('interp.how'))}</p>`)}
  </section>

  <section class="sec">
    <div class="sec-head">
      <h2>${esc(t('groups.title'))}</h2>
      <p class="takeaway">${esc(t('groups.take', { phrase: largestSub.phrase?.[lang] ?? '', n: largestSub.n }))}</p>
    </div>
    <div class="controls">${pngButton('heat', t)}</div>
    <figure class="fig"><div class="chart" data-chart="heat"></div></figure>
    ${howTo(t, `<p>${esc(t('groups.how'))}</p>`)}
  </section>`;

  const hosts = (key) => root.querySelector(`[data-chart="${key}"]`);
  const svgFor = (c, label) => svgDoc(c.width, c.height, c.body, { role: 'img', 'aria-label': label });
  const figure = mountMapFigure(hosts('map'), app, {
    you: youArg,
    past,
    onSelect: (p) => {
      selected = p ? p.id : null;
      renderDetail();
    },
    onRender: ({ narrow, pan, hidden, canPan }) => {
      const button = root.querySelector('[data-map-toggle]');
      button.hidden = !canPan || !(narrow || pan || hidden.length > 0);
      button.innerHTML = `<span>${esc(t(pan ? 'map.fitScreen' : 'map.showAll'))}</span>`;
      const coarse = window.matchMedia('(pointer:coarse)').matches;
      root.querySelector('[data-map-hint]').textContent = t(coarse ? (pan ? 'map.panHint' : 'map.tapHint') : pan ? 'map.panHintMouse' : 'map.hoverHint');
      root.querySelector('[data-map-hidden]').textContent = hidden.length ? t('map.hiddenLabels', { n: hidden.length }) : '';
    },
  });
  const mounts = [
    mountChart(hosts('loadings'), (w) => void (hosts('loadings').innerHTML = svgFor(loadingsPanel({ model, lang, t, width: w }), t('interp.loadTitle')))),
    mountChart(hosts('circle'), (w) => void (hosts('circle').innerHTML = svgFor(circlePanel({ model, lang, t, width: w }), t('interp.circleTitle')))),
    mountChart(hosts('variance'), (w) => void (hosts('variance').innerHTML = svgFor(variancePanel({ model, t, width: w }), t('interp.varTitle')))),
    mountChart(hosts('heat'), (w) => void (hosts('heat').innerHTML = svgFor(heatTable({ model, lang, t, width: w }), t('groups.title')))),
  ];
  if (you) {
    mounts.push(mountChart(hosts('you'), (w) => void (hosts('you').innerHTML = svgFor(youPanel({ model, lang, t, width: w, scores: you.scores }), t('interp.youTitle')))));
  }

  const renderDetail = () => {
    const host = root.querySelector('[data-detail]');
    const p = model.parties.find((q) => q.id === selected);
    if (!p) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = `
    <div class="detail" aria-live="polite">
      ${partyLogo(p, 'logo logo-small')}
      <div class="detail-body">
        <p><b>${esc(p.label)}</b> ${esc(p.name[lang])}</p>
        <p class="meta">${flagImg(p, 'flag-inline')} ${esc(countryName(p.country, app))} · ${esc(finestGroupOf(p, model).label[lang])}</p>
      </div>
      ${you ? `<p class="detail-score"><b>${esc(t.num(similarity(you.answers, p.answers), 2))}</b><span>${esc(t('map.closeness'))}</span></p>` : ''}
      <a class="text-link" href="#/compare?a=${you ? 'you' : model.parties[0].id}&b=${esc(p.id)}" data-compare-party="${esc(p.id)}">${esc(you ? t('common.compareWithYou') : t('common.compare'))}</a>
    </div>`;
  };
  renderDetail();

  // Highlight one group from the key, by mouse or keyboard
  const highlight = (id) => {
    hosts('map').querySelectorAll('[data-group]').forEach((node) => {
      node.classList.toggle('is-dim', Boolean(id) && node.getAttribute('data-group') !== id);
    });
  };
  root.addEventListener('pointerover', (event) => {
    const button = event.target.closest('[data-hl]');
    if (button) highlight(button.dataset.hl);
  });
  root.addEventListener('pointerout', (event) => {
    if (event.target.closest('[data-hl]')) highlight(null);
  });
  root.addEventListener('focusin', (event) => {
    const button = event.target.closest('[data-hl]');
    if (button) highlight(button.dataset.hl);
  });
  root.addEventListener('focusout', (event) => {
    if (event.target.closest('[data-hl]')) highlight(null);
  });
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-map-toggle]')) figure.state.togglePan();
  });
  wireColor(root, app);

  const off = [
    app.on('scope', () => {
      root.querySelector('[data-map-table]').innerHTML = tableRows();
      if (selected && !visibleSet(app).has(selected)) {
        selected = null;
        renderDetail();
      }
    }),
    app.on('color', () => {
      root.querySelector('[data-key]').innerHTML = legend();
      syncToggle(root, 'data-color-by', app.colorBy);
    }),
  ];

  const POSTER_W = 1600;
  const CW = POSTER_W - 112;
  const url = model.site.url;
  const brand = t('brand');
  const scopeNote = () => (app.scope === 'all' ? '' : ` · ${scopeLabel(app.scope, model, t)}`);
  wirePng(root, {
    map: () => {
      const c = pcaChart({ model, lang, t, width: CW, visible: visibleSet(app), you: youArg, past, mode: 'export', colorBy: app.colorBy });
      const lg = pcaLegendSvg({ model, lang, width: CW, colorBy: app.colorBy });
      const content = c.body + g({ transform: `translate(0 ${c.height + 10})` }, lg.body);
      const p = poster({
        title: t('map.posterTitle') + scopeNote(),
        subtitle: you ? t('map.take', { phrase: nearestPhrase }) : t('map.takeNoYou'),
        brand,
        width: POSTER_W,
        contentHeight: c.height + lg.height + 14,
        content,
        notes: [t('map.posterNote'), ...(you ? [fidelityText()] : [])],
        url,
      });
      return { ...p, filename: `compass-party-map-${app.colorBy}-${scopeSlug(app.scope)}-${lang}.png` };
    },
    interp: () => {
      const leftW = 880;
      const gap = 56;
      const rightW = CW - leftW - gap;
      const load = loadingsPanel({ model, lang, t, width: leftW, big: true });
      const circle = circlePanel({ model, lang, t, width: rightW, big: true });
      const variance = variancePanel({ model, t, width: leftW, big: true });
      const mine = you ? youPanel({ model, lang, t, width: rightW, scores: you.scores, big: true }) : null;
      const titleBlock = (x, y, title) => text(x, y, title, { 'font-size': 25, 'font-weight': 700, fill: T.text });
      const rowOneH = Math.max(load.height, circle.height);
      const rowTwoY = rowOneH + 104;
      let content = titleBlock(0, 22, t('interp.loadTitle')) + g({ transform: 'translate(0 40)' }, load.body);
      content += titleBlock(leftW + gap, 22, t('interp.circleTitle')) + g({ transform: `translate(${leftW + gap} 40)` }, circle.body);
      content += titleBlock(0, rowTwoY, t('interp.varTitle')) + g({ transform: `translate(0 ${rowTwoY + 14})` }, variance.body);
      let totalH = rowTwoY + 14 + variance.height;
      if (mine) {
        content += titleBlock(leftW + gap, rowTwoY, t('interp.youTitle')) + g({ transform: `translate(${leftW + gap} ${rowTwoY + 8})` }, mine.body);
        totalH = Math.max(totalH, rowTwoY + 8 + mine.height);
      }
      const p = poster({
        title: t('interp.posterTitle'),
        subtitle: t('interp.varSub', { p: pctTwo }),
        brand,
        width: POSTER_W,
        contentHeight: totalH,
        content,
        notes: [t('interp.right', { pos: poles[0].positive, neg: poles[0].negative }), t('interp.up', { pos: poles[1].positive, neg: poles[1].negative })],
        url,
      });
      return { ...p, filename: `compass-pca-interpretation-${lang}.png` };
    },
    heat: () => {
      const c = heatTable({ model, lang, t, width: CW, big: true });
      const p = poster({ title: t('groups.posterTitle'), subtitle: t('groups.how'), brand, width: POSTER_W, contentHeight: c.height, content: c.body, url });
      return { ...p, filename: `compass-group-profiles-${lang}.png` };
    },
  }, t);

  return () => {
    figure.destroy();
    mounts.forEach((m) => m.destroy());
    off.forEach((f) => f());
  };
}

export function mapView(root, app, params) {
  const { t, store } = app;
  const active = store.active();
  const you = active ? app.derive(active) : null;
  root.innerHTML = `
  <header class="page-head">
    <h1>${esc(t('map.title'))}</h1>
  </header>
  <div class="filter-bar">${scopeSelect(app)}</div>
  <div data-body></div>`;
  wireScope(root, app);
  const cleanup = mapSection(root.querySelector('[data-body]'), app, { params, you });
  // This page's headline already names the map.
  root.querySelector('[data-body] .sec-head h2').classList.add('sr-only');
  return cleanup;
}

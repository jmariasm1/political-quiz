import { silhouettePanels } from '../charts/misc.js';
import { esc, poster, svgDoc } from '../charts/svg.js';
import { countryName, mountChart, pngButton, wirePng } from '../ui.js';

export function methodView(root, app) {
  const { t, model } = app;
  const lang = t.lang;
  const d = model.diagnostics;
  const params = d.params;

  const qList = (dim, sign) =>
    model.questions.filter((q) => q.dim === dim && q.sign === sign).map((q) => `Q${q.id}`).join(', ');

  const checkBlock = (group, dd, level) => {
    if (dd.selected_k <= 1) return `<p>${esc(t(`map.whole${level}`, { name: group.label[lang] }))}</p>`;
    const vars = { name: group.label[lang], k: dd.selected_k, s: t.num(dd.silhouette, 2), p: t.num(dd.reference.p_value, 3) };
    return `<div>
      <p>${esc(t(`${dd.reference.p_value <= 0.05 ? 'map.strong' : 'map.weak'}${level}`, vars))}</p>
      <ul class="stab-list">${group.children
        .map((child) => `<li><b>${esc(child.label[lang])}</b> <span>${esc(t('map.stability', { v: t.num(child.stability, 2) }))}</span></li>`)
        .join('')}</ul>
    </div>`;
  };

  root.innerHTML = `
  <header class="page-head">
    <h1>${esc(t('method.title'))}</h1>
    <p class="deck">${esc(t('method.lead'))}</p>
  </header>
  <article class="prose">
    <h2>${esc(t('method.scoringTitle'))}</h2>
    <p>${esc(t('method.scoring'))}</p>
    <div class="table-scroll"><table class="table-wide">
      <thead><tr><th scope="col">${esc(t('method.dim'))}</th><th scope="col">${esc(t('method.direct'))}</th><th scope="col">${esc(t('method.reverse'))}</th><th scope="col">${esc(t('method.zero'))}</th><th scope="col">${esc(t('method.hundred'))}</th></tr></thead>
      <tbody>${model.dimensions
        .map((dim) => `<tr><td><b>${esc(dim.name[lang])}</b></td><td>${esc(qList(dim.id, 1))}</td><td>${esc(qList(dim.id, -1))}</td><td>${esc(dim.low[lang])}</td><td>${esc(dim.high[lang])}</td></tr>`)
        .join('')}</tbody>
    </table></div>
    <p>${esc(t('method.similarity'))}</p>

    <h2>${esc(t('method.clustersTitle'))}</h2>
    <p>${esc(t('method.clusters', { kmax: params.k_max, k: d.top.selected_k, s: t.num(d.top.silhouette, 3) }))}</p>
    <p>${esc(t('method.subs', { min: t.num(params.min_split_silhouette, 2), overall: t.num(d.sub_overall, 3) }))}</p>
    <p>${esc(t('method.leaves', { overall: t.num(d.leaf_overall, 3) }))}</p>
    <p>${esc(t('method.checks', { draws: params.reference_draws, boot: params.bootstrap_draws }))}</p>
  </article>

  <section class="sec">
    <div class="sec-head"><h2>${esc(t('method.silTitle'))}</h2></div>
    <div class="controls">${pngButton('sil', t)}</div>
    <figure class="fig"><div class="chart" data-chart="sil"></div>
      <figcaption class="meta">${esc(t('method.silBandNote'))} ${esc(t('method.silHollow'))}</figcaption>
    </figure>
    <div class="check-grid">
      ${model.clusters.map((c) => checkBlock(c, d.sub[c.id], '')).join('')}
      ${model.clusters.flatMap((c) => c.children).map((sub) => checkBlock(sub, d.leaf[sub.id], 'Leaf')).join('')}
    </div>
  </section>

  <article class="prose">
    <h2>${esc(t('method.assignTitle'))}</h2>
    <p>${esc(t('method.assign'))}</p>
    <h2>${esc(t('method.limitsTitle'))}</h2>
    <ul>${t('method.limits').map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
    <h2>${esc(t('method.dataTitle'))}</h2>
    <p>${esc(t('method.data', { version: model.version, date: t.day(model.dataDate), parties: model.parties.length, countries: model.countries.length }))}</p>
    <h2>${esc(t('method.creditsTitle'))}</h2>
    <p>${esc(t('method.credits'))}</p>
    <details class="nested">
      <summary>${esc(t('method.creditsTable'))}</summary>
      <div class="table-scroll"><table>
        <thead><tr><th scope="col">${esc(t('common.party'))}</th><th scope="col">${esc(t('common.country'))}</th><th scope="col">${esc(t('method.logoSource'))}</th></tr></thead>
        <tbody>${model.parties
          .map((p) => {
            let host = '';
            try {
              host = new URL(p.logoSource).hostname.replace(/^www\./, '');
            } catch {
              host = '';
            }
            return `<tr><td><b>${esc(p.abbrev)}</b><span class="party-full">${esc(p.name[lang])}</span></td><td>${esc(countryName(p.country, app))}</td><td>${host ? `<a href="${esc(p.logoSource)}" target="_blank" rel="noopener noreferrer">${esc(host)}</a>` : ''}</td></tr>`;
          })
          .join('')}</tbody>
      </table></div>
    </details>
  </article>`;

  const host = root.querySelector('[data-chart="sil"]');
  const mount = mountChart(host, (width) => {
    const c = silhouettePanels({ model, t, lang, width });
    host.innerHTML = svgDoc(c.width, c.height, c.body, { role: 'img', 'aria-label': t('method.silTitle') });
  });
  wirePng(root, {
    sil: () => {
      const width = 1600;
      const c = silhouettePanels({ model, t, lang, width: width - 112, big: true });
      const p = poster({ title: t('method.silTitle'), brand: t('brand'), width, contentHeight: c.height, content: c.body, notes: [t('method.silBandNote'), t('method.silHollow')], url: model.site.url });
      return { ...p, filename: `compass-silhouettes-${lang}.png` };
    },
  }, t);
  return () => mount.destroy();
}

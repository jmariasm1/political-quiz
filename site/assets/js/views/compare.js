import { agreement, allGroups, similarity } from '../core.js';
import { radarChart } from '../charts/misc.js';
import { T, el, esc, g, line, measure, poster, rect, svgDoc, text, wrap } from '../charts/svg.js';
import { countryName, howTo, mountChart, pngButton, wirePng } from '../ui.js';

/** Any two profiles side by side. In the results story, A starts as you and B as your closest party. */
export function compareSection(root, app, { params = {}, story = false } = {}) {
  const { t, model, store } = app;
  const lang = t.lang;
  const results = store.results();
  const activeResult = store.active();
  const you = activeResult ? app.derive(activeResult) : null;
  const clusters = allGroups(model);

  // One lookup for everything that can fill a profile slot.
  const resolve = (id) => {
    if (id === 'you' && you) return { id, title: t('common.youCaps'), sub: t('common.yourAnswers'), scores: you.scores, speaker: t('common.you'), isYou: true };
    if (id?.startsWith('r:')) {
      const r = store.get(id.slice(2));
      if (r) {
        const date = t.date(r.at);
        return { id, title: t('common.youCaps'), sub: t('compare.pastSub', { date }), scores: app.derive(r).scores, speaker: t('compare.pastSpeaker', { date: t.short(r.at) }) };
      }
    }
    if (id?.startsWith('cl:')) {
      const c = clusters.find((x) => x.id === id.slice(3));
      if (c) return { id, title: c.label[lang], sub: t('compare.clusterSub', { n: c.n }), scores: c.centroid, speaker: c.label[lang] };
    }
    const p = model.parties.find((x) => x.id === id);
    if (p) return { id, title: p.label, sub: `${countryName(p.country, app)} · ${p.name[lang]}`, scores: p.scores, speaker: p.label };
    return null;
  };

  const defaultA = you ? 'you' : 'de-grune';
  const defaultB = you ? you.ranked[0].party.id : 'us-gop';
  let a = resolve(params.a) ? params.a : defaultA;
  let b = resolve(params.b) ? params.b : defaultB;

  const options = (selected) => {
    const opt = (value, label) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
    let html = '';
    if (you) {
      html += `<optgroup label="${esc(t('compare.groupYou'))}">${opt('you', t('compare.youOption'))}</optgroup>`;
      const past = results.filter((r) => r.id !== activeResult.id).reverse();
      if (past.length) html += `<optgroup label="${esc(t('compare.groupPast'))}">${past.map((r) => opt(`r:${r.id}`, t('compare.pastOption', { date: t.date(r.at) }))).join('')}</optgroup>`;
    }
    html += `<optgroup label="${esc(t('compare.groupClusters'))}">${clusters.map((c) => opt(`cl:${c.id}`, c.label[lang])).join('')}</optgroup>`;
    const byName = model.countries.slice().sort((x, y) => x.name[lang].localeCompare(y.name[lang], lang));
    for (const c of byName) {
      const parties = model.parties.filter((p) => p.country === c.code).sort((x, y) => x.abbrev.localeCompare(y.abbrev, lang));
      html += `<optgroup label="${esc(c.name[lang])}">${parties.map((p) => opt(p.id, `${p.abbrev} · ${p.name[lang]}`)).join('')}</optgroup>`;
    }
    return html;
  };

  /** A plain sentence about one dimension, using its poles. */
  const sentence = (row, A, B) => {
    const label = (lean) => row.dim[lean][lang];
    const pole = (lean) => label(lean).charAt(0).toLowerCase() + label(lean).slice(1);
    if (row.leanA && row.leanB) {
      if (row.leanA !== row.leanB) return t('compare.oppose', { a: A.speaker, aYou: A.isYou, poleA: pole(row.leanA), b: B.speaker, bYou: B.isYou, poleB: pole(row.leanB) });
      if (row.gap >= model.agreement.agree_max) {
        const further = row.leanA === 'high' ? (row.a > row.b ? A : B) : row.a < row.b ? A : B;
        return t('compare.bothPoleFurther', { pole: pole(row.leanA), who: further.speaker, whoYou: further.isYou });
      }
      return t('compare.bothPole', { pole: pole(row.leanA) });
    }
    if (!row.leanA && !row.leanB) return t('compare.bothMiddle');
    return row.leanA
      ? t('compare.oneMiddle', { a: A.speaker, aYou: A.isYou, pole: pole(row.leanA), b: B.speaker, bYou: B.isYou })
      : t('compare.oneMiddle', { a: B.speaker, aYou: B.isYou, pole: pole(row.leanB), b: A.speaker, bYou: A.isYou });
  };

  const dumbbell = (row) => {
    const lo = Math.min(row.a, row.b);
    const hi = Math.max(row.a, row.b);
    return `<span class="db" aria-hidden="true">
      <i class="db-mid"></i>
      <i class="db-span" style="left:${lo}%;width:${hi - lo}%"></i>
      <i class="db-dot db-b" style="left:${row.b}%"></i>
      <i class="db-dot db-a" style="left:${row.a}%"></i>
    </span>`;
  };

  const rowHtml = (row, A, B) => `
    <li class="ad-row">
      <div class="ad-top">
        <b>${esc(row.dim.name[lang])}</b>
        <span class="ad-gap">${esc(t('common.pointsApart', { n: t.exact(row.gap) }))}</span>
      </div>
      ${dumbbell(row)}
      <div class="ad-values">
        <span><i class="key-a"></i>${esc(A.speaker)} ${esc(t.exact(row.a))}</span>
        <span><i class="key-b"></i>${esc(B.speaker)} ${esc(t.exact(row.b))}</span>
      </div>
      <p class="ad-text">${esc(sentence(row, A, B))}</p>
    </li>`;

  const groupHtml = (key, rows, A, B) =>
    rows.length ? `<div class="ad-group"><h4>${esc(t(`compare.${key}`))}</h4><ul>${rows.map((r) => rowHtml(r, A, B)).join('')}</ul></div>` : '';

  root.innerHTML = `
  <section class="sec" ${story ? 'id="s-compare"' : ''}>
    <div class="sec-head">
      <h2>${esc(t(story ? 'compare.title' : 'compare.titleStandalone'))}</h2>
      <p class="takeaway" data-take></p>
    </div>
    <div class="cmp-pickers">
      <label class="field"><span><i class="key-a"></i>${esc(t('compare.a'))}</span><select data-pick="a"></select></label>
      <button type="button" class="swap" data-swap aria-label="${esc(t('compare.swap'))}" title="${esc(t('compare.swap'))}">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square"><path d="M2 5h10M9.5 2.5 12 5 9.5 7.5M14 11H4M6.5 8.5 4 11l2.5 2.5"/></svg>
      </button>
      <label class="field"><span><i class="key-b"></i>${esc(t('compare.b'))}</span><select data-pick="b"></select></label>
    </div>
    <div class="cmp-layout">
      <div>
        <div class="cmp-score" data-score></div>
        <figure class="fig"><div class="chart" data-chart="radar"></div></figure>
        <div class="controls controls-center">${pngButton('compare', t)}</div>
      </div>
      <div>
        <h3 class="ad-title">${esc(t('compare.whereTitle'))}</h3>
        <div data-ad></div>
      </div>
    </div>
    ${howTo(t, `<p>${esc(t('compare.how'))}</p>`)}
  </section>`;

  const radarHost = root.querySelector('[data-chart="radar"]');
  let A;
  let B;
  const mount = mountChart(radarHost, (width) => {
    if (!A) return;
    const c = radarChart({ model, lang, t, a: A.scores, b: B.scores, width });
    radarHost.innerHTML = svgDoc(c.width, c.height, c.body, { role: 'img', 'aria-label': model.dimensions.map((d, i) => `${d.name[lang]}: ${A.speaker} ${t.exact(A.scores[i])}, ${B.speaker} ${t.exact(B.scores[i])}`).join('. ') });
  });

  const render = () => {
    A = resolve(a);
    B = resolve(b);
    root.querySelector('[data-pick="a"]').innerHTML = options(a);
    root.querySelector('[data-pick="b"]').innerHTML = options(b);
    const score = similarity(A.scores, B.scores);
    root.querySelector('[data-score]').innerHTML = `
      <p class="cmp-who"><b>${esc(A.title)}</b> <span>${esc(A.sub)}</span></p>
      <p class="cmp-big">${esc(t.num(Math.round(score), 0))}<span>/100</span></p>
      <p class="cmp-label">${esc(t('compare.proximity'))}</p>
      <p class="cmp-who"><b>${esc(B.title)}</b> <span>${esc(B.sub)}</span></p>`;
    const ad = agreement(A.scores, B.scores, model.dimensions, model.agreement);
    const same = ad.rows.every((r) => r.gap === 0);
    root.querySelector('[data-take]').textContent = same
      ? t('compare.same')
      : t('compare.take', { a: A.speaker, b: B.speaker, near: ad.rows[0].dim.name[lang].toLowerCase(), far: ad.rows[ad.rows.length - 1].dim.name[lang].toLowerCase() });
    root.querySelector('[data-ad]').innerHTML = same ? '' : groupHtml('agree', ad.agree, A, B) + groupHtml('partial', ad.partial, A, B) + groupHtml('diverge', ad.diverge, A, B);
    mount.refresh();
    if (!story) app.replaceHash(`#/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  };
  render();

  root.addEventListener('change', (event) => {
    if (event.target.dataset.pick === 'a') a = event.target.value;
    else if (event.target.dataset.pick === 'b') b = event.target.value;
    else return;
    render();
  });
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-swap]')) {
      [a, b] = [b, a];
      render();
    }
  });
  const off = app.on('compare', (id) => {
    if (!resolve(id)) return;
    b = id;
    if (a === b) a = you ? 'you' : a;
    render();
    root.querySelector('section').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });

  wirePng(root, {
    compare: () => {
      const width = 1700;
      const CW = width - 112;
      const leftW = 760;
      const gap = 56;
      const rightW = CW - leftW - gap;
      const rad = radarChart({ model, lang, t, a: A.scores, b: B.scores, width: leftW, big: true });
      const score = similarity(A.scores, B.scores);
      // Left column: who, score, radar
      let left = '';
      [[A, T.you], [B, T.other]].forEach(([P, color], i) => {
        const x = i * (leftW / 2 + 6);
        const w = leftW / 2 - 6;
        left += rect(x, 0, w, 5, { fill: color });
        left += text(x, 44, wrap(P.title, w, 34, 800, T.display)[0], { 'font-family': T.display, 'font-size': 34, 'font-weight': 800, fill: T.text });
        const subLine = wrap(P.sub, w, 18)[0];
        left += text(x, 74, subLine === P.sub ? P.sub : `${subLine}…`, { 'font-size': 18, fill: T.text2 });
      });
      left += text(leftW / 2, 170, `${t.num(Math.round(score), 0)}/100`, { 'font-family': T.display, 'font-size': 92, 'font-weight': 800, fill: T.text, 'text-anchor': 'middle' });
      left += text(leftW / 2, 206, t('compare.proximity'), { 'font-size': 22, 'font-weight': 700, fill: T.text, 'text-anchor': 'middle' });
      left += g({ transform: 'translate(0 218)' }, rad.body);
      const legendY = 218 + rad.height + 26;
      // Legend: a line sample, then the name, with a clear gap between the two entries.
      const keyW = (s) => 34 + 10 + measure(s, 20, 700);
      let keyX = leftW / 2 - (keyW(A.speaker) + 44 + keyW(B.speaker)) / 2;
      for (const [P, color] of [[A, T.you], [B, T.other]]) {
        left += line(keyX, legendY - 7, keyX + 34, legendY - 7, { stroke: color, 'stroke-width': 4 });
        left += text(keyX + 44, legendY, P.speaker, { 'font-size': 20, 'font-weight': 700, fill: T.text });
        keyX += keyW(P.speaker) + 44;
      }
      const leftH = legendY + 10;

      // Right column: where they agree and diverge
      const ad = agreement(A.scores, B.scores, model.dimensions, model.agreement);
      let right = text(0, 34, t('compare.whereTitle'), { 'font-family': T.display, 'font-size': 42, 'font-weight': 800, fill: T.text });
      let y = 56;
      const X = (v) => 8 + (v / 100) * (rightW - 16);
      for (const key of ['agree', 'partial', 'diverge']) {
        if (!ad[key].length) continue;
        y += 28;
        right += text(0, y, t(`compare.${key}`), { 'font-size': 20, 'font-weight': 700, fill: T.you });
        y += 6;
        for (const row of ad[key]) {
          y += 30;
          right += text(0, y, row.dim.name[lang], { 'font-size': 21, 'font-weight': 700, fill: T.text });
          right += text(rightW, y, t('common.pointsApart', { n: t.exact(row.gap) }), { 'font-size': 18, fill: T.text2, 'text-anchor': 'end' });
          y += 20;
          right += line(X(0), y, X(100), y, { stroke: T.lineStrong, 'stroke-width': 2 });
          right += line(X(row.a), y, X(row.b), y, { stroke: T.text3, 'stroke-width': 4 });
          right += el('circle', { cx: X(row.b), cy: y, r: 7.5, fill: T.bg, stroke: T.other, 'stroke-width': 3 });
          right += el('circle', { cx: X(row.a), cy: y, r: 8, fill: T.you, stroke: T.bg, 'stroke-width': 2.5, 'paint-order': 'stroke' });
          y += 30;
          right += text(0, y, `${A.speaker} ${t.exact(row.a)}  ·  ${B.speaker} ${t.exact(row.b)}`, { 'font-size': 18, fill: T.text2 });
          for (const l of wrap(sentence(row, A, B), rightW, 18)) {
            y += 25;
            right += text(0, y, l, { 'font-size': 18, fill: T.text3 });
          }
          y += 14;
        }
      }
      const content = left + g({ transform: `translate(${leftW + gap} 0)` }, right);
      const ad0 = ad.rows[0];
      const adN = ad.rows[ad.rows.length - 1];
      const p = poster({
        title: t('compare.posterTitle', { a: A.speaker, b: B.speaker }),
        subtitle: t('compare.take', { a: A.speaker, b: B.speaker, near: ad0.dim.name[lang].toLowerCase(), far: adN.dim.name[lang].toLowerCase() }),
        brand: t('brand'),
        width,
        contentHeight: Math.max(leftH, y) + 10,
        content,
        url: model.site.url,
      });
      const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return { ...p, filename: `compass-compare-${slug(A.speaker)}-${slug(B.speaker)}-${lang}.png` };
    },
  }, t);

  return () => {
    mount.destroy();
    off();
  };
}

export function compareView(root, app, params) {
  return compareSection(root, app, { params });
}

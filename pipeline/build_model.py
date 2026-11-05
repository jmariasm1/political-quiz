#!/usr/bin/env python3
"""Build site/data/model.json from the files in data/.

Run:  python pipeline/build_model.py

The model has two clustering levels, both chosen by mean silhouette with no number of
clusters imposed:

  1. Main clusters: k-means on all parties, k chosen on the grid 2..k_max.
  2. Subgroups: k-means again inside each main cluster, on the same 5D scale. Solutions
     with a one-party group are rejected, and a cluster stays whole when its best
     silhouette is under `min_split_silhouette` (0.25, the conventional line below which
     Kaufman and Rousseeuw describe no substantial structure).

Two further checks are reported but never used to choose k, so the silhouette stays the
only selection rule:

  - Reference test: how often structureless data (uniform in the cluster's rotated
    bounding box) reaches the observed best silhouette. A high value means the subgroups
    may be slices of a continuum.
  - Bootstrap stability: Hennig's cluster-wise Jaccard, one value per subgroup.

PCA is fitted once on all parties and only ever draws the map. It never assigns anyone.
"""
from __future__ import annotations

import csv
import hashlib
import json
import string
import struct
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_samples, silhouette_score

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
SITE = ROOT / 'site'
DIMS = ['economics', 'social', 'civil_liberties', 'internationalism', 'climate']


class DataError(Exception):
    """Raised with a message that says which row of which file to fix."""


def read_csv(name: str) -> list[dict]:
    with (DATA / name).open(encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def load_inputs() -> dict:
    config = json.loads((DATA / 'config.json').read_text(encoding='utf-8'))
    questions = json.loads((DATA / 'questions.json').read_text(encoding='utf-8'))
    countries = read_csv('countries.csv')
    groupings = read_csv('groupings.csv')
    parties = read_csv('parties.csv')
    labels = read_csv('cluster_labels.csv')
    validate(parties, countries, groupings, labels, questions, config)
    return dict(config=config, questions=questions, countries=countries, groupings=groupings,
                parties=parties, labels=labels)


def validate(parties, countries, groupings, labels, questions, config) -> None:
    codes = {c['code'] for c in countries}
    ids = set()
    for i, p in enumerate(parties, start=2):
        where = f"data/parties.csv line {i} ({p.get('id') or 'no id'})"
        if not p['id'] or p['id'] in ids:
            raise DataError(f'{where}: id is empty or already used')
        ids.add(p['id'])
        if p['country_code'] not in codes:
            raise DataError(f"{where}: country_code '{p['country_code']}' is not in data/countries.csv")
        for field in ('abbrev', 'name_en', 'name_es'):
            if not p[field].strip():
                raise DataError(f'{where}: {field} is empty')
        for d in DIMS:
            try:
                value = float(p[d])
            except ValueError:
                raise DataError(f"{where}: {d} = '{p[d]}' is not a number") from None
            if not 0 <= value <= 100:
                raise DataError(f'{where}: {d} = {value} is outside 0-100')
    for g in groupings:
        for code in g['countries'].split(';'):
            if code not in codes:
                raise DataError(f"data/groupings.csv ({g['id']}): unknown country '{code}'")
    for row in labels:
        for anchor in row['anchors'].split(';'):
            if anchor not in ids:
                raise DataError(f"data/cluster_labels.csv: anchor '{anchor}' is not a party id")
    qs = questions['questions']
    if len(qs) != 20 or {q['dim'] for q in qs} != set(DIMS):
        raise DataError('data/questions.json: the questionnaire must keep 20 statements on 5 dimensions')
    if [d['id'] for d in config['dimensions']] != DIMS:
        raise DataError('data/config.json: dimensions must stay in the original order')


def fit_kmeans(X: np.ndarray, k: int, seed: int, n_init: int) -> KMeans:
    return KMeans(n_clusters=k, n_init=n_init, random_state=seed).fit(X)


def silhouette_grid(X: np.ndarray, k_max: int, seed: int, n_init: int, min_size: int) -> list[dict]:
    rows = []
    for k in range(2, min(k_max, len(X) - 1) + 1):
        model = fit_kmeans(X, k, seed, n_init)
        sizes = sorted(np.bincount(model.labels_, minlength=k).tolist(), reverse=True)
        rows.append(dict(k=k, silhouette=float(silhouette_score(X, model.labels_)),
                         inertia=float(model.inertia_), sizes=sizes, eligible=min(sizes) >= min_size))
    return rows


def best_of(grid: list[dict]) -> dict | None:
    eligible = [row for row in grid if row['eligible']]
    return max(eligible, key=lambda r: r['silhouette']) if eligible else None


def reference_test(Y: np.ndarray, observed: float, k_max: int, draws: int, seed: int) -> dict:
    """Share of structureless datasets whose best silhouette reaches the observed one."""
    rng = np.random.default_rng(seed)
    center = Y.mean(0)
    _, _, vt = np.linalg.svd(Y - center, full_matrices=False)
    Z = (Y - center) @ vt.T
    low, high = Z.min(0), Z.max(0)
    best = np.zeros(draws)
    for b in range(draws):
        R = rng.uniform(low, high, size=Z.shape)
        grid = silhouette_grid(R, k_max, seed + b, 3, 1)
        best[b] = max(row['silhouette'] for row in grid)
    return dict(observed=observed, reference_mean=float(best.mean()),
                reference_p95=float(np.quantile(best, 0.95)),
                p_value=float((1 + (best >= observed).sum()) / (draws + 1)), draws=draws)


def bootstrap_jaccard(Y: np.ndarray, labels: np.ndarray, draws: int, seed: int) -> list[float]:
    """Hennig (2007) cluster-wise stability: refit on resamples, keep the best Jaccard."""
    rng = np.random.default_rng(seed)
    k = int(labels.max()) + 1
    groups = [set(np.where(labels == c)[0]) for c in range(k)]
    scores = np.zeros((k, draws))
    for b in range(draws):
        sample = rng.integers(0, len(Y), len(Y))
        pred = fit_kmeans(Y[sample], k, seed + b, 10).predict(Y)
        fitted = [set(np.where(pred == d)[0]) for d in range(k)]
        for c, group in enumerate(groups):
            scores[c, b] = max(len(group & other) / max(1, len(group | other)) for other in fitted)
    return [float(v) for v in scores.mean(1)]


def fit_pca(X: np.ndarray) -> dict:
    """Full PCA with a fixed sign rule so axes never flip when the data are updated:
    the largest-magnitude loading of each component is positive."""
    mean = X.mean(0)
    _, s, vt = np.linalg.svd(X - mean, full_matrices=False)
    for i in range(vt.shape[0]):
        if vt[i, np.argmax(np.abs(vt[i]))] < 0:
            vt[i] *= -1
    variance = s ** 2 / (len(X) - 1)
    return dict(mean=mean, components=vt, explained=variance / variance.sum(), variance=variance)


def auto_label(centroid: np.ndarray, overall: np.ndarray, config: dict) -> dict:
    """Used only when no row in cluster_labels.csv matches, e.g. after a data update."""
    gaps = centroid - overall
    order = np.argsort(-np.abs(gaps))[:2]
    label = {}
    for lang in ('en', 'es'):
        parts = [config['dimensions'][i]['high' if gaps[i] > 0 else 'low'][lang] for i in order]
        label[lang] = ' · '.join(parts)
    return label


def resolve_label(members: set, level: str, rows: list[dict], centroid, overall, config, cluster_id, warnings) -> dict:
    matches = [r for r in rows if r['level'] == level and set(r['anchors'].split(';')) <= members]
    if len(matches) == 1:
        r = matches[0]
        return dict(label=dict(en=r['label_en'], es=r['label_es']), phrase=dict(en=r['phrase_en'], es=r['phrase_es']),
                    blurb=dict(en=r['blurb_en'], es=r['blurb_es']), auto=False)
    warnings.append(f'{cluster_id}: {len(matches)} rows in cluster_labels.csv match; using an automatic label')
    label = auto_label(centroid, overall, config)
    phrase = dict(en=f"the group “{label['en']}”", es=f"el grupo «{label['es']}»")
    return dict(label=label, phrase=phrase, blurb=dict(en='', es=''), auto=True)


def r(values, digits=3):
    """Round numbers (or nested lists) for a stable, readable model.json."""
    if isinstance(values, np.ndarray):
        values = values.tolist()
    if isinstance(values, (list, tuple)):
        return [r(v, digits) for v in values]
    return round(float(values), digits)


def build(inputs: dict) -> tuple[dict, list[str]]:
    cfg = inputs['config']
    params = cfg['clustering']
    seed, k_max, min_size = params['seed'], params['k_max'], params['min_cluster_size']
    parties = inputs['parties']
    X = np.array([[float(p[d]) for d in DIMS] for p in parties])
    ids = [p['id'] for p in parties]
    overall = X.mean(0)
    warnings: list[str] = []

    pca = fit_pca(X)
    project = lambda v: (np.asarray(v) - pca['mean']) @ pca['components'].T
    pcs = project(X)

    # Level 1. These n_init values are the ones behind the original published solution.
    top_grid = silhouette_grid(X, k_max, seed, 60, 1)
    top_best = best_of(top_grid)
    top_model = fit_kmeans(X, top_best['k'], seed, 100)
    # Stable ids: C1 is the main cluster furthest along PC1.
    top_order = np.argsort(-project(top_model.cluster_centers_)[:, 0])
    main_of = {int(old): new for new, old in enumerate(top_order)}
    main_labels = np.array([main_of[int(v)] for v in top_model.labels_])
    top_sil = silhouette_samples(X, main_labels)

    clusters, sub_diagnostics = [], {}
    sub_labels = np.empty(len(X), dtype=object)
    sub_sil = np.zeros(len(X))
    for m in range(top_best['k']):
        cid = f'C{m + 1}'
        idx = np.where(main_labels == m)[0]
        Y = X[idx]
        grid = silhouette_grid(Y, k_max, seed, 100, min_size) if len(idx) >= params['min_parent_size'] else []
        best = best_of(grid)
        split = best is not None and best['silhouette'] >= params['min_split_silhouette']
        children = []
        diag = dict(grid=[dict(k=g['k'], silhouette=r(g['silhouette'], 4), sizes=g['sizes'],
                               eligible=g['eligible']) for g in grid],
                    selected_k=best['k'] if split else 1)
        if split:
            model = fit_kmeans(Y, best['k'], seed, 200)
            order = np.argsort(-project(model.cluster_centers_)[:, 0])
            remap = {int(old): new for new, old in enumerate(order)}
            local = np.array([remap[int(v)] for v in model.labels_])
            sub_sil[idx] = silhouette_samples(Y, local)
            jaccard = bootstrap_jaccard(Y, local, params['bootstrap_draws'], seed)
            diag['reference'] = {key: (r(val, 4) if isinstance(val, float) else val) for key, val in
                                 reference_test(Y, best['silhouette'], k_max, params['reference_draws'], seed).items()}
            diag['silhouette'] = r(best['silhouette'], 4)
            for s in range(best['k']):
                letter = string.ascii_lowercase[s]
                sid = f'{cid}{letter}'
                mem = idx[local == s]
                sub_labels[mem] = sid
                centroid = Y[local == s].mean(0)
                info = resolve_label({ids[i] for i in mem}, 'sub', inputs['labels'], centroid, overall, cfg, sid, warnings)
                children.append(dict(id=sid, parent=cid, n=len(mem), centroid=r(centroid, 2), pc=r(project(centroid)[:2]),
                                     members=[ids[i] for i in mem], silhouette=r(sub_sil[mem].mean()),
                                     stability=r(jaccard[s]), **info))
        else:
            sub_labels[idx] = None
        centroid = X[idx].mean(0)
        info = resolve_label({ids[i] for i in idx}, 'main', inputs['labels'], centroid, overall, cfg, cid, warnings)
        clusters.append(dict(id=cid, n=len(idx), centroid=r(centroid, 2), pc=r(project(centroid)[:2]),
                             members=[ids[i] for i in idx], silhouette=r(top_sil[idx].mean()),
                             children=children, **info))
        sub_diagnostics[cid] = diag

    leaves = [sub_labels[i] or f'C{main_labels[i] + 1}' for i in range(len(X))]
    leaf_ids = {leaf: n for n, leaf in enumerate(sorted(set(leaves)))}
    leaf_sil = float(silhouette_score(X, [leaf_ids[leaf] for leaf in leaves])) if len(leaf_ids) > 1 else None

    # A short hash of the inputs. Saved results remember it so the site can say when the
    # party data have changed since a result was taken.
    digest = hashlib.sha256()
    for name in ('parties.csv', 'groupings.csv', 'cluster_labels.csv', 'config.json'):
        digest.update((DATA / name).read_bytes().replace(b'\r\n', b'\n'))
    reviewed = sorted(p['last_reviewed'] for p in parties if p.get('last_reviewed'))

    abbrev_counts = Counter(p['abbrev'] for p in parties)
    model = dict(
        version=digest.hexdigest()[:10],
        dataDate=reviewed[-1] if reviewed else None,
        site=cfg['site'],
        dimensions=cfg['dimensions'],
        tiers=cfg['tiers'],
        flagAspect=flag_aspects(parties, inputs['countries']),
        agreement={k: v for k, v in cfg['agreement'].items() if not k.startswith('_')},
        scale=inputs['questions']['scale'],
        questions=inputs['questions']['questions'],
        countries=[dict(code=c['code'], name=dict(en=c['name_en'], es=c['name_es']), flag=c['flag'])
                   for c in inputs['countries']],
        groupings=[dict(id=g['id'], name=dict(en=g['name_en'], es=g['name_es']), countries=g['countries'].split(';'))
                   for g in inputs['groupings']],
        parties=[dict(id=p['id'], country=p['country_code'],
                      # Two parties can share an abbreviation (CPC in Canada and in China), so
                      # labels with no flag beside them, such as on the map, add the country code.
                      label=p['abbrev'] if abbrev_counts[p['abbrev']] == 1 else f"{p['abbrev']} {p['country_code']}",
                      flag=p['flag'] or next(c['flag'] for c in inputs['countries'] if c['code'] == p['country_code']),
                      abbrev=p['abbrev'], name=dict(en=p['name_en'], es=p['name_es']),
                      scores=[float(p[d]) for d in DIMS], pc=r(pcs[i][:2]),
                      cluster=f'C{main_labels[i] + 1}', sub=sub_labels[i],
                      silhouette=r(top_sil[i]), subSilhouette=r(sub_sil[i]),
                      logo=p['logo'] if p['logo'] and (SITE / 'assets' / 'logos' / p['logo']).is_file() else None,
                      logoAspect=logo_aspect(p['logo']), logoSource=p['logo_source']) for i, p in enumerate(parties)],
        clusters=clusters,
        overall=r(overall, 2),
        pca=dict(mean=[float(v) for v in pca['mean']], components=pca['components'].tolist(),
                 explained=r(pca['explained'], 5)),
        diagnostics=dict(top=dict(grid=[dict(k=g['k'], silhouette=r(g['silhouette'], 4), sizes=g['sizes'])
                                        for g in top_grid], selected_k=top_best['k'],
                                  silhouette=r(top_best['silhouette'], 4)),
                         sub=sub_diagnostics, leaf_silhouette=r(leaf_sil, 4) if leaf_sil is not None else None,
                         params={k: v for k, v in params.items()}),
    )
    for p in parties:
        if not (p['logo'] and (SITE / 'assets' / 'logos' / p['logo']).is_file()):
            warnings.append(f"{p['id']}: no logo file, the tile will show the abbreviation instead")
    return model, warnings


def png_size(path: Path) -> tuple[int, int]:
    with path.open('rb') as f:
        head = f.read(24)
    return struct.unpack('>II', head[16:24])


def logo_aspect(name: str) -> float | None:
    path = SITE / 'assets' / 'logos' / name
    if not name or not path.is_file():
        return None
    w, h = png_size(path)
    return round(w / h, 4)


def flag_aspects(parties: list[dict], countries: list[dict]) -> dict:
    out = {}
    for flag in sorted({p['flag'] or next(c['flag'] for c in countries if c['code'] == p['country_code']) for p in parties}):
        path = SITE / 'assets' / 'flags' / f'{flag}.png'
        if not path.is_file():
            raise DataError(f'site/assets/flags/{flag}.png is missing')
        w, h = png_size(path)
        out[flag] = round(w / h, 4)
    return out


PAGE_TEXT = {
    'en': dict(
        description='Answer 20 statements and see where you stand among {parties} political parties in the G20 and the world’s full democracies: '
                    'your five-dimensional profile, tier list, party map and head-to-head comparisons.',
        noscript='This site needs JavaScript to score the quiz in your browser.',
        og_locale='en_US'),
    'es': dict(
        description='Responde 20 afirmaciones y descubre dónde te ubicas entre {parties} partidos políticos del G20 y las democracias plenas del mundo: '
                    'tu perfil en cinco dimensiones, tu tier list, el mapa de partidos y comparaciones directas.',
        noscript='Este sitio necesita JavaScript para calcular el cuestionario en tu navegador.',
        og_locale='es_LA'),
}


def write_pages(model: dict) -> None:
    template = (ROOT / 'pipeline' / 'page.template.html').read_text(encoding='utf-8')
    base = model['site']['url'].rstrip('/')
    for lang, text in PAGE_TEXT.items():
        html = template
        values = dict(lang=lang, title=model['site']['title'][lang], base=base, **text)
        values['description'] = text['description'].format(parties=len(model['parties']))
        for key, value in values.items():
            html = html.replace('{{' + key + '}}', value)
        out = SITE / lang / 'index.html'
        out.parent.mkdir(exist_ok=True)
        out.write_text(html, encoding='utf-8', newline='\n')


def main() -> int:
    try:
        inputs = load_inputs()
    except DataError as err:
        print(f'DATA ERROR  {err}', file=sys.stderr)
        return 1
    try:
        model, warnings = build(inputs)
    except DataError as err:
        print(f'DATA ERROR  {err}', file=sys.stderr)
        return 1
    out = SITE / 'data' / 'model.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(model, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    write_pages(model)

    print(f"model {model['version']}  {len(model['parties'])} parties  "
          f"{len(model['countries'])} countries  {len(model['groupings'])} groupings")
    print(f"main clusters: k={model['diagnostics']['top']['selected_k']} "
          f"(silhouette {model['diagnostics']['top']['silhouette']})")
    for c in model['clusters']:
        d = model['diagnostics']['sub'][c['id']]
        ref = d.get('reference', {})
        print(f"  {c['id']} {c['label']['en']} (n={c['n']}): k={d['selected_k']}, "
              f"silhouette {d.get('silhouette')}, reference p={ref.get('p_value')}")
        for s in c['children']:
            flag = '  [AUTO LABEL]' if s['auto'] else ''
            print(f"    {s['id']} {s['label']['en']} (n={s['n']}), stability {s['stability']}{flag}: "
                  f"{' '.join(s['members'])}")
    for w in warnings:
        print(f'  WARNING {w}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

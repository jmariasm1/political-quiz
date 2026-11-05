"""Run with: python -m pytest pipeline/

Covers the published clustering, the update path (what happens when someone edits the data files)
and tests/golden.json, the numpy results the browser code is checked against.
"""
import json
from pathlib import Path

import numpy as np
import pytest

import build_model as bm

ROOT = Path(__file__).resolve().parent.parent
MODEL = json.loads((ROOT / 'site' / 'data' / 'model.json').read_text(encoding='utf-8'))
DIMS = bm.DIMS


def fresh_inputs():
    return bm.load_inputs()


def test_clusters_are_chosen_by_the_highest_silhouette():
    top = MODEL['diagnostics']['top']
    by_k = {row['k']: row['silhouette'] for row in top['grid']}
    assert top['selected_k'] == max(by_k, key=by_k.get)
    assert sum(c['n'] for c in MODEL['clusters']) == len(MODEL['parties'])


def test_scores_follow_the_questionnaire_formula():
    questions = MODEL['questions']
    for party in MODEL['parties']:
        for score, dim in zip(party['scores'], MODEL['dimensions']):
            items = [(q['sign'], party['answers'][i]) for i, q in enumerate(questions) if q['dim'] == dim['id']]
            assert len(items) == 5
            total = sum(sign * (answer - 3) for sign, answer in items)
            assert score == pytest.approx(50 + 5 * total, abs=0.02)


def test_groups_are_found_on_the_answers_not_the_scores():
    answers = np.array([p['answers'] for p in MODEL['parties']])
    params = MODEL['diagnostics']['params']
    k = MODEL['diagnostics']['top']['selected_k']
    model = bm.fit_kmeans((answers - 1) * 25, k, params['seed'], 100)
    ids = np.array([p['id'] for p in MODEL['parties']])
    found = {frozenset(ids[model.labels_ == c].tolist()) for c in range(k)}
    assert found == {frozenset(c['members']) for c in MODEL['clusters']}


def test_questions_are_numbered_in_the_order_the_quiz_shows_them():
    questions = MODEL['questions']
    assert [q['id'] for q in questions] == list(range(1, 26))
    assert sorted(q['no'] for q in questions) == list(range(1, 26))
    for dim_index, dim in enumerate(MODEL['dimensions']):
        assert sorted(q['no'] for q in questions if q['dim'] == dim['id']) == list(range(dim_index * 5 + 1, dim_index * 5 + 6))


def test_subgroups_partition_each_main_cluster():
    for cluster in MODEL['clusters']:
        members = [m for child in cluster['children'] for m in child['members']]
        assert sorted(members) == sorted(cluster['members'])
        assert all(child['n'] >= 2 for child in cluster['children'])


def test_subgroup_count_is_the_silhouette_maximum():
    for cluster in MODEL['clusters']:
        diag = MODEL['diagnostics']['sub'][cluster['id']]
        eligible = [row for row in diag['grid'] if row['eligible']]
        assert diag['selected_k'] == max(eligible, key=lambda r: r['silhouette'])['k']
        assert len(cluster['children']) == diag['selected_k']


def test_currents_partition_each_subgroup_and_follow_the_same_rule():
    parties = {p['id']: p for p in MODEL['parties']}
    floor = MODEL['diagnostics']['params']['min_split_silhouette']
    for cluster in MODEL['clusters']:
        for sub in cluster['children']:
            diag = MODEL['diagnostics']['leaf'][sub['id']]
            eligible = [row for row in diag['grid'] if row['eligible']]
            best = max(eligible, key=lambda r: r['silhouette'])
            if best['silhouette'] < floor:
                # Too little structure to split: the subgroup stays whole and has no currents.
                assert diag['selected_k'] == 1 and sub['children'] == []
                assert all(parties[m]['leaf'] is None for m in sub['members'])
                continue
            assert diag['selected_k'] == best['k'] == len(sub['children'])
            members = [m for leaf in sub['children'] for m in leaf['members']]
            assert sorted(members) == sorted(sub['members'])
            for leaf in sub['children']:
                assert leaf['n'] >= 2 and leaf['parent'] == sub['id']
                assert all(parties[m]['leaf'] == leaf['id'] and parties[m]['sub'] == sub['id'] for m in leaf['members'])


def test_a_current_is_the_kmeans_solution_for_its_subgroup():
    parties = {p['id']: p for p in MODEL['parties']}
    params = MODEL['diagnostics']['params']
    for cluster in MODEL['clusters']:
        for sub in cluster['children']:
            if not sub['children']:
                continue
            Y = (np.array([parties[m]['answers'] for m in sub['members']]) - 1) * 25
            model = bm.fit_kmeans(Y, len(sub['children']), params['seed'], 200)
            found = {frozenset(np.array(sub['members'])[model.labels_ == k].tolist()) for k in range(len(sub['children']))}
            assert found == {frozenset(leaf['members']) for leaf in sub['children']}


def test_every_published_group_has_a_reviewed_label():
    for cluster in MODEL['clusters']:
        assert not cluster['auto']
        for child in cluster['children']:
            assert not child['auto']
            assert not any(leaf['auto'] for leaf in child['children'])


def test_repeated_abbreviations_get_a_country_on_their_label():
    labels = {p['id']: p['label'] for p in MODEL['parties']}
    assert labels['ca-cpc'] == 'CPC CA' and labels['cn-cpc'] == 'CPC CN'
    assert labels['ca-grn'] == 'GRN CA' and labels['uk-grn'] == 'GRN UK' and labels['au-grn'] == 'GRN AU'
    assert labels['br-pt'] == 'PT BR' and labels['mx-pt'] == 'PT MX'
    assert labels['us-dem'] == 'DEM US' and labels['tr-dem'] == 'DEM TR' and labels['id-demokrat'] == 'DEM ID'
    assert labels['id-pan'] == 'PAN ID' and labels['mx-pan'] == 'PAN MX' and labels['pt-pan'] == 'PAN PT'
    assert labels['ee-kesk'] == 'KESK EE' and labels['fi-kesk'] == 'KESK FI'
    assert labels['fr-rn'] == 'RN FR' and labels['cl-rn'] == 'RN CL'
    assert labels['de-afd'] == 'AfD'
    assert len(set(labels.values())) == len(labels)


def test_groupings_are_the_real_memberships():
    groups = {g['id']: set(g['countries']) for g in MODEL['groupings']}
    assert len(groups['g20']) == 19 and 'TW' not in groups['g20'] and 'SA' in groups['g20']
    assert 'TW' not in groups['brics']
    assert len(groups['full-democracies']) == 26 and {'TW', 'UY', 'MU', 'JP'} <= groups['full-democracies']
    assert len(groups['oecd']) == 38 and {'BE', 'CL', 'CO', 'IL', 'PL', 'US', 'TR'} <= groups['oecd']
    assert not groups['oecd'] & {'TW', 'CN', 'RU', 'BR', 'IN', 'SA', 'ZA', 'ID', 'AR', 'MU', 'UY'}
    assert not groups['full-democracies'] & {'US', 'IT', 'SA', 'CN', 'RU'}
    in_a_group = set().union(*groups.values())
    assert in_a_group == {c['code'] for c in MODEL['countries']}


def test_taiwan_is_its_own_entry_and_china_has_one_party():
    assert sorted(p['id'] for p in MODEL['parties'] if p['country'] == 'TW') == ['tw-dpp', 'tw-kmt', 'tw-tpp']
    assert [p['id'] for p in MODEL['parties'] if p['country'] == 'CN'] == ['cn-cpc']


def test_pca_sign_rule_keeps_axes_from_flipping():
    for row in MODEL['pca']['components']:
        assert row[int(np.argmax(np.abs(row)))] > 0


def test_adding_a_party_needs_only_a_new_row():
    inputs = fresh_inputs()
    row = dict(inputs['parties'][0], id='us-test', abbrev='TST', name_en='Test Party', name_es='Partido de Prueba',
               logo='', logo_source='', **{q: '3' for q in bm.ANSWERS})
    inputs['parties'].append(row)
    inputs['config']['clustering'].update(reference_draws=5, bootstrap_draws=5)
    model, warnings = bm.build(inputs)
    assert len(model['parties']) == len(MODEL['parties']) + 1
    added = next(p for p in model['parties'] if p['id'] == 'us-test')
    assert added['logo'] is None
    assert any('us-test' in w for w in warnings)
    assert sum(c['n'] for c in model['clusters']) == len(model['parties'])


def test_new_grouping_reaches_the_model():
    inputs = fresh_inputs()
    inputs['groupings'].append(dict(id='europe', name_en='Europe', name_es='Europa', countries='DE;FR;IT;UK'))
    inputs['config']['clustering'].update(reference_draws=5, bootstrap_draws=5)
    model, _ = bm.build(inputs)
    assert [g['id'] for g in model['groupings']][-1] == 'europe'


def test_a_group_nobody_labelled_gets_an_automatic_name_and_a_warning():
    inputs = fresh_inputs()
    inputs['labels'] = [r for r in inputs['labels'] if r['label_en'] != 'Internationalist centre']
    inputs['config']['clustering'].update(reference_draws=5, bootstrap_draws=5)
    model, warnings = bm.build(inputs)
    unnamed = [c for m in model['clusters'] for c in m['children'] if c['auto']]
    assert len(unnamed) == 1 and unnamed[0]['label']['en'] and unnamed[0]['phrase']['es']
    assert any('automatic label' in w for w in warnings)


@pytest.mark.parametrize('mutate, message', [
    (lambda i: i['parties'][0].update(q01='7'), 'outside 1-5'),
    (lambda i: i['parties'][0].update(q05='high'), 'not a number'),
    (lambda i: i['parties'][1].update(id=i['parties'][0]['id']), 'already used'),
    (lambda i: i['parties'][0].update(country_code='XX'), 'not in data/countries.csv'),
    (lambda i: i['parties'][0].update(name_es=' '), 'name_es is empty'),
    (lambda i: i['groupings'][0].update(countries='US;XX'), "unknown country 'XX'"),
    (lambda i: i['labels'][0].update(anchors='no-such-party'), 'not a party id'),
    (lambda i: i['questions']['questions'].pop(), '25 statements'),
])
def test_bad_data_stops_the_build_and_names_the_problem(mutate, message):
    inputs = fresh_inputs()
    mutate(inputs)
    with pytest.raises(bm.DataError, match=message):
        bm.validate(inputs['parties'], inputs['countries'], inputs['groupings'], inputs['labels'],
                    inputs['questions'], inputs['config'])


def independent_expected(answers):
    """The questionnaire's formula and the model, written out in plain numpy."""
    qs = MODEL['questions']
    dims = [d['id'] for d in MODEL['dimensions']]
    scores = []
    for dim in dims:
        total = 0
        for q, a in zip(qs, answers):
            if q['dim'] == dim:
                total += q['sign'] * (a - 3)
        scores.append(50 + 5 * total)
    u = np.array(scores)
    v = np.array(answers, dtype=float)
    distance = lambda g: 25 * np.sqrt(((v - np.array(g['answers'])) ** 2).mean())
    sim = {p['id']: float(100 - distance(p)) for p in MODEL['parties']}
    main = min(MODEL['clusters'], key=distance)
    sub = min(main['children'], key=distance) if main['children'] else None
    leaf = min(sub['children'], key=distance) if sub and sub['children'] else None
    mean = np.array(MODEL['pca']['mean'])
    comps = np.array(MODEL['pca']['components'])
    pc = comps[:2] @ (u - mean)
    total = ((u - mean) ** 2).sum()
    return dict(answers=answers, scores=scores, similarity=sim, main=main['id'], sub=sub['id'] if sub else None, leaf=leaf['id'] if leaf else None,
                pc=pc.tolist(), fidelity=float((pc ** 2).sum() / total) if total else 1.0)


def test_write_golden_file_for_the_browser_tests():
    rng = np.random.default_rng(2026)
    answers = [[3] * 25, ([4, 2] * 13)[:25], ([2, 4] * 13)[:25]]
    answers += [rng.integers(1, 6, 25).tolist() for _ in range(5)]
    cases = [independent_expected(a) for a in answers]
    out = ROOT / 'tests' / 'golden.json'
    out.write_text(json.dumps(dict(cases=cases), indent=0) + '\n', encoding='utf-8', newline='\n')
    assert len(cases) == 8

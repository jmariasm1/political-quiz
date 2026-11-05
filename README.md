# Global Ideological Compass

A 25-statement political quiz that places you among 365 parties in the G20, the OECD and the countries the EIU classes as full democracies. It runs entirely in the browser, in English and Spanish. Answers stay on the visitor's device: there is no server, no account and no analytics.

**Live site:** https://jmariasm1.github.io/political-quiz/

What a visitor gets:

- A five-dimensional profile (economics, social values, civil liberties, internationalism, climate).
- A tier list of every party, from S to F, with fixed cutoffs or tiers spread to be as even as possible.
- A PCA map with the visitor as a point, plus charts that explain what the axes mean. The map and the tier list can colour parties by cluster, subgroup or current.
- A radar comparison of any two profiles, with "Where they agree and diverge".
- Filters for the G20, G7, founding BRICS, OECD, full democracies, any grouping you add, or a single country.
- A PNG download for every chart, and saved results when they come back.

## Updating the site

Everything editable is in [`data/`](data). Edit a file, push to `main`, and the [workflow](.github/workflows/deploy.yml) rebuilds the clusters, runs the tests and publishes the site. If a test fails, the live site stays as it was.

Saved results store raw answers, so returning visitors are re-scored against the new data automatically and are told that the data changed.

### Change a party's position

Edit its answers in [`data/parties.csv`](data/parties.csv): `q01` to `q25`, each from 1 to 5, in the question order of [`data/questions.json`](data/questions.json). Its five scores are calculated from them. `last_reviewed` is shown on the Method page.

### Add a party

1. Add a row to `data/parties.csv`. The `id` must be unique, such as `co-pl`.
2. Put its logo in `site/assets/logos/`, and set `logo` to the file name. Leave `logo` empty and the tile shows the abbreviation instead.
3. Add the source page of the logo in `logo_source`, which feeds the credits on the Method page.

### Add a country

Add a row to [`data/countries.csv`](data/countries.csv), and put its flag in `site/assets/flags/` (from [FlagCDN](https://flagcdn.com/), for example).

### Add a grouping

Add a row to [`data/groupings.csv`](data/groupings.csv), listing country codes separated by semicolons:

```csv
europe,Europe,Europa,DE;FR;IT;UK
```

It appears in the filters by itself.

### Rename a cluster, subgroup or current

Group names are in [`data/cluster_labels.csv`](data/cluster_labels.csv), each with a short label, a phrase that fits inside a sentence ("You sit closest to the market liberals") and a one-line description, in both languages. Each row is tied to the group containing its `anchors` (party ids), not to a fixed number, so names keep following the right group as the data changes. If an update creates a group that no row matches, it gets an automatic name built from its scores, and the build prints a warning telling you to name it.

### Change tier cutoffs or thresholds

Edit [`data/config.json`](data/config.json). The fixed cutoffs are the default view of the tier list. "Spread for me" works its cutoffs out in the browser: each middle tier is 5 or 10 points wide, and it picks the whole-number cutoffs that bring the fullest and emptiest tiers closest together.

## Running it locally

```bash
python -m venv .venv
```

Activate the environment (`.venv\Scripts\activate` on Windows), then:

```bash
pip install -r pipeline/requirements.txt
```

```bash
python pipeline/build_model.py
```

```bash
npm install
```

```bash
npm run serve
```

Then open http://localhost:8000. To run the tests:

```bash
python -m pytest pipeline/
```

```bash
npm test
```

```bash
npx playwright install chromium
```

```bash
npm run e2e
```

If your data has a mistake, `build_model.py` stops and names the file and line.

## How the model works

- **Scoring:** 25 statements, five per dimension. Each dimension is `5 × (sum of five recoded answers − 5)`.
- **Similarity:** `100 − 25 × RMS(difference between answers)` across all 25 answers, so every question weighs the same. Party answers are the calibrated fractional values.
- **Main clusters:** k-means on the 25 answers, with k chosen by the highest mean silhouette on k = 2 to 12.
- **Subgroups:** the same procedure inside each main cluster, with no number imposed. Solutions containing a one-party group are rejected, and a cluster stays whole if its best silhouette is under 0.25.
- **Currents:** the same procedure and rules again, inside each subgroup.
- **Checks shown beside the groups, never used to choose them:** a reference test against structureless data, and bootstrap stability (Hennig's cluster-wise Jaccard).
- **PCA:** fitted once on the parties' five scores, only to draw the map. A fixed sign rule stops the axes flipping when data changes.

The Method page on the site explains all of this, with the diagnostics.

## Project layout

```
data/        What you edit: parties, countries, groupings, group names, settings, the questionnaire
pipeline/    build_model.py turns data/ into site/data/model.json and the /en/ and /es/ pages
site/        The published site. No framework and no build step
tests/       Scoring tests and an end-to-end browser test
```

Interface text is in `site/assets/js/i18n.js`. A test fails if a string exists in only one language.

## Limits

This is an exploratory questionnaire, not a validated political-science scale. Party answers are modeled estimates, made by hand with AI assistance. No party filled in this questionnaire, and fractional answers come from a calibration, not from evidence of that precision. It is not voting advice.

## Credits

Party names and logos belong to their owners and appear only to identify each party, with no affiliation or endorsement. To remove a logo, delete its file and the tile falls back to the abbreviation. Flags are from FlagCDN. The typefaces are [Fira Sans Extra Condensed](https://fonts.google.com/specimen/Fira+Sans+Extra+Condensed) and [Libre Franklin](https://fonts.google.com/specimen/Libre+Franklin) (SIL Open Font License).

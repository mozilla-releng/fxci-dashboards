# Firefox-CI Dashboards

[![Live](https://img.shields.io/badge/live-fxci.quick.mozilla.cloud-0060df)](https://fxci.quick.mozilla.cloud/)
[![Deploy](https://github.com/mozilla-releng/fxci-dashboards/actions/workflows/deploy.yml/badge.svg)](https://github.com/mozilla-releng/fxci-dashboards/actions/workflows/deploy.yml)

Dashboards for the Firefox-CI Taskcluster instance. Built with [Observable
Framework](https://observablehq.com/framework/), deployed to
[Quick](https://quick.mozilla.cloud/) (Mozilla SSO required). Data is a
periodic build-time snapshot from [STMO](https://sql.telemetry.mozilla.org/), not live.

## Local development

CI uses a separate API key per STMO query (see below), but for local dev your
own personal Redash API key works fine as a fallback — no need to fetch a key
per query:

```sh
export REDASH_API_KEY=...
npm ci
npm run dev   # http://localhost:3000, hot-reloads on edits
```

See the source under `src/` for the dashboard/data-loader model.

## Tests

```sh
npm test            # unit tests
npm run test:perf   # builds the site from fixtures and checks the pages in a browser
```

`test:perf` needs a Playwright browser (`npx playwright install firefox`, or
`--browser chromium` for the one you have). It builds the whole site from made-up
STMO results (`scripts/make-fixtures.js`, read through `STMO_FIXTURES_DIR`), so it
needs no API key and no network beyond the npm registry and a CDN for the
libraries. It then opens the pages of `test/perf/scenarios.js` and:

- fails on any page error, failed request, request outside the site, or number
  that differs from `test/perf/expected.json` (counts of marks, nodes and links,
  and the values of the top line metrics);
- fails when a timing goes over its ceiling in `test/perf/budgets.json`.

The libraries of the pages are not pinned, so a new release of one only prints a
warning. If it changed what a page renders, the counts and digests fail.

After a change that is meant to alter what a page shows, run
`npm run test:perf -- --record` and commit the new `expected.json`. CI runs both
commands on every pull request and every push to `main`, and prints the timings
in the job's summary.

The run writes to `dist-ci/`, so fixture data can never end up in a
`quick deploy ./dist`. It also puts your cached STMO results aside while it runs
and puts them back afterwards.

## CI secrets

CI reads a dedicated key per STMO query (see `src/data/_queries.yml`) from
this repo's `production` GitHub environment, each scoped to just that
query's cached results. To add or rotate one:

```sh
gh secret set REDASH_API_KEY_GECKO2GITHUB_TREND --env production --body "<key>"
```

Omit `--body` to be prompted, or pipe a value in: `echo -n "<key>" | gh secret
set REDASH_API_KEY_GECKO2GITHUB_TREND --env production`.

# Firefox-CI Dashboards

[![Live](https://img.shields.io/badge/live-fxci.quick.mozilla.cloud-0060df)](https://fxci.quick.mozilla.cloud/)

Dashboards for the Firefox-CI Taskcluster instance. Built with [Observable
Framework](https://observablehq.com/framework/), deployed to
[Quick](https://quick.mozilla.cloud/) (Mozilla SSO required). Data is a
periodic build-time snapshot from STMO, not live.

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

## CI secrets

CI reads a dedicated key per STMO query (see `src/data/_queries.md`) from
this repo's `production` GitHub environment, each scoped to just that
query's cached results. To add or rotate one:

```sh
gh secret set REDASH_API_KEY_GECKO2GITHUB_TREND --env production --body "<key>"
```

Omit `--body` to be prompted, or pipe a value in: `echo -n "<key>" | gh secret
set REDASH_API_KEY_GECKO2GITHUB_TREND --env production`.

# Firefox-CI Dashboards

[![Live](https://img.shields.io/badge/live-fxci.quick.mozilla.cloud-0060df)](https://fxci.quick.mozilla.cloud/)

Dashboards for the Firefox-CI Taskcluster instance. Built with [Observable
Framework](https://observablehq.com/framework/), deployed to
[Quick](https://quick.mozilla.cloud/) (Mozilla SSO required). Data is a
periodic build-time snapshot from STMO, not live.

## Local development

```sh
export REDASH_API_KEY=...
npm ci
npm run dev   # http://localhost:3000, hot-reloads on edits
```

See the source under `src/` for the dashboard/data-loader model.

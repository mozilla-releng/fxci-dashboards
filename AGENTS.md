# Firefox-CI Dashboards

[Observable Framework](https://observablehq.com/framework/) site — source in
`src/` (`src/*.md` pages, `src/data/*.js` loaders), builds to `dist/` —
deployed to Mozilla's [Quick](https://quick.mozilla.cloud/) platform as
static, SSO-gated hosting. No `quick.js` client SDK is used: this is
build-time snapshots of STMO data, not a live app.

## Adding a dashboard

1. Create or find the STMO ([sql.telemetry.mozilla.org](https://sql.telemetry.mozilla.org))
   query; note its id and add a row to `src/data/_queries.md` — the only place
   the loader-to-query mapping is documented, since the SQL itself lives on
   STMO, not in this repo.
2. Add `src/data/<name>.json.js`:
   ```js
   import {fetchRows} from "./_stmo.js";
   const rows = await fetchRows(<queryId>);
   process.stdout.write(JSON.stringify(rows));
   ```
   Loaders fetch **cached** STMO results (never trigger re-execution) and
   `throw` on missing config or bad data — a non-zero exit fails the whole
   build, which is the intended alarm.
3. Add `src/<name>.md` that reads `FileAttachment("data/<name>.json").json()`
   and renders it with `Plot` / `Inputs` (implicit globals, no import needed).
4. Add a `{name, path}` entry to `pages` in `observablehq.config.js` so it
   shows up in the sidebar.
5. `npm run build` must pass.

Files/dirs starting with `_` (e.g. `_stmo.js`, `_queries.md`) are helpers, not
pages. `src/queue-health.md` / `src/data/queue-pending.json.js` are a
template with a placeholder query id (`0`) — expected to fail the build until
pointed at a real query.

## Local dev & auth

```sh
export REDASH_API_KEY=...   # scoped Redash key, dedicated user/group
npm ci
npm run dev                 # http://localhost:3000, hot-reloads
```

`npm run build` is the CI gate: fails on loader errors (missing
`REDASH_API_KEY`, bad query id, network/auth) or `.md`/import parse errors. It
does **not** fail on a runtime error inside a page's reactive JS block — those
render inline instead — so put data-shape assertions in loaders.

## Build & deploy

    npm run build
    quick deploy ./dist fxci

- Deploy `dist/` only — never the repo root or `src/`.
- Don't add a top-level `index.html`; Framework generates one from `src/index.md`.
- CI mirrors this: `.github/workflows/deploy.yml` (push to `main`) and
  `refresh.yml` (hourly, clears the loader cache first) both build then
  deploy. Both need the `REDASH_API_KEY` repo secret.
- Site name is fixed as `fxci`. Also useful: `quick list`, `quick open fxci`.

## Quick client SDK can be used

Add `<script src="/quick.js"></script>` and use the global `quick` object —
`quick.me()`, `quick.data` (key/value, atomic ops, live `subscribe`),
`quick.db.collection()` (documents), `quick.ai`, `quick.socket()`
(realtime/multiplayer), `quick.files`, `quick.query()` (read-only BigQuery).
Data/files/realtime are scoped per-site (per hostname). Full reference:
`.claude/skills/quick/SKILL.md`.

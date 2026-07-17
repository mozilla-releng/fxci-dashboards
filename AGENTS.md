# Firefox-CI Dashboards

[Observable Framework](https://observablehq.com/framework/) site — source in
`src/` (`src/*.md` pages, `src/data/*.js` loaders), builds to `dist/` —
deployed to Mozilla's [Quick](https://quick.mozilla.cloud/) platform as
static, SSO-gated hosting. No `quick.js` client SDK is used: this is
build-time snapshots of STMO data, not a live app.

## Adding a dashboard

1. Create or find the STMO ([sql.telemetry.mozilla.org](https://sql.telemetry.mozilla.org))
   query. Grab its own API key (query page → API Key — not your personal
   key; each query has one scoped to just its own cached results) and add it
   as a `production` environment secret named `REDASH_API_KEY_<NAME>` (see
   the README for the `gh secret set` command).
2. Add a row to `src/data/_queries.yaml` — the only place the query-to-secret
   mapping is documented, since the SQL itself lives on STMO, not in this
   repo. The shared data loader (`src/data/[name].json.js`) then produces
   `data/<name>.json` for it automatically; no new loader file needed.
3. Add (or extend) `src/<name>.md` that reads
   `FileAttachment("data/<name>.json").json()` and renders it with `Plot` /
   `Inputs` (implicit globals, no import needed). A page can pull from more
   than one query — see `gecko2github.md`, which combines three.
4. Add a `{name, path}` entry to `pages` in `observablehq.config.js` so it
   shows up in the sidebar (only needed for a genuinely new page — not for a
   new query feeding an existing one).
5. `npm run build` must pass.

Files/dirs starting with `_` (e.g. `_stmo.js`, `_queries.yaml`) are helpers,
not pages. `src/queue-health.md` / `src/data/queue-pending.json.js` are a
template with a placeholder query id (`0`) — expected to fail the build until
pointed at a real query.

## Local dev & auth

```sh
export REDASH_API_KEY=...   # personal key; fine for local dev (see _stmo.js)
npm ci
npm run dev                 # http://localhost:3000, hot-reloads
```

CI instead uses a dedicated per-query key (`REDASH_API_KEY_<LOADER_NAME>`,
one per row in `src/data/_queries.md`) set as a `production` GitHub
environment secret — see the README for the `gh secret set` command.

`npm run build` is the CI gate: fails on loader errors (missing API key env
var, bad query id, network/auth) or `.md`/import parse errors. It does **not**
fail on a runtime error inside a page's reactive JS block — those render
inline instead — so put data-shape assertions in loaders.

## Build & deploy

    npm run build
    quick deploy ./dist fxci

- Deploy `dist/` only — never the repo root or `src/`.
- Don't add a top-level `index.html`; Framework generates one from `src/index.md`.
- CI mirrors this: `.github/workflows/deploy.yml` builds then deploys on push
  to `main` and on an hourly schedule (clearing the loader cache first). It
  runs under the `production` GitHub environment and needs one
  `REDASH_API_KEY_<LOADER_NAME>` secret per query — see `src/data/_queries.md`.
- Site name is fixed as `fxci`. Also useful: `quick list`, `quick open fxci`.

## Quick client SDK can be used

Add `<script src="/quick.js"></script>` and use the global `quick` object —
`quick.me()`, `quick.data` (key/value, atomic ops, live `subscribe`),
`quick.db.collection()` (documents), `quick.ai`, `quick.socket()`
(realtime/multiplayer), `quick.files`, `quick.query()` (read-only BigQuery).
Data/files/realtime are scoped per-site (per hostname). Full reference:
`.claude/skills/quick/SKILL.md`.

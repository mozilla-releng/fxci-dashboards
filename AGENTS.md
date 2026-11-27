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
   repo. The shared data loader (`src/data/[name].parquet.js`) then produces
   `data/<name>.parquet` for it automatically; no new loader file needed.
   Output is Parquet rather than JSON since some of these queries are large
   enough (tens of MB) that plain JSON loads fine from the local dev server
   but fails to fetch once deployed — Parquet's columnar encoding shrinks
   that dramatically. The row may also list the `columns` the page reads and
   the `minRows` of a healthy result: the build fails when the result lacks a
   column or is shorter, so the last good site stays up instead of an empty
   dashboard being deployed.
3. Add (or extend) `src/<name>.md` that reads
   `(await FileAttachment("data/<name>.parquet").parquet()).toArray()` and
   renders it with `Plot` / `Inputs` (implicit globals, no import needed).
   `.toArray()` gives back plain row objects, so the rest of the page's code
   doesn't need to know the data ever passed through Arrow/Parquet. A page
   can pull from more than one query — see `gecko2github.md`, which combines
   three.
4. Add a `{name, path}` entry to `pages` in `observablehq.config.js` so it
   shows up in the sidebar (only needed for a genuinely new page — not for a
   new query feeding an existing one).
5. `npm run build` must pass.

Files/dirs starting with `_` (e.g. `_stmo.js`, `_queries.yaml`) are helpers,
not pages.

## Local dev & auth

```sh
export REDASH_API_KEY=...   # personal key; fine for local dev (see _stmo.js)
npm ci
npm run dev                 # http://localhost:3000, hot-reloads
```

Before running `npm run dev`, check whether one is already running (e.g.
`lsof -i :3000` or `ss -ltnp | grep 3000`) — there's often already an
instance up with a browser attached to it. Reuse that one instead of
starting a second instance on the same port.

To verify a change actually renders correctly — not just that `npm run
build` passes, which does **not** catch a runtime error inside a page's
reactive JS block (see below) — drive the running dev server with
Playwright over CDP rather than poking at it by hand or touching the user's
own browser tabs. Launch a disposable, separate headless browser (its own
`--remote-debugging-port` and `--user-data-dir`, e.g. under `/tmp`), connect
with `chromium.connectOverCDP("http://localhost:<port>")`, then navigate to
`http://localhost:3000/<page>`. From there, script things like: reading
`page.url()` after changing a filter to confirm URL params sync, checking
`document.querySelectorAll("svg path")` bounding rects for absurdly large
values (a real bug this caught: `percent: true` combined with an explicit
`domain` in Observable Plot silently sends a chart's marks off-canvas), and
capturing screenshots for layout review. Kill the disposable browser when
done.

CI instead uses a dedicated per-query key (`REDASH_API_KEY_<LOADER_NAME>`,
one per row in `src/data/_queries.yaml`) set as a `production` GitHub
environment secret — see the README for the `gh secret set` command. That
secret also needs adding to the `env:` block of the build step in
`.github/workflows/deploy.yml`; a `_queries.yaml` row alone isn't enough
since secrets are passed through explicitly, not enumerated automatically.

`npm run build` is the CI gate: fails on loader errors (missing API key env
var, bad query id, network/auth) or `.md`/import parse errors. It does **not**
fail on a runtime error inside a page's reactive JS block — those render
inline instead — so put data-shape assertions in loaders.

## Tests

`npm test` runs the unit tests (`test/unit/`). `npm run test:perf` builds the
site from fixtures and checks the pages in a browser; the README says what it
checks and how to re-record it.

- A page that is added to `test/perf/scenarios.js` needs a table in
  `scripts/make-fixtures.js` for each of its queries, with the columns of the
  real query. A query without one builds as an empty result.
- Never write fixtures into `src/data`: a static file there beats the data
  loader, and would replace real data in a dev server or a deploy. Fixtures are
  read through `STMO_FIXTURES_DIR`, which `src/data/_stmo.js` refuses to honour
  in a deploy.
- `test:perf` runs a browser, which a sandbox may refuse to start; run it outside
  the sandbox if it does, one command at a time.

## Build & deploy

    npm run build
    quick deploy ./dist fxci

- Deploy `dist/` only — never the repo root or `src/`.
- Don't add a top-level `index.html`; Framework generates one from `src/index.md`.
- CI mirrors this: `.github/workflows/deploy.yml` builds then deploys on push
  to `main` and on an hourly schedule (clearing the loader cache first). It
  runs under the `production` GitHub environment and needs one
  `REDASH_API_KEY_<LOADER_NAME>` secret per query — see `src/data/_queries.yaml`.
- Site name is fixed as `fxci`. Also useful: `quick list`, `quick open fxci`.

## Quick client SDK can be used

Add `<script src="/quick.js"></script>` and use the global `quick` object —
`quick.me()`, `quick.data` (key/value, atomic ops, live `subscribe`),
`quick.db.collection()` (documents), `quick.ai`, `quick.socket()`
(realtime/multiplayer), `quick.files`, `quick.query()` (read-only BigQuery).
Data/files/realtime are scoped per-site (per hostname). Full reference:
`.claude/skills/quick/SKILL.md`.

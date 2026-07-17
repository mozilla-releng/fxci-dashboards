# STMO query registry

Not a page (leading underscore) — a reference table of which STMO (Redash)
query backs each data loader. The SQL itself lives on
[sql.telemetry.mozilla.org](https://sql.telemetry.mozilla.org), authored via
the web UI or `stmo-cli`; it is intentionally **not** checked into this repo.

| Loader | STMO query | Query ID | STMO URL |
|---|---|---|---|
| `data/gecko2github-trend.json.js` | Gecko2Github: daily hg/git VCS time percentiles | `123300` | <https://sql.telemetry.mozilla.org/queries/123300> |
| `data/gecko2github-workerpool.json.js` | Gecko2Github: median clone time by worker pool | `123299` | <https://sql.telemetry.mozilla.org/queries/123299> |
| `data/gecko2github-gittasks.json.js` | Gecko2Github: per-task detail for git checkout tasks | `123298` | <https://sql.telemetry.mozilla.org/queries/123298> |

When you add a dashboard, create/find its STMO query first, then add a row
here with the real id and URL.

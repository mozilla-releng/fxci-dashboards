# STMO query registry

Not a page (leading underscore) — a reference table of which STMO (Redash)
query backs each data loader. The SQL itself lives on
[sql.telemetry.mozilla.org](https://sql.telemetry.mozilla.org), authored via
the web UI or `stmo-cli`; it is intentionally **not** checked into this repo.

| Loader | STMO query | Query ID | STMO URL |
|---|---|---|---|

When you add a dashboard, create/find its STMO query first, then add a row
here with the real id and URL.

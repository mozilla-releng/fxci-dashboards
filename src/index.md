---
title: Overview
---

# Firefox-CI Dashboards

Static dashboards about the Firefox-CI Taskcluster instance. Data is a
build-time snapshot fetched from cached
[STMO](https://sql.telemetry.mozilla.org) (Redash) query results and refreshed
on a schedule. See the [source
repo](https://github.com/mozilla-releng/fxci-dashboards) for more details.

- [Checkout Caches](./checkout-caches) — cache hit/miss rates by worker pool
  for VCS checkouts.
- [Gecko2Github Migration](./gecko2github) — hg vs git VCS checkout time for
  Gecko tasks, tracking the migration to Git/GitHub.

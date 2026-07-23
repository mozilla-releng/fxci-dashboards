---
title: Gecko2Github Migration
toc: false
---

# Gecko2Github Migration

Tracks Gecko's migration from Mercurial (`hg.mozilla.org`) to Git/GitHub by
comparing VCS checkout (clone/pull) times for hg vs git, across Gecko tasks.
Snapshot taken at build time from STMO — see `data/_queries.yaml` for which
queries back this page.

```js
const trend = await FileAttachment("data/gecko2github-trend.json").json();
const workerPool = await FileAttachment("data/gecko2github-workerpool.json").json();
const gitTasks = await FileAttachment("data/gecko2github-gittasks.json").json();
```

```js
const VCS_TYPES = ["hg", "git"];
const VCS_COLOR = {domain: VCS_TYPES, range: ["#2ca02c", "#1f77b4"]};

function fmtNumber(v) {
  return v == null ? "—" : v.toLocaleString("en-US");
}

function fmtMinutes(v) {
  return v == null ? "—" : v.toFixed(2);
}
```

Filters apply to every chart and stat on this page. Drag on the volume chart
below to restrict the date range; click it to clear.

<style>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1.25rem;
  padding: 0.85rem 1.1rem;
  margin: 1rem 0 1.5rem;
  border: solid 1px var(--theme-foreground-faintest, #ddd);
  border-radius: 10px;
  background: var(--theme-background-alt, rgba(128, 128, 128, 0.06));
}
.filter-bar > div {
  flex: 0 1 160px;
  min-width: 0;
}
.filter-bar form {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.filter-bar form label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--theme-foreground-muted, #888);
  width: auto;
}
.filter-bar form select {
  width: 100%;
  min-width: 0;
}
.filter-daterange {
  flex: 0 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.filter-daterange-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--theme-foreground-muted, #888);
  white-space: nowrap;
}
.filter-daterange-value-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: nowrap;
}
.filter-daterange-value {
  font-size: 0.9rem;
  white-space: nowrap;
}
.filter-reset {
  font: inherit;
  font-size: 0.8rem;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  border: solid 1px var(--theme-foreground-faint, #ccc);
  background: var(--theme-background, #fff);
  cursor: pointer;
}
/* Always occupies its layout space — toggling via visibility rather than
   conditional rendering means the date value never shifts when the button
   appears/disappears. */
.filter-reset:disabled {
  visibility: hidden;
}
.filter-reset:hover {
  background: var(--theme-background-alt, rgba(128, 128, 128, 0.1));
}
</style>

```js
const projects = [...new Set([...trend, ...workerPool, ...gitTasks].map((d) => d.project))].sort();
const kinds = [...new Set([...trend, ...workerPool, ...gitTasks].map((d) => d.kind))].filter((k) => k != null).sort();
const oses = [...new Set([...trend, ...workerPool, ...gitTasks].map((d) => d.os))].filter((o) => o != null).sort();

// Seeds filters from the URL (?project=&kind=&os=&from=&to=) so a link with
// query params reproduces the same view. Only read once at load — this page
// has no client-side router, so there's nothing to react to on navigation.
const urlParams = new URLSearchParams(window.location.search);
function paramOr(name, allowed) {
  const v = urlParams.get(name);
  return v && allowed.includes(v) ? v : "All";
}

// trend/workerPool carry `day`; gitTasks only has a per-task `started`
// timestamp, so pull its date portion in too — all three are bound by the
// same rolling STMO query window, so the min/max should already agree.
const availableDays = [
  ...trend.map((d) => d.day),
  ...workerPool.map((d) => d.day),
  ...gitTasks.map((d) => d.started?.slice(0, 10))
].filter(Boolean).sort();
const minDay = availableDays[0];
const maxDay = availableDays[availableDays.length - 1];

// Built without view() so they can be laid out in a custom flex bar below
// instead of Framework's default one-per-line stack.
const projectInput = Inputs.select(["All", ...projects], {label: "Project", value: paramOr("project", projects)});
const kindInput = Inputs.select(["All", ...kinds], {label: "Kind", value: paramOr("kind", kinds)});
const osInput = Inputs.select(["All", ...oses], {label: "OS", value: paramOr("os", oses)});

const project = Generators.input(projectInput);
const kind = Generators.input(kindInput);
const os = Generators.input(osInput);

// Holds the brush-selected [from, to] Dates, or null for "full range". A
// Mutable (rather than a view()-bound input) so setting it from the brush
// handler doesn't require the chart itself to be a form input.
// UTC, not local time — matches the "utc"-typed x scale on the brush chart
// (whose bars are keyed off plain "YYYY-MM-DD" strings, parsed as UTC
// midnight) so a round trip through the URL lands on the same day
// regardless of the viewer's timezone.
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function initialDateRange() {
  const from = urlParams.get("from");
  const to = urlParams.get("to");
  if (!from || !to || from > to || from < minDay || to > maxDay) return null;
  return [new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)];
}
const dateRange = Mutable(initialDateRange());
function setDateRange(v) {
  dateRange.value = v;
}
```

<div class="filter-bar">
  <div>${projectInput}</div>
  <div>${kindInput}</div>
  <div>${osInput}</div>
  <div class="filter-daterange">
    <span class="filter-daterange-label">Date range</span>
    <div class="filter-daterange-value-row">
      <span class="filter-daterange-value">${dateRange ? `${isoDate(dateRange[0])} – ${isoDate(dateRange[1])}` : `${minDay} – ${maxDay}`}</span>
      ${htl.html`<button class="filter-reset" disabled=${!dateRange} onclick=${() => setDateRange(null)}>Reset</button>`}
    </div>
  </div>
</div>

```js
// Keeps the URL in sync with the current filters so the view is linkable/
// bookmarkable. Deliberately its own cell, separate from the one declaring
// the dateRange Mutable — merging them would make this effect's dependency
// on project/kind/os re-run that cell too, recreating (and resetting) the
// Mutable on every filter change.
{
  const params = new URLSearchParams(window.location.search);
  const set = (key, val) => (val ? params.set(key, val) : params.delete(key));
  set("project", project === "All" ? null : project);
  set("kind", kind === "All" ? null : kind);
  set("os", os === "All" ? null : os);
  set("from", dateRange ? isoDate(dateRange[0]) : null);
  set("to", dateRange ? isoDate(dateRange[1]) : null);
  const qs = params.toString();
  history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
}
```

```js
// Defaults to the full available window until the user brushes the volume
// chart. dateRange is trusted as already-ordered/in-range since it's only
// ever set from the brush's own (already-clamped) invert() output.
const [rangeStart, rangeEnd] = dateRange
  ? [isoDate(dateRange[0]), isoDate(dateRange[1])]
  : [minDay, maxDay];

function matchesProjectKindOs(row) {
  return (project === "All" || row.project === project)
    && (kind === "All" || row.kind === kind)
    && (os === "All" || row.os === os);
}

function matches(row) {
  const day = row.day ?? row.started?.slice(0, 10);
  return matchesProjectKindOs(row)
    && (day == null || (day >= rangeStart && day <= rangeEnd));
}

// The volume/picker chart deliberately filters by project/kind/os only, not
// by date — it needs to keep showing the full window so there's always
// something to brush, even after the date range has been narrowed.
const pkoTrend = trend.filter(matchesProjectKindOs);

const filteredTrend = trend.filter(matches);
const filteredWorkerPool = workerPool.filter(matches);
const filteredGitTasks = gitTasks.filter(matches);

const PERCENTILE_FIELDS = ["p50_overall", "p90_overall", "avg_overall", "p50_clone", "p90_clone", "p50_pull", "p90_pull"];

// The queries are pre-aggregated per (day, vcs_type, project, kind, os), so
// once a filter leaves more than one project/kind/os combo per day+vcs_type,
// we have to collapse those rows back down to one per day+vcs_type —
// counts sum, percentiles get a tasks-weighted average (not a true combined
// percentile, but the best available without re-aggregating on raw tasks).
function aggregateTrend(rows) {
  const acc = new Map();
  for (const r of rows) {
    const key = `${r.day}|${r.vcs_type}`;
    const a = acc.get(key) ?? {day: r.day, vcs_type: r.vcs_type, tasks: 0, clones: 0, pulls: 0, weighted: {}};
    a.tasks += r.tasks ?? 0;
    a.clones += r.clones ?? 0;
    a.pulls += r.pulls ?? 0;
    for (const f of PERCENTILE_FIELDS) {
      if (r[f] != null) a.weighted[f] = (a.weighted[f] ?? 0) + r[f] * (r.tasks ?? 0);
    }
    acc.set(key, a);
  }
  return [...acc.values()].map((a) => {
    const row = {day: a.day, vcs_type: a.vcs_type, tasks: a.tasks, clones: a.clones, pulls: a.pulls};
    for (const f of PERCENTILE_FIELDS) row[f] = a.tasks ? a.weighted[f] / a.tasks : null;
    return row;
  });
}

function aggregateWorkerPool(rows) {
  const acc = new Map();
  for (const r of rows) {
    const key = `${r.vcs_type}|${r.worker_pool}`;
    const a = acc.get(key) ?? {vcs_type: r.vcs_type, worker_pool: r.worker_pool, tasks: 0, clones: 0, weighted: {}};
    a.tasks += r.tasks ?? 0;
    a.clones += r.clones ?? 0;
    for (const f of ["p50_clone", "p90_clone", "p50_overall", "p50_pull"]) {
      if (r[f] != null) a.weighted[f] = (a.weighted[f] ?? 0) + r[f] * (r.tasks ?? 0);
    }
    acc.set(key, a);
  }
  return [...acc.values()].map((a) => {
    const row = {vcs_type: a.vcs_type, worker_pool: a.worker_pool, tasks: a.tasks, clones: a.clones};
    for (const f of ["p50_clone", "p90_clone", "p50_overall", "p50_pull"]) row[f] = a.tasks ? a.weighted[f] / a.tasks : null;
    return row;
  });
}

const aggregatedTrend = aggregateTrend(filteredTrend);
const aggregatedWorkerPool = aggregateWorkerPool(filteredWorkerPool);

// Collapses aggregatedTrend's per-day rows down to one per vcs_type, giving
// totals/weighted-averages across the whole selected date range rather than
// a single day's snapshot.
const totalsByType = new Map();
for (const r of aggregatedTrend) {
  const a = totalsByType.get(r.vcs_type) ?? {tasks: 0, weighted: {}};
  a.tasks += r.tasks ?? 0;
  for (const f of PERCENTILE_FIELDS) {
    if (r[f] != null) a.weighted[f] = (a.weighted[f] ?? 0) + r[f] * (r.tasks ?? 0);
  }
  totalsByType.set(r.vcs_type, a);
}

function rangeTotal(type, field) {
  const a = totalsByType.get(type);
  if (!a) return null;
  if (field === "tasks") return a.tasks;
  return a.tasks ? a.weighted[field] / a.tasks : null;
}
```

```js
const pkoAggregatedTrend = aggregateTrend(pkoTrend);

// Doubles as the date-range picker: dragging draws a d3 brush over it, and
// the resulting pixel selection is inverted through the plot's own x scale
// into dates, which get pushed into the dateRange Mutable. It's built from
// pkoAggregatedTrend (project/kind/os filtered, but NOT date filtered) so
// the full window stays visible — and brushable — no matter what's selected.
function dateRangePicker({width} = {}) {
  // rectY's interval-based binning needs an actual Date, not an ISO string —
  // passing a string silently collapses every day into a single bin.
  const rows = pkoAggregatedTrend.map((r) => ({...r, day: new Date(r.day)}));
  const height = 260;
  const plot = Plot.plot({
    title: "Task volume per day — drag to select a date range, click to clear",
    width,
    height,
    x: {type: "utc", label: "Date"},
    y: {label: "Tasks", grid: true},
    color: {...VCS_COLOR, legend: true},
    marks: [
      Plot.rectY(rows, {x: "day", y: "tasks", fill: "vcs_type", interval: "day", tip: true}),
      Plot.ruleY([0])
    ]
  });

  // Plot's color legend renders its own small swatch <svg>s nested inside a
  // wrapper div — querySelector("svg") would grab one of those (depth-first,
  // and the legend comes before the chart in DOM order) instead of the main
  // plot canvas, so scope to a direct child only.
  const svg = plot.tagName === "svg" ? plot : plot.querySelector(":scope > svg");
  const xScale = plot.scale("x");
  const [x0, x1] = xScale.range;
  const plotHeight = +svg.getAttribute("height") || height;

  const brush = d3.brushX()
    .extent([[x0, 0], [x1, plotHeight]])
    .on("end", (event) => {
      // Ignore programmatic moves (sourceEvent is null) — otherwise
      // restoring the visual selection below would re-trigger this handler.
      if (!event.sourceEvent) return;
      setDateRange(event.selection ? event.selection.map(xScale.invert) : null);
    });

  const gBrush = d3.select(svg).append("g").attr("class", "date-brush").call(brush);
  if (dateRange) {
    gBrush.call(brush.move, dateRange.map(xScale.apply));
  }

  return plot;
}
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => dateRangePicker({width}))}
  </div>
</div>

<div class="grid grid-cols-3">
  <div class="card">
    <h2>hg tasks</h2>
    <span class="big">${fmtNumber(rangeTotal("hg", "tasks"))}</span>
  </div>
  <div class="card">
    <h2>hg median VCS time</h2>
    <span class="big">${fmtMinutes(rangeTotal("hg", "p50_overall"))}</span>
    <span class="muted">minutes</span>
  </div>
  <div class="card">
    <h2>hg avg VCS time</h2>
    <span class="big">${fmtMinutes(rangeTotal("hg", "avg_overall"))}</span>
    <span class="muted">minutes</span>
  </div>
  <div class="card">
    <h2>git tasks</h2>
    <span class="big">${fmtNumber(rangeTotal("git", "tasks"))}</span>
  </div>
  <div class="card">
    <h2>git median VCS time</h2>
    <span class="big">${fmtMinutes(rangeTotal("git", "p50_overall"))}</span>
    <span class="muted">minutes</span>
  </div>
  <div class="card">
    <h2>git avg VCS time</h2>
    <span class="big">${fmtMinutes(rangeTotal("git", "avg_overall"))}</span>
    <span class="muted">minutes</span>
  </div>
</div>

```js
function trendChart(metricPrefix, yLabel, title, {width} = {}) {
  const p50 = aggregatedTrend
    .filter((r) => r[`p50_${metricPrefix}`] != null)
    .map((r) => ({day: r.day, vcs_type: r.vcs_type, value: r[`p50_${metricPrefix}`]}));
  const p90 = aggregatedTrend
    .filter((r) => r[`p90_${metricPrefix}`] != null)
    .map((r) => ({day: r.day, vcs_type: r.vcs_type, value: r[`p90_${metricPrefix}`]}));
  return Plot.plot({
    title,
    width,
    height: 300,
    x: {type: "utc", label: "Date"},
    y: {label: yLabel, grid: true},
    color: {...VCS_COLOR, legend: true},
    marks: [
      Plot.lineY(p50, {x: "day", y: "value", stroke: "vcs_type", tip: true}),
      Plot.lineY(p90, {x: "day", y: "value", stroke: "vcs_type", strokeDasharray: "2,2", strokeOpacity: 0.6}),
      Plot.ruleY([0])
    ]
  });
}
```

<div class="grid grid-cols-2">
  <div class="card">
    <h2>Clone time <span class="muted">— solid p50, dashed p90</span></h2>
    ${resize((width) => trendChart("clone", "Clone time (minutes)", null, {width}))}
  </div>
  <div class="card">
    <h2>Overall VCS time <span class="muted">— solid p50, dashed p90</span></h2>
    ${resize((width) => trendChart("overall", "Overall VCS time (minutes)", null, {width}))}
  </div>
</div>

```js
// Restricted to pools where git already has data — the point is to compare
// hg vs git on the same infra, not to list every hg-only pool.
function workerPoolChart({width} = {}) {
  const gitPools = new Set(
    aggregatedWorkerPool.filter((r) => r.vcs_type === "git").map((r) => r.worker_pool)
  );
  const pools = [...gitPools].sort((a, b) => {
    const ta = aggregatedWorkerPool.find((r) => r.worker_pool === a && r.vcs_type === "git")?.tasks ?? 0;
    const tb = aggregatedWorkerPool.find((r) => r.worker_pool === b && r.vcs_type === "git")?.tasks ?? 0;
    return tb - ta;
  });
  if (!pools.length) return htl.html`<p class="muted">No git worker pools with data yet.</p>`;
  const rows = aggregatedWorkerPool.filter((r) => pools.includes(r.worker_pool));
  return Plot.plot({
    title: "Median clone time by worker pool (pools with git data)",
    width,
    height: 320,
    marginBottom: 70,
    x: {axis: null},
    fx: {label: null, domain: pools, tickRotate: -30},
    y: {label: "Median clone time (minutes)", grid: true},
    color: {...VCS_COLOR, legend: true},
    marks: [
      Plot.barY(rows, {x: "vcs_type", y: "p50_clone", fill: "vcs_type", fx: "worker_pool", tip: true}),
      Plot.ruleY([0])
    ]
  });
}
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => workerPoolChart({width}))}
  </div>
</div>

## Git checkout tasks

Per-task detail for tasks checking out via Git. Click a point to open its profile.

```js
const TC = "https://firefox-ci-tc.services.mozilla.com";

// Which Firefox Profiler instance to open profiles in. Defaults to the
// production profiler; ?profiler= overrides it (handy for testing a deploy
// preview).
function profilerOrigin() {
  const override = new URL(window.location.href).searchParams.get("profiler");
  if (!override) return "https://profiler.firefox.com";
  return override.includes("://") ? override.replace(/\/$/, "") : `https://${override}`;
}

// The web-server profile endpoint synthesizes a profile from the task's live
// log (as marker data) plus any resource-usage artifact, for any task kind.
function taskProfilerUrl(taskId, runId, label) {
  const base = `${TC}/api/web-server/v1/task/${taskId}/profile`;
  const name = `${label ?? "task"} (${taskId}.${runId ?? 0})`;
  return `${profilerOrigin()}/from-url/${encodeURIComponent(base)}/marker-chart/?globalTrackOrder=0&profileName=${encodeURIComponent(name)}&thread=0&v=17`;
}

function gitScatterChart({width} = {}) {
  if (!gitTasks.length) return htl.html`<p class="muted">No data for this chart.</p>`;
  if (!filteredGitTasks.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  const rows = filteredGitTasks.map((r) => ({
    ...r,
    checkoutType: r.clone_minutes != null ? "clone" : "pull"
  }));
  return Plot.plot({
    title: "Git checkout tasks",
    width,
    height: 380,
    marginBottom: 60,
    x: {type: "utc", label: "Started"},
    y: {label: "VCS (minutes)", grid: true},
    color: {legend: true, label: "Project"},
    symbol: {legend: true, label: "Checkout type"},
    marks: [
      Plot.dot(rows, {
        x: "started",
        y: "overall_minutes",
        stroke: "project",
        symbol: "checkoutType",
        r: 3.5,
        opacity: 0.7,
        href: (d) => taskProfilerUrl(d.task_id, d.run_id, d.project),
        target: "_blank",
        channels: {platform: "platform", checkout: "checkoutType"},
        tip: {format: {stroke: true, symbol: true, x: true, y: true}}
      })
    ]
  });
}
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => gitScatterChart({width}))}
  </div>
</div>

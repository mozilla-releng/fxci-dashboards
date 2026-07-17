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

const days = [...new Set(trend.map((d) => d.day))].sort();
const byDayType = new Map(trend.map((r) => [`${r.day}|${r.vcs_type}`, r]));

// Counters all track the most recent day with data for that type (skips days
// where that type happened not to record any tasks).
function latest(type, field) {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = byDayType.get(`${days[i]}|${type}`)?.[field];
    if (v != null) return v;
  }
  return null;
}

function fmtNumber(v) {
  return v == null ? "—" : v.toLocaleString("en-US");
}

function fmtMinutes(v) {
  return v == null ? "—" : v.toFixed(2);
}
```

<div class="grid grid-cols-3">
  <div class="card">
    <h2>hg tasks</h2>
    <span class="big">${fmtNumber(latest("hg", "tasks"))}</span>
    <span class="muted">latest day</span>
  </div>
  <div class="card">
    <h2>hg median VCS time</h2>
    <span class="big">${fmtMinutes(latest("hg", "p50_overall"))}</span>
    <span class="muted">minutes (latest day)</span>
  </div>
  <div class="card">
    <h2>hg avg VCS time</h2>
    <span class="big">${fmtMinutes(latest("hg", "avg_overall"))}</span>
    <span class="muted">minutes (latest day)</span>
  </div>
  <div class="card">
    <h2>git tasks</h2>
    <span class="big">${fmtNumber(latest("git", "tasks"))}</span>
    <span class="muted">latest day</span>
  </div>
  <div class="card">
    <h2>git median VCS time</h2>
    <span class="big">${fmtMinutes(latest("git", "p50_overall"))}</span>
    <span class="muted">minutes (latest day)</span>
  </div>
  <div class="card">
    <h2>git avg VCS time</h2>
    <span class="big">${fmtMinutes(latest("git", "avg_overall"))}</span>
    <span class="muted">minutes (latest day)</span>
  </div>
</div>

```js
function volumeChart({width} = {}) {
  // rectY's interval-based binning needs an actual Date, not an ISO string —
  // passing a string silently collapses every day into a single bin.
  const rows = trend.map((r) => ({...r, day: new Date(r.day)}));
  return Plot.plot({
    title: "Task volume per day",
    width,
    height: 260,
    x: {type: "utc", label: "Date"},
    y: {label: "Tasks", grid: true},
    color: {...VCS_COLOR, legend: true},
    marks: [
      Plot.rectY(rows, {x: "day", y: "tasks", fill: "vcs_type", interval: "day", tip: true}),
      Plot.ruleY([0])
    ]
  });
}
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => volumeChart({width}))}
  </div>
</div>

```js
function trendChart(metricPrefix, yLabel, title, {width} = {}) {
  const p50 = trend
    .filter((r) => r[`p50_${metricPrefix}`] != null)
    .map((r) => ({day: r.day, vcs_type: r.vcs_type, value: r[`p50_${metricPrefix}`]}));
  const p90 = trend
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
    workerPool.filter((r) => r.vcs_type === "git").map((r) => r.worker_pool)
  );
  const pools = [...gitPools].sort((a, b) => {
    const ta = workerPool.find((r) => r.worker_pool === a && r.vcs_type === "git")?.tasks ?? 0;
    const tb = workerPool.find((r) => r.worker_pool === b && r.vcs_type === "git")?.tasks ?? 0;
    return tb - ta;
  });
  if (!pools.length) return htl.html`<p class="muted">No git worker pools with data yet.</p>`;
  const rows = workerPool.filter((r) => pools.includes(r.worker_pool));
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

Per-task detail for the (currently small) set of gecko tasks checking out via
Git. Click a point to open its profile.

```js
const projects = [...new Set(gitTasks.map((d) => d.project))].sort();
const project = view(
  Inputs.select(["All", ...projects], {label: "Project", value: "All"})
);
```

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
  const filtered = project === "All" ? gitTasks : gitTasks.filter((r) => r.project === project);
  if (!filtered.length) return htl.html`<p class="muted">No data for this project.</p>`;
  const rows = filtered.map((r) => ({
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

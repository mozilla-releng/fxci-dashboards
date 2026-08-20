---
title: MacOS Test Pools
toc: false
---

# MacOS Test Pools

How hard the Firefox-CI MacOS *test* pools are being worked over the last 90
days — the Intel Mac minis (`-r8`) and the Apple Silicon M4s (`-m4`):

| Pool | Hardware |
| --- | --- |
| `gecko-t-osx-1015-r8` | Intel Mac mini, MacOS 10.15 |
| `gecko-t-osx-1400-r8` | Intel Mac mini, MacOS 14 |
| `gecko-t-osx-1500-m4` | Apple Silicon M4, MacOS 15 |
| `gecko-t-osx-1500-m-vms` | Apple Silicon VMs, MacOS 15 |

What the metrics mean:

- **Task runs** — runs that actually started on a machine. Runs that resolve
  as exceptions without ever starting (deadline exceeded, superseded, worker
  shutdown) are queue pressure rather than pool usage, so they're excluded. A
  retried task counts once per run, since each run occupies a machine.
- **Machine-hours** — total `resolved - started` across those runs: how long
  machines were actually busy.
- **Active machines** — distinct workers that ran at least one task that day.
  It's a proxy for fleet size, not an inventory: `fxci.worker_usage` only
  covers cloud (GCP/Azure) workers, so there's no uptime feed for this
  on-prem hardware.
- **Est. utilization** — machine-hours ÷ (active machines × 24h). An
  *estimate*: a machine that was offline for part of the day still counts a
  full 24h of capacity, while one that ran nothing at all doesn't count at
  all. Runs are attributed to the day they started, so a pool-day can read
  slightly over 100% when a long run crosses midnight.
- **Test suite / variant** — the breakdown dimension, written as
  `{test_suite}/{test_variant}`. The variant is left off when a task doesn't
  have one (the default, unmodified run — about 82% of tasks), and for the
  non-test work these pools also pick up the task *kind* stands in for the
  missing suite (`perftest`, `source-test`, `update-test`, …).
- **Trust domain / project** — where the work came from, written as
  `{trust_domain}/{project}`. The trust domain is the CI security domain
  (`gecko`, `comm`, `enterprise`); the project is the repository or branch
  (`autoland`, `try`, `mozilla-beta`, …). Always shown as the pair, because a
  project name isn't unique on its own — `(untagged)` occurs under two
  different domains. Tasks that reach these pools carrying no taskgraph tags
  (almost all of them `enterprise-level-1`) still get a trust domain, which is
  recovered from the scheduler id, but have no branch to attribute to and land
  in `(untagged)`.

Runs are bucketed by the day they started, and only complete days are shown —
today is still accumulating. See `data/_queries.yaml` for the queries that
back this page.

```js
const rows = await FileAttachment("data/macos-test-pools-usage.json").json();
```

```js
// Display metadata per pool. Pools not listed here still render (the query's
// pool list is the source of truth) — they just fall back to a bare name, a
// grey series and an "Other" hardware group.
const POOL_META = new Map([
  ["releng-hardware/gecko-t-osx-1015-r8", {label: "osx-1015-r8", hardware: "Intel (r8)", color: "#d62728"}],
  ["releng-hardware/gecko-t-osx-1400-r8", {label: "osx-1400-r8", hardware: "Intel (r8)", color: "#ff7f0e"}],
  ["releng-hardware/gecko-t-osx-1500-m4", {label: "osx-1500-m4", hardware: "Apple Silicon (m4)", color: "#1f77b4"}],
  ["releng-hardware/gecko-t-osx-1500-m-vms", {label: "osx-1500-m-vms", hardware: "Apple Silicon (m4 VMs)", color: "#9467bd"}]
]);
const HARDWARE_ORDER = ["Intel (r8)", "Apple Silicon (m4)", "Apple Silicon (m4 VMs)", "Other"];
const HARDWARE_COLOR = new Map([
  ["Intel (r8)", "#ff7f0e"],
  ["Apple Silicon (m4)", "#1f77b4"],
  ["Apple Silicon (m4 VMs)", "#9467bd"],
  ["Other", "#7f7f7f"]
]);
const FALLBACK_COLOR = "#7f7f7f";

const SERIES_COLOR = new Map([
  ...[...POOL_META.values()].map((m) => [m.label, m.color]),
  ...HARDWARE_COLOR
]);

function poolLabel(pool) {
  return POOL_META.get(pool)?.label ?? pool.split("/").pop();
}
function poolHardware(pool) {
  return POOL_META.get(pool)?.hardware ?? "Other";
}
function seriesColor(series) {
  return SERIES_COLOR.get(series) ?? FALLBACK_COLOR;
}

function fmtNumber(v) {
  return v == null ? "—" : Math.round(v).toLocaleString("en-US");
}
function fmtDecimal(v) {
  return v == null ? "—" : v.toLocaleString("en-US", {maximumFractionDigits: 1});
}
function fmtPercent(v) {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}
```

```js
// Collapses the query's (day, pool, test_suite_variant) grain to one row per
// (day, pool). tasks/task_hours sum, but pool_workers is a
// COUNT(DISTINCT worker_id) already computed at pool-day grain and repeated
// on every test_suite_variant row, so it's taken rather than added — summing it
// would multiply the fleet by the number of suites it ran.
function poolDayTotals(inputRows) {
  const acc = new Map();
  for (const r of inputRows) {
    const key = `${r.day} ${r.worker_pool}`;
    const a = acc.get(key) ?? {day: r.day, worker_pool: r.worker_pool, tasks: 0, taskHours: 0, workers: 0, unresolved: 0};
    a.tasks += r.tasks ?? 0;
    a.taskHours += r.task_hours ?? 0;
    a.unresolved += r.unresolved_tasks ?? 0;
    a.workers = Math.max(a.workers, r.pool_workers ?? 0);
    acc.set(key, a);
  }
  return [...acc.values()];
}

// Rolls pool-days up into whatever series the user picked (one pool, or a
// hardware group spanning several). Machine counts *are* summed here: no
// machine serves two of these pools on the same day, so the per-pool distinct
// worker counts are disjoint and add up to the group's fleet.
function seriesByDay(poolDays, seriesOf) {
  const acc = new Map();
  for (const d of poolDays) {
    const series = seriesOf(d.worker_pool);
    const key = `${d.day} ${series}`;
    const a = acc.get(key) ?? {day: d.day, series, tasks: 0, taskHours: 0, workers: 0};
    a.tasks += d.tasks;
    a.taskHours += d.taskHours;
    a.workers += d.workers;
    acc.set(key, a);
  }
  return [...acc.values()]
    .map((a) => ({...a, utilization: a.workers > 0 ? a.taskHours / (a.workers * 24) : null}))
    .sort((a, b) => a.day.localeCompare(b.day) || a.series.localeCompare(b.series));
}

function poolSummary(poolDays) {
  const acc = new Map();
  for (const d of poolDays) {
    const a = acc.get(d.worker_pool) ?? {
      pool: poolLabel(d.worker_pool),
      hardware: poolHardware(d.worker_pool),
      tasks: 0,
      taskHours: 0,
      machineDays: 0,
      days: 0,
      peakMachines: 0
    };
    a.tasks += d.tasks;
    a.taskHours += d.taskHours;
    a.machineDays += d.workers;
    a.days += 1;
    a.peakMachines = Math.max(a.peakMachines, d.workers);
    acc.set(d.worker_pool, a);
  }
  return [...acc.values()]
    .map((a) => ({
      pool: a.pool,
      hardware: a.hardware,
      tasks: a.tasks,
      tasksPerDay: a.days ? a.tasks / a.days : null,
      taskHours: a.taskHours,
      avgMachines: a.days ? a.machineDays / a.days : null,
      peakMachines: a.peakMachines,
      // Weighted over the range: total busy hours over total capacity hours,
      // rather than a mean of the per-day rates, so a day with a shrunken
      // fleet can't skew it.
      utilization: a.machineDays ? a.taskHours / (a.machineDays * 24) : null
    }))
    .sort((a, b) => b.taskHours - a.taskHours);
}

function aggregateBySuite(inputRows, seriesOf) {
  const acc = new Map();
  for (const r of inputRows) {
    const series = seriesOf(r.worker_pool);
    const key = `${r.test_suite_variant} ${series}`;
    const a = acc.get(key) ?? {test_suite_variant: r.test_suite_variant, series, tasks: 0, taskHours: 0};
    a.tasks += r.tasks ?? 0;
    a.taskHours += r.task_hours ?? 0;
    acc.set(key, a);
  }
  return [...acc.values()];
}
```

Filters apply to every chart, stat and table below. Drag on the task-runs
chart to restrict the date range; click it to clear.

<style>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 1.25rem;
  padding: 0.85rem 1.1rem;
  margin: 1rem 0 1.5rem;
  border: solid 1px var(--theme-foreground-faintest, #ddd);
  border-radius: 10px;
  background: var(--theme-background-alt, rgba(128, 128, 128, 0.06));
}
.filter-bar > div {
  flex: 0 1 auto;
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
.filter-reset:disabled {
  visibility: hidden;
}
.filter-reset:hover {
  background: var(--theme-background-alt, rgba(128, 128, 128, 0.1));
}
</style>

```js
// Seeds filters from the URL (?pools=&group=&from=&to=) so a link with query
// params reproduces the same view. Only read once at load — this page has no
// client-side router, so there's nothing to react to on navigation.
const urlParams = new URLSearchParams(window.location.search);

const allDays = [...new Set(rows.map((r) => r.day))].filter(Boolean).sort();
const minDay = allDays[0];
const maxDay = allDays[allDays.length - 1];

// POOL_META's insertion order gives the pools a meaningful order (oldest
// Intel through newest Apple Silicon) rather than an alphabetical one; any
// pool the query grew that isn't in POOL_META is appended.
const presentPools = new Set(rows.map((r) => r.worker_pool));
const orderedPools = [
  ...[...POOL_META.keys()].filter((p) => presentPools.has(p)),
  ...[...presentPools].filter((p) => !POOL_META.has(p)).sort()
];
const poolOptions = orderedPools.map(poolLabel);

// Three distinct states, which is why null/""/unknown can't be collapsed:
// an absent ?pools= means "nothing expressed, default to all"; a present but
// empty ?pools= means "the user deselected everything"; and a param naming
// only pools this query no longer returns falls back to all rather than a
// dead-end empty view — honouring that as "none selected" would also make the
// sync cell rewrite the URL to ?pools=, destroying the link that was shared.
const poolsParam = urlParams.get("pools");
let urlPools = null;
if (poolsParam === "") {
  urlPools = [];
} else if (poolsParam !== null) {
  const known = poolsParam.split(",").filter((p) => poolOptions.includes(p));
  urlPools = known.length ? known : null;
}
const poolInput = Inputs.checkbox(poolOptions, {label: "Pools", value: urlPools ?? poolOptions});
const selectedLabels = Generators.input(poolInput);

const GROUPINGS = ["Pool", "Hardware"];
const urlGroup = urlParams.get("group");
const groupInput = Inputs.select(GROUPINGS, {label: "Group by", value: GROUPINGS.includes(urlGroup) ? urlGroup : "Pool"});
const grouping = Generators.input(groupInput);

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
// Parsed strictly rather than compared as strings: a plausible-looking
// ?from=2026-06-1 passes a lexical range check but yields an Invalid Date,
// and isoDate() then throws out of the cell that derives every filtered
// dataset on the page — taking all the stats, charts and tables with it.
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function parseDay(s) {
  if (!s || !DAY_PATTERN.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const windowStart = parseDay(minDay);
const windowEnd = parseDay(maxDay);
function clampDay(d) {
  return d < windowStart ? windowStart : d > windowEnd ? windowEnd : d;
}
function initialDateRange() {
  // Out-of-window edges are clamped, not rejected: brushing to the right edge
  // of the chart yields a `to` one day past maxDay (rectY's "day" interval
  // extends the x domain past the last bar), and throwing that away would
  // silently drop the very range a shared link was carrying.
  const from = parseDay(urlParams.get("from"));
  const to = parseDay(urlParams.get("to"));
  if (!from || !to || from > to || to < windowStart || from > windowEnd) return null;
  return [clampDay(from), clampDay(to)];
}
const dateRange = Mutable(initialDateRange());
function setDateRange(v) {
  // Clamped on the way in too — this is the only place brush output enters the
  // page, so it's where the label, the URL and the row filter are kept in
  // agreement with the actual data window.
  dateRange.value = v ? [clampDay(v[0]), clampDay(v[1])] : null;
}
```

<div class="filter-bar">
  <div>${poolInput}</div>
  <div>${groupInput}</div>
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
// on the pool/grouping inputs re-run that cell too, recreating (and
// resetting) the Mutable on every filter change.
{
  const params = new URLSearchParams(window.location.search);
  const set = (key, val) => (val ? params.set(key, val) : params.delete(key));
  // Written explicitly rather than through `set`, which treats the empty
  // string as "drop the param" and would turn a zero-pool view back into the
  // default all-pools one on reload.
  if (selectedLabels.length === poolOptions.length) params.delete("pools");
  else params.set("pools", selectedLabels.join(","));
  set("group", grouping === "Pool" ? null : grouping);
  set("from", dateRange ? isoDate(dateRange[0]) : null);
  set("to", dateRange ? isoDate(dateRange[1]) : null);
  const qs = params.toString();
  history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
}
```

```js
// Defaults to the full available window until the user brushes the task-runs
// chart. dateRange is trusted as already-ordered/in-range since it's only
// ever set from the brush's own (already-clamped) invert() output.
const [rangeStart, rangeEnd] = dateRange
  ? [isoDate(dateRange[0]), isoDate(dateRange[1])]
  : [minDay, maxDay];

const selectedPools = new Set(selectedLabels);
const seriesOf = grouping === "Hardware" ? poolHardware : poolLabel;

const poolRows = rows.filter((r) => selectedPools.has(poolLabel(r.worker_pool)));
const rangeRows = poolRows.filter((r) => r.day >= rangeStart && r.day <= rangeEnd);

// The picker chart deliberately filters by pool only, not by date — it needs
// to keep showing the full window so there's always something to brush, even
// after the date range has been narrowed.
const allPoolDays = poolDayTotals(poolRows);
const rangePoolDays = allPoolDays.filter((d) => d.day >= rangeStart && d.day <= rangeEnd);

const dailyAll = seriesByDay(allPoolDays, seriesOf);
const daily = seriesByDay(rangePoolDays, seriesOf);
const pools = poolSummary(rangePoolDays);

// The series actually present, in the order their colors were declared, so
// the legend and stacking order stay stable as filters change.
const seriesDomain = (grouping === "Hardware" ? HARDWARE_ORDER : poolOptions).filter((s) =>
  dailyAll.some((d) => d.series === s)
);
const colorSpec = {domain: seriesDomain, range: seriesDomain.map(seriesColor), legend: true};

const totals = rangePoolDays.reduce(
  (a, d) => ({
    tasks: a.tasks + d.tasks,
    taskHours: a.taskHours + d.taskHours,
    capacityHours: a.capacityHours + d.workers * 24,
    unresolved: a.unresolved + d.unresolved
  }),
  {tasks: 0, taskHours: 0, capacityHours: 0, unresolved: 0}
);
const overallUtil = totals.capacityHours > 0 ? totals.taskHours / totals.capacityHours : null;
const daysInRange = new Set(rangePoolDays.map((d) => d.day)).size;

// Machines are only meaningful per day (a pool's fleet doesn't accumulate
// across days), so the headline number is the most recent day in range, with
// the range's peak alongside it for context.
const machinesByDay = new Map();
for (const d of rangePoolDays) machinesByDay.set(d.day, (machinesByDay.get(d.day) ?? 0) + d.workers);
const latestDay = [...machinesByDay.keys()].sort().pop() ?? null;
const machinesLatest = latestDay == null ? null : machinesByDay.get(latestDay);
const machinesPeak = machinesByDay.size ? Math.max(...machinesByDay.values()) : null;

// A pool-day can sit a little over 100% when a long run crosses midnight, but
// a big overshoot means the same run got counted more than once upstream —
// which is exactly what duplicated rows in fxci.tasks/fxci.task_runs did to
// 2026-06-14/15 before the query started deduplicating them. Surface it
// instead of letting one spike silently set the scale of every chart.
const IMPLAUSIBLE_UTILIZATION = 1.5;
const implausible = rangePoolDays
  .filter((d) => d.workers > 0 && d.taskHours / (d.workers * 24) > IMPLAUSIBLE_UTILIZATION)
  .map((d) => ({...d, utilization: d.taskHours / (d.workers * 24)}))
  .sort((a, b) => b.utilization - a.utilization);
```

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Task runs</h2>
    <span class="big">${fmtNumber(totals.tasks)}</span>
    <span class="muted">${daysInRange ? `${fmtNumber(totals.tasks / daysInRange)} / day over ${daysInRange} days` : "no days in range"}</span>
  </div>
  <div class="card">
    <h2>Machine-hours</h2>
    <span class="big">${fmtNumber(totals.taskHours)}</span>
    <span class="muted">${daysInRange ? `${fmtNumber(totals.taskHours / daysInRange)} / day` : "—"}</span>
  </div>
  <div class="card">
    <h2>Est. utilization</h2>
    <span class="big">${fmtPercent(overallUtil)}</span>
    <span class="muted">of ${fmtNumber(totals.capacityHours)} machine-hours available</span>
  </div>
  <div class="card">
    <h2>Active machines</h2>
    <span class="big">${fmtNumber(machinesLatest)}</span>
    <span class="muted">${latestDay ? `on ${latestDay}, peak ${fmtNumber(machinesPeak)}` : "—"}</span>
  </div>
</div>

${totals.unresolved > 0 ? htl.html`<p class="muted">Heads up: ${fmtNumber(totals.unresolved)} run(s) in this range had not resolved when the snapshot was taken, so they count as task runs but add no machine-hours — utilization is understated by that much.</p>` : ""}

${implausible.length ? htl.html`<p class="muted"><strong>Data check:</strong> ${fmtNumber(implausible.length)} pool-day(s) in this range exceed the physical ceiling of machines &times; 24h — worst is ${poolLabel(implausible[0].worker_pool)} on ${implausible[0].day} at ${fmtPercent(implausible[0].utilization)}. That means runs are being counted more than once upstream, so treat every number here as inflated until it's fixed.</p>` : ""}

```js
// Doubles as the date-range picker: dragging draws a d3 brush over it, and
// the resulting pixel selection is inverted through the plot's own x scale
// into dates, which get pushed into the dateRange Mutable. Built from
// dailyAll (pool filtered, but NOT date filtered) so the full window stays
// visible — and brushable — no matter what date range is selected.
function tasksPerDayChart({width} = {}) {
  if (!dailyAll.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  // rectY's interval-based binning needs an actual Date, not an ISO string —
  // passing a string silently collapses every day into a single bin.
  const data = dailyAll.map((d) => ({...d, day: new Date(d.day)}));
  const height = 300;
  const plot = Plot.plot({
    title: "Task runs per day — drag to select a date range, click to clear",
    width,
    height,
    x: {type: "utc", label: "Date"},
    y: {label: "Task runs", grid: true},
    color: colorSpec,
    marks: [
      Plot.rectY(data, {x: "day", y: "tasks", fill: "series", interval: "day", order: seriesDomain, tip: true}),
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
    ${resize((width) => tasksPerDayChart({width}))}
  </div>
</div>

```js
function machineHoursChart({width} = {}) {
  if (!daily.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  const data = daily.map((d) => ({...d, day: new Date(d.day)}));
  return Plot.plot({
    title: "Machine-hours per day — time machines spent running tasks",
    width,
    height: 300,
    x: {type: "utc", label: "Date"},
    y: {label: "Machine-hours", grid: true},
    color: colorSpec,
    marks: [
      Plot.rectY(data, {x: "day", y: "taskHours", fill: "series", interval: "day", order: seriesDomain, tip: true}),
      Plot.ruleY([0])
    ]
  });
}
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => machineHoursChart({width}))}
  </div>
</div>

```js
// Utilization is a rate, so unlike the volume charts these series are drawn
// as separate lines rather than stacked — stacking rates would imply a
// combined number that doesn't exist.
function utilizationChart({width} = {}) {
  if (!daily.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  const data = daily.filter((d) => d.utilization != null).map((d) => ({...d, day: new Date(d.day)}));
  return Plot.plot({
    title: "Estimated utilization per day",
    width,
    height: 300,
    x: {type: "utc", label: "Date"},
    y: {label: "Utilization", grid: true, percent: true, zero: true},
    color: colorSpec,
    marks: [
      // Capacity ceiling. A day can peek above it: a run counts toward the
      // day it started, so one crossing midnight books over 24h on a machine.
      Plot.ruleY([1], {stroke: "currentColor", strokeOpacity: 0.35, strokeDasharray: "3,3"}),
      Plot.lineY(data, {x: "day", y: "utilization", stroke: "series", tip: true}),
      Plot.ruleY([0])
    ]
  });
}

function fleetChart({width} = {}) {
  if (!daily.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  const data = daily.map((d) => ({...d, day: new Date(d.day)}));
  return Plot.plot({
    title: "Active machines per day",
    width,
    height: 300,
    x: {type: "utc", label: "Date"},
    y: {label: "Machines", grid: true, zero: true},
    color: colorSpec,
    marks: [
      // Step: a fleet size holds until it changes, so interpolating between
      // days would draw capacity that never existed.
      Plot.lineY(data, {x: "day", y: "workers", stroke: "series", curve: "step-after", tip: true}),
      Plot.ruleY([0])
    ]
  });
}
```

<div class="grid grid-cols-2">
  <div class="card">
    ${resize((width) => utilizationChart({width}))}
  </div>
  <div class="card">
    ${resize((width) => fleetChart({width}))}
  </div>
</div>

```js
// Ranks suites by machine-hours rather than task count — the question is which
// work consumes the pools, and a slow suite can dominate capacity on a small
// fraction of the runs. 15 covers ~81% of machine-hours; the tail past it is
// long (140+ suite/variant combinations) but individually marginal.
const SUITE_TOP_N = 15;
const suiteRows = aggregateBySuite(rangeRows, seriesOf);

const hoursBySuite = new Map();
const tasksBySuite = new Map();
for (const r of suiteRows) {
  hoursBySuite.set(r.test_suite_variant, (hoursBySuite.get(r.test_suite_variant) ?? 0) + r.taskHours);
  tasksBySuite.set(r.test_suite_variant, (tasksBySuite.get(r.test_suite_variant) ?? 0) + r.tasks);
}
const sortedSuites = [...hoursBySuite.keys()].sort(
  (a, b) => hoursBySuite.get(b) - hoursBySuite.get(a) || a.localeCompare(b)
);

// Suites past the top N collapse into one bar so the chart stays readable
// however many the pools happen to run.
const topSuites = new Set(sortedSuites.slice(0, SUITE_TOP_N));
const restSuites = sortedSuites.slice(SUITE_TOP_N);
const otherLabel = `Other (${restSuites.length})`;
const otherBySeries = new Map();
for (const r of suiteRows) {
  if (!topSuites.has(r.test_suite_variant)) {
    otherBySeries.set(r.series, (otherBySeries.get(r.series) ?? 0) + r.taskHours);
  }
}
const suiteChartRows = [
  ...suiteRows.filter((r) => topSuites.has(r.test_suite_variant)),
  ...[...otherBySeries].map(([series, taskHours]) => ({test_suite_variant: otherLabel, series, taskHours}))
];
const suiteDomain = restSuites.length
  ? [...sortedSuites.slice(0, SUITE_TOP_N), otherLabel]
  : sortedSuites.slice(0, SUITE_TOP_N);

const totalSuiteHours = [...hoursBySuite.values()].reduce((a, b) => a + b, 0);
const suiteTable = sortedSuites.map((s) => ({
  test_suite_variant: s,
  tasks: tasksBySuite.get(s),
  taskHours: hoursBySuite.get(s),
  share: totalSuiteHours > 0 ? hoursBySuite.get(s) / totalSuiteHours : null
}));
```

```js
function suiteChart({width} = {}) {
  if (!suiteDomain.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  const marginLeft = Math.min(320, Math.max(120, Math.max(...suiteDomain.map((s) => s.length)) * 6.5));
  return Plot.plot({
    // Only claims a "top N" when something was actually left out — filtering
    // to one pool can leave fewer suites than SUITE_TOP_N.
    title: restSuites.length
      ? `Machine-hours by test suite / variant — top ${SUITE_TOP_N} of ${sortedSuites.length}`
      : "Machine-hours by test suite / variant",
    width,
    height: Math.max(220, suiteDomain.length * 26 + 60),
    marginLeft,
    y: {label: null, domain: suiteDomain},
    x: {label: "Machine-hours", grid: true},
    color: colorSpec,
    marks: [
      Plot.barX(suiteChartRows, {y: "test_suite_variant", x: "taskHours", fill: "series", order: seriesDomain, tip: true}),
      Plot.ruleX([0])
    ]
  });
}
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => suiteChart({width}))}
  </div>
</div>

```js
Inputs.table(pools, {
  columns: ["pool", "hardware", "tasks", "tasksPerDay", "taskHours", "avgMachines", "peakMachines", "utilization"],
  header: {
    pool: "Pool",
    hardware: "Hardware",
    tasks: "Task runs",
    tasksPerDay: "Runs / day",
    taskHours: "Machine-hours",
    avgMachines: "Avg machines",
    peakMachines: "Peak machines",
    utilization: "Est. utilization"
  },
  format: {
    tasks: fmtNumber,
    tasksPerDay: fmtNumber,
    taskHours: fmtNumber,
    avgMachines: fmtDecimal,
    utilization: fmtPercent
  },
  select: false
})
```

```js
Inputs.table(suiteTable, {
  columns: ["test_suite_variant", "tasks", "taskHours", "share"],
  header: {test_suite_variant: "Test suite / variant", tasks: "Task runs", taskHours: "Machine-hours", share: "Share of hours"},
  format: {tasks: fmtNumber, taskHours: fmtNumber, share: fmtPercent},
  select: false
})
```

## Usage by trust domain / project

Who the pools are actually working for. This comes from a second query at a
`(day, pool, trust_domain, project)` grain over the same runs, so it slices the
same machine-hours the charts above do — just by *where the work came from*
rather than what it was. Every filter above applies here too.

```js
// Second STMO query (125465). Same runs, same window, same dedup as the usage
// query — only the breakdown dimension differs — so a pool-day's hours are
// the same total on both sides, which the coverage check below verifies
// rather than assumes.
const originData = await FileAttachment("data/macos-test-pools-projects.json").json();
```

```js
// Always the qualified pair, never the bare project: `(untagged)` legitimately
// occurs under two different trust domains, so a project name alone would
// silently merge two distinct groups into one bar.
function originLabel(r) {
  return `${r.trust_domain}/${r.project}`;
}

// Mirrors aggregateBySuite — same shape, same reason to exist: collapse the
// day dimension away and roll pools up into whichever series is selected.
function aggregateByOrigin(inputRows, seriesOf) {
  const acc = new Map();
  for (const r of inputRows) {
    const series = seriesOf(r.worker_pool);
    const label = originLabel(r);
    const key = `${label} ${series}`;
    const a = acc.get(key) ?? {label, series, tasks: 0, taskHours: 0};
    a.tasks += r.tasks ?? 0;
    a.taskHours += r.task_hours ?? 0;
    acc.set(key, a);
  }
  return [...acc.values()];
}

function fmtDelta(v) {
  return v == null ? "—" : v.toLocaleString("en-US", {maximumFractionDigits: 1, signDisplay: "exceptZero"});
}
```

```js
const originPoolRows = originData.filter((r) => selectedPools.has(poolLabel(r.worker_pool)));
const originRangeRows = originPoolRows.filter((r) => r.day >= rangeStart && r.day <= rangeEnd);

const originRows = aggregateByOrigin(originRangeRows, seriesOf);

const hoursByOrigin = new Map();
const tasksByOrigin = new Map();
for (const r of originRows) {
  hoursByOrigin.set(r.label, (hoursByOrigin.get(r.label) ?? 0) + r.taskHours);
  tasksByOrigin.set(r.label, (tasksByOrigin.get(r.label) ?? 0) + r.tasks);
}
// No top-N collapsing here, unlike the suite chart: there are ~21 pairs in
// total against 140+ suite/variant combinations, so the whole tail fits on
// one chart and hiding any of it would only cost information.
const originDomain = [...hoursByOrigin.keys()].sort(
  (a, b) => hoursByOrigin.get(b) - hoursByOrigin.get(a) || a.localeCompare(b)
);
const totalOriginHours = [...hoursByOrigin.values()].reduce((a, b) => a + b, 0);

// The parent level of the hierarchy is three values wide, so it's a sentence
// rather than a chart.
const tdHours = new Map();
for (const r of originRangeRows) {
  tdHours.set(r.trust_domain, (tdHours.get(r.trust_domain) ?? 0) + (r.task_hours ?? 0));
}
const tdRollCall = [...tdHours]
  .sort((a, b) => b[1] - a[1])
  .map(([d, h]) => `${d} ${fmtPercent(totalOriginHours > 0 ? h / totalOriginHours : null)}`)
  .join(", ");
```

```js
// Splits the selected range in half by day to show which projects are growing
// into the pools and which are receding. Compared as absolute hours per day,
// not as share: share moves whenever the fleet does, which would book a
// capacity change against every project riding on it.
const originDays = [...new Set(originRangeRows.map((r) => r.day))].sort();
const splitAt = Math.floor(originDays.length / 2);
const firstHalfDays = new Set(originDays.slice(0, splitAt));
const secondHalfDays = new Set(originDays.slice(splitAt));

const halfRates = new Map();
for (const r of originRangeRows) {
  const label = originLabel(r);
  const a = halfRates.get(label) ?? {h1: 0, h2: 0, seen1: false, seen2: false};
  if (firstHalfDays.has(r.day)) {
    a.h1 += r.task_hours ?? 0;
    a.seen1 = true;
  } else if (secondHalfDays.has(r.day)) {
    a.h2 += r.task_hours ?? 0;
    a.seen2 = true;
  }
  halfRates.set(label, a);
}

const originTable = originDomain.map((label) => {
  const a = halfRates.get(label) ?? {h1: 0, h2: 0, seen1: false, seen2: false};
  const rate1 = firstHalfDays.size ? a.h1 / firstHalfDays.size : null;
  const rate2 = secondHalfDays.size ? a.h2 / secondHalfDays.size : null;
  // A project absent from one half has no comparable rate — a branch that was
  // created or reached EOL mid-window isn't a demand shift, and reporting its
  // absence as a fall to zero would rank it among the biggest movers.
  const comparable = a.seen1 && a.seen2 && firstHalfDays.size > 0 && secondHalfDays.size > 0;
  return {
    label,
    tasks: tasksByOrigin.get(label),
    taskHours: hoursByOrigin.get(label),
    share: totalOriginHours > 0 ? hoursByOrigin.get(label) / totalOriginHours : null,
    rate1: comparable ? rate1 : null,
    rate2: comparable ? rate2 : null,
    delta: comparable ? rate2 - rate1 : null
  };
});
const notComparable = originTable.filter((r) => r.delta == null).length;
```

```js
// The two queries are independent STMO snapshots on the same daily schedule,
// so they can sit one refresh apart. Compare only the pool-days present in
// both: a whole-range total comparison reads that one-day offset as a
// permanent value drift and would keep a data-quality alarm permanently lit
// while the shared days actually agree to within rounding.
const usageByPoolDay = new Map();
for (const d of rangePoolDays) usageByPoolDay.set(`${d.day}|${d.worker_pool}`, d.taskHours);

const originByPoolDay = new Map();
for (const r of originRangeRows) {
  const k = `${r.day}|${r.worker_pool}`;
  originByPoolDay.set(k, (originByPoolDay.get(k) ?? 0) + (r.task_hours ?? 0));
}

let worstDrift = 0;
for (const [k, u] of usageByPoolDay) {
  const o = originByPoolDay.get(k);
  if (o == null || !(u > 0)) continue;
  worstDrift = Math.max(worstDrift, Math.abs(u - o) / u);
}
const usageOnlyPoolDays = [...usageByPoolDay.keys()].filter((k) => !originByPoolDay.has(k)).length;
const originOnlyPoolDays = [...originByPoolDay.keys()].filter((k) => !usageByPoolDay.has(k)).length;

// Rounding in the query (task_hours to 3dp) puts the floor well under this;
// anything above it means the two breakdowns genuinely disagree about the
// same runs.
const DRIFT_ALARM = 0.005;
```

<p class="muted">
Trust domain split by machine-hours: ${tdRollCall || "—"}.
Covering ${fmtNumber(originDays.length)} day(s), ${originDays.length ? `${originDays[0]} – ${originDays[originDays.length - 1]}` : "—"}, across ${fmtNumber(originDomain.length)} trust-domain/project pair(s).${usageOnlyPoolDays > 0 ? ` ${fmtNumber(usageOnlyPoolDays)} pool-day(s) in range have no rows in this breakdown yet — the two queries refresh independently, so the newer snapshot can lead the other by a day.` : ""}${originOnlyPoolDays > 0 ? ` ${fmtNumber(originOnlyPoolDays)} pool-day(s) appear here but not in the totals above.` : ""}
</p>

${worstDrift > DRIFT_ALARM ? htl.html`<p class="muted"><strong>Data check:</strong> on the pool-days present in both queries, machine-hours disagree by up to ${fmtPercent(worstDrift)}. The two breakdowns cover the same runs, so they should match exactly — treat the split below as approximate until that's resolved.</p>` : ""}

```js
function originChart({width} = {}) {
  if (!originDomain.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  const marginLeft = Math.min(320, Math.max(120, Math.max(...originDomain.map((s) => s.length)) * 6.5));
  return Plot.plot({
    title: "Machine-hours by trust domain / project",
    width,
    height: Math.max(220, originDomain.length * 26 + 60),
    marginLeft,
    y: {label: null, domain: originDomain},
    x: {label: "Machine-hours", grid: true},
    color: colorSpec,
    marks: [
      Plot.barX(originRows, {y: "label", x: "taskHours", fill: "series", order: seriesDomain, tip: true}),
      Plot.ruleX([0])
    ]
  });
}
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => originChart({width}))}
  </div>
</div>

```js
Inputs.table(originTable, {
  columns: ["label", "tasks", "taskHours", "share", "rate1", "rate2", "delta"],
  header: {
    label: "Trust domain / project",
    tasks: "Task runs",
    taskHours: "Machine-hours",
    share: "Share of hours",
    rate1: "h/day, 1st half",
    rate2: "h/day, 2nd half",
    delta: "Δ h/day"
  },
  format: {
    tasks: fmtNumber,
    taskHours: fmtNumber,
    share: fmtPercent,
    rate1: fmtDecimal,
    rate2: fmtDecimal,
    delta: fmtDelta
  },
  select: false
})
```

${notComparable > 0 ? htl.html`<p class="muted">${fmtNumber(notComparable)} pair(s) ran in only one half of the selected range, so they have no half-over-half rate to compare and are left blank rather than shown as a move to or from zero.</p>` : ""}

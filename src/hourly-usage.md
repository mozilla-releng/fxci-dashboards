---
title: Hourly Usage
toc: false
---

# Hourly Usage

Which projects, worker pools and users are consuming the most hours.

```js
// The STMO query emits "(untagged)" for runs with no project tag — relabel
// to "Unknown" right after load so every downstream chart/table/dropdown
// picks it up without special-casing the string everywhere.
function relabelUntagged(rows) {
  return rows.map((r) => (r.project === "(untagged)" ? {...r, project: "Unknown"} : r));
}
const userRows = relabelUntagged(await FileAttachment("data/usage-by-user.json").json());
```

```js
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
  flex: 0 1 260px;
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
.filter-bar form input,
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
  font-family: var(--sans-serif);
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
  font: 13px/1.2 var(--sans-serif);
  color: inherit;
  padding: 2px 14px;
}
.filter-reset:disabled {
  visibility: hidden;
}
.filter-project {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.filter-project-control {
  display: flex;
  align-items: center;
  /* Matches the native gap Inputs' own CSS puts between the pool input and
     its Submit button (--length1), so the two rows read consistently. */
  gap: 3.25px;
}
.project-dropdown {
  position: relative;
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
}
.project-dropdown-summary {
  width: 100%;
  font: 13px/1.2 var(--sans-serif);
  text-align: left;
  border-radius: 0;
  border: 2px inset rgb(118, 118, 118);
  background: var(--theme-background, #fff);
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-dropdown-summary:hover {
  background: var(--theme-background-alt, rgba(128, 128, 128, 0.1));
}
.project-dropdown-panel {
  position: absolute;
  top: calc(100% + 0.25rem);
  left: 0;
  z-index: 20;
  width: 100%;
  background: var(--theme-background, #fff);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
}
.project-dropdown-panel select {
  width: 100%;
  min-width: 0;
}
/* Two classes to out-specificity ".filter-bar form label" (this label's
   ancestor is the project-dropdown's own <form>), which would otherwise
   force the same shouty all-caps treatment used for the "Project" /
   "Date range" captions onto this checkbox's plain sentence-case text. */
.project-dropdown-panel label.project-dropdown-showall {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: auto;
  padding: 0.4rem 0.6rem;
  font: 12px/1.2 var(--sans-serif);
  text-transform: none;
  letter-spacing: normal;
  color: var(--theme-foreground-muted, #888);
  cursor: pointer;
  border-top: solid 1px var(--theme-foreground-faintest, #ddd);
}
/* ".filter-bar form input { width: 100% }" (meant for the text/select
   inputs) also matches this checkbox and stretches its hit area across the
   whole panel, shoving the "All" text that follows it out to the far
   right — override back to the checkbox's natural size. */
.project-dropdown-panel .project-dropdown-showall input {
  width: auto;
}
</style>

```js
// Seeds filters from the URL (?project=&pool=&from=&to=) so a link with
// query params reproduces the same view. Only read once at load — this page
// has no client-side router, so there's nothing to react to on navigation.
const urlParams = new URLSearchParams(window.location.search);

const allDays = [...new Set(userRows.map((r) => r.day))].filter(Boolean).sort();
const minDay = allDays[0];
const maxDay = allDays[allDays.length - 1];

// A multiselect, not a regex like the pool filter. Every distinct project is
// a real <option> in the underlying <select>, but only the top 15 by
// running hours show by default — that's every project anyone is likely to
// ask for, and it keeps the panel from being dominated by one-off git repos
// and quiet branches. The "Show all projects" toggle below reveals the
// rest. Computed from the full, unfiltered dataset so neither list
// reshuffles as the pool filter changes.
const PROJECT_TOP_N = 15;
const hoursByProjectAll = new Map();
for (const r of userRows) hoursByProjectAll.set(r.project, (hoursByProjectAll.get(r.project) ?? 0) + (r.task_hours ?? 0));
const ALL_PROJECTS = [...hoursByProjectAll.keys()];
const TOP_PROJECTS = [...hoursByProjectAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, PROJECT_TOP_N).map(([p]) => p);

// No "All" sentinel: an empty selection means "all projects" — mixing an
// "All" option into a multiselect alongside specific picks has no sensible
// meaning. Validated against the full project list, not just the top-N
// default, so a shared link can deep-link to a project hidden by default.
const urlProjects = (urlParams.get("project") ?? "").split(",").filter((p) => ALL_PROJECTS.includes(p));

// Wraps a native Inputs.select(..., {multiple: true}) rather than
// hand-rolling checkboxes, so click / ctrl-click / shift-click / keyboard
// selection all behave exactly like a normal multiselect — it's just hidden
// inside a collapsed panel behind a summary button instead of always
// visible. Exposes the same contract Generators.input relies on (a `.value`
// plus "input" events), so it drops in wherever an Observable Input would
// go. Options are sorted alphabetically for scanning even though
// allOptions itself is ordered by hours (that ordering only matters for
// picking the top N).
//
// Every project in allOptions gets a real <option>, not just the visible
// ones — the "Show all projects" checkbox below the list only toggles each
// <option>'s `hidden` attribute, it never rebuilds the <select>. That
// matters because hiding an <option> doesn't clear it from a native
// multi-select's value, so a selection made while "show all" was on
// survives toggling back off.
function projectDropdown(allOptions, visibleOptions, {label, value = []} = {}) {
  const sortedOptions = [...allOptions].sort((a, b) => a.localeCompare(b));
  const visibleSet = new Set(visibleOptions);
  const select = Inputs.select(sortedOptions, {
    label: null,
    value,
    multiple: true,
    size: Math.min(sortedOptions.length, 10)
  });
  function setShowAll(showAll) {
    for (const option of select.querySelectorAll("option")) {
      option.hidden = !showAll && !visibleSet.has(option.textContent);
    }
  }
  setShowAll(false);

  const form = document.createElement("form");
  form.className = "project-dropdown";

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "project-dropdown-summary";

  const showAllLabel = document.createElement("label");
  showAllLabel.className = "project-dropdown-showall";
  const showAllCheckbox = document.createElement("input");
  showAllCheckbox.type = "checkbox";
  showAllCheckbox.addEventListener("change", () => setShowAll(showAllCheckbox.checked));
  showAllLabel.append(showAllCheckbox, "All");

  const panel = document.createElement("div");
  panel.className = "project-dropdown-panel";
  panel.hidden = true;
  panel.append(select, showAllLabel);

  // No "label:" prefix in the button text — the "Project" caption above it
  // (see the filter-bar markup) already supplies that context, same as the
  // date-range control shows just its value with no repeated label.
  summary.title = label;
  summary.setAttribute("aria-label", label);
  function refresh() {
    const v = select.value;
    form.value = v;
    summary.textContent = v.length === 0 ? "All" : v.length === 1 ? v[0] : `${v.length} selected`;
  }

  select.addEventListener("input", () => {
    refresh();
    form.dispatchEvent(new Event("input", {bubbles: true}));
  });

  // Public so an external "Reset" button can clear the selection without
  // reaching into the widget's internals. Assigning select.value updates the
  // underlying <select>'s visual state too (Observable Inputs elements
  // support programmatic value assignment), it just doesn't fire "input" on
  // its own, hence the manual refresh + dispatch below.
  form.clear = () => {
    if (select.value.length === 0) return;
    select.value = [];
    refresh();
    form.dispatchEvent(new Event("input", {bubbles: true}));
  };

  summary.addEventListener("click", (event) => {
    event.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  panel.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", () => (panel.hidden = true));

  form.append(summary, panel);
  refresh();
  return form;
}
const projectInput = projectDropdown(ALL_PROJECTS, TOP_PROJECTS, {label: "Project", value: urlProjects});
const projects = Generators.input(projectInput);

const poolInput = Inputs.text({
  label: "Worker pool (regex)",
  placeholder: "e.g. ^releng-hardware/",
  value: urlParams.get("pool") ?? "",
  submit: true
});
const poolPattern = Generators.input(poolInput);

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
// Parsed strictly rather than compared as strings: a plausible-looking
// ?from=2026-06-1 passes a lexical range check but yields an Invalid Date,
// which would throw out of the cell deriving every dataset on the page.
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
  const from = parseDay(urlParams.get("from"));
  const to = parseDay(urlParams.get("to"));
  if (!from || !to || from > to || to < windowStart || from > windowEnd) return null;
  return [clampDay(from), clampDay(to)];
}
const dateRange = Mutable(initialDateRange());
function setDateRange(v) {
  dateRange.value = v ? [clampDay(v[0]), clampDay(v[1])] : null;
}

// The breakdown value doubles as the row property name ("project",
// "worker_pool", or "created_for_user") so every chart below can key
// straight off it with r[breakdown] instead of a lookup table. Shared by
// the Usage over Time chart and all three "Usage by ___" bar charts, so it
// lives with the page's other top-level filters.
const BREAKDOWN_OPTIONS = ["project", "worker_pool", "created_for_user"];
const BREAKDOWN_LABELS = {project: "Project", worker_pool: "Worker Pool", created_for_user: "User"};
const initialBreakdown = BREAKDOWN_OPTIONS.includes(urlParams.get("breakdown")) ? urlParams.get("breakdown") : "project";
const breakdownInput = Inputs.select(BREAKDOWN_OPTIONS, {
  label: "Breakdown",
  value: initialBreakdown,
  format: (d) => BREAKDOWN_LABELS[d]
});
const breakdown = Generators.input(breakdownInput);
```

<div class="filter-bar">
  <div>${poolInput}</div>
  <div class="filter-project">
    <span class="filter-daterange-label">Project</span>
    <div class="filter-project-control">
      ${projectInput}
      ${htl.html`<button class="filter-reset" disabled=${projects.length === 0} onclick=${() => projectInput.clear()}>Reset</button>`}
    </div>
  </div>
  <div class="filter-daterange">
    <span class="filter-daterange-label">Date range</span>
    <div class="filter-daterange-value-row">
      <span class="filter-daterange-value">${dateRange ? `${isoDate(dateRange[0])} – ${isoDate(dateRange[1])}` : `${minDay} – ${maxDay}`}</span>
      ${htl.html`<button class="filter-reset" disabled=${!dateRange} onclick=${() => setDateRange(null)}>Reset</button>`}
    </div>
  </div>
  <div>${breakdownInput}</div>
</div>

```js
// Compiled inside this cell (not a helper declared alongside poolPattern)
// because a plain function defined in an earlier cell would capture a stale
// snapshot; this cell is the one that actually reruns reactively. Invalid
// regex falls back to "no filter" rather than breaking the page.
let poolRegex = null;
if (poolPattern) {
  try {
    poolRegex = new RegExp(poolPattern, "i");
  } catch {
    poolRegex = null;
  }
}

// Used in prose (not titles — those stay static regardless of selection) so
// data-quality caveats still read correctly for any number of projects.
const projectPhrase = projects.length === 0
  ? "all projects"
  : projects.length === 1
    ? projects[0]
    : `${projects.length} projects`;
```

```js
// Keeps the URL in sync with the current filters so the view is linkable/
// bookmarkable. Deliberately its own cell, separate from the one declaring
// the dateRange Mutable — merging them would make this effect's dependency
// on poolPattern re-run that cell too, recreating (and resetting) the
// Mutable on every keystroke.
{
  const params = new URLSearchParams(window.location.search);
  const set = (key, val) => (val ? params.set(key, val) : params.delete(key));
  set("project", projects.length ? projects.join(",") : null);
  set("pool", poolPattern || null);
  set("from", dateRange ? isoDate(dateRange[0]) : null);
  set("to", dateRange ? isoDate(dateRange[1]) : null);
  set("groupBy", groupBy !== "week" ? groupBy : null);
  set("breakdown", breakdown !== "project" ? breakdown : null);
  const qs = params.toString();
  history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
}
```

```js
// Defaults to the full available window until the user brushes the first
// chart. dateRange is trusted as already-ordered/in-range since it's only
// ever set from the brush's own (already-clamped) invert() output.
const [rangeStart, rangeEnd] = dateRange ? [isoDate(dateRange[0]), isoDate(dateRange[1])] : [minDay, maxDay];

function projectFilterOf(r) {
  return projects.length === 0 || projects.includes(r.project);
}

// Picker-chart inputs are pool/project-filtered only, not date-filtered, so
// there's always something to brush even after the range has been narrowed.
const userPoolRows = userRows.filter((r) => (!poolRegex || poolRegex.test(r.worker_pool)) && projectFilterOf(r));
const userRangeRows = userPoolRows.filter((r) => r.day >= rangeStart && r.day <= rangeEnd);

// Pool-filtered ONLY (never project-filtered): this is the "all projects"
// denominator for the share stat. Summing task_hours across these rows
// implicitly sums across users too, since project filtering is the only
// thing that varies below.
const poolPoolRows = userRows.filter((r) => !poolRegex || poolRegex.test(r.worker_pool));
const poolRangeRows = poolPoolRows.filter((r) => r.day >= rangeStart && r.day <= rangeEnd);

// Selected-project slice, for the stat cards and the share-over-time line.
const selectedProjectPoolRangeRows = poolRangeRows.filter(projectFilterOf);
```

```js
const totalTaskHours = userRangeRows.reduce((a, r) => a + (r.task_hours ?? 0), 0);
const totalTasks = userRangeRows.reduce((a, r) => a + (r.tasks ?? 0), 0);
const matchedHours = poolRangeRows.reduce((a, r) => a + (r.task_hours ?? 0), 0);
const projectShare = matchedHours > 0 ? selectedProjectPoolRangeRows.reduce((a, r) => a + (r.task_hours ?? 0), 0) / matchedHours : null;
const daysInRange = new Set(userRangeRows.map((r) => r.day)).size;
const distinctProjectsInRange = new Set(poolRangeRows.map((r) => r.project)).size;

const hoursByUserAll = new Map();
for (const r of userRangeRows) {
  hoursByUserAll.set(r.created_for_user, (hoursByUserAll.get(r.created_for_user) ?? 0) + (r.task_hours ?? 0));
}
const userHoursSorted = [...hoursByUserAll.values()].sort((a, b) => b - a);
const distinctUsers = hoursByUserAll.size;
const medianUserHours = userHoursSorted.length
  ? userHoursSorted[Math.floor((userHoursSorted.length - 1) / 2)]
  : null;
```

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Running hours</h2>
    <span class="big">${fmtNumber(totalTaskHours)}</span>
    <span class="muted">${daysInRange ? `${fmtNumber(totalTaskHours / daysInRange)} / day over ${daysInRange} days` : "no days in range"}</span>
  </div>
  <div class="card">
    <h2>Task runs</h2>
    <span class="big">${fmtNumber(totalTasks)}</span>
    <span class="muted">${daysInRange ? `${fmtNumber(totalTasks / daysInRange)} / day` : "—"}</span>
  </div>
  ${projects.length === 0
    ? htl.html`<div class="card">
        <h2>Distinct projects</h2>
        <span class="big">${fmtNumber(distinctProjectsInRange)}</span>
        <span class="muted">touching the matched pools in this range</span>
      </div>`
    : htl.html`<div class="card">
        <h2>Share of matched pools</h2>
        <span class="big">${fmtPercent(projectShare)}</span>
        <span class="muted">of ${fmtNumber(matchedHours)} running hours, all projects</span>
      </div>`}
  <div class="card">
    <h2>Distinct users</h2>
    <span class="big">${fmtNumber(distinctUsers)}</span>
    <span class="muted">median ${fmtDecimal(medianUserHours)}h / user</span>
  </div>
</div>

## Usage over Time

```js
const GROUP_BY_OPTIONS = ["day", "week", "month"];
const initialGroupBy = GROUP_BY_OPTIONS.includes(urlParams.get("groupBy")) ? urlParams.get("groupBy") : "week";
const groupByInput = Inputs.select(GROUP_BY_OPTIONS, {
  label: "Group By",
  value: initialGroupBy,
  format: (d) => d[0].toUpperCase() + d.slice(1)
});
const groupBy = Generators.input(groupByInput);
```

<div class="filter-bar">
  <div>${groupByInput}</div>
</div>

```js
// Buckets a day (ISO string) down to the start of its containing week/month,
// so rows can be re-aggregated at coarser granularity than the underlying
// per-day query results. utcWeek floors to Sunday, matching Plot's own
// "week" interval used below for the chart's bin width.
function dayBucketFn(groupBy) {
  if (groupBy === "day") return (day) => day;
  const interval = groupBy === "month" ? d3.utcMonth : d3.utcWeek;
  return (day) => isoDate(interval.floor(new Date(`${day}T00:00:00Z`)));
}
```

```js
// Bucket everything past the top 10 keys (by running hours in the rows
// given) into "Other" so the stacked chart never grows past 11 colors, and
// keep the legend + each stack's internal order alphabetical while colors
// track the (stable) hours-rank of each key.
function topBucketColorScale(rows, keyFn) {
  const TOP_N = 10;
  const hoursByKey = new Map();
  for (const r of rows) hoursByKey.set(keyFn(r), (hoursByKey.get(keyFn(r)) ?? 0) + (r.task_hours ?? 0));
  const topKeys = [...hoursByKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(([k]) => k);
  const topKeySet = new Set(topKeys);
  const hasOther = hoursByKey.size > topKeys.length;
  const colorForKey = new Map(topKeys.map((k, i) => [k, d3.schemeTableau10[i]]));
  if (hasOther) colorForKey.set("Other", "#999");
  const order = [...colorForKey.keys()].sort((a, b) => a.localeCompare(b));
  return {bucket: (value) => (topKeySet.has(value) ? value : "Other"), order, range: order.map((k) => colorForKey.get(k))};
}
```

```js
// pool/project-filtered but NOT date-filtered, so the chart always shows
// (and can brush) the full window regardless of the selected range.
// Bucketed against the full (undated) window too, so the "Other" grouping
// doesn't reshuffle as the user drags the brush.
function totalsPerDayByKey(inputRows, keyFn, bucket, dayBucket) {
  const acc = new Map();
  for (const r of inputRows) {
    const day = dayBucket(r.day);
    const key = bucket(keyFn(r));
    const mapKey = `${day}|${key}`;
    const a = acc.get(mapKey) ?? {day, key, taskHours: 0};
    a.taskHours += r.task_hours ?? 0;
    acc.set(mapKey, a);
  }
  return [...acc.values()].sort((a, b) => a.day.localeCompare(b.day));
}
const dailyScale = topBucketColorScale(userPoolRows, (r) => r[breakdown]);
const dailyTotals = totalsPerDayByKey(userPoolRows, (r) => r[breakdown], dailyScale.bucket, dayBucketFn(groupBy));
const breakdownLabel = BREAKDOWN_LABELS[breakdown].toLowerCase();
```

```js
// Doubles as the date-range picker: dragging draws a d3 brush over it, and
// the resulting pixel selection is inverted through the plot's own x scale
// into dates, which get pushed into the dateRange Mutable.
function usageOverTimeChart({width} = {}) {
  if (!dailyTotals.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  // rectY's interval-based binning needs an actual Date, not an ISO string —
  // passing a string silently collapses every day into a single bin.
  const data = dailyTotals.map((d) => ({...d, day: new Date(d.day)}));
  const height = 300;
  const plot = Plot.plot({
    title: `Running hours per ${groupBy} by ${breakdownLabel} — drag to select a date range, click to clear`,
    width,
    height,
    x: {type: "utc", label: "Date"},
    y: {label: "Running hours", grid: true},
    color: {legend: true, domain: dailyScale.order, range: dailyScale.range},
    marks: [
      Plot.rectY(data, Plot.stackY({x: "day", y: "taskHours", fill: "key", interval: groupBy, order: dailyScale.order, tip: true})),
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
    ${resize((width) => usageOverTimeChart({width}))}
  </div>
</div>

```js
// Shared by the three "Usage by ___" bar charts below: aggregates rows by
// keyFn (user/project/worker pool) while tracking each row's hours broken
// down by the page's global `breakdown` dimension, so every section can
// stack its bars by the same, user-selected field.
function groupedUsageSummary(inputRows, keyFn) {
  const acc = new Map();
  for (const r of inputRows) {
    const k = keyFn(r);
    const a = acc.get(k) ?? {
      key: k,
      breakdown: new Map(),
      tasks: 0,
      taskHours: 0,
      taskGroups: 0,
      retryRuns: 0
    };
    a.tasks += r.tasks ?? 0;
    a.taskHours += r.task_hours ?? 0;
    a.taskGroups += r.pushes ?? 0;
    a.retryRuns += r.retry_runs ?? 0;
    a.breakdown.set(r[breakdown], (a.breakdown.get(r[breakdown]) ?? 0) + (r.task_hours ?? 0));
    acc.set(k, a);
  }
  const total = [...acc.values()].reduce((s, a) => s + a.taskHours, 0);
  return [...acc.values()]
    .map((a) => ({
      key: a.key,
      tasks: a.tasks,
      taskHours: a.taskHours,
      taskGroups: a.taskGroups,
      hoursPerTaskGroup: a.taskGroups > 0 ? a.taskHours / a.taskGroups : null,
      tasksPerTaskGroup: a.taskGroups > 0 ? a.tasks / a.taskGroups : null,
      retryRuns: a.retryRuns,
      share: total > 0 ? a.taskHours / total : null,
      breakdown: a.breakdown
    }))
    .sort((a, b) => b.taskHours - a.taskHours);
}

const USAGE_ROWS_TOP_N = 20;

// Buckets and colors each row's breakdown values using the exact same
// scale as the Usage over Time chart above (dailyScale, keyed by the same
// `breakdown` field) so a given project/pool/user always gets the same
// color everywhere on the page, not a chart-local reassignment. That scale
// is already alphabetically ordered, so sorting each bar's own segments by
// that order gets us alphabetical stacking for free. Stacked manually
// (explicit x0/x1) since Plot's stack transform only supports one shared
// z-order for the whole chart.
function topNBreakdownBars(topRows) {
  return topRows.flatMap((row) => {
    const collapsed = new Map();
    for (const [b, hours] of row.breakdown) {
      const series = dailyScale.bucket(b);
      collapsed.set(series, (collapsed.get(series) ?? 0) + hours);
    }
    const sorted = [...collapsed.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let x0 = 0;
    return sorted.map(([series, hours]) => {
      const x1 = x0 + hours;
      const bar = {key: row.key, series, taskHours: hours, x0, x1};
      x0 = x1;
      return bar;
    });
  });
}

function topNUsageChart(topRows, bars, {namePlural, keyField, width} = {}) {
  if (!topRows.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  const domain = topRows.map((r) => r.key);
  const marginLeft = Math.min(320, Math.max(160, Math.max(...domain.map((k) => k.length)) * 6.5));
  // Breaking a section down by its own key (e.g. Usage by User with
  // Breakdown = User) collapses every bar to a single, redundant segment —
  // skip the color encoding and legend in that case and fall back to
  // Plot's default single-color bars rather than showing a legend with one
  // entry per row.
  const selfBreakdown = keyField === breakdown;
  return Plot.plot({
    title: selfBreakdown
      ? `Top ${Math.min(USAGE_ROWS_TOP_N, topRows.length)} ${namePlural} by running hours`
      : `Top ${Math.min(USAGE_ROWS_TOP_N, topRows.length)} ${namePlural} by running hours, by ${breakdownLabel}`,
    width,
    height: Math.max(220, domain.length * 24 + 60),
    marginLeft,
    y: {label: null, domain},
    x: {label: "Running hours", grid: true},
    color: selfBreakdown ? undefined : {legend: true, domain: dailyScale.order, range: dailyScale.range},
    marks: [
      Plot.barX(bars, {
        y: "key",
        x1: "x0",
        x2: "x1",
        // Same blue as the first swatch in dailyScale's palette, so a
        // self-breakdown bar reads as "no encoding" rather than an
        // arbitrary color choice.
        fill: selfBreakdown ? d3.schemeTableau10[0] : "series",
        title: selfBreakdown ? (d) => `${fmtNumber(d.taskHours)}h` : (d) => `${d.series}: ${fmtNumber(d.taskHours)}h`,
        tip: true
      }),
      Plot.ruleX([0])
    ]
  });
}

function usageTable(rows, keyHeader) {
  return Inputs.table(rows, {
    columns: ["key", "tasks", "taskHours", "share", "taskGroups", "hoursPerTaskGroup", "tasksPerTaskGroup"],
    header: {
      key: keyHeader,
      tasks: "Task runs",
      taskHours: "Running hours",
      share: "Share of hours",
      taskGroups: "Task groups",
      hoursPerTaskGroup: "Hours / task group",
      tasksPerTaskGroup: "Task runs / task group"
    },
    format: {
      tasks: fmtNumber,
      taskHours: fmtNumber,
      share: fmtPercent,
      taskGroups: fmtNumber,
      hoursPerTaskGroup: fmtDecimal,
      tasksPerTaskGroup: fmtDecimal
    },
    select: false
  });
}
```

## Usage by User

```js
// Ranks by running hours, not task count: a slow talos run and a 20s lint
// task both count as "1 task run" but consume wildly different capacity.
const userTable = groupedUsageSummary(userRangeRows, (r) => r.created_for_user);
const topUserRows = userTable.slice(0, USAGE_ROWS_TOP_N);
const topUserBars = topNBreakdownBars(topUserRows);
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => topNUsageChart(topUserRows, topUserBars, {namePlural: "users", keyField: "created_for_user", width}))}
  </div>
</div>

```js
usageTable(userTable, "User")
```

## Usage by Project

```js
const projectTable = groupedUsageSummary(userRangeRows, (r) => r.project);
const topProjectRows = projectTable.slice(0, USAGE_ROWS_TOP_N);
const topProjectBars = topNBreakdownBars(topProjectRows);
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => topNUsageChart(topProjectRows, topProjectBars, {namePlural: "projects", keyField: "project", width}))}
  </div>
</div>

```js
usageTable(projectTable, "Project")
```

## Usage by Worker Pool

```js
const poolTable = groupedUsageSummary(userRangeRows, (r) => r.worker_pool);
const topPoolRows = poolTable.slice(0, USAGE_ROWS_TOP_N);
const topPoolBars = topNBreakdownBars(topPoolRows);
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => topNUsageChart(topPoolRows, topPoolBars, {namePlural: "worker pools", keyField: "worker_pool", width}))}
  </div>
</div>

```js
usageTable(poolTable, "Worker pool")
```

```js
const untaggedProjectHours = poolRangeRows
  .filter((r) => r.project === "Unknown")
  .reduce((a, r) => a + (r.task_hours ?? 0), 0);
const unknownUserHours = userRangeRows
  .filter((r) => r.created_for_user === "(unknown)")
  .reduce((a, r) => a + (r.task_hours ?? 0), 0);
```

${untaggedProjectHours > 0 || unknownUserHours > 0 ? htl.html`<p class="muted">Work that couldn't be fully attributed in this range: ${fmtNumber(untaggedProjectHours)} running hour(s) with no project tag, ${fmtNumber(unknownUserHours)} ${projectPhrase} running hour(s) with no created_for_user. Shown rather than dropped, so totals above still reconcile.</p>` : ""}

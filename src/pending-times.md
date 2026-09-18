---
title: Pending Times
toc: false
---

# Pending Times

How long Firefox-CI tasks wait for a worker before they start.

```js
import {isoDate, dateRangeControl, attachDateBrush} from "./components/date-range.js";
```

```js
// The STMO query emits "(untagged)" for runs with no project tag — relabel
// to "Unknown" right after load so every downstream chart/table/dropdown
// picks it up without special-casing the string everywhere.
function relabelUntagged(rows) {
  return rows.map((r) => (r.project === "(untagged)" ? {...r, project: "Unknown"} : r));
}
const rows = relabelUntagged((await FileAttachment("data/pending-times.parquet").parquet()).toArray());
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
// null -> unknown, Infinity -> censored by the open-ended >=4h bucket, else a
// human-scaled duration. Infinity is a deliberate sentinel (see pctSeconds
// below): Inputs.table sorts it above every finite wait, which is exactly
// the semantics an unmeasurable "worse than anything on the chart" wait
// should have.
function fmtSeconds(s) {
  if (s == null) return "—";
  if (!Number.isFinite(s)) return "> 4h";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
function fmtDeltaSeconds(s) {
  if (s == null) return "—";
  const sign = s > 0 ? "+" : s < 0 ? "−" : "±";
  return `${sign}${fmtSeconds(Math.abs(s))}`;
}
```

```js
// Bucket columns as emitted by STMO query 126751, aligned to their [lower,
// upper) edges in seconds. The last of these (p_ge4h) is open-ended (upper =
// null). BUCKET_LABELS/_LOWER_S/_UPPER_S carry one more entry than
// BUCKET_FIELDS -- a 9th "Expired" bucket, appended for deadline-exceeded
// tasks (see addRow below), which has no source column of its own since
// those tasks never had a measured wait at all.
const BUCKET_FIELDS = ["p_lt1m", "p_1_5m", "p_5_15m", "p_15_30m", "p_30_60m", "p_1_2h", "p_2_4h", "p_ge4h"];
const BUCKET_LABELS = ["< 1m", "1–5m", "5–15m", "15–30m", "30–60m", "1–2h", "2–4h", "≥ 4h", "Deadline-Exceeded"];
const BUCKET_LOWER_S = [0, 60, 300, 900, 1800, 3600, 7200, 14400, 14400];
const BUCKET_UPPER_S = [60, 300, 900, 1800, 3600, 7200, 14400, null, null];
const OVER_30M_FROM = 4; // p_30_60m onward
const OVER_1H_FROM = 5; // p_1_2h onward
const OVER_2H_FROM = 6; // p_2_4h onward
const OPEN_BUCKET = 7; // p_ge4h
const EXPIRED_BUCKET = 8; // deadline-exceeded — kept separate from OPEN_BUCKET so it gets its own color
const PRIORITY_ORDER = ["highest", "very-high", "high", "medium", "low", "very-low", "lowest"];
// Fast (blue) -> slow (red), sampled across the 8 real, measured-duration
// buckets. Expired gets a fixed, near-black red appended after rather than
// sampled from the same ramp: it isn't a slower version of the same
// measured wait, it's a task that never got measured at all, and needs to
// read as categorically worse than the reddest real bucket rather than just
// one more shade in that gradient.
const BUCKET_COLORS = [...d3.quantize((t) => d3.interpolateRdYlBu(1 - t), BUCKET_FIELDS.length), "#67000d"];

// Interpolates a percentile inside a summed bucket histogram. `counts` is a
// 9-element array aligned to BUCKET_LOWER_S/BUCKET_UPPER_S (8 real buckets
// plus Expired). Returns a tagged result rather than a bare number so
// callers can't accidentally do arithmetic on "no answer" and get a
// confidently wrong one:
//   {state: "value", seconds, total, bucket}
//   {state: "unbounded", total, bucket}    landed in p_ge4h or Expired, both open-ended
//   {state: "insufficient", total}          too few runs for this quantile to mean anything
//   {state: "empty", total: 0}
function histPercentile(counts, q) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return {state: "empty", total: 0};
  // p50 needs 2 runs behind it to mean anything, p90 needs 10, p99 needs
  // 100 — below that a (pool, project, priority) slice reports a
  // confident-looking number that's really just noise from a handful of runs.
  const minSamples = 1 / (1 - q);
  if (total < minSamples) return {state: "insufficient", total};
  const target = q * total;
  let cum = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (c === 0) continue; // never report a percentile inside an empty bucket
    if (cum + c >= target) {
      if (BUCKET_UPPER_S[i] == null) return {state: "unbounded", total, bucket: i};
      const frac = (target - cum) / c;
      return {state: "value", seconds: BUCKET_LOWER_S[i] + frac * (BUCKET_UPPER_S[i] - BUCKET_LOWER_S[i]), total, bucket: i};
    }
    cum += c;
  }
  // Floating-point accumulation can leave a hair short of `target` on the
  // final bucket instead of tripping the loop's own exit condition — fall
  // back to the last non-empty bucket rather than returning undefined, which
  // would poison every downstream calculation with NaN.
  for (let i = counts.length - 1; i >= 0; i--) {
    if (counts[i] > 0) {
      return BUCKET_UPPER_S[i] == null
        ? {state: "unbounded", total, bucket: i}
        : {state: "value", seconds: BUCKET_UPPER_S[i], total, bucket: i};
    }
  }
  return {state: "empty", total: 0};
}
// Table/leaderboard adapter only — Infinity must never reach a Plot log
// scale, which throws on non-finite domain values.
function pctSeconds(res) {
  if (res.state === "value") return res.seconds;
  if (res.state === "unbounded") return Infinity;
  return null;
}
```

```js
function emptyAgg(key) {
  return {key, runs: 0, pendingHours: 0, maxS: 0, counts: new Array(BUCKET_LABELS.length).fill(0)};
}

// The only place the sum-vs-max rule lives: runs/pending_hours and all
// bucket counts are additive, but pending_max_s is already a MAX per row —
// summing it would invent a wait nobody experienced.
//
// A task's expired_runs is added to both `runs` and its own EXPIRED_BUCKET
// slot, kept separate from p_ge4h so the two render as distinct
// segments/colors rather than one blended bucket.
function addRow(agg, r) {
  agg.runs += r.runs ?? 0;
  agg.pendingHours += r.pending_hours ?? 0;
  agg.maxS = Math.max(agg.maxS, r.pending_max_s ?? 0);
  for (let i = 0; i < BUCKET_FIELDS.length; i++) agg.counts[i] += r[BUCKET_FIELDS[i]] ?? 0;
  agg.runs += r.expired_runs ?? 0;
  agg.pendingHours += r.expired_pending_hours ?? 0;
  agg.maxS = Math.max(agg.maxS, r.expired_max_s ?? 0);
  agg.counts[EXPIRED_BUCKET] += r.expired_runs ?? 0;
  return agg;
}

// Merges one already-derived agg's totals/counts into another — used to
// roll a long tail of breakdown keys into a single "Other" bucket. Doesn't
// go through addRow: that operates on raw parquet rows, and routing an
// already-aggregated row through it again would need to reconstruct a fake
// raw row per bucket field, and silently break the moment a bucket (like
// EXPIRED_BUCKET) has no corresponding raw column to reconstruct from.
function mergeAgg(agg, other) {
  agg.runs += other.runs;
  agg.pendingHours += other.pendingHours;
  agg.maxS = Math.max(agg.maxS, other.maxS);
  for (let i = 0; i < agg.counts.length; i++) agg.counts[i] += other.counts[i];
  return agg;
}

function aggregateBy(inputRows, keyFn) {
  const acc = new Map();
  for (const r of inputRows) {
    const key = keyFn(r);
    const agg = acc.get(key) ?? emptyAgg(key);
    addRow(agg, r);
    acc.set(key, agg);
  }
  return [...acc.values()];
}

function aggregateByDay(inputRows, keyFn, dayBucket) {
  const acc = new Map();
  for (const r of inputRows) {
    const day = dayBucket(r.day);
    const key = keyFn(r);
    const mapKey = `${day}|${key}`;
    const agg = acc.get(mapKey) ?? {...emptyAgg(key), day};
    addRow(agg, r);
    acc.set(mapKey, agg);
  }
  return [...acc.values()].sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
}

// Uses Σ(bucket counts) — not `runs` — as the denominator for every share and
// percentile. The query guarantees the two match today (checked below), but
// computing both means a future query edit renders a visible warning instead
// of silently producing shares over 100%.
function deriveAgg(agg) {
  const bucketTotal = agg.counts.reduce((a, b) => a + b, 0);
  const over30mRuns = agg.counts.slice(OVER_30M_FROM).reduce((a, b) => a + b, 0);
  const over1hRuns = agg.counts.slice(OVER_1H_FROM).reduce((a, b) => a + b, 0);
  const over2hRuns = agg.counts.slice(OVER_2H_FROM).reduce((a, b) => a + b, 0);
  // Includes EXPIRED_BUCKET (unlike over30m/1h/2h above, which pick it up
  // for free via slice — this is the one spot that indexes a single bucket
  // rather than slicing to the end): a deadline-exceeded task waited well
  // past 4h by definition, so "waiting > 4h" excluding it would undercount.
  const over4hRuns = agg.counts[OPEN_BUCKET] + agg.counts[EXPIRED_BUCKET];
  // Unlike over30m/1h/2h/4h above, not a "worse than X" cumulative share —
  // just this one bucket's own share, so it reads as "how much of this was
  // deadline-exceeded" rather than folding into the >4h story.
  const expiredRuns = agg.counts[EXPIRED_BUCKET];
  return {
    ...agg,
    bucketTotal,
    over30mRuns,
    over1hRuns,
    over2hRuns,
    over4hRuns,
    expiredRuns,
    over30m: bucketTotal > 0 ? over30mRuns / bucketTotal : null,
    over1h: bucketTotal > 0 ? over1hRuns / bucketTotal : null,
    over2h: bucketTotal > 0 ? over2hRuns / bucketTotal : null,
    over4h: bucketTotal > 0 ? over4hRuns / bucketTotal : null,
    expiredShare: bucketTotal > 0 ? expiredRuns / bucketTotal : null,
    p50: pctSeconds(histPercentile(agg.counts, 0.5)),
    p90: pctSeconds(histPercentile(agg.counts, 0.9)),
    p95: pctSeconds(histPercentile(agg.counts, 0.95)),
    p99: pctSeconds(histPercentile(agg.counts, 0.99)),
    meanWaitS: agg.runs > 0 ? (agg.pendingHours * 3600) / agg.runs : null,
    avgPendingHoursPerTask: agg.runs > 0 ? agg.pendingHours / agg.runs : null
  };
}

// Buckets a day (ISO string) down to the start of its containing week/month.
function dayBucketFn(groupBy) {
  if (groupBy === "day") return (day) => day;
  const interval = groupBy === "month" ? d3.utcMonth : d3.utcWeek;
  return (day) => interval.floor(new Date(`${day}T00:00:00Z`)).toISOString().slice(0, 10);
}

// A week/month bucket is "partial" when it doesn't span every calendar day it
// should — true only at the edges of the data window, since the 90-day
// window itself has no gaps. Computed from the full (unfiltered) day list so
// it doesn't change as filters narrow the data.
function partialDayBuckets(days, dayBucket, groupBy) {
  if (groupBy === "day") return new Set();
  const counts = new Map();
  for (const day of days) counts.set(dayBucket(day), (counts.get(dayBucket(day)) ?? 0) + 1);
  const partial = new Set();
  for (const [key, n] of counts) {
    const start = new Date(`${key}T00:00:00Z`);
    const expected =
      groupBy === "month" ? Math.round((d3.utcMonth.offset(start, 1) - start) / 86400000) : 7;
    if (n < expected) partial.add(key);
  }
  return partial;
}

// Adapted from the Hourly Usage dashboard's top-N color scale, but weighted
// by pending hours (the "how much pain" lens) rather than task hours — a
// pool can have huge task-hour volume with almost no waiting. `weightFn` is
// overridable so the deadline-exceeded trend chart can rank its top 10 by
// `expired_runs` instead — a pool can carry heavy real congestion
// (high pending_hours) with zero starved/misconfigured tasks, or vice
// versa, and ranking that chart by pending_hours would show the wrong ten
// pools entirely.
function topBucketColorScale(inputRows, keyFn, weightFn = (r) => r.pending_hours ?? 0) {
  const TOP_N = 10;
  const hoursByKey = new Map();
  for (const r of inputRows) hoursByKey.set(keyFn(r), (hoursByKey.get(keyFn(r)) ?? 0) + weightFn(r));
  const topKeys = [...hoursByKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(([k]) => k);
  const topKeySet = new Set(topKeys);
  const hasOther = hoursByKey.size > topKeys.length;
  const colorForKey = new Map(topKeys.map((k, i) => [k, d3.schemeTableau10[i]]));
  if (hasOther) colorForKey.set("Other", "#999");
  const order = [...colorForKey.keys()].sort((a, b) => a.localeCompare(b));
  return {bucket: (value) => (topKeySet.has(value) ? value : "Other"), order, range: order.map((k) => colorForKey.get(k))};
}

// Priority is a small (8-value) ordinal domain that should never be
// collapsed into "Other" or sorted by size — the entire insight is the
// monotonic degradation from highest to lowest, which sorting by run count
// or alphabetically would destroy. worker_pool/project go through the
// generic top-N scale above instead.
function seriesScale(inputRows, breakdown, weightFn) {
  if (breakdown === "priority") {
    const present = new Set(inputRows.map((r) => r.priority));
    const order = PRIORITY_ORDER.filter((p) => present.has(p));
    return {bucket: (v) => v, order, range: order.map((_, i) => d3.schemeTableau10[i % 10])};
  }
  return topBucketColorScale(inputRows, (r) => r[breakdown], weightFn);
}
```

<style>
.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  margin-top: 0.5rem;
}
.stat-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.stat-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--theme-foreground-muted, #888);
}
.stat-value {
  font-size: 1.375rem;
  font-weight: 500;
  white-space: nowrap;
}
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
.filter-bar form input:not([type="checkbox"]),
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
.filter-reset {
  font: 13px/1.2 var(--sans-serif);
  color: inherit;
  padding: 2px 14px;
}
.filter-reset:disabled {
  visibility: hidden;
}
/* Per-chart filters (Group By, and Threshold on the "waiting more than"
   chart), duplicated under each time-series chart's heading instead of
   living in the shared filter-bar — kept visually smaller since each only
   scopes the one chart below it. */
.chart-groupby {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0.15rem 0 0.75rem;
}
.chart-groupby form {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
}
.chart-groupby form label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--theme-foreground-muted, #888);
  width: auto;
}
.chart-groupby form select {
  font-size: 0.75rem;
  width: auto;
}
/* Shared by the Project and Priority filters — both are multiselect
   dropdowns behind a collapsed panel (see multiSelectDropdown below). */
.filter-multiselect {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.filter-multiselect-control {
  display: flex;
  align-items: center;
  gap: 3.25px;
}
.multiselect-dropdown {
  position: relative;
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
}
.multiselect-dropdown-summary {
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
.multiselect-dropdown-summary:hover {
  background: var(--theme-background-alt, rgba(128, 128, 128, 0.1));
}
.multiselect-dropdown-panel {
  position: absolute;
  top: calc(100% + 0.25rem);
  left: 0;
  z-index: 20;
  width: 100%;
  background: var(--theme-background, #fff);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
}
.multiselect-dropdown-panel select {
  width: 100%;
  min-width: 0;
}
.multiselect-dropdown-panel label.multiselect-dropdown-showall {
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
.multiselect-dropdown-panel .multiselect-dropdown-showall input {
  width: auto;
}
</style>

```js
// Seeds filters from the URL (?pool=&project=&priority=&from=&to=&breakdown=&groupByWait=&groupByOver30m=&over30mThreshold=&scatterThreshold=)
// so a link with query params reproduces the same view. Only read once at
// load — this page has no client-side router, so there's nothing to react to
// on navigation.
const urlParams = new URLSearchParams(window.location.search);

const allDays = [...new Set(rows.map((r) => r.day))].filter(Boolean).sort();
const minDay = allDays[0];
const maxDay = allDays[allDays.length - 1];

// A multiselect, not a regex like the pool filter. Every distinct project is
// a real <option>, but only the top 15 by pending hours show by default —
// ranked by pending hours (not task hours) since this page is about waiting,
// not volume. Computed from the full, unfiltered dataset so the list never
// reshuffles as other filters change.
const PROJECT_TOP_N = 15;
const hoursByProjectAll = new Map();
for (const r of rows) hoursByProjectAll.set(r.project, (hoursByProjectAll.get(r.project) ?? 0) + (r.pending_hours ?? 0));
const ALL_PROJECTS = [...hoursByProjectAll.keys()];
const TOP_PROJECTS = [...hoursByProjectAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, PROJECT_TOP_N).map(([p]) => p);
const urlProjects = (urlParams.get("project") ?? "").split(",").filter((p) => ALL_PROJECTS.includes(p));

// Wraps a native Inputs.select(..., {multiple: true}) behind a collapsed
// panel so click / ctrl-click / shift-click / keyboard selection all behave
// like a normal multiselect; exposes the same `.value` + "input" event
// contract Generators.input relies on. Adapted from the Hourly Usage
// dashboard's project dropdown, generalized with a `sort` option (priority
// needs canonical Taskcluster order, not alphabetical) and a "Show all"
// toggle that only renders when there's actually a hidden tail to reveal.
function multiSelectDropdown(allOptions, visibleOptions, {label, value = [], sort = (a, b) => a.localeCompare(b)} = {}) {
  const sortedOptions = [...allOptions].sort(sort);
  const visibleSet = new Set(visibleOptions);
  const hasHidden = allOptions.length > visibleOptions.length;
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
  form.className = "multiselect-dropdown";

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "multiselect-dropdown-summary";

  const panel = document.createElement("div");
  panel.className = "multiselect-dropdown-panel";
  panel.hidden = true;
  panel.append(select);

  if (hasHidden) {
    const showAllLabel = document.createElement("label");
    showAllLabel.className = "multiselect-dropdown-showall";
    const showAllCheckbox = document.createElement("input");
    showAllCheckbox.type = "checkbox";
    showAllCheckbox.addEventListener("change", () => setShowAll(showAllCheckbox.checked));
    showAllLabel.append(showAllCheckbox, "All");
    panel.append(showAllLabel);
  }

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
const projectInput = multiSelectDropdown(ALL_PROJECTS, TOP_PROJECTS, {label: "Project", value: urlProjects});
const projects = Generators.input(projectInput);

const poolInput = Inputs.text({
  label: "Worker pool (regex)",
  placeholder: "e.g. ^releng-hardware/",
  value: urlParams.get("pool") ?? "",
  submit: true
});
const poolPattern = Generators.input(poolInput);

// No "All" sentinel, same convention as the project filter: an empty
// selection means "all priorities", not "none". All 8 values are always
// visible (no top-N truncation needed), sorted in canonical Taskcluster
// order rather than alphabetically — the whole point of this dimension is
// the monotonic degradation from highest to lowest, which an alphabetical
// list would obscure.
const urlPriorities = (urlParams.get("priority") ?? "").split(",").filter((p) => PRIORITY_ORDER.includes(p));
const priorityInput = multiSelectDropdown(PRIORITY_ORDER, PRIORITY_ORDER, {
  label: "Priority",
  value: urlPriorities,
  sort: (a, b) => PRIORITY_ORDER.indexOf(a) - PRIORITY_ORDER.indexOf(b)
});
const selectedPriorities = Generators.input(priorityInput);

// Kept free of reactive dependencies: re-running this cell would rebuild the
// control, losing the typed range and the user's focus.
const dateRangeInput = dateRangeControl({
  minDay,
  maxDay,
  from: urlParams.get("from"),
  to: urlParams.get("to")
});
const dateRange = Generators.input(dateRangeInput);
function setDateRange(v) {
  dateRangeInput.setRange(v);
}

const BREAKDOWN_OPTIONS = ["worker_pool", "project", "priority"];
const BREAKDOWN_LABELS = {worker_pool: "Worker Pool", project: "Project", priority: "Priority"};
const initialBreakdown = BREAKDOWN_OPTIONS.includes(urlParams.get("breakdown")) ? urlParams.get("breakdown") : "worker_pool";
const breakdownInput = Inputs.select(BREAKDOWN_OPTIONS, {
  label: "Breakdown",
  value: initialBreakdown,
  format: (d) => BREAKDOWN_LABELS[d]
});
const breakdown = Generators.input(breakdownInput);

// Group By is per-chart, not global (see waitProfileGroupByInput /
// over30mGroupByInput below) — each of the two time-series charts gets its
// own small selector under its heading, affecting only that chart.
const GROUP_BY_OPTIONS = ["day", "week", "month"];
function makeGroupByInput(param) {
  const initial = GROUP_BY_OPTIONS.includes(urlParams.get(param)) ? urlParams.get(param) : "day";
  return Inputs.select(GROUP_BY_OPTIONS, {
    label: "Group by",
    value: initial,
    format: (d) => d[0].toUpperCase() + d.slice(1)
  });
}
const waitProfileGroupByInput = makeGroupByInput("groupByWait");
const waitProfileGroupBy = Generators.input(waitProfileGroupByInput);
const over30mGroupByInput = makeGroupByInput("groupByOver30m");
const over30mGroupBy = Generators.input(over30mGroupByInput);

// Threshold, per-chart like Group By above — reuses the same
// over30m/over1h/over2h/over4h/expiredShare fields deriveAgg already
// computes for the "Waiting more than" stat card. Shared by the "share of
// runs waiting more than ___" line chart and the volume-vs-wait bubble
// chart, each with its own selector and URL param.
const THRESHOLD_OPTIONS = ["30m", "1h", "2h", "4h", "Expired"];
const THRESHOLD_FIELD = {"30m": "over30m", "1h": "over1h", "2h": "over2h", "4h": "over4h", Expired: "expiredShare"};
// "Expired" isn't a "waited more than X" threshold like the other four —
// it's its own share, not a cumulative one — so it needs its own phrasing
// everywhere a threshold label gets stitched into chart text.
function thresholdPhrase(threshold) {
  return threshold === "Expired" ? "deadline-exceeded" : `waiting > ${threshold}`;
}
function makeThresholdInput(param) {
  const initial = THRESHOLD_OPTIONS.includes(urlParams.get(param)) ? urlParams.get(param) : "30m";
  return Inputs.select(THRESHOLD_OPTIONS, {
    label: "Threshold",
    value: initial,
    // Display-only abbreviation — THRESHOLD_OPTIONS/THRESHOLD_FIELD/the URL
    // param and thresholdPhrase() all keep using "Expired" as the value, so
    // this doesn't ripple into any of that; it just keeps the dropdown from
    // being the one option wider than "30m"/"1h"/"2h"/"4h".
    format: (d) => (d === "Expired" ? "D-E" : d)
  });
}
const over30mThresholdInput = makeThresholdInput("over30mThreshold");
const over30mThreshold = Generators.input(over30mThresholdInput);
const scatterThresholdInput = makeThresholdInput("scatterThreshold");
const scatterThreshold = Generators.input(scatterThresholdInput);
```

<div class="filter-bar">
  <div>${poolInput}</div>
  <div class="filter-multiselect">
    <span class="filter-daterange-label">Project</span>
    <div class="filter-multiselect-control">
      ${projectInput}
      ${htl.html`<button class="filter-reset" disabled=${projects.length === 0} onclick=${() => projectInput.clear()}>Reset</button>`}
    </div>
  </div>
  <div class="filter-multiselect">
    <span class="filter-daterange-label">Priority</span>
    <div class="filter-multiselect-control">
      ${priorityInput}
      ${htl.html`<button class="filter-reset" disabled=${selectedPriorities.length === 0} onclick=${() => priorityInput.clear()}>Reset</button>`}
    </div>
  </div>
  <div class="filter-daterange">
    <span class="filter-daterange-label">Date range</span>
    ${dateRangeInput}
  </div>
  <div>${breakdownInput}</div>
</div>

```js
// Keeps the URL in sync with the current filters so the view is linkable/
// bookmarkable. Deliberately its own cell, separate from the one declaring
// the date-range control — merging them would make this effect's dependency
// on the other filters re-run that cell too, rebuilding the control (and
// losing the selected range) on every filter change.
{
  const params = new URLSearchParams(window.location.search);
  const set = (key, val) => (val ? params.set(key, val) : params.delete(key));
  set("pool", poolPattern || null);
  set("project", projects.length ? projects.join(",") : null);
  set("priority", selectedPriorities.length ? selectedPriorities.join(",") : null);
  set("from", dateRange ? isoDate(dateRange[0]) : null);
  set("to", dateRange ? isoDate(dateRange[1]) : null);
  set("breakdown", breakdown !== "worker_pool" ? breakdown : null);
  set("groupByWait", waitProfileGroupBy !== "day" ? waitProfileGroupBy : null);
  set("groupByOver30m", over30mGroupBy !== "day" ? over30mGroupBy : null);
  set("over30mThreshold", over30mThreshold !== "30m" ? over30mThreshold : null);
  set("scatterThreshold", scatterThreshold !== "30m" ? scatterThreshold : null);
  const qs = params.toString();
  history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
}
```

```js
// Compiled in this cell (not a helper declared alongside poolPattern)
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

// Null dateRange means the full window. It's already ordered, whole-day and
// in-window — the control normalizes every path that sets it.
const [rangeStart, rangeEnd] = dateRange ? [isoDate(dateRange[0]), isoDate(dateRange[1])] : [minDay, maxDay];

const projectSet = new Set(projects);
const prioritySet = new Set(selectedPriorities);
const passFilters = (r) =>
  (!poolRegex || poolRegex.test(r.worker_pool)) &&
  (projectSet.size === 0 || projectSet.has(r.project)) &&
  (prioritySet.size === 0 || prioritySet.has(r.priority));

// The wait-profile chart's inputs are filtered but NOT date-filtered, so it
// always shows (and can brush) the full window regardless of the selected
// range.
const scopeRows = rows.filter(passFilters);
const rangeRows = scopeRows.filter((r) => r.day >= rangeStart && r.day <= rangeEnd);
const daysInRange = new Set(rangeRows.map((r) => r.day)).size;

const waitProfileDayBucket = dayBucketFn(waitProfileGroupBy);
const waitProfilePartialSet = partialDayBuckets(allDays, waitProfileDayBucket, waitProfileGroupBy);
const over30mDayBucket = dayBucketFn(over30mGroupBy);

// Page-wide totals, for the stat cards. addRow already folds the
// deadline-exceeded contribution into totals.runs/pendingHours/counts.
const totalAggs = aggregateBy(rangeRows, () => "all");
const totals = deriveAgg(totalAggs[0] ?? emptyAgg("all"));
// Computed directly rather than derived from `totals`, so the "Expired"
// stat's rate doesn't depend on how deriveAgg happens to be shaped.
// Denominator is "every task attempt" (started runs + tasks that never got
// the chance to), not just expiredTotal on its own, which would be a count
// with no sense of scale.
const startedRunsTotal = rangeRows.reduce((sum, r) => sum + (r.runs ?? 0), 0);
const expiredTotal = rangeRows.reduce((sum, r) => sum + (r.expired_runs ?? 0), 0);
const expiredRate = startedRunsTotal + expiredTotal > 0 ? expiredTotal / (startedRunsTotal + expiredTotal) : null;

// Follows the Breakdown select, like the composition and over30m charts
// below — lets "worst X by rate" be compared against "worst X by volume" at
// whichever grain (worker pool/project/priority) is currently selected.
const poolAggs = aggregateBy(rangeRows, (r) => r[breakdown])
  .map(deriveAgg)
  .filter((a) => a.runs > 0 && a.over30m != null);

// Hoisted out of poolScatterChart so the bubble chart's heading (which needs
// the "(top N, rest as Other)" qualifier) can be rendered as HTML above the
// chart, under which the threshold selector sits, rather than duplicating
// this computation.
const scatterScale = seriesScale(rangeRows, breakdown);
const scatterTopSuffix = scatterScale.order.includes("Other") ? ` (top ${scatterScale.order.length - 1}, rest as Other)` : "";

// Follows the Breakdown select — feeds both the composition chart and the
// table below.
const breakdownAggs = aggregateBy(rangeRows, (r) => r[breakdown])
  .map(deriveAgg)
  .filter((a) => a.runs > 0);
const breakdownSorted = [...breakdownAggs].sort((a, b) => b.pendingHours - a.pendingHours);

const BREAKDOWN_TOP_N = 15;
// Priority (8 values, ordinal) never collapses; worker_pool (225) and
// project (61) do. The tail is summed into one "Other" row via mergeAgg —
// the same sum/max rule used everywhere else — so the composition chart's
// buckets still add up to 100% instead of silently dropping the tail.
function collapseBreakdown(aggs, keyName) {
  if (keyName === "priority") {
    const present = new Set(aggs.map((a) => a.key));
    return {rows: aggs, domain: PRIORITY_ORDER.filter((p) => present.has(p)), otherCount: 0};
  }
  if (aggs.length <= BREAKDOWN_TOP_N) {
    const sorted = [...aggs].sort((a, b) => b.pendingHours - a.pendingHours);
    return {rows: sorted, domain: sorted.map((a) => a.key), otherCount: 0};
  }
  const sorted = [...aggs].sort((a, b) => b.pendingHours - a.pendingHours);
  const top = sorted.slice(0, BREAKDOWN_TOP_N);
  const rest = sorted.slice(BREAKDOWN_TOP_N);
  const otherAgg = rest.reduce((acc, a) => mergeAgg(acc, a), emptyAgg(`Other (${rest.length})`));
  const other = deriveAgg(otherAgg);
  return {rows: [...top, other], domain: [...top.map((a) => a.key), other.key], otherCount: rest.length};
}
const collapsed = collapseBreakdown(breakdownAggs, breakdown);

function compositionRows(aggs) {
  return aggs.flatMap((a) =>
    BUCKET_LABELS.map((bucket, i) => ({
      key: a.key,
      bucket,
      share: a.bucketTotal > 0 ? a.counts[i] / a.bucketTotal : 0
    }))
  );
}

// Splits the days in range in half to see whether each breakdown key's p90 is
// trending up or down. Only a real (finite) number on both sides is
// comparable — a percentile that's null (too few runs) or Infinity (censored
// by the open >=4h bucket) can't be subtracted without fabricating a number.
const rangeDays = [...new Set(rangeRows.map((r) => r.day))].sort();
const splitAt = Math.floor(rangeDays.length / 2);
const firstHalfDays = new Set(rangeDays.slice(0, splitAt));
const secondHalfDays = new Set(rangeDays.slice(splitAt));
function halfDeltaP90(inputRows, keyFn) {
  const firstAggs = new Map();
  const secondAggs = new Map();
  for (const r of inputRows) {
    const key = keyFn(r);
    if (firstHalfDays.has(r.day)) {
      const agg = firstAggs.get(key) ?? emptyAgg(key);
      addRow(agg, r);
      firstAggs.set(key, agg);
    } else if (secondHalfDays.has(r.day)) {
      const agg = secondAggs.get(key) ?? emptyAgg(key);
      addRow(agg, r);
      secondAggs.set(key, agg);
    }
  }
  const deltas = new Map();
  for (const key of new Set([...firstAggs.keys(), ...secondAggs.keys()])) {
    const p1 = pctSeconds(histPercentile((firstAggs.get(key) ?? emptyAgg(key)).counts, 0.9));
    const p2 = pctSeconds(histPercentile((secondAggs.get(key) ?? emptyAgg(key)).counts, 0.9));
    deltas.set(key, Number.isFinite(p1) && Number.isFinite(p2) ? p2 - p1 : null);
  }
  return deltas;
}
const halfDeltas = halfDeltaP90(rangeRows, (r) => r[breakdown]);
const tableRows = breakdownSorted.map((a) => ({...a, deltaP90: halfDeltas.get(a.key) ?? null}));
```

<div class="grid grid-cols-3">
  <div class="card">
    <h2>Task runs</h2>
    <span class="big">${fmtNumber(totals.runs)}</span>
    <span class="muted">${daysInRange ? `${fmtNumber(totals.runs / daysInRange)} / day over ${daysInRange} days` : "no days in range"}</span>
  </div>
  <div class="card">
    <h2>Pending hours</h2>
    <span class="big">${fmtNumber(totals.pendingHours)}</span>
    <span class="muted">${daysInRange ? `${fmtNumber(totals.pendingHours / daysInRange)} / day` : "—"}</span>
  </div>
  <div class="card">
    <h2>Mean wait</h2>
    <span class="big">${fmtSeconds(totals.meanWaitS)}</span>
    <span class="muted">across ${fmtNumber(poolAggs.length)} ${BREAKDOWN_LABELS[breakdown].toLowerCase()}(s)</span>
  </div>
</div>

<div class="grid grid-cols-2">
  <div class="card">
    <h2>Wait percentiles</h2>
    <div class="stat-row">
      <div class="stat-item">
        <span class="stat-label">p50</span>
        <span class="stat-value">${fmtSeconds(totals.p50)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">p90</span>
        <span class="stat-value">${fmtSeconds(totals.p90)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">p95</span>
        <span class="stat-value">${fmtSeconds(totals.p95)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">p99</span>
        <span class="stat-value">${fmtSeconds(totals.p99)}</span>
      </div>
    </div>
  </div>
  <div class="card">
    <h2>Waiting more than</h2>
    <div class="stat-row">
      <div class="stat-item">
        <span class="stat-label">30m</span>
        <span class="stat-value">${fmtPercent(totals.over30m)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">1h</span>
        <span class="stat-value">${fmtPercent(totals.over1h)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">2h</span>
        <span class="stat-value">${fmtPercent(totals.over2h)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">4h</span>
        <span class="stat-value">${fmtPercent(totals.over4h)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Expired</span>
        <span class="stat-value">${fmtPercent(expiredRate)}</span>
      </div>
    </div>
  </div>
</div>

```js
// Built from scopeRows (filtered, but NOT date filtered) so the full window
// stays brushable no matter how narrow the selected range is.
function waitProfileChart({width} = {}) {
  const dayAggs = aggregateByDay(scopeRows, () => "all", waitProfileDayBucket).map(deriveAgg);
  const data = dayAggs.flatMap((a) =>
    BUCKET_LABELS.map((bucket, i) => ({
      day: new Date(a.day),
      bucket,
      share: a.bucketTotal > 0 ? a.counts[i] / a.bucketTotal : 0,
      runs: a.counts[i],
      partial: waitProfilePartialSet.has(a.day)
    }))
  );
  if (!data.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  const height = 320;
  const plot = Plot.plot({
    width,
    height,
    x: {type: "utc", label: "Date"},
    y: {label: "Share of runs", tickFormat: ".0%", domain: [0, 1]},
    color: {domain: BUCKET_LABELS, range: BUCKET_COLORS, legend: true},
    marks: [
      Plot.rectY(
        data,
        Plot.stackY({
          x: "day",
          y: "share",
          fill: "bucket",
          // Slowest buckets stack from the axis up: at full scope, waits
          // over 30m are only ~5% of runs, so anchoring them to zero keeps
          // them visible instead of floating as a sliver on top of a
          // dominant <1m band.
          order: [...BUCKET_LABELS].reverse(),
          interval: waitProfileGroupBy,
          fillOpacity: (d) => (d.partial ? 0.45 : 1),
          // stackY's own x/y/y1/y2/fill channels would otherwise show the
          // internal stacked band and raw field names, so they're replaced
          // with explicit "Key:" channels for a tip consistent with the
          // other charts on this page.
          channels: {
            "Bucket:": (d) => `${d.bucket}${d.partial ? " (partial)" : ""}`,
            "Percentage:": (d) => fmtPercent(d.share),
            "Runs:": (d) => fmtNumber(d.runs)
          },
          tip: {format: {x: false, y: false, y1: false, y2: false, fill: false, fillOpacity: false}}
        })
      ),
      Plot.ruleY([0])
    ]
  });

  return attachDateBrush(plot, {height, dateRange, setDateRange});
}
```

<div class="grid grid-cols-1">
  <div class="card">
    <h2>Share of runs by wait time, per ${waitProfileGroupBy} — drag to select a date range, click to clear</h2>
    <div class="chart-groupby">${waitProfileGroupByInput}</div>
    ${resize((width) => waitProfileChart({width}))}
  </div>
</div>

${waitProfilePartialSet.size ? htl.html`<p class="muted">The first and/or last ${waitProfileGroupBy} in range is partial (doesn't span a full ${waitProfileGroupBy}) and is drawn at reduced opacity above — its total isn't comparable to a full ${waitProfileGroupBy}.</p>` : ""}

```js
// Exact under any filter (it's a ratio of two additive quantities), and
// readable at any magnitude — unlike the stacked chart above, which gets
// hard to read once wait times shrink to a couple of percent.
function over30mChart({width} = {}) {
  const field = THRESHOLD_FIELD[over30mThreshold];
  const scale = seriesScale(scopeRows, breakdown);
  const dayAggs = aggregateByDay(scopeRows, (r) => scale.bucket(r[breakdown]), over30mDayBucket)
    .map(deriveAgg)
    .filter((a) => a[field] != null);
  if (!dayAggs.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  const data = dayAggs.map((d) => ({...d, day: new Date(d.day)}));
  const plot = Plot.plot({
    width,
    height: 320,
    x: {type: "utc", label: "Date"},
    y: {label: `Share ${thresholdPhrase(over30mThreshold)}`, tickFormat: ".0%", grid: true, zero: true},
    color: {legend: true, domain: scale.order, range: scale.range},
    marks: [
      Plot.lineY(data, {
        x: "day",
        y: field,
        stroke: "key",
        // x/y/stroke's default tip labels ("Date", "Share waiting > …",
        // "key") aren't all colon-friendly renamable in place, so they're
        // suppressed here and replaced with explicit "Key:" channels.
        channels: {
          "Date:": (d) => isoDate(d.day),
          [`${BREAKDOWN_LABELS[breakdown]}:`]: (d) => d.key,
          [`Share ${thresholdPhrase(over30mThreshold)}:`]: (d) => fmtPercent(d[field])
        },
        tip: {format: {x: false, y: false, stroke: false, z: false}}
      }),
      Plot.ruleY([0])
    ]
  });

  // Same legend-swatch-hover highlighting as the bubble chart below: dim
  // every other series and bold the hovered one. Unlike the bubble chart,
  // each key here is unambiguously a single line (the day aggregation
  // itself groups by the collapsed key, so "Other" is one line too) — no
  // need to guard the tip-firing on a single-match count.
  const mainSvg = plot.tagName === "svg" ? plot : plot.querySelector(":scope > svg");
  const linePaths = [...mainSvg.querySelectorAll('g[aria-label="line"] path')];
  const pathsByColorKey = new Map();
  scale.order.forEach((key, i) => {
    const color = scale.range[i];
    pathsByColorKey.set(key, linePaths.filter((p) => p.getAttribute("stroke") === color));
  });

  // Plot's tip finds the nearest *discrete data point* across every series
  // (not just the hovered one) to wherever the pointer lands, so the
  // synthetic hover has to land exactly on one of this key's real (day,
  // value) rows — anywhere else (e.g. an interpolated point along the
  // rendered curve) can be pixel-closer to a different series' point,
  // which was the "wrong key" bug. Landing on the day where this key's
  // value peaks, rather than e.g. its first day, also avoids the case
  // where many series sit at/near zero together and tie.
  const xScale = plot.scale("x");
  const yScale = plot.scale("y");
  const peakRowByKey = new Map();
  for (const d of data) {
    const current = peakRowByKey.get(d.key);
    if (!current || d[field] > current[field]) peakRowByKey.set(d.key, d);
  }

  function fireTipEvent(type, key) {
    const row = peakRowByKey.get(key);
    const path = pathsByColorKey.get(key)?.[0];
    if (!row || !path) return;
    // xScale/yScale.apply() return coordinates in the same local SVG
    // user-space the mark itself was drawn in, so this path's own CTM (not
    // a plain getBoundingClientRect offset, which ignores any internal
    // viewBox scaling) converts them to real client coordinates.
    const ctm = path.getScreenCTM();
    const x = xScale.apply(row.day);
    const y = yScale.apply(row[field]);
    path.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      clientX: ctm.a * x + ctm.c * y + ctm.e,
      clientY: ctm.b * x + ctm.d * y + ctm.f,
      pointerType: "mouse"
    }));
  }

  function setHighlight(activePaths) {
    const activeSet = new Set(activePaths);
    for (const p of linePaths) {
      const isActive = activeSet.size === 0 || activeSet.has(p);
      p.style.opacity = isActive ? "" : "0.15";
      p.style.strokeWidth = activeSet.has(p) ? "3" : "";
    }
  }

  const swatches = [...plot.querySelectorAll('span[class*="-swatch"]')];
  swatches.forEach((swatch, i) => {
    const key = scale.order[i];
    const paths = pathsByColorKey.get(key) ?? [];
    swatch.style.cursor = "default";
    swatch.addEventListener("mouseenter", () => {
      setHighlight(paths);
      fireTipEvent("pointerenter", key);
      fireTipEvent("pointermove", key);
    });
    swatch.addEventListener("mouseleave", () => {
      fireTipEvent("pointerleave", key);
      setHighlight([]);
    });
  });

  return plot;
}
```

<div class="grid grid-cols-1">
  <div class="card">
    <h2>Share of runs ${thresholdPhrase(over30mThreshold)} per ${over30mGroupBy}, by ${BREAKDOWN_LABELS[breakdown].toLowerCase()}</h2>
    <div class="chart-groupby">${over30mGroupByInput}${over30mThresholdInput}</div>
    ${resize((width) => over30mChart({width}))}
  </div>
</div>

```js
// Resolves, visually, the fact that two sensible "worst X" rankings
// disagree: a key with a tiny run count can have a near-total >30m rate,
// while a key with a huge run count can rack up more total pending hours at
// a modest rate. Bubble size (pending hours) makes both readable at once.
// Follows the Breakdown select — same grain as poolAggs above.
function poolScatterChart({width} = {}) {
  const field = THRESHOLD_FIELD[scatterThreshold];
  const scatterAggs = poolAggs.filter((a) => a[field] != null);
  if (!scatterAggs.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  // Colors, rather than labels overlaid on the chart, identify each key —
  // same scale used by the over30m chart: top-10-plus-Other for
  // worker_pool/project, full ordinal domain for priority. Each key stays
  // its own bubble even when bucketed into "Other"; only the color is
  // shared, not the data point.
  const scale = scatterScale;
  const data = scatterAggs.map((a) => ({...a, colorKey: scale.bucket(a.key)}));
  const plot = Plot.plot({
    width,
    height: 440,
    marginBottom: 40,
    x: {label: "Task runs in range", grid: true},
    y: {label: `Share of runs ${thresholdPhrase(scatterThreshold)}`, tickFormat: ".0%", grid: true},
    r: {range: [2, 24]},
    color: {domain: scale.order, range: scale.range, legend: true},
    marks: [
      Plot.dot(data, {
        x: "runs",
        y: field,
        r: "pendingHours",
        fill: "colorKey",
        fillOpacity: 0.6,
        stroke: "colorKey",
        // colorKey collapses non-top-N keys into "Other", so it's suppressed
        // from the tip in favor of the real (uncollapsed) key below.
        channels: {
          [`${BREAKDOWN_LABELS[breakdown]}:`]: (d) => d.key,
          "Runs:": (d) => fmtNumber(d.runs),
          [`Share ${thresholdPhrase(scatterThreshold)}:`]: (d) => fmtPercent(d[field]),
          "Pending hours:": (d) => fmtNumber(d.pendingHours)
        },
        tip: {format: {x: false, y: false, r: false, fill: false, stroke: false}}
      }),
      Plot.ruleY([0])
    ]
  });

  // Wires the legend swatches (plain <span>s Plot renders for a categorical
  // color scale, in the same order as color.domain) up to the dots sharing
  // their colorKey: dim every other bubble, and — since Plot's tip mark
  // listens for real pointer events on the SVG rather than exposing an
  // imperative "show tip for index N" API — synthesize the same pointerenter/
  // pointermove events a real hover would send, positioned at that circle's
  // current screen coordinates, to reuse Plot's own tip rendering. Only done
  // for a single-bubble key (every priority value, or a top-10 pool/project);
  // "Other" maps to many bubbles, and there's no single point a tip could
  // honestly describe.
  // Grouped by the circle's own rendered `fill` attribute rather than
  // zipping `data` against the DOM by index — Plot draws dots sorted by
  // radius (biggest first, so small bubbles aren't hidden underneath), so
  // the rendered <circle> order doesn't match `data`'s order. The fill
  // color is unambiguous, since it's the colorKey channel Plot just used.
  const mainSvg = plot.tagName === "svg" ? plot : plot.querySelector(":scope > svg");
  const dotCircles = [...mainSvg.querySelectorAll('g[aria-label="dot"] circle')];
  const circlesByColorKey = new Map();
  scale.order.forEach((key, i) => {
    const color = scale.range[i];
    circlesByColorKey.set(key, dotCircles.filter((c) => c.getAttribute("fill") === color));
  });

  function fireTipEvent(type, circle) {
    const rect = circle.getBoundingClientRect();
    circle.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      pointerType: "mouse"
    }));
  }

  function setHighlight(activeCircles) {
    const activeSet = new Set(activeCircles);
    for (const c of dotCircles) {
      const isActive = activeSet.size === 0 || activeSet.has(c);
      c.style.opacity = isActive ? "" : "0.15";
      c.style.strokeWidth = activeSet.has(c) ? "2.5" : "";
    }
  }

  const swatches = [...plot.querySelectorAll('span[class*="-swatch"]')];
  swatches.forEach((swatch, i) => {
    const circles = circlesByColorKey.get(scale.order[i]) ?? [];
    swatch.style.cursor = "default";
    swatch.addEventListener("mouseenter", () => {
      setHighlight(circles);
      if (circles.length === 1) {
        fireTipEvent("pointerenter", circles[0]);
        fireTipEvent("pointermove", circles[0]);
      }
    });
    swatch.addEventListener("mouseleave", () => {
      if (circles.length === 1) fireTipEvent("pointerleave", circles[0]);
      setHighlight([]);
    });
  });

  return plot;
}
```

<div class="grid grid-cols-1">
  <div class="card">
    <h2>Volume vs. wait by ${BREAKDOWN_LABELS[breakdown].toLowerCase()} — bubble size is total pending hours, color by ${BREAKDOWN_LABELS[breakdown].toLowerCase()}${scatterTopSuffix}</h2>
    <div class="chart-groupby">${scatterThresholdInput}</div>
    ${resize((width) => poolScatterChart({width}))}
  </div>
</div>

```js
function compositionChart({width} = {}) {
  if (!collapsed.domain.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  const data = compositionRows(collapsed.rows);
  const marginLeft = Math.min(320, Math.max(120, Math.max(...collapsed.domain.map((k) => k.length)) * 6.5));
  return Plot.plot({
    title: collapsed.otherCount
      ? `Wait-time composition by ${BREAKDOWN_LABELS[breakdown].toLowerCase()} — top ${BREAKDOWN_TOP_N} of ${breakdownAggs.length}`
      : `Wait-time composition by ${BREAKDOWN_LABELS[breakdown].toLowerCase()}`,
    width,
    height: Math.max(220, collapsed.domain.length * 26 + 60),
    marginLeft,
    y: {label: null, domain: collapsed.domain},
    x: {label: "Share of runs", tickFormat: ".0%", domain: [0, 1]},
    color: {domain: BUCKET_LABELS, range: BUCKET_COLORS, legend: true},
    marks: [
      Plot.barX(data, {
        y: "key",
        x: "share",
        fill: "bucket",
        order: BUCKET_LABELS,
        channels: {
          [`${BREAKDOWN_LABELS[breakdown]}:`]: (d) => d.key,
          "Bucket:": (d) => d.bucket,
          "Share:": (d) => fmtPercent(d.share)
        },
        tip: {format: {x: false, y: false, fill: false}}
      }),
      Plot.ruleX([0])
    ]
  });
}
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => compositionChart({width}))}
  </div>
</div>

```js
Inputs.table(tableRows, {
  columns: ["key", "runs", "pendingHours", "avgPendingHoursPerTask", "p50", "p90", "p99", "over30m", "over4h", "maxS", "deltaP90"],
  header: {
    key: BREAKDOWN_LABELS[breakdown],
    runs: "Task runs",
    pendingHours: "Pending hours",
    avgPendingHoursPerTask: "Avg pending hrs / task",
    p50: "p50",
    p90: "p90",
    p99: "p99",
    over30m: "> 30m",
    over4h: "≥ 4h",
    maxS: "Worst wait",
    deltaP90: "Δ p90, 1st→2nd half"
  },
  format: {
    runs: fmtNumber,
    pendingHours: fmtNumber,
    avgPendingHoursPerTask: fmtDecimal,
    p50: fmtSeconds,
    p90: fmtSeconds,
    p99: fmtSeconds,
    over30m: fmtPercent,
    over4h: fmtPercent,
    maxS: fmtSeconds,
    deltaP90: fmtDeltaSeconds
  },
  select: false
})
```

```js
// The query guarantees bucket counts sum to `runs` exactly; if that ever
// drifts (e.g. a future edit to the query), every share and percentile above
// becomes misleading rather than merely different, so it's surfaced rather
// than assumed. Mirrors addRow's own runs/expired_runs handling — otherwise
// this would falsely alarm, since totals.runs includes expired_runs that a
// plain sum of `r.runs` wouldn't.
const rangeRunsTotal = rangeRows.reduce((a, r) => a + (r.runs ?? 0) + (r.expired_runs ?? 0), 0);
const bucketDrift = rangeRunsTotal > 0 ? Math.abs(totals.bucketTotal - rangeRunsTotal) / rangeRunsTotal : 0;
const DRIFT_ALARM = 0.001;

const suppressedCount = breakdownAggs.filter((a) => histPercentile(a.counts, 0.9).state === "insufficient").length;
const censoredCount = breakdownAggs.filter((a) => a.p90 === Infinity).length;
```

${bucketDrift > DRIFT_ALARM ? htl.html`<p class="muted"><strong>Data check:</strong> wait-time bucket counts and total task runs disagree by ${fmtPercent(bucketDrift)} in this range — treat every share and percentile on this page as approximate until that's resolved.</p>` : ""}

${suppressedCount > 0 ? htl.html`<p class="muted">${fmtNumber(suppressedCount)} ${BREAKDOWN_LABELS[breakdown].toLowerCase()}(s) in the table have too few runs for a p90 to be meaningful and show "—" instead.</p>` : ""}

${censoredCount > 0 ? htl.html`<p class="muted">${fmtNumber(censoredCount)} ${BREAKDOWN_LABELS[breakdown].toLowerCase()}(s) have a p90 that falls in the open-ended ≥ 4h bucket and show "> 4h" rather than a fabricated number.</p>` : ""}

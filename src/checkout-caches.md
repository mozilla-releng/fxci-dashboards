---
title: Checkout Caches
toc: false
---

# Checkout Caches

Firefox-CI tasks can use a persistent checkout cache to avoid needing a full
clone. Each task falls into one of three states, from best to worst:

- **nopull** - checkout exists and desired revision was already present
- **pull** - checkout exists but desired revision needed to be fetched
- **clone** - checkout did not exist and full clone was required

"Cache hit rate" below means the share of checkouts that avoided a full clone
(`nopull` + `pull`). See `data/_queries.yaml` for which query backs this page.

```js
const rows = await FileAttachment("data/checkout-caches-workerpool.json").json();
```

```js
function fmtNumber(v) {
  return v == null ? "—" : v.toLocaleString("en-US");
}
function fmtPercent(v) {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function aggregateByPool(inputRows) {
  const byPool = new Map();
  for (const r of inputRows) {
    const a = byPool.get(r.worker_pool) ?? {worker_pool: r.worker_pool, tasks: 0, nopull: 0, pull: 0, clone: 0};
    a.tasks += r.tasks ?? 0;
    a.nopull += r.nopull ?? 0;
    a.pull += r.pull ?? 0;
    a.clone += r.clone ?? 0;
    byPool.set(r.worker_pool, a);
  }
  return [...byPool.values()]
    .map((a) => ({
      ...a,
      hitRate: a.tasks > 0 ? (a.nopull + a.pull) / a.tasks : null,
      cloneRate: a.tasks > 0 ? a.clone / a.tasks : null,
      pullRate: a.tasks > 0 ? a.pull / a.tasks : null,
      nopullRate: a.tasks > 0 ? a.nopull / a.tasks : null
    }))
    .sort((a, b) => b.tasks - a.tasks);
}

function aggregateByDay(inputRows) {
  const days = [...new Set(inputRows.map((r) => r.day))].filter(Boolean).sort();
  const byDay = new Map();
  for (const r of inputRows) {
    const a = byDay.get(r.day) ?? {day: r.day, tasks: 0, nopull: 0, pull: 0, clone: 0};
    a.tasks += r.tasks ?? 0;
    a.nopull += r.nopull ?? 0;
    a.pull += r.pull ?? 0;
    a.clone += r.clone ?? 0;
    byDay.set(r.day, a);
  }
  return days.map((d) => byDay.get(d));
}
```

Filters apply to every chart, stat, and the table below. Drag on the
full-clone chart to restrict the date range; click it to clear.

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
.filter-bar form input {
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
// Seeds filters from the URL (?project=&pool=&from=&to=) so a link with
// query params reproduces the same view. Only read once at load — this page
// has no client-side router, so there's nothing to react to on navigation.
const urlParams = new URLSearchParams(window.location.search);

const allDays = [...new Set(rows.map((r) => r.day))].filter(Boolean).sort();
const minDay = allDays[0];
const maxDay = allDays[allDays.length - 1];

const allProjects = [...new Set(rows.map((r) => r.project))].filter(Boolean).sort();
const urlProject = urlParams.get("project");
const projectInput = Inputs.select(["All", ...allProjects], {label: "Project", value: allProjects.includes(urlProject) ? urlProject : "All"});
const project = Generators.input(projectInput);

const poolInput = Inputs.text({label: "Worker pool (regex)", placeholder: "e.g. gecko-.*win", value: urlParams.get("pool") ?? "", submit: true});
const poolPattern = Generators.input(poolInput);

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
  <div>${poolInput}</div>
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
// on poolPattern/project re-run that cell too, recreating (and resetting) the
// Mutable on every keystroke.
{
  const params = new URLSearchParams(window.location.search);
  const set = (key, val) => (val ? params.set(key, val) : params.delete(key));
  set("project", project !== "All" ? project : null);
  set("pool", poolPattern || null);
  set("from", dateRange ? isoDate(dateRange[0]) : null);
  set("to", dateRange ? isoDate(dateRange[1]) : null);
  const qs = params.toString();
  history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
}
```

```js
// Defaults to the full available window until the user brushes the
// full-clone chart. dateRange is trusted as already-ordered/in-range since
// it's only ever set from the brush's own (already-clamped) invert() output.
const [rangeStart, rangeEnd] = dateRange
  ? [isoDate(dateRange[0]), isoDate(dateRange[1])]
  : [minDay, maxDay];

// Compiled here (rather than in a helper function defined alongside
// poolPattern's own declaration) because a plain function declaration in an
// earlier cell captures a stale snapshot of poolPattern that never updates —
// this cell is the one that's actually re-run reactively on every change.
// Invalid regex falls back to "no filter" rather than breaking the page.
let poolRegex = null;
if (poolPattern) {
  try {
    poolRegex = new RegExp(poolPattern, "i");
  } catch {
    poolRegex = null;
  }
}

// The picker chart deliberately filters by project/pool only, not by date —
// it needs to keep showing the full window so there's always something to
// brush, even after the date range has been narrowed.
const poolRows = rows.filter(
  (r) => (project === "All" || r.project === project) && (!poolRegex || poolRegex.test(r.worker_pool))
);
const dailyTotals = aggregateByDay(poolRows);

const filteredRows = poolRows.filter((r) => r.day == null || (r.day >= rangeStart && r.day <= rangeEnd));
const pools = aggregateByPool(filteredRows);

const overall = pools.reduce(
  (acc, p) => ({tasks: acc.tasks + p.tasks, nopull: acc.nopull + p.nopull, pull: acc.pull + p.pull, clone: acc.clone + p.clone}),
  {tasks: 0, nopull: 0, pull: 0, clone: 0}
);
const overallHitRate = overall.tasks > 0 ? (overall.nopull + overall.pull) / overall.tasks : null;
```

<div class="grid grid-cols-3">
  <div class="card">
    <h2>Cache hit rate <span class="muted">— avoided a full clone</span></h2>
    <span class="big">${fmtPercent(overallHitRate)}</span>
  </div>
  <div class="card">
    <h2>Total checkouts</h2>
    <span class="big">${fmtNumber(overall.tasks)}</span>
  </div>
  <div class="card">
    <h2>Full clones (misses)</h2>
    <span class="big">${fmtNumber(overall.clone)}</span>
  </div>
</div>

```js
// Doubles as the date-range picker: dragging draws a d3 brush over it, and
// the resulting pixel selection is inverted through the plot's own x scale
// into dates, which get pushed into the dateRange Mutable. It's built from
// dailyTotals (pool filtered, but NOT date filtered) so the full window
// stays visible — and brushable — no matter what date range is selected.
function missTrendChart({width} = {}) {
  if (!dailyTotals.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  const rows2 = dailyTotals.map((d) => ({...d, day: new Date(d.day), missRate: d.tasks > 0 ? d.clone / d.tasks : null}));
  const height = 260;
  const plot = Plot.plot({
    title: "Full-clone (cache miss) rate over time — drag to select a date range, click to clear",
    width,
    height,
    x: {type: "utc", label: "Date"},
    y: {label: "Miss rate", grid: true, percent: true},
    marks: [
      Plot.lineY(rows2, {x: "day", y: "missRate", stroke: "#d62728", tip: true}),
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
    ${resize((width) => missTrendChart({width}))}
  </div>
</div>

```js
function stateChart({width} = {}) {
  if (!pools.length) return htl.html`<p class="muted">No data for this filter.</p>`;
  // Worst to best: rank primarily by clone (miss) rate, then pull rate, then
  // nopull rate — not by the combined hitRate, since a pool with a high pull
  // rate but zero clones should still rank worse than a pool that's mostly
  // nopull, even though both can have the same nopull+pull "hit rate".
  const orderedPools = [...pools]
    .sort((a, b) => (b.cloneRate - a.cloneRate) || (b.pullRate - a.pullRate) || (a.nopullRate - b.nopullRate))
    .map((p) => p.worker_pool);
  const long = pools.flatMap((p) => [
    {worker_pool: p.worker_pool, state: "nopull", count: p.nopull},
    {worker_pool: p.worker_pool, state: "pull", count: p.pull},
    {worker_pool: p.worker_pool, state: "clone", count: p.clone}
  ]);
  // Non-breaking space: survives SVG whitespace collapsing, and (combined
  // with the tip's monospace option below) lines up padded text into columns.
  const PAD = "\u00A0";
  const pctOf = (state) => (p) => fmtPercent(p.tasks ? p[state] / p.tasks : null);
  const pctWidth = Math.max(...["nopull", "pull", "clone"].flatMap((state) => pools.map((p) => pctOf(state)(p).length)));
  // Plot.tip's format callback gets (value, i) — i indexes back into the
  // array passed as this mark's data, not the hovered row itself.
  const fmtPctOf = (state) => (_, i) => pctOf(state)(pools[i]).padStart(pctWidth, PAD);
  const padLabel = (s) => s + PAD.repeat("nopull".length - s.length);
  return Plot.plot({
    title: "Checkout cache state by worker pool — worst hit rate to best",
    width,
    height: Math.max(220, pools.length * 22),
    marginLeft: 220,
    x: {label: "Share of checkouts", grid: true, percent: true},
    y: {label: null, domain: orderedPools},
    color: {domain: ["nopull", "pull", "clone"], range: ["#2ca02c", "#1f77b4", "#d62728"], legend: true},
    marks: [
      Plot.barX(long, {
        x: "count",
        y: "worker_pool",
        fill: "state",
        offset: "normalize",
        order: ["nopull", "pull", "clone"]
      }),
      Plot.tip(
        pools,
        Plot.pointerY({
          x: () => 0.5,
          y: "worker_pool",
          monospace: true,
          channels: {
            nopull: {value: () => "nopull", scale: "color", label: padLabel("nopull")},
            pull: {value: () => "pull", scale: "color", label: padLabel("pull")},
            clone: {value: () => "clone", scale: "color", label: padLabel("clone")}
          },
          format: {x: false, nopull: fmtPctOf("nopull"), pull: fmtPctOf("pull"), clone: fmtPctOf("clone")}
        })
      ),
      Plot.ruleX([0])
    ]
  });
}
```

<div class="grid grid-cols-1">
  <div class="card">
    ${resize((width) => stateChart({width}))}
  </div>
</div>

```js
Inputs.table(pools, {
  columns: ["worker_pool", "tasks", "nopull", "pull", "clone", "hitRate"],
  header: {worker_pool: "Worker pool", tasks: "Tasks", nopull: "No-pull (hot)", pull: "Pull (warm)", clone: "Clone (miss)", hitRate: "Hit rate"},
  format: {hitRate: fmtPercent},
  select: false
})
```

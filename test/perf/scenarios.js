// The pages the perf run opens and what it does on them. `charts` selects every
// chart of a page in document order, and `hover` and `zoom` name the ones to
// work on by their place in that list.

const PERF_BACKFILL_WAITS = {
  root: "#bw-charts",
  tiles: {item: ".bw-metric", title: ".bw-metric-title", value: ".bw-metric-value"},
  charts: "#bw-charts .bw-chart",
  tooltip: "#bw-tooltip",
  ring: "#bw-ring",
  stubs: {"https://firefox-ci-tc.services.mozilla.com/": {dates: []}},
  hover: [
    {name: "requests", chart: 7},
    {name: "candles", chart: 8}
  ],
  pin: {chart: 7},
  legend: {block: 1, entry: 1},
  zoom: {chart: 7, from: 0.1, to: 0.35}
};

// The 12 tiles are the first 12 charts and the candles the 13th.
const SHIP_TO_NIGHTLY = {
  root: "#sn-charts",
  tiles: {item: ".bw-metric", title: ".bw-metric-title", value: ".bw-metric-value"},
  charts: "#sn-charts .bw-chart",
  tooltip: "#bw-tooltip",
  ring: "#bw-ring",
  stubs: {},
  hover: [
    {name: "end to end", chart: 0},
    {name: "stages", chart: 5},
    {name: "candles", chart: 12}
  ],
  pin: {chart: 12},
  legend: {block: 1, entry: 1},
  zoom: {chart: 0, from: 0.1, to: 0.35}
};

export const SCENARIOS = [
  {name: "perf-backfill-waits, Linux talos, all days", path: "/perf-backfill-waits.html", ...PERF_BACKFILL_WAITS},
  {name: "perf-backfill-waits, mac M4, two weeks", path: "/perf-backfill-waits.html?platform=mac+M4&from=2026-09-01&to=2026-09-14", ...PERF_BACKFILL_WAITS},
  {name: "ship-to-nightly, the last 90 days", path: "/ship-to-nightly.html", ...SHIP_TO_NIGHTLY},
  {name: "ship-to-nightly, 30 days", path: "/ship-to-nightly.html?from=2026-10-28&to=2026-11-26", ...SHIP_TO_NIGHTLY},
  {name: "ship-to-nightly, a revision by its D number", path: "/ship-to-nightly.html?revision=D350000", ...SHIP_TO_NIGHTLY},
  {name: "ship-to-nightly, a search that matches many revisions", path: "/ship-to-nightly.html?search=alice", ...SHIP_TO_NIGHTLY}
];

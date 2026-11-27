---
title: Ship to Nightly faster
toc: false
---

# Ship to Nightly faster

How long a patch takes from "Land" in Phabricator to a shipped Nightly.

```js
import {candleOf, CANDLE_SEGMENTS, closureSummary, durationsOf, inCohort, journeyOf, matchesQuery, mergesOf, nightliesOf, parseBackouts, parseRevision, PUBLISH_HORIZON_S, quantile, STAGE_INFO, statusOf, UNMATCHED_AFTER_S, watermarksOf} from "./_journey.js";
import {journeyProfile} from "./_journey-profile.js";
import {openProfile} from "./_profiler.js";
import {createTooltip, timelineLink} from "./_tooltip.js";
import {chartBox, dateAxis, DAY_MS, eventRule, formatTime, MARGINS, syncCharts} from "./_time-charts.js";
import {collapsibleBlock, hiddenKeysState, LEGEND_MARKERS} from "./_legend.js";
import {countOf, metricsRow} from "./_metrics.js";
import {candleChart, segmentLines} from "./_candles.js";
```

```js
const journeyRows = (await FileAttachment("data/nightly-journeys.parquet").parquet()).toArray();
const closureRows = (await FileAttachment("data/nightly-treestatus.parquet").parquet()).toArray();
```

```js
// The sources lag the present by different amounts, so each has its own watermark.
// A tile only counts the landings that had time to finish by the oldest of them.
const marks = watermarksOf(journeyRows);
const publishUntil = Math.min(marks.landoUntil, marks.commitMapsUntil);
const journeys = journeyRows.map((row) => journeyOf(row));
const secondsToDate = (seconds) => new Date(seconds * 1000);

// The charts keep the newest when there are too many to draw, so the order is by request.
const landings = journeys
  .map((journey) => {
    const durations = durationsOf(journey);
    return {
      kind: "landing",
      time: secondsToDate(journey.requested),
      journey,
      durations,
      candle: candleOf(journey, marks),
      status: statusOf(journey, marks),
      publishCohort: inCohort(journey, publishUntil, PUBLISH_HORIZON_S)
    };
  })
  .sort((a, b) => a.time - b.time);
// The CI of a push is only final once it had time to finish, so the tiles count the pushes that had.
const ciFinal = (pushedAt) => pushedAt <= marks.treeherderUntil - PUBLISH_HORIZON_S;
const merges = mergesOf(journeys).map(({merged, ciDone, ...merge}) => ({kind: "merge", time: secondsToDate(merged), ci: ciDone === null ? null : ciDone - merged, final: ciFinal(merged), ...merge}));
const autolandPushes = [...new Map(journeys.filter((journey) => journey.autolandRev && journey.pushed !== null).map((journey) => [journey.autolandRev, journey])).values()].map((journey) => ({
  kind: "push",
  time: secondsToDate(journey.pushed),
  ci: journey.autolandCiDone === null ? null : journey.autolandCiDone - journey.pushed,
  final: ciFinal(journey.pushed)
}));
const nightlies = nightliesOf(journeys).map((nightly) => ({kind: "nightly", time: secondsToDate(nightly.started), ...nightly}));
const closures = closureRows
  .filter((row) => row.status === "closed" && row.end_s !== null)
  .map((row) => ({kind: "closure", time: secondsToDate(row.start_s), hours: (row.end_s - row.start_s) / 3600}));
const closedPeriods = closureRows
  .filter((row) => row.status === "closed")
  .map((row) => {
    const endS = row.end_s ?? marks.landoUntil;
    return {start: secondsToDate(row.start_s), end: secondsToDate(endS), startS: row.start_s, endS, tag: row.reason_tag, backouts: parseBackouts(row.backouts)};
  });

const DATA_FIRST_DAY = d3.utcDay.floor(secondsToDate(d3.min(journeys, (journey) => journey.requested)));
const DATA_LAST_DAY = d3.utcDay.floor(secondsToDate(marks.landoUntil));
const dayAfter = (day) => new Date(+day + DAY_MS);
const inDomain = (domain, time) => time >= domain[0] && time < domain[1];

// ?revision=D343744 picks a landing. The days around it are shown, unless the address
// says which days to show.
const urlRevision = parseRevision(new URLSearchParams(window.location.search).get("revision"));
const pickedRevision = Mutable(urlRevision);
const pickRevision = (revision) => (pickedRevision.value = revision);
const focusLanding = landings.find((landing) => landing.journey.revision === urlRevision);
const focusDay = focusLanding ? d3.utcDay.floor(focusLanding.time) : null;
const clampDay = (day) => new Date(Math.min(+DATA_LAST_DAY, Math.max(+DATA_FIRST_DAY, +day)));
const DEFAULT_FROM = focusDay ? clampDay(new Date(+focusDay - 3 * DAY_MS)) : new Date(Math.max(+DATA_FIRST_DAY, +DATA_LAST_DAY - 89 * DAY_MS));
const DEFAULT_TO = focusDay ? clampDay(new Date(+focusDay + 3 * DAY_MS)) : DATA_LAST_DAY;
```

```js
const selectedLandings = landings.filter((landing) => landing.journey.revision === pickedRevision);
```

```js
const formatCount = (n) => Math.round(n).toLocaleString("en-US");
const formatPercent = (share) => `${Math.round(share * 1000) / 10}%`;
const formatDays = (days) => `${days.toFixed(1)}d`;
function formatWait(hours) {
  const seconds = Math.round(hours * 3600);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const landingsOf = (items) => items.filter((item) => item.kind === "landing");
const shippedIn = (cohort) => (items) => landingsOf(items).filter((landing) => landing[cohort] && landing.status === "shipped");
const hoursOf = (seconds) => (seconds === undefined ? undefined : seconds / 3600);
const percentile = (cohort, key, share) => (items) => hoursOf(quantile(shippedIn(cohort)(items).map((landing) => landing.durations[key]), share));
const settled = (items) => landingsOf(items).filter((landing) => landing.publishCohort && (landing.status === "shipped" || landing.status === "backed out"));
const stagePair = (key, color) => [
  {key: "p50", title: "p50", value: percentile("publishCohort", key, 0.5), color: color[0]},
  {key: "p95", title: "p95", value: percentile("publishCohort", key, 0.95), color: color[1]}
];
const ciPercentile = (kind, share) => (items) => hoursOf(quantile(items.filter((item) => item.kind === kind && item.final && item.ci !== null).map((item) => item.ci), share));
const ciPair = (kind, color) => [
  {key: "p50", title: "p50", value: ciPercentile(kind, 0.5), color: color[0]},
  {key: "p95", title: "p95", value: ciPercentile(kind, 0.95), color: color[1]}
];
const BLUES = ["#86b4ea", "#2f74d0", "#163f7a"];
const closedHours = (items) => d3.sum(items.filter((item) => item.kind === "closure"), (item) => item.hours);

// Every tile counts its items by day: a landing by the day it was requested, a merge by
// the day it happened, a closure by the day it began.
const METRICS = [
  {
    key: "endtoend",
    title: "Land to published in a Nightly",
    span: 3,
    countless: true,
    format: formatWait,
    series: [
      {key: "p50", title: "p50", value: percentile("publishCohort", "total", 0.5), color: BLUES[0]},
      {key: "p90", title: "p90", value: percentile("publishCohort", "total", 0.9), color: BLUES[1]},
      {key: "p99", title: "p99", value: percentile("publishCohort", "total", 0.99), color: BLUES[2]}
    ]
  },
  {
    key: "landed",
    title: "Revisions landed per day",
    countless: true,
    format: formatCount,
    headline: {value: (items, days) => landingsOf(items).length / days, format: formatCount},
    series: [{key: "landed", title: "revisions", value: (items) => landingsOf(items).length, color: "#8a4fb5"}]
  },
  {key: "queue", title: "Waiting in the Lando queue", span: 2, countless: true, format: formatWait, series: stagePair("queue", ["#9bd0b0", "#237a4b"])},
  {key: "ciautoland", title: "CI on autoland", span: 2, countless: true, format: formatWait, series: ciPair("push", ["#e8b07a", "#c46a10"])},
  {key: "autoland", title: "On autoland until merged to main", span: 2, countless: true, format: formatWait, series: stagePair("autoland", ["#f1c27d", "#d98324"])},
  {key: "cimain", title: "CI on main", span: 2, countless: true, format: formatWait, series: ciPair("merge", ["#e58aa6", "#b5365e"])},
  {key: "waiting", title: "Merged to main until its Nightly starts", span: 2, countless: true, format: formatWait, series: stagePair("waiting", ["#f0a8bd", "#c2476f"])},
  {key: "build", title: "Nightly build and publish", span: 2, countless: true, format: formatWait, series: stagePair("build", ["#9fb6e8", "#5b6abf"])},
  {key: "merges", title: "Merges to main", countless: true, format: formatCount, series: [{key: "merges", title: "merges", value: (items) => items.filter((item) => item.kind === "merge").length, color: "#5b6abf"}]},
  {
    key: "closed",
    title: "Autoland tree closed",
    countless: true,
    format: formatWait,
    headline: {value: (items) => closedHours(items) / 24, format: formatDays},
    series: [{key: "closed", title: "closed", value: closedHours, color: "#b3202a"}]
  },
  {
    key: "backedout",
    title: "Revisions backed out",
    countless: true,
    format: formatPercent,
    series: [{key: "backedout", title: "share", value: (items) => (settled(items).length ? settled(items).filter((landing) => landing.status === "backed out").length / settled(items).length : undefined), color: "#b3202a"}]
  },
  {
    key: "afternightly",
    title: "Backed out after a Nightly had published them",
    countless: true,
    format: formatCount,
    series: [{key: "afternightly", title: "revisions", value: (items) => landingsOf(items).filter(({journey}) => journey.backedOut && journey.published !== null && journey.published < journey.backout).length, color: "#7a1f26"}]
  }
];

const CUTOFF_KEY = "cohort";
const publishCutoff = secondsToDate(publishUntil - PUBLISH_HORIZON_S);
const METRICS_TITLE = {chartKey: "chart-metrics", title: "Top line metrics"};
const E2E_TITLE = {chartKey: "chart-endtoend", title: "From Land to a shipped Nightly"};
const CANDLES_HEIGHT = 300;
const MAX_CANDLES = 30000;
const TALLEST_SHARE = 0.99;
const HIT_RADIUS = 8;
const MAX_MARKED = 300;
const MATCH_COLOR = "#0a84ff";
const SEARCH_PAUSE_MS = 250;
```

```js
// The tooltip is defined in the same cell as what uses it to filter by requester, as a
// cell may not depend on one that depends on it.
const tooltip = createTooltip({invalidation});
const blockCache = new Map();
const TC_URL = "https://firefox-ci-tc.services.mozilla.com";
const TREEHERDER_URL = "https://treeherder.mozilla.org";
const TREESTATUS_LOG_URL = "https://lando.moz.tools/treestatus/firefox-autoland/logs";
const external = (href, text) => htl.html`<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

const BACKOUT_COLOR = "#b3202a";
const STAGE_LINK_TO = {
  lando: ({journey}) => ["→ Lando", `https://lando.moz.tools/D${journey.revision}/`],
  autoland: ({journey}) => journey.autolandRev && ["→ Treeherder", `${TREEHERDER_URL}/jobs?repo=autoland&revision=${journey.autolandRev}`],
  waiting: ({journey}) => journey.centralRev && ["→ Treeherder", `${TREEHERDER_URL}/jobs?repo=mozilla-central&revision=${journey.centralRev}`]
};
const stageLink = (key) => (landing) => {
  const target = STAGE_LINK_TO[key]?.(landing);
  return target ? external(target[1], target[0]) : null;
};
const hoursText = (seconds) => formatWait(seconds / 3600);
const SEGMENT_STYLE = Object.fromEntries(CANDLE_SEGMENTS.map(({key, title, color}) => [key, {title, color}]));
const CI_OF_STAGE = {autoland: ["autolandCi", "ciAutoland"], waiting: ["mainCi", "ciMain"]};

// The CI is part of the stage it runs in, as it is in the bar, and only what ran before the
// stage ended counts there. The CI of a push on main goes on after the Nightly starts.
const ciNote = (stage) => {
  const [segment, ci] = CI_OF_STAGE[stage] ?? [];
  if (!segment) return undefined;
  const {title, color} = SEGMENT_STYLE[segment];
  return ({durations}) => {
    if (durations[ci] === null) return null;
    const inStage = Math.max(0, Math.min(durations[ci], durations[stage]));
    return htl.html`<span class="bw-tt-sub"><i class="bw-swatch" style="background:${color}"></i>${title}: <b>${hoursText(inStage)}</b>${durations[ci] > inStage ? ` (${hoursText(durations[ci])} in all)` : ""}</span>`;
  };
};
const STAGE_LINES = STAGE_INFO.map((stage) => ({...stage, applies: (landing) => landing.durations[stage.key] !== null, link: stageLink(stage.key), note: ciNote(stage.key)}));

// The profile is built when the link is clicked, and the profiler is opened inside the
// click, which is the only time a browser lets a page open a window.
const journeyLink = ({journey}) =>
  timelineLink("→ Journey in the Firefox Profiler", () => openProfile(() => journeyProfile(journey, {marks, closures: closureRows})), `D${journey.revision}-journey.json`);

function requesterLink(name) {
  const link = htl.html`<a href="#" title="Show only the landings of ${name}">${name}</a>`;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    document.dispatchEvent(new CustomEvent("sn-requester", {detail: name}));
    tooltip.hide();
  });
  return link;
}

function backoutLine({journey}) {
  const reached = journey.published !== null && journey.published < journey.backout;
  return htl.html`<span class="bw-tt-blocked"><b>Backed out</b> ${formatTime(secondsToDate(journey.backout))}, ${hoursText(journey.backout - journey.pushed)} after it was on autoland, by ${journey.backoutBy}${reached ? ", after a Nightly had published it" : ""}</span>`;
}

function outcomeLine({durations, status}) {
  if (status === "shipped") return htl.html`<span><b>${hoursText(durations.total)}</b> from Land to published</span>`;
  if (status === "unmatched") return htl.html`<span>No Nightly has taken it, more than ${UNMATCHED_AFTER_S / 86400} days later</span>`;
  return htl.html`<span>Still on its way</span>`;
}

function landingLines(landing, linkRequester = true) {
  const {journey, durations, status} = landing;
  return htl.html`<span class="bw-tt-links"><b>${external(`https://phabricator.services.mozilla.com/D${journey.revision}`, `D${journey.revision}`)}</b>${journey.bug ? [" · ", external(`https://bugzilla.mozilla.org/show_bug.cgi?id=${journey.bug}`, `bug ${journey.bug}`)] : ""}</span>
    <span>land requested ${formatTime(landing.time)}</span>
    <div class="bw-tt-links">by ${linkRequester ? requesterLink(journey.requester) : journey.requester}${journey.stack.size > 1 ? `, revision ${journey.stack.index + 1} of a stack of ${journey.stack.size}` : ""}</div>
    ${status === "backed out" ? backoutLine(landing) : outcomeLine(landing)}
    <div class="bw-tt-sep"></div>
    ${segmentLines(STAGE_LINES, {durations, subject: landing, format: formatWait})}
    ${journey.queueClosed ? htl.html`<span class="bw-tt-pool">autoland was closed for ${hoursText(journey.queueClosed)} of the Lando queue</span>` : ""}
    ${journey.autolandClosed ? htl.html`<span class="bw-tt-pool">autoland was closed for ${hoursText(journey.autolandClosed)} of the time on autoland</span>` : ""}
    ${journey.failedAttempts ? htl.html`<span class="bw-tt-pool">${countOf(journey.failedAttempts, "attempt")} to land it failed before</span>` : ""}
    <div class="bw-tt-sep"></div>
    <div class="bw-tt-links">${journeyLink(landing)}</div>`;
}

function nightlyLines({decisionId, time, started, published, landed}) {
  return htl.html`<span><b>Nightly started</b></span>
    <span>${formatTime(time)}</span>
    ${published !== null ? htl.html`<span class="bw-tt-pool">published ${hoursText(published - started)} later</span>` : ""}
    ${landed ? htl.html`<span class="bw-tt-pool">${countOf(landed, "revision")} published in it</span>` : ""}
    <div class="bw-tt-sep"></div>
    <div class="bw-tt-links">${external(`${TC_URL}/tasks/${decisionId}`, "→ Taskcluster, its decision task")}</div>`;
}

function mergeLines({rev, time, by, landed}) {
  return htl.html`<span><b>Merged to main</b></span>
    <span>${formatTime(time)}</span>
    <span class="bw-tt-pool">${by ? `by ${by}, ` : ""}${countOf(landed, "revision")} from autoland</span>
    <div class="bw-tt-sep"></div>
    <div class="bw-tt-links">${external(`${TREEHERDER_URL}/jobs?repo=mozilla-central&revision=${rev}`, "→ Treeherder, its push")}</div>`;
}

function revisionLink(revision) {
  const link = htl.html`<a href="?revision=D${revision}">D${revision}</a>`;
  link.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    document.dispatchEvent(new CustomEvent("sn-revision", {detail: revision}));
    tooltip.hide();
  });
  return link;
}
const MAX_LISTED = 6;

const autolandPush = (rev) => `${TREEHERDER_URL}/jobs?repo=autoland&revision=${rev}`;
const shortRev = (rev) => rev.slice(0, 12);
const backoutLinks = ({broken, fix}) =>
  htl.html`<div class="bw-tt-links">${external(autolandPush(broken), shortRev(broken))} backed out${fix ? [" by ", external(autolandPush(fix), shortRev(fix))] : ""}</div>`;

function closureLines({startS, endS, start, tag, backouts}) {
  const {requested, longestWait, backedOut} = closureSummary(journeys, startS, endS);
  return htl.html`<span><b>Autoland closed</b>${tag ? `, ${tag.replaceAll("_", " ")}` : ""}</span>
    <span>${formatTime(start)}, for ${hoursText(endS - startS)}</span>
    ${requested ? htl.html`<span class="bw-tt-pool">${countOf(requested, "revision")} asked to land during it${longestWait ? `, the longest waited ${hoursText(longestWait)} in the Lando queue` : ""}</span>` : ""}
    ${backedOut.length ? htl.html`<div class="bw-tt-links">backed out during it: ${backedOut.slice(0, MAX_LISTED).map(revisionLink)}${backedOut.length > MAX_LISTED ? ` and ${backedOut.length - MAX_LISTED} more` : ""}</div>` : ""}
    ${backouts.length ? htl.html`<div class="bw-tt-sep"></div><span class="bw-tt-pool">On Treeherder</span>${backouts.map(backoutLinks)}` : ""}
    <div class="bw-tt-sep"></div>
    <div class="bw-tt-links">${external(TREESTATUS_LOG_URL, "→ Lando, the tree status log")}</div>`;
}
```

```js
function itemsIn(domain, requester) {
  return [
    ...landings.filter((landing) => inDomain(domain, landing.time) && (!requester || landing.journey.requester === requester)),
    ...merges.filter((merge) => inDomain(domain, merge.time)),
    ...autolandPushes.filter((push) => inDomain(domain, push.time)),
    ...closures.filter((closure) => inDomain(domain, closure.time))
  ];
}

function metricsBlock(items, width, domain) {
  return metricsRow({
    items,
    metrics: METRICS,
    domain,
    width,
    tooltip,
    noun: "item",
    eventRules: (days) => [eventRule(days, new Set(), {key: CUTOFF_KEY, date: publishCutoff})]
  });
}

// How a candle ends is part of what it says: a Nightly published it, it was backed out
// before or after it was merged to main, or it is still on its way and is drawn up to
// the last thing recorded. The mark of each is what the chart draws and the legend shows.
const MAIN_BACKOUT_COLOR = "#7a1f26";
const END_KINDS = [
  {key: "end-shipped", kind: "shipped", title: "was published in a Nightly", mark: {r: 3, fill: "currentColor"}},
  {key: "end-backed-out-autoland", kind: "backed out on autoland", title: "was backed out while it was on autoland", mark: {symbol: "cross", r: 5, stroke: BACKOUT_COLOR, strokeWidth: 2}},
  {key: "end-backed-out-main", kind: "backed out on main", title: "was backed out after it was merged to main", mark: {symbol: "times", r: 5, stroke: MAIN_BACKOUT_COLOR, strokeWidth: 2}},
  {key: "end-open", kind: "open", title: "still on its way, drawn up to what is recorded", mark: {r: 3, fill: "white", stroke: "currentColor"}}
];
const swatch = ({key, title, color}) => ({key, title, marker: () => LEGEND_MARKERS.swatch(color, 0.8)});
const CLOSURES_KEY = "closures";
const NIGHTLY_KEY = "nightly-starts";
const MERGE_KEY = "merges-to-main";
const MARKS = {
  nightly: {key: NIGHTLY_KEY, color: "#1b8a9e", opacity: 0.6, width: 1.5},
  merge: {key: MERGE_KEY, color: "#8a4fb5", opacity: 0.4, width: 1}
};
const closuresIn = ([from, to]) =>
  closedPeriods
    .filter(({start, end}) => start < to && end > from)
    .map(({start, end}) => ({start: new Date(Math.max(+start, +from)), end: new Date(Math.min(+end, +to))}));
const candleGroups = () => [
  {title: "Stage", entries: CANDLE_SEGMENTS.map(swatch)},
  {
    title: "Time markers",
    entries: [
      {key: CLOSURES_KEY, title: "autoland was closed", marker: () => LEGEND_MARKERS.swatch(BACKOUT_COLOR, 0)},
      {key: NIGHTLY_KEY, title: "a Nightly started", marker: () => LEGEND_MARKERS.rule(MARKS.nightly.color, MARKS.nightly.opacity)},
      {key: MERGE_KEY, title: "a merge to main", marker: () => LEGEND_MARKERS.rule(MARKS.merge.color, MARKS.merge.opacity)}
    ]
  },
  {title: "A candle ends when it", entries: END_KINDS.map(({key, title, mark}) => ({key, title, marker: () => LEGEND_MARKERS.symbol(mark)}))}
];

function showCandle(event, point, chartRect) {
  if (point.marker) {
    const lines = point.marker.kind === "nightly" ? nightlyLines(point.marker) : mergeLines(point.marker);
    if (tooltip.open(event, point.marker, lines)) tooltip.hideRing();
    return;
  }
  if (point.band) {
    if (tooltip.open(event, point.band, closureLines(point.band))) tooltip.hideRing();
    return;
  }
  if (!tooltip.open(event, point.item, landingLines(point.item))) return;
  tooltip.showRing(chartRect, point, 12);
}

const MARKER_REACH = 4;

// The time the pointer points to, if it is within the plot.
function timeAt(px, py, {width, domain}) {
  const inside = px >= MARGINS.left && px <= width - MARGINS.right && py >= MARGINS.top && py <= CANDLES_HEIGHT - MARGINS.bottom;
  return inside ? +domain[0] + ((px - MARGINS.left) / (width - MARGINS.left - MARGINS.right)) * (+domain[1] - +domain[0]) : null;
}

// The closure going on at the time the pointer points to.
function closureAt(px, py, frame) {
  const time = timeAt(px, py, frame);
  const band = time === null ? null : closedPeriods.find(({start, end}) => +start <= time && time < +end);
  return band ? {band, x: px, y: py} : null;
}

// The time marker within reach of the pointer, the nearest if there are several.
function markerAt(px, py, frame, markers) {
  const time = timeAt(px, py, frame);
  if (time === null) return null;
  const reach = (MARKER_REACH * (+frame.domain[1] - +frame.domain[0])) / (frame.width - MARGINS.left - MARGINS.right);
  const near = markers.filter((marker) => Math.abs(+marker.time - time) <= reach);
  const nearest = near.reduce((best, marker) => (!best || Math.abs(+marker.time - time) < Math.abs(+best.time - time) ? marker : best), null);
  return nearest ? {marker: nearest, x: px, y: py} : null;
}

// A filled dot at each item, as one path: a point that has no length is drawn as a dot by a
// round cap, and what the page does for each element it draws is what makes it slow.
function dotPath(items, topHours, {r, fill, opacity = 1}) {
  const points = items.flatMap((item) => [{time: item.time, hours: topHours(item)}, {time: item.time, hours: topHours(item)}, {time: item.time, hours: null}]);
  return Plot.line(points, {x: "time", y: "hours", stroke: fill, strokeWidth: 2 * r, strokeLinecap: "round", opacity});
}

// A thin line from the bottom to the top of the plot at each time, as one path.
function markerLines(times, {color, opacity, width}, maxHours) {
  const points = times.flatMap((time) => [{time, hours: 0}, {time, hours: maxHours * 1.05}, {time, hours: null}]);
  return Plot.line(points, {x: "time", y: "hours", stroke: color, strokeOpacity: opacity, strokeWidth: width});
}

// A bar for each landing at the moment it was requested, stacked from what happened
// first to what happened last, with a mark at its top that says how it ended. The
// height scale comes from all the landings of the days shown, so that hiding some does
// not rescale it, and the tallest hundredth is cut at the top, so that a few landings
// that never arrived do not flatten the rest. A bar is a line for each stage, so only the
// most recent are drawn.
function candlesChart({shown, width, hidden, domain}) {
  const items = shown.slice(-MAX_CANDLES);
  const maxHours = Math.max(1, quantile(shown.map((landing) => landing.candle.total / 3600), TALLEST_SHARE) ?? 1);
  const taller = shown.filter((landing) => landing.candle.total / 3600 > maxHours).length;
  const barWidth = Math.min(5, Math.max(1, (width - MARGINS.left - MARGINS.right) / Math.max(1, items.length)));
  const chosen = new Set(selectedLandings);
  const matches = items.filter((landing) => found.has(landing)).slice(-MAX_MARKED);
  const frame = {width, domain};
  const marked = [
    {items: nightlies, ...MARKS.nightly},
    {items: merges, ...MARKS.merge}
  ]
    .filter(({key}) => !hidden.has(key))
    .map((mark) => ({...mark, items: mark.items.filter(({time}) => inDomain(domain, time))}));
  const markers = marked.flatMap(({items}) => items);
  const plot = candleChart({
    items,
    segments: CANDLE_SEGMENTS,
    hidden,
    domain,
    width,
    height: CANDLES_HEIGHT,
    maxHours,
    durationsOf: (landing) => landing.candle.segments,
    barWidth,
    hitRadius: HIT_RADIUS,
    tooltip,
    show: showCandle,
    highlighted: matches,
    extraHit: (px, py) => markerAt(px, py, frame, markers) ?? (hidden.has(CLOSURES_KEY) ? null : closureAt(px, py, frame)),
    before: [
      eventRule(domain, new Set(), {key: CUTOFF_KEY, date: publishCutoff}),
      ...(hidden.has(CLOSURES_KEY) ? [] : [Plot.rectX(closuresIn(domain), {x1: "start", x2: "end", fill: BACKOUT_COLOR, fillOpacity: 0.15})]),
      ...marked.map(({items, ...style}) => markerLines(items.map(({time}) => time), style, maxHours)),
      ...(matches.length ? [markerLines([...new Set(matches.map(({time}) => +time))].map((time) => new Date(time)), {color: MATCH_COLOR, opacity: 0.85, width: 3}, maxHours)] : [])
    ],
    after: ({topHours, ends}) => {
      const endMarks = (list, opacity) =>
        END_KINDS.filter(({key}) => !hidden.has(key)).map(({kind, mark}) => {
          const ended = list.filter((landing) => landing.candle.kind === kind);
          return mark.stroke === undefined ? dotPath(ended, topHours, {...mark, opacity}) : Plot.dot(ended, {x: "time", y: topHours, ...mark, opacity});
        });
      return [
        ...endMarks(ends, matches.length ? 0.25 : 1),
        ...(matches.length ? endMarks(matches, 1) : []),
        Plot.dot(ends.filter((landing) => chosen.has(landing)), {x: "time", y: topHours, r: 9, stroke: BACKOUT_COLOR, strokeWidth: 2, fill: "none"}),
        Plot.dot(matches, {x: "time", y: topHours, r: 8, stroke: MATCH_COLOR, strokeWidth: 2.5, fill: "none"})
      ];
    }
  });
  const cut = shown.length - items.length;
  return htl.html`${chartBox(plot, CANDLES_HEIGHT)}${cut ? htl.html`<p class="bw-note">Only the ${formatCount(MAX_CANDLES)} most recent are drawn, of ${formatCount(shown.length)}.</p>` : ""}${taller ? htl.html`<p class="bw-note">${countOf(taller, "candle")} taller than ${formatWait(maxHours)} ${taller === 1 ? "is" : "are"} cut there.</p>` : ""}`;
}

function section(width, hidden, requester, domain) {
  const items = itemsIn(domain, requester);
  const shown = landingsOf(items);
  const none = () => htl.html`<p class="bw-note">No revisions in this range.</p>`;
  const bodies = {
    "chart-endtoend": {
      groups: () => (shown.length ? candleGroups() : null),
      draw: (ownHidden) => (shown.length ? candlesChart({shown, width, hidden: ownHidden, domain}) : none())
    },
    "chart-metrics": {groups: () => null, draw: () => metricsBlock(items, width, domain)}
  };
  const block = (item) =>
    collapsibleBlock(item, {
      hidden,
      state: {setHidden, setHiddenKeys},
      width,
      context: [width, +domain[0], +domain[1], requester, ...(item.chartKey === E2E_TITLE.chartKey ? [search, pickedRevision] : [])],
      cache: blockCache,
      body: ({chartKey}, ownHidden) => ({groups: bodies[chartKey].groups(), content: bodies[chartKey].draw(ownHidden)})
    });
  const element = htl.html`<section class="sn-section">${[METRICS_TITLE, E2E_TITLE].map(block)}</section>`;
  syncCharts(element, domain, (from, to) => setRange(d3.utcDay.floor(from), d3.utcDay.floor(new Date(Math.max(+from, +to - 1)))), tooltip);
  return element;
}
```

<style>
.bw-note {
  margin: 1rem 0 0;
  color: var(--theme-foreground-muted, #888);
}
.bw-filters > div {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0 2rem;
  margin: 0.25rem 0;
}
.bw-clear {
  margin-bottom: 0.4rem;
}
.sn-search-count {
  margin-bottom: 0.4rem;
  color: var(--theme-foreground-muted, #888);
}
.sn-presets {
  display: inline-flex;
  gap: 0.4rem;
}
.sn-banner-close {
  position: absolute;
  top: 0.2rem;
  right: 0.4rem;
  padding: 0 0.3rem;
  border: 0;
  background: none;
  font-size: 1.3rem;
  line-height: 1.2;
  color: var(--theme-foreground-muted, #888);
  cursor: pointer;
}
.sn-banner {
  position: relative;
  margin: 0.75rem 0;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--theme-foreground-faintest, #ddd);
  border-radius: 6px;
}
.sn-banner span,
.sn-banner div {
  display: block;
}
.sn-banner .bw-tt-links a {
  display: inline;
  margin-right: 0.6em;
}
.sn-banner .bw-tt-sep {
  margin: 4px 0;
  border-top: 1px solid var(--theme-foreground-faintest, #ddd);
}
.sn-banner .bw-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  border-radius: 2px;
}
.sn-banner .bw-tt-blocked {
  color: #b3202a;
}
.sn-banner .bw-tt-pool {
  color: var(--theme-foreground-muted, #888);
}
</style>

```js
// What to look for among the revisions: a D number, a bug, a requester, or the start of a
// git or hg revision. The candles of the ones that match are circled, once typing pauses.
const searchBox = Inputs.text({
  label: "Search",
  placeholder: "D number, bug, requester, git or hg revision",
  value: new URLSearchParams(window.location.search).get("search") ?? "",
  width: 420,
  autocomplete: "off",
  spellcheck: false
});
const searchState = Object.assign(document.createElement("div"), {value: searchBox.value.trim()});
{
  let timer;
  searchBox.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      searchState.value = searchBox.value.trim();
      searchState.dispatchEvent(new Event("input"));
    }, SEARCH_PAUSE_MS);
  });
  invalidation.then(() => clearTimeout(timer));
}
const search = Generators.input(searchState);
const searchCount = htl.html`<span class="sn-search-count"></span>`;
```

```js
const matched = search ? landings.filter(({journey}) => matchesQuery(journey, search)) : [];
const found = new Set(matched);
```

```js
// Among the days and the requester shown, and beyond them.
{
  const here = matched.filter((landing) => inDomain(domain, landing.time) && (!requester || landing.journey.requester === requester));
  const away = matched.length - here.length;
  const count = countOf(here.length, "match", "matches");
  searchCount.textContent = !search ? "" : !matched.length ? "No match" : `${count}${here.length > MAX_MARKED ? `, the ${MAX_MARKED} newest circled` : ""}${away ? `, ${away} elsewhere` : ""}`;
}
```

```js
// Limits the page to one requester, chosen here or by clicking a name in a tooltip. It
// lists everyone, most landings first.
const requesterCounts = d3.rollups(landings, (group) => group.length, (landing) => landing.journey.requester).sort((a, b) => b[1] - a[1]);
const urlRequester = new URLSearchParams(window.location.search).get("requester");
const requesterInput = Inputs.select(new Map([["Everyone", ""], ...requesterCounts.map(([name, n]) => [`${name} (${n})`, name])]), {
  label: "Requested by",
  value: requesterCounts.some(([name]) => name === urlRequester) ? urlRequester : ""
});
const requester = Generators.input(requesterInput);
const chooseRequester = ({detail}) => {
  requesterInput.value = detail;
  requesterInput.dispatchEvent(new Event("input", {bubbles: true}));
};
document.addEventListener("sn-requester", chooseRequester);
invalidation.then(() => document.removeEventListener("sn-requester", chooseRequester));
```

```js
// The days the charts show, from the date inputs, the presets or by dragging across a
// chart, and kept in the address as ?from= and ?to=. Both are days, so the last one
// is shown whole. The default is the last 90 days of data.
const dayParam = (name) => {
  const text = new URLSearchParams(window.location.search).get(name);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(text ?? "") ? new Date(`${text}T00:00:00Z`) : null;
  return day >= DATA_FIRST_DAY && day <= DATA_LAST_DAY ? day : null;
};
const dateInput = (label, value) => Inputs.date({label, value, min: DATA_FIRST_DAY, max: DATA_LAST_DAY});
const fromInput = dateInput("From", dayParam("from") ?? DEFAULT_FROM);
const toInput = dateInput("To", dayParam("to") ?? DEFAULT_TO);
const rangeFrom = Generators.input(fromInput);
const rangeTo = Generators.input(toInput);

const setRange = (from, to) => {
  for (const [input, day] of [[fromInput, from], [toInput, to]]) {
    input.value = day;
    input.dispatchEvent(new Event("input", {bubbles: true}));
  }
};
const presetButton = (days) => {
  const button = htl.html`<button type="button" class="bw-clear" title="The last ${days} day${days === 1 ? "" : "s"} of data">${days}d</button>`;
  button.onclick = () => setRange(new Date(Math.max(+DATA_FIRST_DAY, +DATA_LAST_DAY - (days - 1) * DAY_MS)), DATA_LAST_DAY);
  return button;
};
const presets = htl.html`<span class="sn-presets">${[1, 3, 7, 30, 90].map(presetButton)}</span>`;
const resetButton = htl.html`<button type="button" class="bw-clear" title="Show the days of the start again">Reset</button>`;
resetButton.onclick = () => setRange(DEFAULT_FROM, DEFAULT_TO);
```

```js
// Picks the revision of a link in a tooltip without leaving the page, and shows the days
// around it if it is not among the ones shown.
{
  const pick = ({detail: revision}) => {
    const params = new URLSearchParams(window.location.search);
    params.set("revision", `D${revision}`);
    history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
    pickRevision(revision);
    const landing = landings.find((candidate) => candidate.journey.revision === revision);
    if (landing && !inDomain(domain, landing.time)) {
      const day = d3.utcDay.floor(landing.time);
      setRange(clampDay(new Date(+day - 3 * DAY_MS)), clampDay(new Date(+day + 3 * DAY_MS)));
    }
  };
  document.addEventListener("sn-revision", pick);
  invalidation.then(() => document.removeEventListener("sn-revision", pick));
}
```

```js
// [start, end) of the days chosen. Dates in the wrong order are put right.
const domain = (() => {
  const [first, last] = [rangeFrom ?? DEFAULT_FROM, rangeTo ?? DEFAULT_TO].sort((a, b) => a - b);
  return [first, dayAfter(last)];
})();
```

```js
resetButton.disabled = +domain[0] === +DEFAULT_FROM && +domain[1] === +dayAfter(DEFAULT_TO);
```

<div class="bw-filters"><div>${searchBox}${searchCount}</div><div>${requesterInput}</div><div>${fromInput}${toInput}${presets}${resetButton}</div></div>

```js
{
  // Every parameter is always there, with its default when nobody chose, so that the
  // address says what the page shows.
  const params = new URLSearchParams(window.location.search);
  const isoDay = (day) => day.toISOString().slice(0, 10);
  params.set("search", search);
  params.set("requester", requester);
  params.set("from", isoDay(domain[0]));
  params.set("to", isoDay(new Date(+domain[1] - DAY_MS)));
  history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
}
```

```js
// The landing that ?revision= picks, with what a tooltip says about it, until it is closed.
{
  const close = htl.html`<button type="button" class="sn-banner-close" title="Close" aria-label="Close">×</button>`;
  close.onclick = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("revision");
    history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
    pickRevision(null);
  };
  const card = (content) => htl.html`<div class="sn-banner">${close}${content}</div>`;
  // Something is always displayed, as what a cell showed before stays if it shows nothing.
  display(
    selectedLandings.length
      ? card(selectedLandings.map((landing, index) => htl.html`${index ? htl.html`<div class="bw-tt-sep"></div>` : ""}${landingLines(landing, false)}`))
      : pickedRevision !== null
        ? card(`D${pickedRevision} is not among the revisions landed since ${DATA_FIRST_DAY.toISOString().slice(0, 10)}.`)
        : htl.html`<div></div>`
  );
}
```

```js
// The keys of the collapsed charts and of the hidden dots. Every title and legend
// button writes them to this element, and the charts redraw when it changes.
const hiddenKeys = hiddenKeysState("sn-charts");
const hidden = Generators.input(hiddenKeys.input);
const {setHiddenKeys, setHidden} = hiddenKeys;
```

<div class="card" id="sn-charts">
  ${resize((width) => section(width, hidden, requester, domain))}
</div>

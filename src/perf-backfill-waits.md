---
title: Perf backfill waits
toc: false
---

# Perf backfill waits

```js
// A pool cannot have more busy workers than workers. A few bins do, by up to ten
// times, all on 14 and 15 June, so what is busy is cut back to the pool's workers.
const loadRows = (await FileAttachment("data/backfill-load.parquet").parquet())
  .toArray()
  .map((r) => ({pool: r.pool, bin_s: r.bin_s, workers: r.workers, busy: Math.min(r.busy, r.workers)}));
const queueTable = await FileAttachment("data/backfill-queue.parquet").parquet();
const requestRows = (await FileAttachment("data/backfill-requests.parquet").parquet())
  .toArray()
  .map((r) => ({
    pool: r.pool,
    id: r.request_id,
    pushGroups: r.push_group_ids ? r.push_group_ids.split(",") : [],
    downstreamIds: r.downstream_ids ? r.downstream_ids.split(",") : [],
    fromRevision: r.from_revision,
    toRevision: r.to_revision,
    requester: requesterName(r.requested_by),
    time: new Date(r.created_s * 1000),
    target: r.target_label.replace(/^test-[^/]+\/\w+-/, ""),
    tests: r.tests,
    builds: r.builds,
    profiles: r.profile_generations,
    queues: {instrumented: r.instrumented_queue, profile: r.profile_queue, build: r.build_queue},
    blocked: r.blocked_tests ? blockedPerfTasks(r) : null,
    chain: r.last_test_id ? endToEndChain(r) : null
  }));
```

```js
import {openDependencyTimeline, openDownstreamTimeline, poolActivityDays} from "./_task-profile.js";
import {openQueueGantt} from "./_queue-profile.js";
import {indexQueueSeries, KINDS as QUEUE_KINDS, queuedPerBucket} from "./_queue-position.js";
import {FIRST_DAY, LAST_DAY} from "./_task-queues.js";
import {attachPlotHover, createTooltip, nearestDot, timelineLink} from "./_tooltip.js";
import {chartBox, dateAxis, DAY_MS, eventRule, formatTime, MARGINS, syncCharts} from "./_time-charts.js";
import {collapsibleBlock, hiddenKeysState, LEGEND_MARKERS} from "./_legend.js";
import {candleChart, segmentLines} from "./_candles.js";
import {countOf, metricsRow} from "./_metrics.js";
```

```js
// A person's login on Treeherder, or the client of a bot such as the perf sheriffs'.
function requesterName(clientId) {
  const person = clientId?.match(/^mozilla-auth0\/[^|]+\|[^|]+\|([^/]+)\//);
  return person ? person[1] : (clientId?.replace(/^project\//, "") ?? "unknown");
}

// What a request waited for until its last perf task finished or expired, as
// consecutive durations in seconds: the request task and the `backfill-task`
// action, each until it created the next, then the instrumented build, the
// profile generation, the build and the perf task each waiting then running. The
// builds and the profile generation are zero when the perf task ran on a build
// that already existed. The first is what the others leave out of the total: the
// time between one task finishing and the next being able to run, such as signing.
function endToEndChain(r) {
  const total = r.last_test_resolved_s - r.created_s;
  const durations = {
    request: r.request_s,
    action: r.action_s,
    instrumentedWait: r.instrumented_wait_s,
    instrumentedRun: r.instrumented_run_s,
    profileWait: r.profile_wait_s,
    profileRun: r.profile_run_s,
    buildWait: r.build_wait_s,
    buildRun: r.build_run_s,
    testWait: r.test_wait_s,
    testRun: r.test_run_s,
    testExpired: r.test_expired_s
  };
  const unexplained = Math.max(0, total - d3.sum(Object.values(durations)));
  return {
    testId: r.last_test_id,
    buildId: r.build_id,
    profileId: r.profile_id,
    instrumentedId: r.instrumented_id,
    expired: r.test_expired_s > 0,
    blocked: Boolean(r.test_blocked),
    finished: new Date(r.last_test_resolved_s * 1000),
    total,
    // When every perf task of the request never ran, what no task accounts for is
    // the wait for the broken task upstream, until the deadline.
    durations: {other: r.test_blocked ? 0 : unexplained, blocked: r.test_blocked ? unexplained : 0, ...durations}
  };
}

// The perf tasks of a request that never ran because a task they depend on
// failed, expired or was cancelled: how many, when the last one gave up at its
// deadline, and what broke, the dependency itself and the first task up the chain.
function blockedPerfTasks(r) {
  return {
    count: r.blocked_tests,
    testId: r.blocked_test_id,
    deadline: new Date(r.blocked_resolved_s * 1000),
    parent: r.blocked_parent_id ? {id: r.blocked_parent_id, label: r.blocked_parent_label, outcome: r.blocked_parent_outcome} : null,
    root: r.blocked_root_id ? {id: r.blocked_root_id, label: r.blocked_root_label, outcome: r.blocked_root_outcome} : null
  };
}
```

```js
const POOL_QUEUES = {
  "Linux talos": "releng-hardware/gecko-t-linux-talos-2404",
  "Windows 11 hw": "releng-hardware/win11-64-24h2-hw",
  "mac M4": "releng-hardware/gecko-t-osx-1500-m4",
  "mac 14.70": "releng-hardware/gecko-t-osx-1400-r8",
  "Android A55": "proj-autophone/gecko-t-lambda-perf-a55",
  "Windows hw-ref": "releng-hardware/win11-64-24h2-hw-ref"
};
const POOLS = Object.keys(POOL_QUEUES);
const BUCKET_SECONDS = [900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];
const EXCEPTION_COLOR = "#d99a00";
const BUG_KEY = "bug";
// When the patch of bug 1677741 landed on autoland: the time of its comment #15.
const BUG_DATE = new Date("2026-09-04T10:33:58Z");
const {top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT, right: MARGIN_RIGHT} = MARGINS;
const HIT_RADIUS = 8;
const TC_URL = "https://firefox-ci-tc.services.mozilla.com";
const TREEHERDER_URL = "https://treeherder.mozilla.org";
const WORKERS_URL = "https://tests.firefox.dev/workers.html";

// The days the data covers, and the range the charts show, as [first moment, end
// of the last day].
const DATA_FIRST_DAY = new Date(`${FIRST_DAY}T00:00:00Z`);
const DATA_LAST_DAY = new Date(`${LAST_DAY}T00:00:00Z`);
const dayAfter = (day) => new Date(+day + DAY_MS);

const bugRule = (domain, hidden) => eventRule(domain, hidden, {key: BUG_KEY, date: BUG_DATE});

const inDomain = (domain, ms) => ms >= domain[0] && ms < domain[1];
const requestsByPool = d3.group(requestRows, (r) => r.pool);
const METRICS_TITLE = {chartKey: "chart-metrics", title: "Top line metrics"};
const REQUESTS_TITLE = {chartKey: "chart-requests", title: "Backfill requests"};
const REQUESTS_HEIGHT = 260;
const E2E_TITLE = {chartKey: "chart-endtoend", title: "From backfill request to its last perf task"};
const E2E_HEIGHT = 240;
const QUEUES_TITLE = {chartKey: "chart-queues", title: "Tasks queued by priority in the worker pools of those tasks"};
const QUEUE_HEIGHT = 150;
// The pools a request waits in, in the order of its chain, and what each runs.
const CHAIN_POOL_ROLES = [
  {key: "instrumented", title: "instrumented builds"},
  {key: "profile", title: "profile generations"},
  {key: "build", title: "builds"},
  {key: "test", title: "perf tasks"}
];
const TIER_COLORS = new Map([
  ["highest", "#d64045"],
  ["very-high", "#f28c28"],
  ["high", "#f2c14e"],
  ["medium", "#2ba3b8"]
]);
// What a queue's layers are: one for each of the higher priorities, then for each
// of the low ones (low, very-low and lowest) one for each kind of run, so that the
// perf backfills of a priority can be told from what else waits in it, and from
// the perf backfills of the others. The kinds use the colours of the same things in
// the pool load, lighter for each lower priority.
const LOW_TIERS = [
  {tier: "low", title: "Low priority", fade: 0},
  {tier: "very-low", title: "Very low priority", fade: 0.3},
  {tier: "lowest", title: "Lowest priority", fade: 0.55}
];
const LOW_KINDS = {backfill: {title: "backfill tasks", color: "#8e44ad"}, perf: {title: "other perf tasks", color: "#3d9a5b"}, other: {title: "other tasks", color: "#8a8a8a"}};
const QUEUE_LAYERS = [
  ...[...TIER_COLORS].map(([tier, color]) => ({key: tier, title: tier, tooltip: tier, color, values: (depth, bucket) => depth.tiers.get(tier)[bucket]})),
  ...LOW_TIERS.flatMap(({tier, title, fade}) =>
    QUEUE_KINDS.map((kind) => ({
      key: `${tier}-${kind}`,
      group: title,
      title: LOW_KINDS[kind].title,
      tooltip: `${tier}, ${LOW_KINDS[kind].title}`,
      color: d3.interpolateRgb(LOW_KINDS[kind].color, "#ffffff")(fade),
      values: (depth, bucket) => depth.kinds.get(tier).get(kind)[bucket]
    }))
  )
];
const E2E_BAR_WIDTH = 5;
// A perf task never runs when a task it depends on does not complete: it stays
// unscheduled until its deadline. The root cause is the task at the top of that
// chain of broken tasks, the first one that broke on its own, as the tasks below it
// only never ran because of it. Its mark tells how it broke.
const BLOCKED_COLOR = "#b3202a";
const BLOCKED_GROUP = "Perf task that never ran, because a task upstream broke";
const BLOCKED_KINDS = [
  {key: "blocked-failed", title: "mark at its deadline, root cause failed", symbol: "times", marker: "cross", matches: (outcome) => outcome === "failed"},
  {key: "blocked-expired", title: "mark at its deadline, root cause expired in a queue", symbol: "diamond2", marker: "diamond", matches: (outcome) => outcome === "expired"},
  {key: "blocked-canceled", title: "mark at its deadline, root cause was cancelled", symbol: "triangle2", marker: "triangle", matches: (outcome) => outcome === "canceled"},
  {key: "blocked-other", title: "mark at its deadline, root cause had an exception or is unknown", symbol: "square2", marker: "square", matches: () => true}
];
const blockedKind = ({root, parent}) => BLOCKED_KINDS.find(({matches}) => matches(root?.outcome ?? parent?.outcome ?? ""));
// Bottom to top, in the order things happen. `group` and `short` title the
// legend, `title` the tooltip. `applies` tells which requests have the segment.
const hasId = (key) => (chain) => Boolean(chain[key]);
const E2E_SEGMENTS = [
  {key: "other", group: "Other", short: "gaps between tasks, such as signing and scheduling", title: "other gaps between tasks, such as signing and scheduling", color: "#cfcfcf"},
  {key: "request", group: "Backfill request", short: "waiting and running, until it created the action", title: "backfill request waiting and running, until it created the action", color: "#b39a74"},
  {key: "action", group: "Backfill-task action", short: "waiting and running, until it created the perf task", title: "backfill-task action waiting and running, until it created the perf task", color: "#8a4fb5"},
  {key: "instrumentedWait", group: "Instrumented build", short: "waited for a worker", title: "instrumented build waited for a worker", color: "#f4c15d", applies: hasId("instrumentedId")},
  {key: "instrumentedRun", group: "Instrumented build", short: "ran", title: "instrumented build ran", color: "#7cc79a", applies: hasId("instrumentedId")},
  {key: "profileWait", group: "Profile generation", short: "waited for a worker", title: "profile generation waited for a worker", color: "#d98324", applies: hasId("profileId")},
  {key: "profileRun", group: "Profile generation", short: "ran", title: "profile generation ran", color: "#237a4b", applies: hasId("profileId")},
  {key: "buildWait", group: "Build", short: "waited for a worker", title: "build waited for a worker", color: "#f0b6c8", applies: hasId("buildId")},
  {key: "buildRun", group: "Build", short: "ran", title: "build ran", color: "#c2476f", applies: hasId("buildId")},
  {key: "testWait", group: "Perf task", short: "waited for a worker", title: "perf task waited for a worker", color: "#9cc3ee", applies: (chain) => !chain.expired || chain.durations.testWait > 0},
  {key: "testRun", group: "Perf task", short: "ran", title: "perf task ran", color: "#2f74d0", applies: (chain) => !chain.expired || chain.durations.testRun > 0},
  {key: "testExpired", group: "Perf task", short: "expired while waiting for a worker", title: "perf task expired while waiting for a worker", color: EXCEPTION_COLOR, applies: (chain) => chain.expired},
  {key: "blocked", group: BLOCKED_GROUP, short: "bar up to its deadline, when no perf task of the request ran", title: "perf task never ran, waited for a broken upstream task until its deadline", color: BLOCKED_COLOR, applies: (chain) => chain.blocked}
];
const REQUEST_SIZES = [10, 50, 100];
// What the requests chart's colour legend toggles: requests by how many profile
// generations they triggered.
const PROFILE_BUCKETS = [
  {key: "profiles-none", title: "none", has: (n) => n === 0},
  {key: "profiles-1-9", title: "1 to 9", has: (n) => n >= 1 && n <= 9},
  {key: "profiles-10-19", title: "10 to 19", has: (n) => n >= 10 && n <= 19},
  {key: "profiles-20-plus", title: "20 or more", has: (n) => n >= 20}
];
const profileBucket = (profiles) => PROFILE_BUCKETS.find((bucket) => bucket.has(profiles));
const binsByPool = d3.group(loadRows, (r) => r.pool);
```

```js
function formatWait(hours) {
  const seconds = Math.round(hours * 3600);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// workers.html shows each pool's activity for a day, with a Profiler button on
// every pool row. It only keeps recent days, and silently shows the latest one
// when asked for a day it does not have, so link to it only for the days its
// own index lists. Until that list loads, or if it fails, there is no link.
let workersDays = new Set();
fetch(`${TC_URL}/api/index/v1/task/gecko.v2.mozilla-central.latest.source.test-info-worker-data/artifacts/public/index.json`)
  .then((response) => response.json())
  .then(({dates}) => {
    workersDays = new Set(dates);
  })
  .catch(() => {});

function workersUrl(queue, date) {
  return workersDays.has(date) ? `${WORKERS_URL}?${new URLSearchParams({date, filter: queue})}` : null;
}

function poolActivityUrls(queue, fromMs, toMs) {
  return poolActivityDays(fromMs, toMs, (date) => workersUrl(queue, date));
}

// Where a task's dependency timeline opens from, so that a profile can link its
// tasks to theirs. The page shows a link to open it, since the profiler can only
// be opened from a click.
const timelineUrl = (taskId) => `${window.location.origin}${window.location.pathname}?timeline=${taskId}`;

const dependencyTimelineLink = ({task_id}, text = "→ Dependency timeline") =>
  timelineLink(text, (onProgress) => openDependencyTimeline({taskId: task_id, poolActivityUrls, timelineUrl, queueTable, onProgress}), `${task_id}-dependencies.json`);

// The tasks a backfill request started and what they created.
const downstreamTimelineLink = (request) =>
  timelineLink(
    "→ Downstream timeline",
    (onProgress) =>
      openDownstreamTimeline({requestId: request.id, taskIds: request.downstreamIds, pushGroups: request.pushGroups, poolActivityUrls, timelineUrl, queueTable, onProgress}),
    `${request.id}-downstream.json`
  );

// The workers of a queue's pool: the six test pools are named on the page, and the
// build pools in the load data after their queue.
const POOL_OF_QUEUE = new Map(Object.entries(POOL_QUEUES).map(([pool, queue]) => [queue, pool]));
const workerBinsOf = (queue) => binsByPool.get(POOL_OF_QUEUE.get(queue) ?? queue) ?? null;

// The tasks waiting in a queue, a day around a moment, by priority and kind.
const queueGanttLink = ({queue, roles, time}) =>
  timelineLink(
    "→ Gantt of the queue, by priority and kind",
    () =>
      openQueueGantt({
        queueTable,
        queue,
        roles,
        centerMs: +time,
        firstMs: +DATA_FIRST_DAY,
        lastMs: +dayAfter(DATA_LAST_DAY),
        poolActivityUrls,
        workerBins: workerBinsOf(queue)
      }),
    `${queue.replace("/", "-")}-queue.json`
  );

const tooltip = createTooltip({invalidation});

const REQUEST_RADII = [2, 14];
const requestRadius = (tests, maxTests) => REQUEST_RADII[0] + (REQUEST_RADII[1] - REQUEST_RADII[0]) * Math.sqrt(tests / maxTests);
const purples = (t) => d3.interpolatePurples(0.25 + 0.75 * t);
const profileColor = (profiles, maxProfiles) => purples(Math.sqrt(profiles / maxProfiles));
const requestColor = (maxProfiles) => ({type: "sqrt", domain: [0, maxProfiles], interpolate: purples});

// The requester's name filters the requests to theirs, through the input that
// holds the filter.
function requesterLink(name) {
  const link = htl.html`<a href="#" title="Show only the requests of ${name}">${name}</a>`;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    document.dispatchEvent(new CustomEvent("bw-requester", {detail: name}));
    tooltip.hide();
  });
  return link;
}

const treeherderRangeUrl = ({fromRevision, toRevision}) =>
  `${TREEHERDER_URL}/jobs?repo=autoland&fromchange=${fromRevision}&tochange=${toRevision}`;

const taskLink = (id, text) => htl.html`<a href="${TC_URL}/tasks/${id}" target="_blank" rel="noopener">${text}</a>`;

// Where to look at what a request did: the tasks it triggered over time, the
// pushes it backfilled up to the one it was made on, and its own task.
function requestLinks(request) {
  return htl.html`${downstreamTimelineLink(request)}
    ${request.fromRevision && request.toRevision ? htl.html`<a href="${treeherderRangeUrl(request)}" target="_blank" rel="noopener">→ Treeherder, the pushes it backfilled</a>` : ""}
    ${taskLink(request.id, "→ TC Task of the request")}`;
}

function requestHeading(request) {
  return htl.html`<span><b>${request.target}</b></span>
    <span>requested ${formatTime(request.time)}</span>
    <div class="bw-tt-links">by ${requesterLink(request.requester)}</div>`;
}

function requestTooltipContent(request) {
  return htl.html`${requestHeading(request)}
    <span>${countOf(request.tests, "perf test")} scheduled on ${countOf(request.pushGroups.length, "older push", "older pushes")}</span>
    <span>${countOf(request.builds, "build")} and ${countOf(request.profiles, "profile generation")} triggered</span>
    <div class="bw-tt-sep"></div>
    ${requestLinks(request)}
    <span class="bw-tt-pool">${request.pool}</span>`;
}

const OUTCOMES = {failed: "failed", expired: "expired in a queue", canceled: "was cancelled", exception: "ended with an exception"};
const describeOutcome = (task) => `${task.label || "a task"} ${OUTCOMES[task.outcome] ?? "did not complete"}`;

// What stopped a request's perf tasks from running: the dependency that broke, and
// the root cause, the first task up the chain that broke on its own, with where to
// look at it. They are the same task when the dependency itself broke on its own.
function blockedLines({count, deadline, parent, root}) {
  const same = parent && root && parent.id === root.id;
  return htl.html`<div class="bw-tt-sep"></div>
    <span class="bw-tt-blocked"><b>${countOf(count, "perf task")}</b> never ran, waiting until the last deadline, ${formatTime(deadline)}</span>
    ${parent ? htl.html`<span class="bw-tt-blocked">${same ? "Broken task" : "Blocked by"}: ${describeOutcome(parent)}</span>` : ""}
    ${root && !same ? htl.html`<span class="bw-tt-blocked">Root cause: ${describeOutcome(root)}</span>` : ""}
    ${root ? htl.html`${taskLink(root.id, "→ TC Task of the root cause")}${dependencyTimelineLink({task_id: root.id}, "→ Dependency timeline of the root cause")}` : ""}`;
}

function endToEndTooltipContent(request) {
  const {chain} = request;
  const ended = chain.blocked ? "never ran" : chain.expired ? "expired" : "finished";
  return htl.html`${requestHeading(request)}
    <span class="${chain.blocked ? "bw-tt-blocked" : chain.expired ? "bw-tt-expired" : ""}"><b>${formatWait(chain.total / 3600)}</b> until the last perf task ${ended}, ${formatTime(chain.finished)}</span>
    <div class="bw-tt-sep"></div>
    ${segmentLines(E2E_SEGMENTS, {durations: chain.durations, subject: chain, format: (hours) => formatWait(hours)})}
    ${request.blocked ? blockedLines(request.blocked) : ""}
    <div class="bw-tt-sep"></div>
    ${requestLinks(request)}
    ${chain.instrumentedId ? taskLink(chain.instrumentedId, "→ TC Task of the instrumented build") : ""}
    ${chain.profileId ? taskLink(chain.profileId, "→ TC Task of the profile generation") : ""}
    ${chain.buildId ? taskLink(chain.buildId, "→ TC Task of the build") : ""}
    ${taskLink(chain.testId, "→ TC Task of the perf task")}
    <span class="bw-tt-pool">${request.pool}</span>`;
}

function showRequest(event, point, chartRect) {
  if (!tooltip.open(event, point.request, requestTooltipContent(point.request))) return;
  tooltip.showRing(chartRect, point, Math.max(12, 2 * point.radius + 4));
}

function showEndToEnd(event, point, chartRect) {
  if (!tooltip.open(event, point.item.chain, endToEndTooltipContent(point.item))) return;
  tooltip.showRing(chartRect, point, 12);
}

// What each backfill request triggered, on the same date axis as the task charts
// above it, with the same tooltip. Requests made in the same minute land on top
// of each other, so the dots are translucent.
// The scales come from all the platform's requests, so that filtering by
// requester does not rescale the dots.
function requestsChart({requests, shown, width, hidden, domain}) {
  const maxTests = d3.max(requests, (r) => r.tests);
  const maxBuilds = d3.max(requests, (r) => r.builds);
  const padding = Math.max(1, maxBuilds * 0.08);
  const dots = shown.filter((request) => !hidden.has(profileBucket(request.profiles).key));
  const plot = Plot.plot({
    width,
    height: REQUESTS_HEIGHT,
    marginTop: MARGIN_TOP,
    marginBottom: MARGIN_BOTTOM,
    marginLeft: MARGIN_LEFT,
    marginRight: MARGIN_RIGHT,
    x: dateAxis(domain, width),
    y: {domain: [-padding, maxBuilds + padding], ticks: d3.ticks(0, maxBuilds, 6), grid: true, label: "builds"},
    r: {domain: [0, maxTests], range: REQUEST_RADII},
    color: requestColor(d3.max(requests, (r) => r.profiles)),
    marks: [
      Plot.ruleY([0], {strokeOpacity: 0.3}),
      bugRule(domain, hidden),
      Plot.dot(dots, {
        x: "time",
        y: "builds",
        r: "tests",
        fill: "profiles",
        fillOpacity: 0.7,
        stroke: "currentColor",
        strokeOpacity: 0.25
      })
    ]
  });
  const x = plot.scale("x");
  const y = plot.scale("y");
  const points = dots.map((request) => ({
    request,
    x: x.apply(request.time),
    y: y.apply(request.builds),
    radius: requestRadius(request.tests, maxTests)
  }));
  attachPlotHover(tooltip, plot, (px, py) => nearestDot(points, px, py, HIT_RADIUS), showRequest);
  return plot;
}

// One bar per request, stacked from what happened first to what happened last,
// with a dot at its top, which is the end-to-end time. The height scale comes
// from all the platform's requests, like in the requests chart. Segments the
// legend has hidden are left out and the others close ranks, so the dot is at
// the top of what is left.
function endToEndChart({requests, shown, width, hidden, domain}) {
  const blockedHours = (request) => (request.blocked.deadline - request.time) / 3600000;
  const maxHours = Math.max(d3.max(requests, (request) => request.chain?.total ?? 0) / 3600, d3.max(requests, (request) => (request.blocked ? blockedHours(request) : 0)) ?? 0);
  // A perf task that never ran is marked where it gave up, at its deadline. When
  // the request has others that ran, a line joins it to where they ended.
  const marked = (kind) => shown.filter((request) => request.blocked && blockedKind(request.blocked) === kind && !hidden.has(kind.key));
  const markedRequests = new Set(BLOCKED_KINDS.flatMap(marked));
  const joined = [...markedRequests].filter((request) => request.chain && !request.chain.blocked);
  return candleChart({
    items: shown.filter((request) => request.chain),
    segments: E2E_SEGMENTS,
    hidden,
    domain,
    width,
    height: E2E_HEIGHT,
    maxHours,
    barWidth: E2E_BAR_WIDTH,
    hitRadius: HIT_RADIUS,
    tooltip,
    show: showEndToEnd,
    before: [bugRule(domain, hidden)],
    after: ({topHours, ends}) => {
      const runEnds = ends.filter((request) => !request.chain.blocked);
      return [
        Plot.ruleX(joined, {x: "time", y1: topHours, y2: blockedHours, stroke: BLOCKED_COLOR, strokeOpacity: 0.7, strokeDasharray: "2 2"}),
        Plot.dot(runEnds.filter((request) => !request.chain.expired), {x: "time", y: topHours, r: 3, fill: "currentColor"}),
        Plot.dot(runEnds.filter((request) => request.chain.expired), {x: "time", y: topHours, symbol: "times", r: 5, stroke: EXCEPTION_COLOR, strokeWidth: 2}),
        ...BLOCKED_KINDS.map((kind) => Plot.dot(marked(kind), {x: "time", y: blockedHours, symbol: kind.symbol, r: 5, stroke: BLOCKED_COLOR, strokeWidth: 2, fill: "none"}))
      ];
    },
    drawnHours: (request, topHours) => Math.max(topHours(request), markedRequests.has(request) ? blockedHours(request) : 0)
  });
}

// The worker pools the chain tasks of these requests ran in: for each kind of
// task the queue most requests used, with kinds that share a queue merged. The
// perf tasks run in the platform's own pool.
function chainPools(requests, pool) {
  const mostUsed = (key) => {
    const counts = d3.rollups(requests, (group) => group.length, (request) => request.queues[key]).filter(([queue]) => queue);
    return d3.greatest(counts, ([, count]) => count)?.[0];
  };
  const queueOf = ({key}) => (key === "test" ? POOL_QUEUES[pool] : mostUsed(key));
  const byQueue = d3.group(CHAIN_POOL_ROLES.filter((role) => queueOf(role)), queueOf);
  return Array.from(byQueue, ([queue, roles]) => ({queue, roles: roles.map(({title}) => title).join(" and ")}));
}

// What a queue held at the pointer: the runs waiting in each layer, and in all.
function queueTooltipContent({queue, roles, time, counts, total}) {
  const line = (layer) => htl.html`<span><i class="bw-swatch" style="background:${layer.color}"></i>${layer.tooltip}: <b>${Math.round(counts.get(layer.key)).toLocaleString("en-US")}</b></span>`;
  return htl.html`<span><b>${formatTime(time)}</b></span>
    <span class="bw-tt-pool">${queue}, ${roles}</span>
    <div class="bw-tt-sep"></div>
    <span><b>${Math.round(total).toLocaleString("en-US")}</b> tasks waiting for a worker</span>
    ${QUEUE_LAYERS.filter((layer) => Math.round(counts.get(layer.key)) > 0).map(line)}
    <div class="bw-tt-sep"></div>
    ${queueGanttLink({queue, roles, time})}`;
}

// The runs waiting in a task queue over time, stacked from the bottom by priority,
// highest first, down to the lowest, where each low priority is split by what the
// runs are. Each bucket is the mean over its width, like the pool load.
function queueChart({queue, roles, width, hidden, domain}) {
  const secondsPerPixel = (domain[1] - domain[0]) / 1000 / (width - MARGIN_LEFT - MARGIN_RIGHT);
  const bucketSeconds = BUCKET_SECONDS.find((seconds) => seconds >= secondsPerPixel) ?? BUCKET_SECONDS[BUCKET_SECONDS.length - 1];
  const depth = queuedPerBucket(indexQueueSeries(queueTable), queue, {fromSeconds: +domain[0] / 1000, toSeconds: +domain[1] / 1000, bucketSeconds});
  const shownLayers = QUEUE_LAYERS.filter(({key}) => !hidden.has(key));
  const buckets = depth ? d3.range(depth.bucketCount) : [];
  const timeOf = (bucket) => new Date((depth.firstBin + bucket * bucketSeconds) * 1000);
  const valueOf = (layer, bucket) => layer.values(depth, bucket);
  const totalOf = (bucket, layers) => d3.sum(layers, (layer) => valueOf(layer, bucket));
  const rows = buckets.flatMap((bucket) => shownLayers.map((layer) => ({time: timeOf(bucket), layer: layer.key, queued: valueOf(layer, bucket)})));
  const top = Math.max(1, d3.max(buckets, (bucket) => totalOf(bucket, shownLayers)) ?? 1);
  const plot = Plot.plot({
    width,
    height: QUEUE_HEIGHT,
    marginTop: MARGIN_TOP,
    marginBottom: MARGIN_BOTTOM,
    marginLeft: MARGIN_LEFT,
    marginRight: MARGIN_RIGHT,
    x: dateAxis(domain, width),
    y: {domain: [0, top * 1.05], grid: true, label: "tasks waiting"},
    color: {domain: QUEUE_LAYERS.map(({key}) => key), range: QUEUE_LAYERS.map(({color}) => color)},
    marks: [
      Plot.ruleY([0], {strokeOpacity: 0.3}),
      bugRule(domain, hidden),
      Plot.areaY(rows, {x: "time", y: "queued", z: "layer", fill: "layer", order: QUEUE_LAYERS.map(({key}) => key), curve: "step-after", fillOpacity: 0.85})
    ]
  });
  const xScale = plot.scale("x");
  const find = (px, py) => {
    if (!depth || px < MARGIN_LEFT || px > width - MARGIN_RIGHT || py < MARGIN_TOP || py > QUEUE_HEIGHT - MARGIN_BOTTOM) return null;
    const bucket = Math.floor((+xScale.invert(px) / 1000 - depth.firstBin) / bucketSeconds);
    return bucket >= 0 && bucket < depth.bucketCount ? {bucket, x: px} : null;
  };
  const show = (event, {bucket}) => {
    const counts = new Map(QUEUE_LAYERS.map((layer) => [layer.key, valueOf(layer, bucket)]));
    const content = queueTooltipContent({queue, roles, time: timeOf(bucket), counts, total: totalOf(bucket, QUEUE_LAYERS)});
    if (tooltip.open(event, `${queue}:${bucket}:${bucketSeconds}`, content)) tooltip.hideRing();
  };
  attachPlotHover(tooltip, plot, find, show);
  return plot;
}

// One chart for each worker pool the requests' tasks ran in.
function queuesBlock({requests, pool, width, hidden, domain}) {
  const heading = (roles, queue) => htl.html`<div class="bw-requests-key"><span><b>${roles[0].toUpperCase()}${roles.slice(1)}</b> run in ${queue}</span></div>`;
  return htl.html`${chainPools(requests, pool).map(({queue, roles}) => htl.html`${heading(roles, queue)}${chartBox(queueChart({queue, roles, width, hidden, domain}), QUEUE_HEIGHT)}`)}`;
}

// How many requests the end-to-end chart shows.
function endToEndKey(requests, shown) {
  const count = (list) => list.filter((request) => request.chain).length;
  const note = shown.length < requests.length ? htl.html`<span>${count(shown)} of ${count(requests)} requests</span>` : htl.html`<span>${count(requests)} of ${requests.length} requests, the others scheduled no perf task that ran, expired or never ran. A yellow cross is a perf task that expired. A red mark is a perf task that never ran because a task upstream broke, at its deadline. Its shape tells how the root cause ended: the first task up the chain that broke on its own, whose own dependencies were fine.</span>`;
  return htl.html`<div class="bw-requests-key">${note}</div>`;
}

// What the sizes of the requests chart stand for, and how many requests it shows.
function requestsKey(requests, shown, selectedRequester) {
  const maxTests = d3.max(requests, (r) => r.tests);
  const side = 2 * REQUEST_RADII[1] + 2;
  const sizes = REQUEST_SIZES.filter((tests) => tests <= maxTests).map(
    (tests) => htl.html`<span class="bw-key"><svg width="${side}" height="${side}"><circle cx="${side / 2}" cy="${side / 2}" r="${requestRadius(tests, maxTests)}" fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-opacity="0.5"></circle></svg>${tests} tests</span>`
  );
  const filter = selectedRequester ? htl.html`<span>${shown.length} of ${requests.length} requests, by ${selectedRequester}</span>` : "";
  return htl.html`<div class="bw-requests-key">${sizes}${filter}</div>`;
}

const EVENT_LEGEND = {title: "Event", entries: [{key: BUG_KEY, title: "Backfill priority set to very-low (bug 1677741)", marker: () => LEGEND_MARKERS.event()}]};
// One row per task of the chain, with what it waited for and ran.
const E2E_LEGEND = [
  ...d3.groups(E2E_SEGMENTS, (segment) => segment.group).map(([title, segments]) => ({
    title,
    entries: [
      ...(title === BLOCKED_GROUP ? BLOCKED_KINDS.map(({key, title, marker}) => ({key, title, marker: () => LEGEND_MARKERS[marker](BLOCKED_COLOR)})) : []),
      ...segments.map(({key, short, color}) => ({key, title: short, marker: () => LEGEND_MARKERS.swatch(color, 1)}))
    ]
  })),
  EVENT_LEGEND
];
const QUEUE_LEGEND = [
  {title: "Priority", entries: QUEUE_LAYERS.slice(0, TIER_COLORS.size).map(({key, title, color}) => ({key, title, marker: () => LEGEND_MARKERS.swatch(color, 1)}))},
  ...LOW_TIERS.map(({title}) => ({
    title,
    entries: QUEUE_LAYERS.filter((layer) => layer.group === title).map(({key, title, color}) => ({key, title, marker: () => LEGEND_MARKERS.swatch(color, 1)}))
  })),
  EVENT_LEGEND
];
// The buckets of the platform's requests, coloured like the dots in them.
const requestsLegend = (requests) => {
  const maxProfiles = d3.max(requests, (r) => r.profiles);
  const entries = PROFILE_BUCKETS.flatMap((bucket) => {
    const inBucket = requests.filter((r) => bucket.has(r.profiles));
    return inBucket.length ? [{key: bucket.key, title: bucket.title, marker: () => LEGEND_MARKERS.dot(profileColor(d3.max(inBucket, (r) => r.profiles), maxProfiles))}] : [];
  });
  return [{title: "Profile generations", entries}, EVENT_LEGEND];
};

const CHARTS = [METRICS_TITLE, REQUESTS_TITLE, E2E_TITLE, QUEUES_TITLE];

const endToEndHours = (requests, share) => d3.quantile(requests.filter((request) => request.chain).map((request) => request.chain.total / 3600), share);
const sumOf = (key) => (requests) => (requests.length ? d3.sum(requests, (request) => request[key]) : undefined);
const formatCount = (n) => Math.round(n).toLocaleString("en-US");
const distinctRequesters = (requests) => (requests.length ? new Set(requests.map((request) => request.requester)).size : undefined);
// The numbers at the top of the page, each for the whole range and for each day of
// it, by the day of the request. A day with no requests has no end-to-end time. A
// tile has one or more series, which share its chart.
const METRICS = [
  {
    key: "endtoend",
    title: "End-to-end time",
    span: 3,
    format: formatWait,
    series: [
      {key: "p50", title: "p50", value: (requests) => endToEndHours(requests, 0.5), color: "#86b4ea"},
      {key: "p90", title: "p90", value: (requests) => endToEndHours(requests, 0.9), color: "#2f74d0"},
      {key: "p99", title: "p99", value: (requests) => endToEndHours(requests, 0.99), color: "#163f7a"}
    ]
  },
  {key: "requests", title: "Backfill requests", format: formatCount, countless: true, series: [{value: (requests) => requests.length, color: "#8a4fb5"}]},
  {key: "requesters", title: "People requesting backfills", format: formatCount, series: [{value: distinctRequesters, color: "#5b6abf"}]},
  {key: "builds", title: "Builds scheduled", format: formatCount, series: [{value: sumOf("builds"), color: "#c2476f"}]},
  {key: "profiles", title: "Profile generations scheduled", format: formatCount, series: [{value: sumOf("profiles"), color: "#237a4b"}]},
  {key: "tests", title: "Perf tests scheduled", format: formatCount, series: [{value: sumOf("tests"), color: "#d98324"}]},
  {key: "blocked", title: "Perf tests that never ran, upstream broke", format: formatCount, series: [{value: (requests) => (requests.length ? d3.sum(requests, (request) => request.blocked?.count ?? 0) : undefined), color: BLOCKED_COLOR}]}
];

// The platform's charts, each as wide as the page and collapsed from its title:
// what its backfill requests triggered, how long they took, and what waited in the
// queues of the workers they ran on. Each has its own legend under its title, and
// its own hidden keys, `<chart key>:<key>`. A collapsed chart's key is its own
// chart key.
const blockCache = new Map();

function platformSection(pool, width, hidden, selectedRequester, domain) {
  const requests = requestsByPool.get(pool)?.filter((request) => inDomain(domain, +request.time));
  const shown = selectedRequester ? requests?.filter((r) => r.requester === selectedRequester) : requests;
  const noRequests = () =>
    !requests
      ? htl.html`<p class="bw-note">Backfill requests are not charted for this platform yet.</p>`
      : !requests.length
        ? htl.html`<p class="bw-note">No backfill requests in this range.</p>`
        : null;
  const requestChart = (drawKey, draw, height, hidden) =>
    noRequests() ?? htl.html`${drawKey(requests, shown, selectedRequester)}${chartBox(draw({requests, shown, width, hidden, domain}), height)}`;
  const bodies = {
    "chart-metrics": {
      legend: () => null,
      draw: () => noRequests() ?? metricsRow({items: shown, metrics: METRICS, domain, width, tooltip, noun: "backfill request", eventRules: (days) => [bugRule(days, new Set())]})
    },
    "chart-requests": {legend: () => requests && requestsLegend(requests), draw: (hidden) => requestChart(requestsKey, requestsChart, REQUESTS_HEIGHT, hidden)},
    "chart-endtoend": {legend: () => requests && E2E_LEGEND, draw: (hidden) => requestChart(endToEndKey, endToEndChart, E2E_HEIGHT, hidden)},
    "chart-queues": {legend: () => requests?.length && QUEUE_LEGEND, draw: (hidden) => noRequests() ?? queuesBlock({requests, pool, width, hidden, domain})}
  };
  // A chart is drawn again only when something it shows changed: its own hidden keys,
  // whether it is collapsed, the platform, requester, days or width.
  const block = (item) =>
    collapsibleBlock(item, {
      hidden,
      state: {setHidden, setHiddenKeys},
      width,
      context: [pool, width, +domain[0], +domain[1], selectedRequester],
      cache: blockCache,
      body: ({chartKey}, ownHidden) => {
        const {legend, draw} = bodies[chartKey];
        return {groups: legend(), content: draw(ownHidden)};
      }
    });
  const section = htl.html`<section class="bw-pool">${CHARTS.map(block)}</section>`;
  syncCharts(section, domain, (from, to) => setRange(d3.utcDay.floor(from), d3.utcDay.floor(new Date(Math.max(+from, +to - 1)))), tooltip);
  return section;
}
```

<style>
.bw-requests-key {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 1.5rem;
  padding: 0 40px 0 44px;
  font-size: 0.8rem;
  color: var(--theme-foreground-muted, #888);
}
.bw-requests-key > * {
  margin: 0;
}
.bw-key {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.bw-key .bw-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.bw-note {
  margin: 1rem 0 0;
  color: var(--theme-foreground-muted, #888);
}
.bw-timeline-banner {
  margin: 0.75rem 0;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--theme-foreground-faintest, #ddd);
  border-radius: 6px;
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
</style>

```js
// The platform is seeded from ?platform= so a link reproduces the view. Kept
// free of reactive dependencies: re-running this cell would rebuild the control.
const urlPlatform = new URLSearchParams(window.location.search).get("platform");
const platformInput = Inputs.select(POOLS, {label: "Platform", value: POOLS.includes(urlPlatform) ? urlPlatform : POOLS[0]});
const platform = Generators.input(platformInput);
```

```js
// Limits the requests chart to one requester, chosen here or by clicking a name
// in a tooltip. It lists the requesters of the platform, so it is rebuilt when
// the platform changes, keeping the requester if the new platform has them too.
const requesterCounts = d3.rollups(requestsByPool.get(platform) ?? [], (group) => group.length, (r) => r.requester).sort((a, b) => b[1] - a[1]);
const urlRequester = new URLSearchParams(window.location.search).get("requester");
const requesterInput = Inputs.select(new Map([["Everyone", ""], ...requesterCounts.map(([name, n]) => [`${name} (${n})`, name])]), {
  label: "Requested by",
  value: requesterCounts.some(([name]) => name === urlRequester) ? urlRequester : "",
  disabled: !requesterCounts.length
});
const requester = Generators.input(requesterInput);
const chooseRequester = ({detail}) => {
  requesterInput.value = detail;
  requesterInput.dispatchEvent(new Event("input", {bubbles: true}));
};
document.addEventListener("bw-requester", chooseRequester);
invalidation.then(() => document.removeEventListener("bw-requester", chooseRequester));
```

```js
// The days the charts show, from the date inputs or by dragging across a chart,
// and kept in the address as ?from= and ?to=. Both are days, so the last one is
// shown whole.
const dayParam = (name) => {
  const text = new URLSearchParams(window.location.search).get(name);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(text ?? "") ? new Date(`${text}T00:00:00Z`) : null;
  return day >= DATA_FIRST_DAY && day <= DATA_LAST_DAY ? day : null;
};
const dateInput = (label, value) => Inputs.date({label, value, min: DATA_FIRST_DAY, max: DATA_LAST_DAY});
const fromInput = dateInput("From", dayParam("from") ?? DATA_FIRST_DAY);
const toInput = dateInput("To", dayParam("to") ?? DATA_LAST_DAY);
const rangeFrom = Generators.input(fromInput);
const rangeTo = Generators.input(toInput);

const setRange = (from, to) => {
  for (const [input, day] of [[fromInput, from], [toInput, to]]) {
    input.value = day;
    input.dispatchEvent(new Event("input", {bubbles: true}));
  }
};
const resetButton = htl.html`<button type="button" class="bw-clear" title="Show all the days again">Reset zoom</button>`;
resetButton.onclick = () => setRange(DATA_FIRST_DAY, DATA_LAST_DAY);
```

```js
// [start, end) of the days chosen. Dates in the wrong order are put right.
const domain = (() => {
  const [first, last] = [rangeFrom ?? DATA_FIRST_DAY, rangeTo ?? DATA_LAST_DAY].sort((a, b) => a - b);
  return [first, dayAfter(last)];
})();
```

```js
// Nothing to reset when all the days are shown.
resetButton.disabled = +domain[0] === +DATA_FIRST_DAY && +domain[1] === +dayAfter(DATA_LAST_DAY);
```

```js
// A link in a profile opens the page with ?timeline=<task id>. The profiler can
// only be opened from a click, so the page offers it.
{
  const taskId = new URLSearchParams(window.location.search).get("timeline");
  if (/^[A-Za-z0-9_-]{22}$/.test(taskId ?? "")) {
    display(htl.html`<div class="bw-timeline-banner">Dependency timeline of <code>${taskId}</code>: ${dependencyTimelineLink({task_id: taskId}, "→ Open it in the Firefox Profiler")}</div>`);
  }
}
```

<div class="bw-filters"><div>${platformInput}${requesterInput}</div><div>${fromInput}${toInput}${resetButton}</div></div>

```js
{
  // Every parameter is always there, with its default when nobody chose, so that
  // the address says what the page shows.
  const params = new URLSearchParams(window.location.search);
  const isoDay = (day) => day.toISOString().slice(0, 10);
  params.set("platform", platform);
  params.set("requester", requester);
  params.set("from", isoDay(domain[0]));
  params.set("to", isoDay(new Date(+domain[1] - DAY_MS)));
  history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
}
```

```js
// The keys of the hidden series and charts. Every legend button writes them to
// this element, and the charts redraw when it changes.
const hiddenKeys = hiddenKeysState("bw-charts");
const hidden = Generators.input(hiddenKeys.input);
const {setHiddenKeys, setHidden} = hiddenKeys;
```

<div class="card" id="bw-charts">
  ${resize((width) => platformSection(platform, width, hidden, requester, domain))}
</div>

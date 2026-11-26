---
title: Perf backfill waits
toc: false
---

# Perf backfill waits

```js
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
    blocked: r.blocked_tests ? blockedPerfTasks(r) : null,
    chain: r.last_test_id ? endToEndChain(r) : null
  }));
```

```js
import {openDependencyTimeline, openDownstreamTimeline, poolActivityDays} from "./_task-profile.js";
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
const POOLS = ["Linux talos", "Windows 11 hw", "mac M4", "mac 14.70", "Android A55", "Windows hw-ref"];
const EXCEPTION_COLOR = "#d99a00";
const BUG_KEY = "bug";
// When the patch of bug 1677741 landed on autoland: the time of its comment #15.
const BUG_DATE = new Date("2026-09-04T10:33:58Z");
const MARGIN_TOP = 18;
const MARGIN_BOTTOM = 22;
const MARGIN_LEFT = 44;
const MARGIN_RIGHT = 40;
const HIT_RADIUS = 8;
const TC_URL = "https://firefox-ci-tc.services.mozilla.com";
const TREEHERDER_URL = "https://treeherder.mozilla.org";
const WORKERS_URL = "https://tests.firefox.dev/workers.html";
const DAY_MS = 86400000;
const formatDay = d3.utcFormat("%-d %b");
const formatTime = d3.utcFormat("%-d %b %H:%M UTC");

// The days the data covers, and the range the charts show, as [first moment, end
// of the last day].
const DATA_FIRST_DAY = new Date("2026-06-14T00:00:00Z");
const DATA_LAST_DAY = new Date("2026-11-24T00:00:00Z");
const dayAfter = (day) => new Date(+day + DAY_MS);
const TICK_DAYS = [1, 2, 7, 14, 28, 56];
const TICK_SPACING = 90;

// A tick every day, two days, week and so on, as often as they stay apart.
function dateTicks(domain, width) {
  const days = (domain[1] - domain[0]) / DAY_MS;
  const room = Math.max(2, (width - MARGIN_LEFT - MARGIN_RIGHT) / TICK_SPACING);
  return d3.utcDay.range(domain[0], domain[1], TICK_DAYS.find((step) => days / step <= room) ?? TICK_DAYS[TICK_DAYS.length - 1]);
}

const dateAxis = (domain, width) => ({type: "utc", domain, ticks: dateTicks(domain, width), tickFormat: formatDay, label: null});

const bugRule = (domain, hidden) =>
  hidden.has(BUG_KEY) || BUG_DATE < domain[0] || BUG_DATE > domain[1]
    ? null
    : Plot.ruleX([BUG_DATE], {stroke: "currentColor", strokeOpacity: 0.5, strokeDasharray: "2 3"});

const inDomain = (domain, ms) => ms >= domain[0] && ms < domain[1];
const requestsByPool = d3.group(requestRows, (r) => r.pool);
const METRICS_TITLE = {chartKey: "chart-metrics", title: "Top line metrics"};
const REQUESTS_TITLE = {chartKey: "chart-requests", title: "Backfill requests"};
const REQUESTS_HEIGHT = 260;
const E2E_TITLE = {chartKey: "chart-endtoend", title: "From backfill request to its last perf task"};
const E2E_HEIGHT = 240;
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

// A link that opens a Gantt in the Firefox Profiler. `open` gets a progress
// callback and returns the opener's result. The window opens inside the click so
// popup blockers allow it.
function timelineLink(text, open, filename) {
  const link = htl.html`<a href="#">${text}</a>`;
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    if (link.dataset.busy) return;
    link.dataset.busy = "true";
    const label = link.textContent;
    try {
      const result = await open((count) => {
        link.textContent = `→ Loading ${count} tasks…`;
      });
      link.textContent = label;
      if (!result.opened) {
        link.href = result.downloadUrl;
        link.download = filename;
        link.textContent = "→ Popup blocked: download the profile, then drop it on profiler.firefox.com";
      }
    } catch (error) {
      link.textContent = `${text} failed: ${error.message}`;
    } finally {
      delete link.dataset.busy;
    }
  });
  return link;
}

// Where a task's dependency timeline opens from, so that a profile can link its
// tasks to theirs. The page shows a link to open it, since the profiler can only
// be opened from a click.
const timelineUrl = (taskId) => `${window.location.origin}${window.location.pathname}?timeline=${taskId}`;

const dependencyTimelineLink = ({task_id}, text = "→ Dependency timeline") =>
  timelineLink(text, (onProgress) => openDependencyTimeline({taskId: task_id, poolActivityUrls, timelineUrl, onProgress}), `${task_id}-dependencies.json`);

// The tasks a backfill request started and what they created.
const downstreamTimelineLink = (request) =>
  timelineLink(
    "→ Downstream timeline",
    (onProgress) =>
      openDownstreamTimeline({requestId: request.id, taskIds: request.downstreamIds, pushGroups: request.pushGroups, poolActivityUrls, timelineUrl, onProgress}),
    `${request.id}-downstream.json`
  );

// One tooltip shared by every chart. Hovering opens it and it stays open briefly
// after the pointer leaves, and while the pointer is over it. Clicking pins it, so
// the pointer can travel to its links; clicking elsewhere or pressing Escape
// releases it.
const tooltipState = {key: null, hideTimer: null, pinned: false, dragging: false};
const OVERLAY_IDS = ["bw-tooltip", "bw-ring"];

function hideTooltip() {
  tooltipState.key = null;
  tooltipState.pinned = false;
  for (const id of OVERLAY_IDS) document.getElementById(id).style.display = "none";
}

function scheduleHideTooltip() {
  if (tooltipState.pinned) return;
  clearTimeout(tooltipState.hideTimer);
  tooltipState.hideTimer = setTimeout(hideTooltip, 220);
}

const tooltipElement = document.getElementById("bw-tooltip");
tooltipElement.onpointerenter = () => clearTimeout(tooltipState.hideTimer);
tooltipElement.onpointerleave = scheduleHideTooltip;
document.onclick = (event) => {
  if (!tooltipElement.contains(event.target)) hideTooltip();
};
document.onkeydown = (event) => {
  if (event.key === "Escape") hideTooltip();
};

function openTooltip(event, key, content) {
  if (tooltipState.pinned || tooltipState.dragging) return false;
  clearTimeout(tooltipState.hideTimer);
  if (tooltipState.key === key) return false;
  tooltipState.key = key;

  tooltipElement.replaceChildren(content);
  tooltipElement.style.display = "block";
  const {offsetWidth, offsetHeight} = tooltipElement;
  const gap = 14;
  const flipX = event.clientX + gap + offsetWidth > window.innerWidth;
  const flipY = event.clientY + gap + offsetHeight > window.innerHeight;
  tooltipElement.style.left = `${flipX ? event.clientX - offsetWidth - gap : event.clientX + gap}px`;
  tooltipElement.style.top = `${flipY ? event.clientY - offsetHeight - gap : event.clientY + gap}px`;
  return true;
}

const REQUEST_RADII = [2, 14];
const requestRadius = (tests, maxTests) => REQUEST_RADII[0] + (REQUEST_RADII[1] - REQUEST_RADII[0]) * Math.sqrt(tests / maxTests);
const countOf = (n, noun, plural = `${noun}s`) => `${n} ${n === 1 ? noun : plural}`;
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
    hideTooltip();
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
  const line = ({key, title, color}) =>
    htl.html`<span><i class="bw-swatch" style="background:${color}"></i>${title}: <b>${formatWait(chain.durations[key] / 3600)}</b></span>`;
  const ended = chain.blocked ? "never ran" : chain.expired ? "expired" : "finished";
  return htl.html`${requestHeading(request)}
    <span class="${chain.blocked ? "bw-tt-blocked" : chain.expired ? "bw-tt-expired" : ""}"><b>${formatWait(chain.total / 3600)}</b> until the last perf task ${ended}, ${formatTime(chain.finished)}</span>
    <div class="bw-tt-sep"></div>
    ${[...E2E_SEGMENTS].reverse().filter(({applies}) => !applies || applies(chain)).map(line)}
    ${request.blocked ? blockedLines(request.blocked) : ""}
    <div class="bw-tt-sep"></div>
    ${requestLinks(request)}
    ${chain.instrumentedId ? taskLink(chain.instrumentedId, "→ TC Task of the instrumented build") : ""}
    ${chain.profileId ? taskLink(chain.profileId, "→ TC Task of the profile generation") : ""}
    ${chain.buildId ? taskLink(chain.buildId, "→ TC Task of the build") : ""}
    ${taskLink(chain.testId, "→ TC Task of the perf task")}
    <span class="bw-tt-pool">${request.pool}</span>`;
}

// Rings the point on its chart, sized to it.
function ringPoint(chartRect, {x, y}, size) {
  const ring = document.getElementById("bw-ring");
  ring.style.width = `${size}px`;
  ring.style.height = `${size}px`;
  ring.style.left = `${chartRect.left + x}px`;
  ring.style.top = `${chartRect.top + y}px`;
  ring.style.display = "block";
}

function showRequest(event, point, chartRect) {
  if (!openTooltip(event, point.request, requestTooltipContent(point.request))) return;
  ringPoint(chartRect, point, Math.max(12, 2 * point.radius + 4));
}

function showEndToEnd(event, point, chartRect) {
  if (!openTooltip(event, point.request.chain, endToEndTooltipContent(point.request))) return;
  ringPoint(chartRect, point, 12);
}

// The dot under the pointer: of the dots it is inside, the smallest, so a small
// dot on top of a big one stays reachable. Otherwise the nearest within reach.
function requestAt(points, x, y) {
  const distanceTo = (point) => Math.hypot(point.x - x, point.y - y);
  const inside = points.filter((point) => distanceTo(point) <= point.radius);
  if (inside.length) return inside.reduce((best, point) => (point.radius < best.radius ? point : best));
  const near = points.filter((point) => distanceTo(point) <= HIT_RADIUS);
  return near.length ? near.reduce((best, point) => (distanceTo(point) < distanceTo(best) ? point : best)) : null;
}

// The bar under the pointer: the nearest one within reach sideways, anywhere
// from the axis up to a little above its dot.
function barAt(points, x, y) {
  const near = points.filter((point) => Math.abs(point.x - x) <= E2E_BAR_WIDTH && y >= point.y - HIT_RADIUS && y <= point.baseline + HIT_RADIUS);
  return near.length ? near.reduce((best, point) => (Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best)) : null;
}

// Hover and click on a Plot chart, with the tooltip shared by the other charts.
// `find` gets the pointer's position in the chart and returns the point there.
function attachPlotHover(plot, find, show) {
  const hitAt = (event) => {
    const rect = plot.getBoundingClientRect();
    return {point: find(event.clientX - rect.left, event.clientY - rect.top), rect};
  };
  plot.addEventListener("pointermove", (event) => {
    const {point, rect} = hitAt(event);
    plot.style.cursor = point ? "pointer" : "";
    if (point) show(event, point, rect);
    else scheduleHideTooltip();
  });
  plot.addEventListener("pointerleave", scheduleHideTooltip);
  plot.addEventListener("click", (event) => {
    event.stopPropagation();
    const {point, rect} = hitAt(event);
    tooltipState.pinned = false;
    if (!point) return hideTooltip();
    show(event, point, rect);
    tooltipState.pinned = true;
  });
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
  attachPlotHover(plot, (px, py) => requestAt(points, px, py), showRequest);
  return plot;
}

// One bar per request, stacked from what happened first to what happened last,
// with a dot at its top, which is the end-to-end time. The height scale comes
// from all the platform's requests, like in the requests chart. Segments the
// legend has hidden are left out and the others close ranks, so the dot is at
// the top of what is left.
function endToEndChart({requests, shown, width, hidden, domain}) {
  const chained = shown.filter((request) => request.chain);
  const segments = E2E_SEGMENTS.filter(({key}) => !hidden.has(key));
  const topHours = (request) => d3.sum(segments, ({key}) => request.chain.durations[key]) / 3600;
  const ends = segments.length ? chained : [];
  const blockedHours = (request) => (request.blocked.deadline - request.time) / 3600000;
  const maxHours = Math.max(d3.max(requests, (request) => request.chain?.total ?? 0) / 3600, d3.max(requests, (request) => (request.blocked ? blockedHours(request) : 0)) ?? 0);
  // A perf task that never ran is marked where it gave up, at its deadline. When
  // the request has others that ran, a line joins it to where they ended.
  const marked = (kind) => shown.filter((request) => request.blocked && blockedKind(request.blocked) === kind && !hidden.has(kind.key));
  const markedRequests = new Set(BLOCKED_KINDS.flatMap(marked));
  const joined = [...markedRequests].filter((request) => request.chain && !request.chain.blocked);
  const runEnds = ends.filter((request) => !request.chain.blocked);
  const bars = chained.flatMap((request) => {
    let from = 0;
    return segments.map(({key}) => {
      const to = from + request.chain.durations[key] / 3600;
      const bar = {time: request.time, key, from, to};
      from = to;
      return bar;
    });
  });
  const plot = Plot.plot({
    width,
    height: E2E_HEIGHT,
    marginTop: MARGIN_TOP,
    marginBottom: MARGIN_BOTTOM,
    marginLeft: MARGIN_LEFT,
    marginRight: MARGIN_RIGHT,
    x: dateAxis(domain, width),
    y: {domain: [0, maxHours * 1.05], grid: true, label: "hours"},
    color: {domain: E2E_SEGMENTS.map(({key}) => key), range: E2E_SEGMENTS.map(({color}) => color)},
    marks: [
      Plot.ruleY([0], {strokeOpacity: 0.3}),
      bugRule(domain, hidden),
      Plot.ruleX(bars, {x: "time", y1: "from", y2: "to", stroke: "key", strokeWidth: E2E_BAR_WIDTH}),
      Plot.ruleX(joined, {x: "time", y1: topHours, y2: blockedHours, stroke: BLOCKED_COLOR, strokeOpacity: 0.7, strokeDasharray: "2 2"}),
      Plot.dot(runEnds.filter((request) => !request.chain.expired), {x: "time", y: topHours, r: 3, fill: "currentColor"}),
      Plot.dot(runEnds.filter((request) => request.chain.expired), {x: "time", y: topHours, symbol: "times", r: 5, stroke: EXCEPTION_COLOR, strokeWidth: 2}),
      ...BLOCKED_KINDS.map((kind) => Plot.dot(marked(kind), {x: "time", y: blockedHours, symbol: kind.symbol, r: 5, stroke: BLOCKED_COLOR, strokeWidth: 2, fill: "none"}))
    ]
  });
  const x = plot.scale("x");
  const y = plot.scale("y");
  const drawnHours = (request) => Math.max(topHours(request), markedRequests.has(request) ? blockedHours(request) : 0);
  const points = ends.map((request) => ({request, x: x.apply(request.time), y: y.apply(drawnHours(request)), baseline: y.apply(0)}));
  attachPlotHover(plot, (px, py) => barAt(points, px, py), showEndToEnd);
  return plot;
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

const LEGEND_MARKERS = {
  dot: (color) => htl.svg`<svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="${color}"></circle></svg>`,
  cross: (color) => htl.svg`<svg width="10" height="10" aria-hidden="true"><path d="M1 1L9 9M1 9L9 1" stroke="${color}" stroke-width="1.6"></path></svg>`,
  diamond: (color) => htl.svg`<svg width="10" height="10" aria-hidden="true"><path d="M5 0.8L9.2 5L5 9.2L0.8 5Z" fill="none" stroke="${color}" stroke-width="1.6"></path></svg>`,
  triangle: (color) => htl.svg`<svg width="10" height="10" aria-hidden="true"><path d="M5 0.9L9.3 9H0.7Z" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"></path></svg>`,
  square: (color) => htl.svg`<svg width="10" height="10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" fill="none" stroke="${color}" stroke-width="1.6"></rect></svg>`,
  swatch: (color, alpha) => htl.svg`<svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="${color}" fill-opacity="${Math.min(1, alpha + 0.2)}"></rect></svg>`,
  event: () => htl.svg`<svg width="18" height="10" aria-hidden="true"><path d="M0 5H18" stroke="currentColor" stroke-opacity="0.6" stroke-width="1.4" stroke-dasharray="2 3"></path></svg>`
};
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
// The buckets of the platform's requests, coloured like the dots in them.
const requestsLegend = (requests) => {
  const maxProfiles = d3.max(requests, (r) => r.profiles);
  const entries = PROFILE_BUCKETS.flatMap((bucket) => {
    const inBucket = requests.filter((r) => bucket.has(r.profiles));
    return inBucket.length ? [{key: bucket.key, title: bucket.title, marker: () => LEGEND_MARKERS.dot(profileColor(d3.max(inBucket, (r) => r.profiles), maxProfiles))}] : [];
  });
  return [{title: "Profile generations", entries}, EVENT_LEGEND];
};

// A row of buttons, each hiding or showing its entry, and a title that hides or
// shows them all. Double-clicking an entry shows only that one of the row, or all
// of them again if it already was the only one. The keys of a chart's legend are
// its own, so that hiding a series in one chart leaves the same series of another
// in place.
function legendRow({title, entries}, hidden, scope, otherGroups = []) {
  const keyOf = (key) => `${scope}:${key}`;
  const keys = entries.map((entry) => keyOf(entry.key));
  const anyVisible = keys.some((key) => !hidden.has(key));
  const titleButton = htl.html`<button type="button" class="bw-legend-title" aria-pressed="${String(anyVisible)}">${title}</button>`;
  // Double-clicking the title shows only this group of the legend, or all of them
  // again if it already was the only one.
  const otherKeys = otherGroups.flatMap((group) => group.entries.map((entry) => keyOf(entry.key)));
  const showOnlyGroup = () => {
    const alone = otherKeys.every((other) => hidden.has(other));
    setHiddenKeys(alone ? [] : otherKeys, [...keys, ...(alone ? otherKeys : [])]);
  };
  titleButton.onclick = (event) => (event.detail === 2 ? showOnlyGroup() : setHidden(keys, anyVisible));
  const showOnly = (key) => {
    const others = keys.filter((other) => other !== key);
    const alone = others.every((other) => hidden.has(other));
    setHiddenKeys(alone ? [] : others, [key, ...(alone ? others : [])]);
  };
  return htl.html`<div class="bw-legend">${titleButton}${entries.map(({key, title, marker}) => {
    const button = htl.html`<button type="button" aria-pressed="${String(!hidden.has(keyOf(key)))}">${marker()}${title}</button>`;
    // The first click of a double click toggles the entry, and the second shows it alone.
    button.onclick = (event) => (event.detail === 2 ? showOnly(keyOf(key)) : setHidden([keyOf(key)], !hidden.has(keyOf(key))));
    return button;
  })}</div>`;
}

const legendRows = (groups, hidden, scope) =>
  htl.html`<div class="bw-legends bw-chart-legends">${groups.map((group) => legendRow(group, hidden, scope, groups.filter((other) => other !== group)))}</div>`;

// A chart in a box that tells where its plot area is: `left` and `right` pixels
// from the edges. Charts of different sizes share the time axis through it, in the
// line at the pointer and in the selection. A box that is `daily` has a bar a day.
function chartBox(content, height, {left = MARGIN_LEFT, right = MARGIN_RIGHT, top = MARGIN_TOP, bottom = MARGIN_BOTTOM, daily = false} = {}) {
  return htl.html`<div class="bw-chart" data-left="${left}" data-right="${right}" data-daily="${daily}" style="--plot-top:${top}px;--plot-height:${height - top - bottom}px">${content}<div class="bw-selection"></div><div class="bw-crosshair"><span></span></div></div>`;
}

const DRAG_PIXELS = 4;

// Links the charts of a section by time: a line down every chart at the pointer,
// with its time, so that what happened in one chart can be read in the others, and
// a selection by dragging across any of them, shown in all, which `select` gets
// as two moments when it ends.
function syncCharts(section, domain, select) {
  const boxes = [...section.querySelectorAll(".bw-chart")];
  const span = domain[1] - domain[0];
  const edges = (box) => {
    const rect = box.getBoundingClientRect();
    return {rect, left: Number(box.dataset.left), right: rect.width - Number(box.dataset.right)};
  };
  const fractionAt = (box, clientX) => {
    const {rect, left, right} = edges(box);
    return (clientX - rect.left - left) / (right - left);
  };
  const place = (box, element, fraction) => {
    const {left, right} = edges(box);
    element.style.left = `${left + fraction * (right - left)}px`;
  };

  const lines = boxes.map((box) => ({box, line: box.querySelector(".bw-crosshair")}));
  const hideLines = () => {
    if (!tooltipState.pinned) for (const {line} of lines) line.style.display = "none";
  };
  section.addEventListener("pointermove", (event) => {
    const box = event.target.closest?.(".bw-chart");
    if (!box || drag) return hideLines();
    const fraction = fractionAt(box, event.clientX);
    if (fraction < 0 || fraction > 1) return hideLines();
    const time = new Date(+domain[0] + fraction * span);
    for (const {box: other, line} of lines) {
      line.style.display = "block";
      place(other, line, fraction);
      line.firstElementChild.textContent = other.dataset.daily === "true" ? formatDay(time) : formatTime(time);
    }
  });
  section.addEventListener("pointerleave", hideLines);

  let drag = null;
  const showSelection = (from, to) => {
    for (const box of boxes) {
      const selection = box.querySelector(".bw-selection");
      selection.style.display = from === null ? "none" : "block";
      if (from === null) continue;
      const {left, right} = edges(box);
      selection.style.left = `${left + from * (right - left)}px`;
      selection.style.width = `${(to - from) * (right - left)}px`;
    }
  };
  const clamp = (fraction) => Math.min(1, Math.max(0, fraction));
  const move = (event) => {
    if (!drag.active && Math.abs(event.clientX - drag.startX) < DRAG_PIXELS) return;
    if (!drag.active) {
      drag.active = true;
      tooltipState.dragging = true;
      hideTooltip();
      for (const {line} of lines) line.style.display = "none";
    }
    const fractions = [drag.fraction, clamp(fractionAt(drag.box, event.clientX))].sort((a, b) => a - b);
    drag.range = fractions;
    showSelection(...fractions);
  };
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancel);
    const {active, range} = drag;
    drag = null;
    tooltipState.dragging = false;
    if (active) hideTooltip();
    showSelection(null);
    if (!active || !range || range[1] - range[0] <= 0) return;
    // The click that follows a drag is not one.
    const swallow = (event) => event.stopPropagation();
    window.addEventListener("click", swallow, {capture: true, once: true});
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    select(new Date(+domain[0] + range[0] * span), new Date(+domain[0] + range[1] * span));
  };
  const cancel = () => {
    drag.active = false;
    end();
  };
  section.addEventListener("pointerdown", (event) => {
    const box = event.target.closest?.(".bw-chart");
    if (event.button !== 0 || !box) return;
    const fraction = fractionAt(box, event.clientX);
    if (fraction < 0 || fraction > 1) return;
    drag = {box, fraction, startX: event.clientX, active: false, range: null};
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
  });
}

const CHARTS = [METRICS_TITLE, REQUESTS_TITLE, E2E_TITLE];

const METRIC_HEIGHT = 84;
const METRIC_TOP = 18;
const METRIC_BOTTOM = 4;
const METRIC_GAP = 12;
const METRIC_MIN_WIDTH = 110;
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
  {key: "requests", title: "Backfill requests", format: formatCount, series: [{value: (requests) => requests.length, color: "#8a4fb5"}]},
  {key: "requesters", title: "People requesting backfills", format: formatCount, series: [{value: distinctRequesters, color: "#5b6abf"}]},
  {key: "builds", title: "Builds scheduled", format: formatCount, series: [{value: sumOf("builds"), color: "#c2476f"}]},
  {key: "profiles", title: "Profile generations scheduled", format: formatCount, series: [{value: sumOf("profiles"), color: "#237a4b"}]},
  {key: "tests", title: "Perf tests scheduled", format: formatCount, series: [{value: sumOf("tests"), color: "#d98324"}]},
  {key: "blocked", title: "Perf tests that never ran, upstream broke", format: formatCount, series: [{value: (requests) => (requests.length ? d3.sum(requests, (request) => request.blocked?.count ?? 0) : undefined), color: BLOCKED_COLOR}]}
];

// One tile: the numbers, and below them a chart of each for every day, which
// shares the time axis of the charts below, with the same pointer line, tooltip and
// selection.
function metricTile(metric, {requests, domain, tileWidth}) {
  const days = d3.utcDay.range(domain[0], domain[1]);
  const byDay = d3.group(requests, (request) => +d3.utcDay.floor(request.time));
  const perDay = days.map((day) => {
    const ofDay = byDay.get(+day) ?? [];
    return {day, requests: ofDay, values: metric.series.map((series) => series.value(ofDay))};
  });
  const steps = [...perDay, {day: domain[1], requests: [], values: perDay[perDay.length - 1]?.values ?? []}];
  const top = Math.max(d3.max(perDay, (entry) => d3.max(entry.values)) ?? 0, 1e-9) * 1.1;
  const single = metric.series.length === 1;
  const plot = Plot.plot({
    width: tileWidth,
    height: METRIC_HEIGHT,
    marginTop: METRIC_TOP,
    marginBottom: METRIC_BOTTOM,
    marginLeft: 0,
    marginRight: 0,
    x: {type: "utc", domain, axis: null},
    y: {domain: [0, top], axis: null},
    marks: [
      Plot.ruleY([0], {strokeOpacity: 0.3}),
      bugRule(domain, new Set()),
      ...metric.series.flatMap(({color}, index) => {
        const options = {x: "day", y: (entry) => entry.values[index], curve: "step-after", defined: (entry) => entry.values[index] != null};
        return [
          ...(single ? [Plot.areaY(steps, {...options, fill: color, fillOpacity: 0.25})] : []),
          Plot.lineY(steps, {...options, stroke: color, strokeWidth: 1.2})
        ];
      })
    ]
  });
  const xScale = plot.scale("x");
  const find = (px, py) => {
    const index = Math.floor((+xScale.invert(px) - +domain[0]) / DAY_MS);
    return px >= 0 && px <= tileWidth && py >= METRIC_TOP && py <= METRIC_HEIGHT - METRIC_BOTTOM && index >= 0 && index < days.length ? {entry: perDay[index], x: px} : null;
  };
  const show = (event, {entry}) => {
    const line = (series, index) => {
      const value = entry.values[index];
      const text = value == null ? "–" : metric.format(value);
      return single
        ? htl.html`<span>${metric.title}: <b>${text}</b></span>`
        : htl.html`<span><i class="bw-swatch" style="background:${series.color}"></i>${series.title}: <b>${text}</b></span>`;
    };
    const content = htl.html`<span><b>${formatDay(entry.day)}</b></span>
      ${metric.series.map(line)}
      ${metric.key === "requests" ? "" : htl.html`<span class="bw-tt-pool">${countOf(entry.requests.length, "backfill request")}</span>`}`;
    if (openTooltip(event, `${metric.key}:${+entry.day}`, content)) document.getElementById("bw-ring").style.display = "none";
  };
  attachPlotHover(plot, find, show);
  const totalOf = (series) => {
    const total = series.value(requests);
    return total == null ? "–" : metric.format(total);
  };
  const values = single
    ? htl.html`<div class="bw-metric-value">${totalOf(metric.series[0])}</div>`
    : htl.html`<div class="bw-metric-value bw-metric-multi">${metric.series.map((series) => htl.html`<span style="color:${series.color}"><small>${series.title}</small> ${totalOf(series)}</span>`)}</div>`;
  return htl.html`<div class="bw-metric" style="width:${tileWidth}px">
    <div class="bw-metric-title">${metric.title}</div>
    ${values}
    ${chartBox(plot, METRIC_HEIGHT, {left: 0, right: 0, top: METRIC_TOP, bottom: METRIC_BOTTOM, daily: true})}
  </div>`;
}

function metricsRow({requests, domain, width}) {
  const units = d3.sum(METRICS, ({span = 1}) => span);
  const fits = (columns) => Math.floor((width - (columns - 1) * METRIC_GAP) / columns);
  const columns = d3.range(units, 0, -1).find((n) => fits(n) >= METRIC_MIN_WIDTH) ?? 1;
  const unitWidth = fits(columns);
  const widthOf = ({span = 1}) => Math.min(span, columns) * unitWidth + (Math.min(span, columns) - 1) * METRIC_GAP;
  return htl.html`<div class="bw-metrics" style="grid-template-columns:repeat(${columns}, ${unitWidth}px)">${METRICS.map((metric) => {
    const tile = metricTile(metric, {requests, domain, tileWidth: widthOf(metric)});
    tile.style.gridColumn = `span ${Math.min(metric.span ?? 1, columns)}`;
    return tile;
  })}</div>`;
}

// The platform's charts, each as wide as the page and collapsed from its title:
// what its backfill requests triggered and how long they took. Each has its own
// legend under its title, and its own hidden keys, `<chart key>:<key>`. A collapsed
// chart's key is its own chart key.
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
    "chart-metrics": {legend: () => null, draw: () => noRequests() ?? metricsRow({requests: shown, domain, width})},
    "chart-requests": {legend: () => requests && requestsLegend(requests), draw: (hidden) => requestChart(requestsKey, requestsChart, REQUESTS_HEIGHT, hidden)},
    "chart-endtoend": {legend: () => requests && E2E_LEGEND, draw: (hidden) => requestChart(endToEndKey, endToEndChart, E2E_HEIGHT, hidden)}
  };
  // A chart is drawn again only when something it shows changed: its own hidden keys,
  // whether it is collapsed, the platform, requester, days or width. Hiding a series
  // in one chart leaves the others as they were, so they do not flash or cost time.
  const block = (item) => {
    const collapsed = hidden.has(item.chartKey);
    const prefix = `${item.chartKey}:`;
    const ownKeys = [...hidden].filter((key) => key.startsWith(prefix)).sort();
    const signature = JSON.stringify([pool, width, +domain[0], +domain[1], selectedRequester, collapsed, ownKeys]);
    const cached = blockCache.get(item.chartKey);
    if (cached?.signature === signature) return cached.node;
    const title = columnTitles(width, item, collapsed);
    let node;
    if (collapsed) {
      node = htl.html`<div>${title}</div>`;
    } else {
      const {legend, draw} = bodies[item.chartKey];
      const groups = legend();
      const ownHidden = {has: (key) => hidden.has(`${item.chartKey}:${key}`)};
      node = htl.html`<div>${title}${groups ? legendRows(groups, hidden, item.chartKey) : ""}${draw(ownHidden)}</div>`;
    }
    blockCache.set(item.chartKey, {signature, node});
    return node;
  };
  const section = htl.html`<section class="bw-pool">${CHARTS.map(block)}</section>`;
  syncCharts(section, domain, (from, to) => setRange(d3.utcDay.floor(from), d3.utcDay.floor(new Date(Math.max(+from, +to - 1)))));
  return section;
}

// Aligned with the left edge of the chart, where its axis labels start. The title
// collapses and expands its chart.
function columnTitles(width, {chartKey, title}, collapsed) {
  const button = htl.html`<button type="button" class="bw-collapse" aria-expanded="${String(!collapsed)}"><span aria-hidden="true">${collapsed ? "▸" : "▾"}</span> ${title}</button>`;
  button.onclick = () => setHidden([chartKey], !collapsed);
  return htl.html`<div class="bw-title" style="width:${width}px"><h2>${button}</h2></div>`;
}
```

<style>
.bw-legends {
  margin: 0.75rem 0 1.25rem;
  font-family: var(--sans-serif);
}
.bw-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 1.25rem;
  margin: 0.35rem 0;
  font-size: 0.85rem;
  color: var(--theme-foreground-muted, #888);
}
.bw-legend button {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.bw-legend button.bw-legend-title {
  min-width: 9rem;
  justify-content: flex-start;
  font-weight: 600;
}
.bw-legend button:hover {
  color: var(--theme-foreground, #000);
}
.bw-legend button[aria-pressed="false"] {
  opacity: 0.4;
  text-decoration: line-through;
}
.bw-title {
  box-sizing: border-box;
  margin: 0;
  text-align: left;
}
.bw-title h2 {
  margin: 1.5rem 0 0;
  max-width: none;
  font-size: 1.6rem;
  line-height: 1.2;
}
.bw-collapse {
  padding: 0;
  text-align: left;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.bw-collapse span {
  text-align: left;
  display: inline-block;
  width: 1em;
  color: var(--theme-foreground-muted, #888);
}
.bw-chart-legends {
  margin: 0.25rem 0 0.5rem;
  padding: 0 40px 0 44px;
}
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
.bw-metrics {
  display: grid;
  gap: 0.75rem 12px;
  margin: 0.5rem 0 0;
}
.bw-metric-title {
  min-height: 3.6em;
  font-size: 0.8rem;
  line-height: 1.2;
  color: var(--theme-foreground-muted, #888);
}
.bw-metric-value {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.2;
}
.bw-metric-multi {
  display: flex;
  gap: 0.7rem;
  font-size: 0.95rem;
  line-height: 1.9;
  white-space: nowrap;
}
.bw-metric-multi small {
  font-size: 0.7rem;
  font-weight: 400;
}
#bw-tooltip {
  position: fixed;
  z-index: 1000;
  display: none;
  max-width: 520px;
  padding: 8px 12px;
  border-radius: 4px;
  background: #2a2a2a;
  color: white;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.7;
}
#bw-tooltip span,
#bw-tooltip a {
  display: block;
  color: inherit;
  text-decoration: none;
  overflow-wrap: anywhere;
}
#bw-tooltip a {
  color: #7ecfff;
}
#bw-tooltip a:hover {
  text-decoration: underline;
}
#bw-tooltip .bw-tt-sep {
  margin: 4px 0;
  border-top: 1px solid #555;
}
#bw-tooltip .bw-tt-expired {
  color: #f2c14e;
}
#bw-tooltip .bw-tt-blocked {
  color: #ff8a8f;
}
#bw-tooltip .bw-tt-pool {
  font-size: 0.9em;
  color: #bbb;
}
#bw-tooltip .bw-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  border-radius: 2px;
}
.bw-chart {
  position: relative;
  -webkit-user-select: none;
  user-select: none;
  cursor: crosshair;
}
.bw-selection {
  position: absolute;
  top: var(--plot-top);
  z-index: 2;
  display: none;
  height: var(--plot-height);
  background: rgba(47, 116, 208, 0.18);
  border-left: 1px solid rgba(47, 116, 208, 0.7);
  border-right: 1px solid rgba(47, 116, 208, 0.7);
  pointer-events: none;
}
.bw-crosshair {
  position: absolute;
  top: var(--plot-top);
  z-index: 2;
  display: none;
  width: 0;
  height: var(--plot-height);
  border-left: 1px solid rgba(128, 128, 128, 0.8);
  pointer-events: none;
}
.bw-crosshair span {
  position: absolute;
  top: -15px;
  left: 0;
  transform: translateX(-50%);
  padding: 0 4px;
  border-radius: 3px;
  background: var(--theme-background, #fff);
  color: var(--theme-foreground-muted, #888);
  font-size: 10px;
  white-space: nowrap;
}
#bw-tooltip .bw-tt-links a {
  display: inline;
  margin-right: 0.6em;
}
#bw-ring {
  position: fixed;
  z-index: 999;
  display: none;
  width: 12px;
  height: 12px;
  transform: translate(-50%, -50%);
  border: 1.5px solid currentColor;
  border-radius: 50%;
  pointer-events: none;
}
</style>

<div id="bw-tooltip"></div>
<div id="bw-ring"></div>

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
const hiddenInput = Object.assign(document.createElement("div"), {value: new Set()});
const hidden = Generators.input(hiddenInput);
// Redrawing replaces the charts, which for a moment leaves the page shorter and
// would scroll it back up. The charts' box keeps its height until they are drawn,
// and the page then goes back to where it was.
const keepingScroll = (change) => {
  const box = document.getElementById("bw-charts");
  const top = window.scrollY;
  box.style.minHeight = `${box.offsetHeight}px`;
  const release = () => {
    observer.disconnect();
    clearTimeout(timer);
    requestAnimationFrame(() => {
      box.style.minHeight = "";
      window.scrollTo({top});
    });
  };
  const observer = new MutationObserver(release);
  const timer = setTimeout(release, 10000);
  observer.observe(box, {childList: true, subtree: true});
  change();
};
const setHiddenKeys = (toHide, toShow) => {
  const next = new Set(hiddenInput.value);
  for (const key of toHide) next.add(key);
  for (const key of toShow) next.delete(key);
  keepingScroll(() => {
    hiddenInput.value = next;
    hiddenInput.dispatchEvent(new Event("input"));
  });
};
const setHidden = (keys, hide) => (hide ? setHiddenKeys(keys, []) : setHiddenKeys([], keys));
```

<div class="card" id="bw-charts">
  ${resize((width) => platformSection(platform, width, hidden, requester, domain))}
</div>

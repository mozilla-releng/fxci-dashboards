import {aheadSeries, indexQueueSeries, LAYERS} from "./_queue-position.js";

const TC_URL = "https://firefox-ci-tc.services.mozilla.com";
const QUEUE_API = `${TC_URL}/api/queue/v1`;
const QUEUE_URL = `${QUEUE_API}/task`;
const PROFILER_ORIGIN = "https://profiler.firefox.com";
const PROFILER_POST_URL = `${PROFILER_ORIGIN}/from-post-message/`;

const PROCESSED_PROFILE_VERSION = 77;
const REQUEST_CONCURRENCY = 8;
const REQUEST_ATTEMPTS = 5;
const BATCH_ATTEMPTS = 2;
const BATCH_SIZE = 500;
const WINDOW_LEAD_MS = 3600_000;
const HOUR_MS = 3600_000;
const DAY_MS = 86400_000;
const MAX_POOL_DAYS = 4;
const HANDSHAKE_INTERVAL_MS = 250;
const HANDSHAKE_TIMEOUT_MS = 30_000;

// Zero-width characters in increasing code point order: a row name starting with
// the n-th one sorts after the names starting with the ones before it, and shows
// nothing.
const UPSTREAM_ORDER = ["​", "‌", "‍", "⁠", "⁡", "⁢", "⁣", "⁤", "⁪", "⁫", "⁬", "⁭"];
const CATEGORY_CLOCK = 0;
const CATEGORY_QUEUE = 1;
const FIRST_TASK_CATEGORY = 2;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATE_COLORS = {completed: "green", failed: "red"};
const WAIT_COLOR = "orange";
const EXCEPTION_COLOR = "yellow";
// The higher tiers have a colour of their own, the low ones the colour of the kind
// of run, as in the page's queue chart: backfills purple, other perf tasks green,
// other tasks grey.
const TIER_COLORS = {highest: "red", "very-high": "orange", high: "yellow", medium: "teal"};
const KIND_COLORS = {backfill: "purple", perf: "green", other: "grey"};
const layerColor = ({tier, kind}) => (kind ? KIND_COLORS[kind] : TIER_COLORS[tier]);
const MIN_QUEUE_GRAPH_MS = 600_000;
const QUEUE_THREAD_NAME = "Tasks ahead of";

const toMs = (iso) => Date.parse(iso);
const pad = (n) => String(n).padStart(2, "0");
const formatClockTime = (ms) => `${new Date(ms).toISOString().replace("T", " ").slice(0, 19)} UTC`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, {attempts = REQUEST_ATTEMPTS, ...init} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status} for ${url}`);
      if (response.status === 404) throw Object.assign(lastError, {notFound: true});
    } catch (error) {
      if (error.notFound) throw error;
      lastError = error;
    }
    await sleep(500 * attempt);
  }
  throw lastError;
}

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return results;
}

async function loadTask(taskId) {
  try {
    const [definition, {status}] = await Promise.all([getJson(`${QUEUE_URL}/${taskId}`), getJson(`${QUEUE_URL}/${taskId}/status`)]);
    return {id: taskId, definition, runs: status.runs};
  } catch (error) {
    if (error.notFound) return null;
    throw error;
  }
}

// The queue answers for many tasks at once: one request for their definitions and
// one for their statuses, instead of two requests per task. A task that no longer
// exists is left out of the answer.
async function postTaskIds(path, key, taskIds) {
  const found = new Map();
  let continuationToken = null;
  do {
    const query = continuationToken ? `?continuationToken=${encodeURIComponent(continuationToken)}` : "";
    const page = await getJson(`${QUEUE_API}/${path}${query}`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({taskIds}),
      attempts: BATCH_ATTEMPTS
    });
    for (const entry of page[key]) found.set(entry.taskId, entry);
    continuationToken = page.continuationToken;
  } while (continuationToken);
  return found;
}

async function loadTaskBatch(taskIds) {
  const [definitions, statuses] = await Promise.all([postTaskIds("tasks", "tasks", taskIds), postTaskIds("tasks/status", "statuses", taskIds)]);
  return taskIds.map((id) => (definitions.has(id) && statuses.has(id) ? {id, definition: definitions.get(id).task, runs: statuses.get(id).status.runs} : null));
}

// The batch endpoints are experimental: if the queue refuses them, ask for the
// tasks one by one.
async function loadTasks(taskIds) {
  const batches = [];
  for (let from = 0; from < taskIds.length; from += BATCH_SIZE) batches.push(taskIds.slice(from, from + BATCH_SIZE));
  try {
    return (await Promise.all(batches.map(loadTaskBatch))).flat();
  } catch {
    return mapWithLimit(taskIds, REQUEST_CONCURRENCY, loadTask);
  }
}

function resolvedAt(task) {
  const last = task.runs[task.runs.length - 1];
  return last?.resolved ? toMs(last.resolved) : Infinity;
}

function taskLoader(onProgress) {
  const loaded = new Map();
  const load = async (ids) => {
    const missing = [...new Set(ids)].filter((id) => !loaded.has(id));
    const tasks = await loadTasks(missing);
    missing.forEach((id, index) => loaded.set(id, tasks[index]));
    onProgress(loaded.size);
    return ids.map((id) => loaded.get(id)).filter(Boolean);
  };
  const loadFocus = async (taskId) => {
    const [focus] = await load([taskId]);
    if (!focus) throw new Error(`task ${taskId} not found`);
    return focus;
  };
  const unavailable = () => [...loaded.values()].filter((task) => !task).length;
  return {load, loadFocus, unavailable};
}

export async function fetchCriticalChain(taskId, onProgress = () => {}) {
  const {load, loadFocus, unavailable} = taskLoader(onProgress);

  const focus = await loadFocus(taskId);
  const directDependencies = await load(focus.definition.dependencies);
  const kept = new Set([focus, ...directDependencies]);

  let dependencies = directDependencies;
  while (dependencies.length) {
    const critical = dependencies.reduce((latest, task) => (resolvedAt(task) > resolvedAt(latest) ? task : latest));
    kept.add(critical);
    dependencies = await load(critical.definition.dependencies);
  }

  return {focus, tasks: [...kept], unavailable: unavailable()};
}

function taskIntervals(task, now) {
  const intervals = [];
  for (const run of task.runs) {
    const scheduled = toMs(run.scheduled);
    const started = run.started ? toMs(run.started) : null;
    const resolved = run.resolved ? toMs(run.resolved) : null;
    const worker = run.workerId ? `${run.workerGroup}/${run.workerId}` : "";
    const details = {state: run.state, reason: run.reasonResolved === run.state ? "" : (run.reasonResolved ?? ""), worker};
    if (started) {
      intervals.push({start: scheduled, end: started, label: `Waiting for a worker (run ${run.runId})`, color: WAIT_COLOR, wait: true, ...details});
      intervals.push({
        start: started,
        end: resolved ?? now,
        label: `Run ${run.runId}: ${run.state}`,
        color: STATE_COLORS[run.state] ?? EXCEPTION_COLOR,
        ...details
      });
    } else {
      const never = resolved ? `, never claimed: ${run.reasonResolved}` : ", still waiting";
      intervals.push({
        start: scheduled,
        end: resolved ?? now,
        label: `Waiting for a worker (run ${run.runId})${never}`,
        color: resolved ? EXCEPTION_COLOR : WAIT_COLOR,
        wait: true,
        ...details
      });
    }
  }
  return intervals;
}

function clockIntervals(fromMs, untilMs) {
  const intervals = [];
  for (let start = Math.floor(fromMs / HOUR_MS) * HOUR_MS, index = 0; start < untilMs; start += HOUR_MS, index++) {
    const date = new Date(start);
    const midnight = date.getUTCHours() === 0;
    const label = midnight
      ? `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} 00:00`
      : `${pad(date.getUTCHours())}:00`;
    intervals.push({start, end: start + HOUR_MS, label, color: index % 2 ? "transparent" : "grey", from: formatClockTime(start), to: formatClockTime(start + HOUR_MS)});
  }
  return intervals;
}

const MARKER_FIELDS = [
  {key: "taskId", label: "Task ID", format: "string"},
  {key: "taskView", label: "Task view", format: "url"},
  {key: "timeline", label: "Dependency timeline", format: "url"},
  {key: "pool", label: "Worker pool", format: "string"},
  ...Array.from({length: MAX_POOL_DAYS}, (_, i) => ({key: `poolDay${i + 1}`, label: `Pool activity, day ${i + 1}`, format: "url"})),
  {key: "priority", label: "Priority", format: "string"},
  {key: "project", label: "Project", format: "string"},
  {key: "from", label: "From", format: "string"},
  {key: "to", label: "To", format: "string"},
  {key: "state", label: "State", format: "string"},
  {key: "reason", label: "Resolved as", format: "string"},
  {key: "worker", label: "Worker", format: "string"},
  {key: "aheadAtStart", label: "Tasks ahead when scheduled", format: "integer"},
  {key: "aheadAtStartBy", label: "By priority", format: "string"}
];

const QUEUE_FIELDS = [
  {key: "ahead", label: "Tasks ahead of it", format: "integer"},
  ...LAYERS.map(({key, label}) => ({key, label: `${label}${label.includes(",") ? "" : " priority"}`, format: "integer"})),
  ...LAYERS.map(({key, label}) => ({key: `stack_${key}`, label, format: "integer", hidden: true}))
];

const QUEUE_GRAPHS = [...LAYERS].reverse().map((layer) => ({key: `stack_${layer.key}`, type: "bar", color: layerColor(layer)}));

function withoutEmpty(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
}

function poolDayFields(poolActivityUrls, queue, fromMs, toMs) {
  const fields = {};
  poolActivityUrls(queue, fromMs, toMs)
    .slice(0, MAX_POOL_DAYS)
    .forEach((url, index) => {
      if (url) fields[`poolDay${index + 1}`] = url;
    });
  return fields;
}

function markerTable(strings, threadId) {
  const table = {data: [], name: [], startTime: [], endTime: [], phase: [], category: [], threadId: [], length: 0};
  const stringIndex = (value) => {
    const found = strings.indexOf(value);
    return found >= 0 ? found : strings.push(value) - 1;
  };
  const add = ({row, category, start, end, data, type = "TaskInterval"}) => {
    table.data.push({type, ...data});
    table.name.push(stringIndex(row));
    table.startTime.push(start);
    table.endTime.push(end);
    table.phase.push(1);
    table.category.push(category);
    table.threadId.push(threadId);
    table.length++;
  };
  return {table, add};
}

function emptyTable(columns) {
  return {...Object.fromEntries(columns.map((column) => [column, []])), length: 0};
}

// The graphs stack the layers from the first in line, up to the task's own tier.
function stackedCounts(counts, tier) {
  const lastOwn = LAYERS.map((layer) => layer.tier).lastIndexOf(tier);
  const stacked = {};
  LAYERS.forEach(({key}, index) => {
    stacked[`stack_${key}`] = index > lastOwn ? 0 : LAYERS.slice(0, index + 1).reduce((sum, layer) => sum + (counts[layer.key] ?? 0), 0);
  });
  return stacked;
}

function tierBreakdown(counts) {
  return LAYERS.filter(({key}) => counts[key]).map(({key, label}) => `${counts[key].toLocaleString("en-US")} ${label}`).join(", ");
}

function waitSamples(queueSeries, definition, interval) {
  return queueSeries ? aheadSeries(queueSeries, {queue: definition.taskQueueId, tier: definition.priority, scheduledMs: interval.start, endMs: interval.end}) : [];
}

function finishedBefore(intervals) {
  const last = intervals[intervals.length - 1];
  return {
    start: intervals[0].start,
    end: last.end,
    label: `Finished before this window${last.state ? `: ${last.state}` : ""}`,
    color: "grey",
    state: last.state,
    reason: last.reason,
    worker: last.worker
  };
}

const DEPENDENCIES_TITLE = {heading: "Task dependencies of", describe: "its direct dependencies and the chain that held it back"};
const taskName = ({definition}) => definition.metadata.name;

export function buildProfile(
  {focus, tasks, unavailable = 0, titleParts = DEPENDENCIES_TITLE, groupOf = () => ""},
  {poolActivityUrls, timelineUrl = null, queueSeries = null, now = Date.now()}
) {
  const windowStart = toMs(focus.definition.created) - WINDOW_LEAD_MS;
  const strings = [];
  const {table, add} = markerTable(strings, 0);
  const queueMarkers = markerTable(strings, 1);

  const perTask = tasks.map((task) => {
    const intervals = taskIntervals(task, now);
    const inWindow = intervals.filter((interval) => interval.end > windowStart);
    return {task, intervals: inWindow.length || !intervals.length ? inWindow : [finishedBefore(intervals)]};
  });
  const shown = perTask.filter(({intervals}) => intervals.length);
  const windowEnd = Math.max(...shown.flatMap(({intervals}) => intervals.map((interval) => interval.end)), windowStart + HOUR_MS);

  for (const interval of clockIntervals(windowStart, windowEnd)) {
    add({
      row: "Clock (UTC)",
      category: CATEGORY_CLOCK,
      start: Math.max(interval.start, windowStart) - windowStart,
      end: interval.end - windowStart,
      data: {label: interval.label, color: interval.color, from: interval.from, to: interval.to}
    });
  }

  // The chart lists its rows by category name, then by row name. A task's
  // category is its group, and its row name starts with a character nobody sees
  // that sorts by how far upstream the task is, so that in each group the tasks
  // that others wait for come first.
  const depths = dependencyDepths(tasks);
  const nameCounts = new Map();
  const nameOf = (task) => `${UPSTREAM_ORDER[Math.min(depths.get(task.id), UPSTREAM_ORDER.length - 1)]}${taskName(task)}`;
  shown.forEach(({task}) => nameCounts.set(nameOf(task), (nameCounts.get(nameOf(task)) ?? 0) + 1));
  const uniqueName = (task) => (nameCounts.get(nameOf(task)) > 1 ? `${nameOf(task)} [${task.id.slice(0, 6)}]` : nameOf(task));
  const taskCategories = new Map();
  const categoryOf = (task) => {
    const name = groupOf(task) || "Tasks";
    if (!taskCategories.has(name)) taskCategories.set(name, FIRST_TASK_CATEGORY + taskCategories.size);
    return taskCategories.get(name);
  };

  for (const {task, intervals} of shown) {
    const {definition} = task;
    const row = `${task.id === focus.id ? "▶ " : ""}${uniqueName(task)}`;
    for (const interval of intervals) {
      const samples = interval.wait ? waitSamples(queueSeries, definition, interval) : [];
      const first = samples[0];
      add({
        row,
        category: categoryOf(task),
        start: Math.max(interval.start, windowStart) - windowStart,
        end: Math.max(interval.end, windowStart) - windowStart,
        data: {
          label: interval.label,
          color: interval.color,
          taskId: task.id,
          taskView: `${TC_URL}/tasks/${task.id}`,
          ...(timelineUrl ? {timeline: timelineUrl(task.id)} : {}),
          pool: definition.taskQueueId,
          ...poolDayFields(poolActivityUrls, definition.taskQueueId, interval.start, interval.end),
          priority: definition.priority,
          project: definition.tags?.project ?? "unknown",
          from: formatClockTime(interval.start),
          to: formatClockTime(interval.end),
          ...withoutEmpty({state: interval.state, reason: interval.reason, worker: interval.worker}),
          ...(first ? {aheadAtStart: first.ahead, aheadAtStartBy: tierBreakdown(first.counts) || "none"} : {})
        }
      });
      if (samples.length && interval.end - interval.start >= MIN_QUEUE_GRAPH_MS) {
        for (const sample of samples) {
          queueMarkers.add({
            type: "QueueAhead",
            row: uniqueName(task),
            category: CATEGORY_QUEUE,
            start: Math.max(sample.startMs, windowStart) - windowStart,
            end: sample.endMs - windowStart,
            data: {label: `${sample.ahead.toLocaleString("en-US")} tasks ahead`, ahead: sample.ahead, ...sample.counts, ...stackedCounts(sample.counts, definition.priority)}
          });
        }
      }
    }
  }

  const title = `${titleParts.heading} ${focus.id}, from ${formatClockTime(windowStart)}, ${shown.length} tasks: ${titleParts.describe}${unavailable ? `, ${unavailable} expired tasks not available` : ""}`;

  return {
    meta: {
      interval: 1,
      startTime: windowStart,
      abi: "",
      misc: "",
      oscpu: "",
      platform: "",
      processType: 0,
      extensions: {id: [], name: [], baseURL: [], length: 0},
      categories: [
        {name: "Clock (UTC)", color: "grey", subcategories: ["Other"]},
        {name: "Queue", color: "orange", subcategories: ["Other"]},
        ...[...taskCategories.keys()].map((name) => ({name, color: "grey", subcategories: ["Other"]}))
      ],
      product: title,
      stackwalk: 0,
      toolkit: "",
      version: 31,
      preprocessedProfileVersion: PROCESSED_PROFILE_VERSION,
      appBuildID: "",
      sourceURL: "",
      physicalCPUs: 0,
      logicalCPUs: 0,
      CPUName: "",
      symbolicated: true,
      markerSchema: [
        {
          name: "TaskInterval",
          display: ["marker-chart", "marker-table"],
          colorField: "color",
          chartLabel: "{marker.data.label}",
          tableLabel: "{marker.data.label}",
          tooltipLabel: "{marker.data.label}",
          fields: MARKER_FIELDS
        },
        {
          name: "QueueAhead",
          display: ["marker-table"],
          tableLabel: "{marker.data.label}",
          tooltipLabel: "{marker.data.label}",
          description: "Runs queued in the same task queue that workers take before this one: every queued run of a higher priority, and the runs of its own priority that were queued earlier.",
          fields: QUEUE_FIELDS,
          graphs: QUEUE_GRAPHS
        }
      ]
    },
    libs: [],
    pages: [],
    shared: {
      stackTable: emptyTable(["frame", "prefixOffset"]),
      frameTable: emptyTable(["flags", "address", "category", "subcategory", "func", "lib", "nativeSymbol", "innerWindowID", "line", "column", "originalLocation"]),
      funcTable: emptyTable(["flags", "name", "resource", "source", "lineNumber", "columnNumber", "originalLocation"]),
      resourceTable: emptyTable(["name", "host", "type"]),
      nativeSymbols: emptyTable(["libIndex", "address", "name", "functionSize"]),
      sources: emptyTable(["id", "filename", "startLine", "startColumn", "sourceMapURL", "content", "generatedSource"]),
      stringArray: strings,
      sourceLocationTable: emptyTable(["source", "line", "column"])
    },
    threads: [thread({name: "Tasks", id: 0, markers: table}), ...(queueMarkers.table.length ? [thread({name: QUEUE_THREAD_NAME, id: 1, markers: queueMarkers.table})] : [])]
  };
}

// How many tasks a task waits for, along its longest chain of dependencies
// among the tasks of the profile: 0 for a task that waits for none of them.
function dependencyDepths(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depths = new Map();
  const depthOf = (task) => {
    if (!depths.has(task.id)) {
      const upstream = task.definition.dependencies.filter((id) => byId.has(id));
      depths.set(task.id, 1 + Math.max(-1, ...upstream.map((id) => depthOf(byId.get(id)))));
    }
    return depths.get(task.id);
  };
  tasks.forEach(depthOf);
  return depths;
}

function thread({name, id, markers}) {
  return {
    processType: "default",
    processStartupTime: 0,
    processShutdownTime: null,
    registerTime: 0,
    unregisterTime: null,
    pausedRanges: [],
    name,
    isMainThread: true,
    pid: String(id),
    tid: id,
    samples: {weightType: "samples", weight: null, eventDelay: [], stack: [], time: [], length: 0},
    markers
  };
}

export function poolActivityDays(fromMs, toMs, urlForDate) {
  const urls = [];
  for (let day = Math.floor(fromMs / DAY_MS) * DAY_MS; day <= toMs; day += DAY_MS) {
    urls.push(urlForDate(new Date(day).toISOString().slice(0, 10)));
  }
  return urls;
}

function injectProfile(profilerWindow, profile) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const stop = () => {
      clearInterval(poll);
      window.removeEventListener("message", onMessage);
    };
    const onMessage = (event) => {
      if (event.origin !== PROFILER_ORIGIN || event.data?.name !== "ready:response") return;
      stop();
      profilerWindow.postMessage({name: "inject-profile", profile}, PROFILER_ORIGIN);
      resolve();
    };
    const poll = setInterval(() => {
      if (profilerWindow.closed) {
        stop();
        reject(new Error("the profiler window was closed"));
      } else if (Date.now() - startedAt > HANDSHAKE_TIMEOUT_MS) {
        stop();
        reject(new Error("the profiler did not answer"));
      } else {
        profilerWindow.postMessage({name: "ready:request"}, PROFILER_ORIGIN);
      }
    }, HANDSHAKE_INTERVAL_MS);
    window.addEventListener("message", onMessage);
  });
}

const DOWNSTREAM_TITLE = {heading: "Downstream tasks of", describe: "the actions it started and the tests, builds and profile generations they created"};

// The request's own task and the tasks it triggered, listed by the caller. Rows
// are named after their push, oldest first, so that each push's tasks sit together.
async function fetchDownstream({requestId, taskIds, pushGroups}, onProgress) {
  const {load, unavailable} = taskLoader(onProgress);
  const [focus, ...tasks] = await load([requestId, ...taskIds]);
  if (focus?.id !== requestId) throw new Error(`task ${requestId} not found`);
  const groupOf = (task) => {
    const push = pushGroups.indexOf(task.definition.taskGroupId);
    return push < 0 ? "" : `push ${pad(push + 1)}`;
  };
  return {focus, tasks: [focus, ...tasks], unavailable: unavailable(), titleParts: DOWNSTREAM_TITLE, groupOf};
}

// `timelineUrl(taskId)` is the address that opens a task's dependency timeline;
// each task of the profile links to it.
export const openDependencyTimeline = ({taskId, poolActivityUrls, timelineUrl = null, queueTable = null, onProgress}) =>
  openTimeline(() => fetchCriticalChain(taskId, onProgress), {poolActivityUrls, timelineUrl, queueTable});

export const openDownstreamTimeline = ({requestId, taskIds, pushGroups, poolActivityUrls, timelineUrl = null, queueTable = null, onProgress}) =>
  openTimeline(() => fetchDownstream({requestId, taskIds, pushGroups}, onProgress), {poolActivityUrls, timelineUrl, queueTable});

async function openTimeline(fetchTasks, {poolActivityUrls, timelineUrl, queueTable}) {
  const profilerWindow = window.open(PROFILER_POST_URL, "_blank");
  try {
    const chain = await fetchTasks();
    const profile = buildProfile(chain, {poolActivityUrls, timelineUrl, queueSeries: queueTable ? indexQueueSeries(queueTable) : null});
    if (!profilerWindow) {
      return {opened: false, downloadUrl: URL.createObjectURL(new Blob([JSON.stringify(profile)], {type: "application/json"}))};
    }
    await injectProfile(profilerWindow, profile);
    return {opened: true};
  } catch (error) {
    profilerWindow?.close();
    throw error;
  }
}

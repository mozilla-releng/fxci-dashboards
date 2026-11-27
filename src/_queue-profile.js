import {openProfile} from "./_profiler.js";
import {indexQueueSeries, KINDS, KIND_TITLES, LAYERS, queuedPerBucket, TIERS} from "./_queue-position.js";
import {hasRunRows, queuedRuns} from "./_task-rows.js";
import {clockIntervals, formatClockTime, layerColor, markerTable, processedProfile, thread, UPSTREAM_ORDER} from "./_task-profile.js";

const BIN_SECONDS = 300;
const BIN_MS = BIN_SECONDS * 1000;
const HALF_WINDOW_MS = 12 * 3600_000;

const STACK_THREAD_NAME = "Tasks queued";
const TASK_URL = "https://firefox-ci-tc.services.mozilla.com/tasks/";
const TREEHERDER_URL = "https://treeherder.mozilla.org";
const WORKERS_THREAD_NAME = "Workers in the pool";
const WORKER_BIN_MS = 15 * 60 * 1000;

// A push in the data is "<repository>/<revision>", the repository being its project.
function pushUrl(push) {
  if (!push) return null;
  const slash = push.lastIndexOf("/");
  return `${TREEHERDER_URL}/jobs?repo=${encodeURIComponent(push.slice(0, slash))}&revision=${push.slice(slash + 1)}`;
}
const tierTitle = (tier) => `${tier[0].toUpperCase()}${tier.slice(1)} priority`;

// The mean number of runs of each layer queued in each bucket: a run counts for the
// share of the bucket it spent in the queue.
function meanQueuedPerBucket(runs, {startMs, bucketCount, endMs}) {
  const means = new Map(LAYERS.map((layer) => [layer.key, new Float64Array(bucketCount)]));
  for (const run of runs) {
    const layer = layerFor(run);
    const from = Math.max(run.scheduled * 1000, startMs);
    const to = Math.min(run.left ? run.left * 1000 : endMs, endMs);
    const counts = means.get(layer.key);
    for (let bucket = Math.floor((from - startMs) / BIN_MS); bucket < bucketCount && startMs + bucket * BIN_MS < to; bucket++) {
      const binStart = startMs + bucket * BIN_MS;
      counts[bucket] += (Math.min(to, binStart + BIN_MS) - Math.max(from, binStart)) / BIN_MS;
    }
  }
  return means;
}

// The window of a Gantt is a day, centred on `centerMs` unless the data ends first.
export function queueWindow({centerMs, firstMs, lastMs}) {
  const length = Math.min(2 * HALF_WINDOW_MS, lastMs - firstMs);
  const fromMs = Math.min(Math.max(firstMs, centerMs - HALF_WINDOW_MS), lastMs - length);
  return {fromMs, toMs: fromMs + length};
}

const layerFor = (run) => LAYERS.find((layer) => layer.tier === run.tier && (!layer.kind || layer.kind === run.kind));
const rowOf = (layer) => (layer.kind ? `${UPSTREAM_ORDER[KINDS.indexOf(layer.kind)]}${layer.label}` : `${layer.tier} priority`);

// The tasks waiting in a task queue as a Gantt: a row for each kind of task of each
// priority, grouped by priority with the first in line on top, and by kind in the low
// priorities. With `runs`, every run queued during the window (see queuedRuns), each
// task has a bar from when it was scheduled until it left the queue, and the marker
// table lists them. Without, per-run rows are not kept for the queue or the day, and
// a bar is the mean number of tasks of the group queued during 5 minutes, not a task.
export function buildQueueProfile({queueTable, queue, roles, centerMs, firstMs, lastMs, poolActivityUrls, runs = null, workerBins = null}) {
  const {fromMs, toMs} = queueWindow({centerMs, firstMs, lastMs});
  const depth = runs ? null : queuedPerBucket(indexQueueSeries(queueTable), queue, {fromSeconds: fromMs / 1000, toSeconds: toMs / 1000, bucketSeconds: BIN_SECONDS});
  if (!runs && !depth) throw new Error(`no data for the queue ${queue}`);

  const startMs = depth ? depth.firstBin * 1000 : Math.floor(fromMs / BIN_MS) * BIN_MS;
  const bucketCount = depth ? depth.bucketCount : Math.ceil((toMs - startMs) / BIN_MS);
  const endMs = startMs + bucketCount * BIN_MS;
  const strings = [];
  const {table, add} = markerTable(strings, 0);
  const stack = markerTable(strings, 1);

  // The chart lists its rows by category name, then by row name, so each starts
  // with a character nobody sees that sorts them in the order wanted.
  const clockCategory = 0;
  const tierCategory = (tier) => 1 + TIERS.indexOf(tier);
  const categories = [
    {name: `${UPSTREAM_ORDER[0]}Clock (UTC)`, color: "grey"},
    ...TIERS.map((tier, index) => ({name: `${UPSTREAM_ORDER[index + 1]}${tierTitle(tier)}`, color: layerColor(LAYERS.find((layer) => layer.tier === tier))}))
  ];

  for (const interval of clockIntervals(startMs, endMs)) {
    add({
      row: "Clock (UTC)",
      category: clockCategory,
      start: Math.max(interval.start, startMs) - startMs,
      end: interval.end - startMs,
      data: {label: interval.label, color: interval.color, from: interval.from, to: interval.to}
    });
  }

  const meansOf = (layer) => (layer.kind ? depth.kinds.get(layer.tier).get(layer.kind) : depth.tiers.get(layer.tier));
  const runMeans = runs ? meanQueuedPerBucket(runs, {startMs, bucketCount, endMs}) : null;

  const poolDays = new Map();
  const poolDayOf = (ms) => {
    const dayMs = Math.floor(ms / 86400000) * 86400000;
    if (!poolDays.has(dayMs)) poolDays.set(dayMs, poolActivityUrls(queue, dayMs, dayMs + 86400000).filter(Boolean)[0]);
    return poolDays.get(dayMs);
  };
  for (const run of runs ?? []) {
    const layer = layerFor(run);
    const scheduledMs = run.scheduled * 1000;
    const leftMs = run.left ? run.left * 1000 : null;
    const poolDay = poolDayOf(scheduledMs);
    add({
      type: "QueueTask",
      row: rowOf(layer),
      category: tierCategory(layer.tier),
      start: Math.max(scheduledMs, startMs) - startMs,
      end: Math.min(leftMs ?? endMs, endMs) - startMs,
      data: {
        label: run.label,
        color: layerColor(layer),
        taskId: run.id,
        taskUrl: `${TASK_URL}${run.id}`,
        ...(run.push ? {pushUrl: pushUrl(run.push)} : {}),
        ...(run.pusher ? {pusher: run.pusher} : {}),
        ...(run.requester ? {requester: run.requester} : {}),
        ...(run.requestPush ? {requestPushUrl: pushUrl(run.requestPush)} : {}),
        priority: run.tier,
        kind: layer.kind ? KIND_TITLES[layer.kind] : "all kinds",
        outcome: leftMs === null ? "still queued" : run.claimed ? "claimed by a worker" : "left unclaimed (cancelled or deadline exceeded)",
        pool: queue,
        ...(poolDay ? {poolDay} : {}),
        from: formatClockTime(scheduledMs),
        to: leftMs === null ? "still queued" : formatClockTime(leftMs)
      }
    });
  }

  for (const layer of runs ? [] : LAYERS) {
    const means = meansOf(layer);
    // Rows are told apart by name alone, whatever their category, so the name has the priority.
    const row = rowOf(layer);
    means.forEach((mean, bucket) => {
      const queued = Math.round(mean);
      if (queued <= 0) return;
      const start = startMs + bucket * BIN_MS;
      const days = poolActivityUrls(queue, start, start + BIN_MS).filter(Boolean);
      add({
        type: "QueueBin",
        row,
        category: tierCategory(layer.tier),
        start: bucket * BIN_MS,
        end: (bucket + 1) * BIN_MS,
        data: {
          label: `${queued.toLocaleString("en-US")} queued`,
          color: layerColor(layer),
          queued,
          priority: layer.tier,
          kind: layer.kind ? KIND_TITLES[layer.kind] : "all kinds",
          pool: queue,
          ...(days[0] ? {poolDay: days[0]} : {}),
          from: formatClockTime(start),
          to: formatClockTime(start + BIN_MS)
        }
      });
    });
  }

  // One track for all of them: the mean number of each layer in each bucket, and the
  // running total up to the layer, which the graphs draw.
  const layerMeans = LAYERS.map((layer) => ({layer, means: runMeans ? runMeans.get(layer.key) : meansOf(layer)}));
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const counts = Object.fromEntries(layerMeans.map(({layer, means}) => [layer.key, Math.round(means[bucket])]));
    let running = 0;
    const stacked = Object.fromEntries(LAYERS.map(({key}) => [`stack_${key}`, (running += counts[key])]));
    stack.add({
      type: "QueueStack",
      row: "Tasks queued",
      category: 0,
      start: bucket * BIN_MS,
      end: (bucket + 1) * BIN_MS,
      data: {label: `${running.toLocaleString("en-US")} queued`, queued: running, ...counts, ...stacked}
    });
  }

  // The workers of the pool, in the bins of its load data that overlap the window.
  const workersTrack = markerTable(strings, 2);
  const poolBins = (workerBins ?? []).filter((bin) => bin.bin_s * 1000 + WORKER_BIN_MS > startMs && bin.bin_s * 1000 < endMs);
  for (const bin of poolBins) {
    const binStart = bin.bin_s * 1000;
    workersTrack.add({
      type: "PoolWorkers",
      row: WORKERS_THREAD_NAME,
      category: 0,
      start: Math.max(binStart, startMs) - startMs,
      end: Math.min(binStart + WORKER_BIN_MS, endMs) - startMs,
      data: {
        label: `${bin.workers} workers`,
        workers: bin.workers,
        busy: Math.round(bin.busy),
        from: formatClockTime(binStart),
        to: formatClockTime(binStart + WORKER_BIN_MS)
      }
    });
  }
  const workerCounts = poolBins.map((bin) => bin.workers);
  const workersTitle = workerCounts.length
    ? `, ${Math.min(...workerCounts) === Math.max(...workerCounts) ? Math.max(...workerCounts) : `${Math.min(...workerCounts)} to ${Math.max(...workerCounts)}`} workers`
    : "";

  const title = `Tasks queued in ${queue} (${roles}), ${formatClockTime(startMs)} to ${formatClockTime(endMs)}${runs ? `, ${runs.length.toLocaleString("en-US")} tasks` : ""}${workersTitle}`;
  return processedProfile({
    title,
    startTime: startMs,
    strings,
    categories,
    markerSchema: [
      {
        name: "TaskInterval",
        display: ["marker-chart", "marker-table"],
        colorField: "color",
        chartLabel: "{marker.data.label}",
        tableLabel: "{marker.data.label}",
        tooltipLabel: "{marker.data.label}",
        fields: [
          {key: "from", label: "From", format: "string"},
          {key: "to", label: "To", format: "string"}
        ]
      },
      {
        name: "QueueBin",
        display: ["marker-chart", "marker-table"],
        colorField: "color",
        chartLabel: "{marker.data.label}",
        tableLabel: "{marker.data.label}",
        tooltipLabel: "{marker.data.label}",
        description: "The mean number of tasks of this priority and kind waiting for a worker in the queue during these 5 minutes. It is a count: the individual tasks are not known.",
        fields: [
          {key: "queued", label: "Tasks queued, mean", format: "integer"},
          {key: "priority", label: "Priority", format: "string"},
          {key: "kind", label: "Kind", format: "string"},
          {key: "pool", label: "Worker pool", format: "string"},
          {key: "poolDay", label: "Pool activity", format: "url"},
          {key: "from", label: "From", format: "string"},
          {key: "to", label: "To", format: "string"}
        ]
      },
      {
        name: "QueueTask",
        display: ["marker-chart", "marker-table"],
        colorField: "color",
        chartLabel: "{marker.data.label}",
        tableLabel: "{marker.data.label}",
        tooltipLabel: "{marker.data.label}",
        description: "A task waiting for a worker in the queue: from when it was scheduled until a worker claimed it, or until it left unclaimed.",
        fields: [
          {key: "taskId", label: "Task ID", format: "string"},
          {key: "taskUrl", label: "Task view", format: "url"},
          {key: "pushUrl", label: "Push on Treeherder", format: "url"},
          {key: "pusher", label: "Pushed by", format: "string"},
          {key: "requester", label: "Requested by", format: "string"},
          {key: "requestPushUrl", label: "Requested on the push", format: "url"},
          {key: "priority", label: "Priority", format: "string"},
          {key: "kind", label: "Kind", format: "string"},
          {key: "outcome", label: "Left the queue", format: "string"},
          {key: "pool", label: "Worker pool", format: "string"},
          {key: "poolDay", label: "Pool activity", format: "url"},
          {key: "from", label: "Scheduled", format: "string"},
          {key: "to", label: "Left the queue at", format: "string"}
        ]
      },
      {
        name: "QueueStack",
        display: ["marker-table"],
        tableLabel: "{marker.data.label}",
        tooltipLabel: "{marker.data.label}",
        description: "All the tasks waiting for a worker in the queue during these 5 minutes, stacked from the first in line, by priority and kind. The mean number of each.",
        fields: [
          {key: "queued", label: "Tasks queued, mean", format: "integer"},
          ...LAYERS.map(({key, label}) => ({key, label, format: "integer"})),
          ...LAYERS.map(({key, label}) => ({key: `stack_${key}`, label, format: "integer", hidden: true}))
        ],
        graphs: [...LAYERS].reverse().map((layer) => ({key: `stack_${layer.key}`, type: "bar", color: layerColor(layer)}))
      },
      {
        name: "PoolWorkers",
        display: ["marker-table"],
        tableLabel: "{marker.data.label}",
        tooltipLabel: "{marker.data.label}",
        description:
          "The workers of the pool during these 15 minutes. The pool has no configured size here: it is the number of workers that ran something in a session overlapping them, where a session ends after 24 hours without a run. Busy is the mean number of them running a task or starting the next.",
        fields: [
          {key: "workers", label: "Workers in the pool", format: "integer"},
          {key: "busy", label: "Busy workers, mean", format: "integer"},
          {key: "from", label: "From", format: "string"},
          {key: "to", label: "To", format: "string"}
        ],
        graphs: [
          {key: "workers", type: "bar", color: "grey"},
          {key: "busy", type: "bar", color: "blue"}
        ]
      }
    ],
    threads: [
      thread({name: "Queue", id: 0, markers: table}),
      thread({name: STACK_THREAD_NAME, id: 1, markers: stack.table}),
      ...(poolBins.length ? [thread({name: WORKERS_THREAD_NAME, id: 2, markers: workersTrack.table})] : [])
    ]
  });
}

// The runs are read from the per-run files when the queue and day have them, and
// otherwise the Gantt has the counts of the queue series.
export const openQueueGantt = (options) =>
  openProfile(async () => {
    const {fromMs, toMs} = queueWindow(options);
    const runs = hasRunRows(options.queue, fromMs, toMs) ? await queuedRuns(options.queue, fromMs, toMs) : null;
    return buildQueueProfile({...options, runs});
  });

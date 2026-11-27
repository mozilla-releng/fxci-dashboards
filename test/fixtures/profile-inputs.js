// Inputs for the golden tests of the profile builders: a few tasks and runs, and
// a queue, small enough to read, that between them reach every branch of
// buildProfile and buildQueueProfile.
import {poolActivityDays} from "../../src/_task-profile.js";

const at = (iso) => Date.parse(iso);
const seconds = (iso) => at(iso) / 1000;

export const NOW = at("2026-11-18T12:00:00Z");
const BUILD_QUEUE = "gecko-3/b-linux-docker-amd";
const PERF_QUEUE = "releng-hardware/gecko-t-linux-talos-2404";

const run = (runId, scheduled, started, resolved, state, reasonResolved, worker = null) => ({
  runId,
  state,
  reasonResolved,
  scheduled,
  started,
  resolved,
  ...(worker ? {workerGroup: "fixture-group", workerId: worker} : {})
});

const task = (id, name, {created, dependencies = [], queue = BUILD_QUEUE, priority = "high", runs}) => ({
  id,
  definition: {created, dependencies, metadata: {name}, taskQueueId: queue, priority, taskGroupId: "fixture-group-id", tags: {project: "autoland"}},
  runs
});

const OLD = task("oldAAAAAAAAAAAAAAAAAA", "toolchain-old", {
  created: "2026-11-17T08:00:00Z",
  runs: [run(0, "2026-11-17T08:00:00Z", "2026-11-17T08:05:00Z", "2026-11-17T08:30:00Z", "completed", "completed", "w0")]
});
const TOOLCHAIN = task("tcAAAAAAAAAAAAAAAAAAA", "toolchain-running", {
  created: "2026-11-18T09:00:00Z",
  runs: [run(0, "2026-11-18T09:00:00Z", "2026-11-18T09:10:00Z", null, "running", "running", "w1")]
});
const BUILD = task("buildBBBBBBBBBBBBBBBBB", "build-linux64-shippable/opt", {
  created: "2026-11-18T09:50:00Z",
  dependencies: [OLD.id],
  runs: [run(0, "2026-11-18T09:50:00Z", "2026-11-18T09:58:00Z", "2026-11-18T10:40:00Z", "completed", "completed", "w2")]
});
export const FOCUS = task("testCCCCCCCCCCCCCCCCCC", "test-linux2404-64-shippable/opt-talos-bcv", {
  created: "2026-11-18T10:41:00Z",
  dependencies: [BUILD.id, TOOLCHAIN.id],
  queue: PERF_QUEUE,
  priority: "low",
  runs: [
    run(0, "2026-11-18T10:41:00Z", null, "2026-11-18T11:10:00Z", "exception", "deadline-exceeded"),
    run(1, "2026-11-18T11:10:00Z", "2026-11-18T11:25:00Z", "2026-11-18T11:55:00Z", "failed", "failed", "w3")
  ]
});

export const TASKS = [OLD, TOOLCHAIN, BUILD, FOCUS];

const DAY = "2026-11-18";
export const poolActivityUrls = (queue, fromMs, toMs) =>
  poolActivityDays(fromMs, toMs, (date) => (date === DAY ? `https://workers.example.test/?date=${date}&filter=${encodeURIComponent(queue)}` : null));
export const timelineUrl = (taskId) => `https://dashboards.example.test/page?timeline=${taskId}`;

// What indexQueueSeries reads of an Arrow table: columns that spread into an
// array, and numeric ones with toArray().
const column = (values) => Object.assign([...values], {toArray: () => values});
export function queueTable(rows) {
  const columns = {queue: [], tier: [], bin_s: [], queued: [], arrived: [], claimed: [], dropped: []};
  for (const row of rows) for (const name of Object.keys(columns)) columns[name].push(row[name]);
  return {getChild: (name) => column(columns[name])};
}

const bin = (iso) => Math.floor(seconds(iso) / 300) * 300;
export const QUEUE_ROWS = [
  {queue: PERF_QUEUE, tier: "high", bin_s: bin("2026-11-18T10:40:00Z"), queued: 2, arrived: 3, claimed: 1, dropped: 0},
  {queue: PERF_QUEUE, tier: "high", bin_s: bin("2026-11-18T10:55:00Z"), queued: 4, arrived: 1, claimed: 4, dropped: 0},
  {queue: PERF_QUEUE, tier: "low", bin_s: bin("2026-11-18T10:40:00Z"), queued: 10, arrived: 5, claimed: 2, dropped: 1},
  {queue: PERF_QUEUE, tier: "low", bin_s: bin("2026-11-18T11:00:00Z"), queued: 12, arrived: 0, claimed: 6, dropped: 0},
  {queue: PERF_QUEUE, tier: "low:backfill", bin_s: bin("2026-11-18T10:40:00Z"), queued: 30, arrived: 8, claimed: 3, dropped: 0},
  {queue: PERF_QUEUE, tier: "low:backfill", bin_s: bin("2026-11-18T11:10:00Z"), queued: 35, arrived: 0, claimed: 9, dropped: 2},
  {queue: PERF_QUEUE, tier: "low:perf", bin_s: bin("2026-11-18T10:45:00Z"), queued: 6, arrived: 2, claimed: 2, dropped: 0},
  {queue: PERF_QUEUE, tier: "very-low", bin_s: bin("2026-11-18T10:40:00Z"), queued: 1, arrived: 1, claimed: 0, dropped: 0}
];

export const QUEUE = {
  queue: PERF_QUEUE,
  roles: "perf tasks",
  centerMs: at("2026-11-18T11:00:00Z"),
  firstMs: at("2026-11-18T10:00:00Z"),
  lastMs: at("2026-11-18T13:00:00Z")
};

export const RUNS = [
  {id: "runAAAAAAAAAAAAAAAAAAA", label: "test-linux2404-64-shippable/opt-talos-bcv", scheduled: seconds("2026-11-18T10:41:00Z"), left: seconds("2026-11-18T11:10:00Z"), tier: "low", kind: "backfill", claimed: false, push: "autoland/aaaaaaaaaaaa", pusher: "alice", requester: "bob", requestPush: "autoland/bbbbbbbbbbbb"},
  {id: "runBBBBBBBBBBBBBBBBBBB", label: "test-linux2404-64-shippable/opt-raptor", scheduled: seconds("2026-11-18T10:50:00Z"), left: seconds("2026-11-18T11:25:00Z"), tier: "low", kind: "perf", claimed: true, push: "try/cccccccccccc", pusher: "carol"},
  {id: "runCCCCCCCCCCCCCCCCCCC", label: "test-linux2404-64-shippable/opt-talos-other", scheduled: seconds("2026-11-18T11:00:00Z"), left: null, tier: "high", kind: "other", claimed: false}
];

export const WORKER_BINS = [
  {bin_s: seconds("2026-11-18T10:45:00Z"), workers: 24, busy: 18.4},
  {bin_s: seconds("2026-11-18T11:00:00Z"), workers: 26, busy: 22.6},
  {bin_s: seconds("2026-11-18T11:15:00Z"), workers: 26, busy: 9.2}
];

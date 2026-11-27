import assert from "node:assert/strict";
import {readFileSync, writeFileSync} from "node:fs";
import {afterEach, beforeEach, describe, test} from "node:test";
import {intervalProfile} from "../../src/_interval-profile.js";
import {openProfile, PROFILER_POST_URL} from "../../src/_profiler.js";
import {indexQueueSeries} from "../../src/_queue-position.js";
import {buildQueueProfile} from "../../src/_queue-profile.js";
import {buildProfile, UPSTREAM_ORDER} from "../../src/_task-profile.js";
import {FOCUS, NOW, poolActivityUrls, QUEUE, queueTable, QUEUE_ROWS, RUNS, TASKS, timelineUrl, WORKER_BINS} from "../fixtures/profile-inputs.js";

// UPDATE_GOLDEN=1 npm test rewrites the golden files from the current code.
const fixture = (name) => new URL(`../fixtures/${name}.golden.json`, import.meta.url);

function sameAsGolden(name, profile) {
  const actual = JSON.stringify(profile);
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(fixture(name), `${actual}\n`);
  const expected = readFileSync(fixture(name), "utf8").trimEnd();
  const offset = [...actual].findIndex((character, index) => character !== expected[index]);
  assert.ok(actual === expected, `${name} differs from its golden file, first at character ${offset < 0 ? Math.min(actual.length, expected.length) : offset}`);
}

// What the profiler needs of a profile to open it: every marker column as long as
// its table says, every name and category an index into what exists, and every
// marker of a type the schema describes.
function assertWellFormed(profile) {
  const {markerSchema, categories} = profile.meta;
  const types = new Set(markerSchema.map(({name}) => name));
  assert.equal(profile.shared.stringArray.length > 0, true);
  assert.ok(profile.threads.length > 0);
  for (const {markers} of profile.threads) {
    for (const column of ["data", "name", "startTime", "endTime", "phase", "category", "threadId"]) assert.equal(markers[column].length, markers.length, `${column} is as long as the table`);
    for (let index = 0; index < markers.length; index++) {
      assert.ok(markers.name[index] >= 0 && markers.name[index] < profile.shared.stringArray.length, "name is a string index");
      assert.ok(markers.category[index] >= 0 && markers.category[index] < categories.length, "category is a category index");
      assert.ok(markers.startTime[index] >= 0 && markers.startTime[index] <= markers.endTime[index], "starts at or after zero, and not after it ends");
      assert.ok(types.has(markers.data[index].type), `${markers.data[index].type} is in the schema`);
    }
  }
}

const rowsOf = (profile, thread = 0) => profile.threads[thread].markers.name.map((index) => profile.shared.stringArray[index]);

describe("the profiles of task graphs", () => {
  const options = {poolActivityUrls, timelineUrl, now: NOW};

  test("dependencies of a task", () => {
    const profile = buildProfile({focus: FOCUS, tasks: TASKS}, options);
    assertWellFormed(profile);
    sameAsGolden("dependencies", profile);
  });

  test("dependencies of a task, with the tasks ahead of each wait", () => {
    sameAsGolden("dependencies-queue", buildProfile({focus: FOCUS, tasks: TASKS}, {...options, queueSeries: indexQueueSeries(queueTable(QUEUE_ROWS))}));
  });

  test("downstream tasks, grouped", () => {
    const groupOf = (task) => (task.id === FOCUS.id ? "push 02" : "push 01");
    const titleParts = {heading: "Downstream tasks of", describe: "the tasks it triggered"};
    sameAsGolden("downstream", buildProfile({focus: FOCUS, tasks: TASKS, unavailable: 2, titleParts, groupOf}, options));
  });
});

describe("the profiles of a task queue", () => {
  const options = {...QUEUE, queueTable: queueTable(QUEUE_ROWS), poolActivityUrls};

  test("from the counts of the queue", () => {
    const profile = buildQueueProfile(options);
    assertWellFormed(profile);
    sameAsGolden("queue-counts", profile);
  });

  test("from every run, with the workers of the pool", () => {
    sameAsGolden("queue-runs", buildQueueProfile({...options, runs: RUNS, workerBins: WORKER_BINS}));
  });
});

describe("intervalProfile", () => {
  const START = Date.parse("2026-11-18T10:00:00Z");
  const FIELDS = [{key: "label", label: "Label", format: "string"}, {key: "who", label: "Who", format: "string"}];
  const at = (minutes) => START + minutes * 60_000;
  const interval = (row, category, from, to, extra = {}) => ({row, category, start: at(from), end: at(to), label: `${row} ${from}-${to}`, color: "green", who: "alice", ...extra});
  const profileOf = (tracks, extra = {}) => intervalProfile({title: "A journey", startMs: START, fields: FIELDS, tracks, ...extra});

  test("is well formed, with the rows of every track in its own thread", () => {
    const profile = profileOf([
      {name: "Journey", intervals: [interval("Review", "Before", 0, 30), interval("Queue", "Lando", 30, 90)]},
      {name: "Events", intervals: [interval("Merge", "Autoland", 100, 100)]}
    ]);
    assertWellFormed(profile);
    assert.deepEqual(profile.threads.map(({name, tid}) => [name, tid]), [["Journey", 0], ["Events", 1]]);
    assert.equal(profile.meta.product, "A journey");
    assert.equal(profile.meta.startTime, START);
    assert.ok(rowsOf(profile, 1).includes("Merge"));
  });

  test("shares one table of strings between the tracks", () => {
    const profile = profileOf([
      {name: "One", intervals: [interval("Same row", "Stage", 0, 10)]},
      {name: "Two", intervals: [interval("Same row", "Stage", 20, 30)]}
    ]);
    const [first] = profile.threads[0].markers.name.slice(-1);
    const [second] = profile.threads[1].markers.name;
    assert.equal(first, second);
  });

  test("puts a clock row in the first track, and only there, unless it is turned off", () => {
    const tracks = [{name: "One", intervals: [interval("A", "Stage", 0, 130)]}, {name: "Two", intervals: [interval("B", "Stage", 0, 10)]}];
    const withClock = profileOf(tracks);
    assert.ok(rowsOf(withClock, 0).includes("Clock (UTC)"));
    assert.ok(!rowsOf(withClock, 1).includes("Clock (UTC)"));
    assert.equal(withClock.meta.categories[0].name, "Clock (UTC)");
    assert.equal(rowsOf(withClock, 0).filter((row) => row === "Clock (UTC)").length, 3);

    const withoutClock = profileOf(tracks, {clock: false});
    assert.ok(!rowsOf(withoutClock, 0).includes("Clock (UTC)"));
    assertWellFormed(withoutClock);
  });

  test("numbers the categories in the order they first appear", () => {
    const profile = profileOf([{name: "One", intervals: [interval("A", "Second", 0, 5), interval("B", "First", 5, 10), interval("C", "Second", 10, 15)]}], {clock: false});
    assert.deepEqual(profile.meta.categories.map(({name}) => name), ["Second", "First"]);
    assert.deepEqual(profile.threads[0].markers.category, [0, 1, 0]);
  });

  test("puts an invisible prefix on a row to sort it where wanted", () => {
    const profile = profileOf([{name: "One", intervals: [interval("Late", "Stage", 0, 5, {order: 2}), interval("Early", "Stage", 5, 10, {order: 0}), interval("Plain", "Stage", 10, 15)]}], {clock: false});
    assert.deepEqual(rowsOf(profile), [`${UPSTREAM_ORDER[2]}Late`, `${UPSTREAM_ORDER[0]}Early`, "Plain"]);
    const sorted = [...rowsOf(profile)].sort();
    assert.deepEqual(sorted, [`${UPSTREAM_ORDER[0]}Early`, `${UPSTREAM_ORDER[2]}Late`, "Plain"].sort());
    assert.ok(`${UPSTREAM_ORDER[0]}Early` < `${UPSTREAM_ORDER[2]}Late`);
  });

  test("sorts a row with an order below zero as the first", () => {
    const profile = profileOf([{name: "One", intervals: [interval("Row", "Stage", 0, 5, {order: -1})]}], {clock: false});
    assert.deepEqual(rowsOf(profile), [`${UPSTREAM_ORDER[0]}Row`]);
  });

  test("builds the profile of a very large number of intervals", () => {
    const intervals = Array.from({length: 300_000}, (_, index) => interval("Row", "Stage", index, index + 1));
    const profile = profileOf([{name: "One", intervals}], {clock: false});
    assert.equal(profile.threads[0].markers.length, 300_000);
  });

  test("measures times from the start, and keeps what began before it at zero", () => {
    const profile = profileOf([{name: "One", intervals: [interval("A", "Stage", -30, 20), interval("B", "Stage", 10, 40)]}], {clock: false});
    assert.deepEqual(profile.threads[0].markers.startTime, [0, 600_000]);
    assert.deepEqual(profile.threads[0].markers.endTime, [1_200_000, 2_400_000]);
  });

  test("describes every field, and adds the from and to times of each interval", () => {
    const profile = profileOf([{name: "One", intervals: [interval("A", "Stage", 0, 5)]}], {clock: false});
    const [schema] = profile.meta.markerSchema;
    assert.deepEqual(schema.fields.map(({key}) => key), ["label", "who", "from", "to"]);
    assert.equal(profile.threads[0].markers.data[0].from, "2026-11-18 10:00:00 UTC");
    assert.equal(profile.threads[0].markers.data[0].to, "2026-11-18 10:05:00 UTC");
    assert.equal(profile.threads[0].markers.data[0].who, "alice");
  });

  test("does not describe from and to twice", () => {
    const fields = [...FIELDS, {key: "from", label: "Began", format: "string"}];
    const profile = intervalProfile({title: "t", startMs: START, fields, clock: false, tracks: [{name: "One", intervals: [interval("A", "Stage", 0, 5)]}]});
    assert.deepEqual(profile.meta.markerSchema[0].fields.map(({key}) => key), ["label", "who", "from", "to"]);
  });

  test("copes with no interval at all", () => {
    const profile = profileOf([{name: "One", intervals: []}]);
    assertWellFormed(profile);
    assert.equal(profile.threads[0].markers.length, 1);
  });
});

describe("openProfile", () => {
  const ORIGIN = "https://profiler.firefox.com";
  let opened;
  let listeners;

  const profilerWindow = (overrides = {}) => {
    const posted = [];
    return {closed: false, posted, closeCalls: 0, postMessage: (message, origin) => posted.push([message, origin]), close() { this.closeCalls++; }, ...overrides};
  };
  const answer = (event) => listeners.forEach((listener) => listener(event));
  const untilPosted = async (win, name) => {
    while (!win.posted.some(([message]) => message.name === name)) await new Promise((resolve) => setTimeout(resolve, 20));
  };

  beforeEach(() => {
    opened = [];
    listeners = new Set();
    globalThis.window = {
      open: (...args) => (opened.push(args), globalThis.window.next),
      addEventListener: (type, listener) => type === "message" && listeners.add(listener),
      removeEventListener: (type, listener) => type === "message" && listeners.delete(listener)
    };
  });

  afterEach(() => {
    delete globalThis.window;
  });

  test("opens the profiler before it builds the profile", async () => {
    const win = profilerWindow();
    globalThis.window.next = win;
    let openedBeforeBuild = null;
    const result = openProfile(async () => {
      openedBeforeBuild = opened.length === 1;
      return {profile: true};
    });
    await untilPosted(win, "ready:request");
    answer({origin: ORIGIN, data: {name: "ready:response"}});
    assert.deepEqual(await result, {opened: true});
    assert.equal(openedBeforeBuild, true);
    assert.deepEqual(opened, [[PROFILER_POST_URL, "_blank"]]);
  });

  test("sends the profile to the profiler's origin once it answers", async () => {
    const win = profilerWindow();
    globalThis.window.next = win;
    const result = openProfile(async () => ({title: "p"}));
    await untilPosted(win, "ready:request");
    assert.deepEqual(win.posted[0], [{name: "ready:request"}, ORIGIN]);
    answer({origin: ORIGIN, data: {name: "ready:response"}});
    await result;
    assert.deepEqual(win.posted.at(-1), [{name: "inject-profile", profile: {title: "p"}}, ORIGIN]);
    assert.equal(listeners.size, 0, "it stops listening");
  });

  test("ignores an answer from another origin", async () => {
    const win = profilerWindow();
    globalThis.window.next = win;
    const result = openProfile(async () => ({title: "p"}));
    await untilPosted(win, "ready:request");
    answer({origin: "https://evil.example.test", data: {name: "ready:response"}});
    assert.ok(!win.posted.some(([message]) => message.name === "inject-profile"));
    answer({origin: ORIGIN, data: {name: "ready:response"}});
    await result;
    assert.equal(win.posted.filter(([message]) => message.name === "inject-profile").length, 1);
  });

  test("offers the profile as a file when the popup was blocked", async () => {
    globalThis.window.next = null;
    const result = await openProfile(async () => ({title: "p"}));
    assert.equal(result.opened, false);
    assert.match(result.downloadUrl, /^blob:/);
    URL.revokeObjectURL(result.downloadUrl);
  });

  test("closes the window and passes the error on when the profile cannot be built", async () => {
    const win = profilerWindow();
    globalThis.window.next = win;
    await assert.rejects(openProfile(async () => { throw new Error("no tasks"); }), /no tasks/);
    assert.equal(win.closeCalls, 1);
  });

  test("fails when the profiler window is closed before it answers", async () => {
    const win = profilerWindow({closed: true});
    globalThis.window.next = win;
    await assert.rejects(openProfile(async () => ({title: "p"})), /window was closed/);
    assert.equal(listeners.size, 0, "it stops listening");
  });
});

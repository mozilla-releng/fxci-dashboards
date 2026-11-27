// Deterministic stand-ins for the STMO results the pages under test read, one
// <queryId>.json per query, for builds with STMO_FIXTURES_DIR set (see
// src/data/_stmo.js). The columns are the ones of the real queries; the values
// only have to be plausible and always the same. A query without a fixture
// builds as an empty result, so the pages that are not tested render empty.
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {load} from "js-yaml";
import {FIRST_DAY, LAST_DAY, TASK_CHUNKS} from "../src/_task-queues.js";
import {between, pick, random, revision, taskId} from "./fixture-random.js";
import {NIGHTLY_TABLES} from "./nightly-fixtures.js";

const DAY = 86400;
const FIRST_S = Date.parse(`${FIRST_DAY}T00:00:00Z`) / 1000;
const LAST_S = Date.parse(`${LAST_DAY}T00:00:00Z`) / 1000 + DAY;

const POOLS = {
  "Linux talos": {queue: "releng-hardware/gecko-t-linux-talos-2404", platform: "linux2404-64", builds: "linux64", workers: 30},
  "Windows 11 hw": {queue: "releng-hardware/win11-64-24h2-hw", platform: "windows11-64-24h2", builds: "win64", workers: 40},
  "mac M4": {queue: "releng-hardware/gecko-t-osx-1500-m4", platform: "macosx1500-aarch64", builds: "macosx64-aarch64", workers: 60},
  "mac 14.70": {queue: "releng-hardware/gecko-t-osx-1400-r8", platform: "macosx1470-64", builds: "macosx64", workers: 25},
  "Android A55": {queue: "proj-autophone/gecko-t-lambda-perf-a55", platform: "android-hw-a55-14-0-aarch64", builds: "android-aarch64", workers: 20},
  "Windows hw-ref": {queue: "releng-hardware/win11-64-24h2-hw-ref", platform: "windows11-64-24h2-ref-hw", builds: "win64", workers: 12}
};
const BUILD_QUEUES = ["gecko-3/b-linux-docker-amd", "gecko-3/b-win2022", "releng-hardware/gecko-3-b-osx-arm64"];
const PEOPLE = ["alice", "bob", "carol", "dave", "erin", "frank", "grace", "heidi"];
const BOTS = ["project/perf-sheriff-bot", "project/perftest-bot"];
const TESTS = ["browsertime-tp6-firefox-amazon", "browsertime-speedometer3", "talos-bcv", "raptor-youtube-playback", "perftest-startup"];
const TIERS = ["highest", "very-high", "high", "medium", "low", "low:backfill", "low:perf", "very-low", "very-low:backfill", "very-low:perf", "lowest", "lowest:backfill", "lowest:perf"];

function requestedBy(rand) {
  return rand() < 0.2 ? pick(rand, BOTS) : `mozilla-auth0/ad|Mozilla-LDAP|${pick(rand, PEOPLE)}/treeherder`;
}

function request(rand, pool, {queue, platform, builds}, index) {
  const created = FIRST_S + DAY + Math.floor(rand() * (LAST_S - FIRST_S - 3 * DAY));
  const tests = between(rand, 1, 120);
  const hasBuild = rand() < 0.7;
  const hasProfile = hasBuild && rand() < 0.6;
  const hasInstrumented = hasProfile && rand() < 0.8;
  const ran = rand() < 0.88;
  const blocked = !ran && rand() < 0.7;
  const expired = ran && rand() < 0.04;
  const seconds = (low, high, present = true) => (present ? between(rand, low, high) : 0);
  const durations = {
    request_s: seconds(5, 120),
    action_s: seconds(5, 200),
    instrumented_wait_s: seconds(60, 20000, hasInstrumented),
    instrumented_run_s: seconds(900, 4000, hasInstrumented),
    profile_wait_s: seconds(60, 30000, hasProfile),
    profile_run_s: seconds(900, 7000, hasProfile),
    build_wait_s: seconds(30, 9000, hasBuild),
    build_run_s: seconds(600, 3600, hasBuild),
    test_wait_s: expired || blocked ? 0 : seconds(60, 60000),
    test_run_s: expired || blocked ? 0 : seconds(300, 3600),
    test_expired_s: expired ? 86400 : 0
  };
  const total = Object.values(durations).reduce((sum, value) => sum + value, 0) + between(rand, 0, 1800);
  const failedRoot = {id: taskId(rand), label: `build-${builds}-shippable/opt`, outcome: pick(rand, ["failed", "expired", "canceled", "exception"])};
  return {
    pool,
    request_id: taskId(rand),
    push_group_ids: Array.from({length: between(rand, 1, 8)}, () => taskId(rand)).join(","),
    from_revision: revision(rand),
    to_revision: revision(rand),
    downstream_ids: Array.from({length: between(rand, 2, 12)}, () => taskId(rand)).join(","),
    requested_by: requestedBy(rand),
    created_s: created,
    target_label: `test-${platform}/opt-${pick(rand, TESTS)}`,
    tests,
    builds: hasBuild ? between(rand, 1, 20) : 0,
    profile_generations: hasProfile ? between(rand, 1, 30) : 0,
    last_test_id: ran || blocked ? taskId(rand) : "",
    last_test_resolved_s: ran ? created + total : blocked ? created + total + 86400 : 0,
    ...durations,
    build_id: hasBuild ? taskId(rand) : "",
    build_queue: hasBuild ? pick(rand, BUILD_QUEUES) : "",
    profile_id: hasProfile ? taskId(rand) : "",
    profile_queue: hasProfile ? pick(rand, BUILD_QUEUES) : "",
    instrumented_id: hasInstrumented ? taskId(rand) : "",
    instrumented_queue: hasInstrumented ? pick(rand, BUILD_QUEUES) : "",
    test_blocked: blocked,
    blocked_tests: blocked ? between(rand, 1, tests) : 0,
    blocked_test_id: blocked ? taskId(rand) : "",
    blocked_resolved_s: blocked ? created + total + 86400 : 0,
    blocked_parent_id: blocked ? failedRoot.id : "",
    blocked_parent_label: blocked ? failedRoot.label : "",
    blocked_parent_outcome: blocked ? failedRoot.outcome : "",
    blocked_root_id: blocked ? failedRoot.id : "",
    blocked_root_label: blocked ? failedRoot.label : "",
    blocked_root_outcome: blocked ? failedRoot.outcome : "",
    index
  };
}

function requests() {
  const rand = random(1);
  const rows = Object.entries(POOLS).flatMap(([pool, details], poolIndex) =>
    Array.from({length: 260 - 20 * poolIndex}, (_, index) => request(rand, pool, details, index))
  );
  return rows.sort((a, b) => a.created_s - b.created_s || a.request_id.localeCompare(b.request_id)).map(({index, ...row}) => row);
}

function poolLoad() {
  const rand = random(2);
  const rows = [];
  for (const [pool, {workers}] of Object.entries(POOLS)) {
    for (let bin = FIRST_S; bin < LAST_S; bin += 900) {
      const hour = (bin % DAY) / 3600;
      const daytime = 0.35 + 0.65 * Math.max(0, Math.sin(((hour - 6) / 24) * 2 * Math.PI));
      const capacity = Math.max(1, Math.round(workers * (0.9 + 0.1 * rand())));
      const busy = Math.round(capacity * Math.min(1, daytime * (0.6 + 0.6 * rand())) * 10) / 10;
      const busyPerf = Math.round(busy * 0.5 * rand() * 10) / 10;
      const busyBackfill = Math.round(busyPerf * 0.6 * rand() * 10) / 10;
      const projects = [["autoland", 0.6], ["try", 0.3], ["mozilla-central", 0.1]]
        .map(([project, share]) => ({project, busy: Math.round(busy * share * 10) / 10}))
        .filter(({busy: value}) => value > 0);
      rows.push({
        pool,
        bin_s: bin,
        workers: capacity,
        busy,
        busy_perf: busyPerf,
        busy_backfill: busyBackfill,
        waiting: Math.round(Math.max(0, (daytime - 0.7) * 40 * rand()) * 10) / 10,
        by_project: JSON.stringify(projects)
      });
    }
  }
  return rows;
}

function queue() {
  const rand = random(3);
  const queues = [...new Set([...Object.values(POOLS).map(({queue: name}) => name), ...BUILD_QUEUES, ...Object.values(TASK_CHUNKS).flatMap(({queues: names}) => names)])].slice(0, 8);
  const rows = [];
  for (const name of queues) {
    for (const tier of TIERS) {
      let queued = 0;
      for (let day = FIRST_S; day < LAST_S; day += DAY) {
        const bins = [...new Set(Array.from({length: between(rand, 2, 6)}, () => day + 300 * between(rand, 0, 287)))].sort((a, b) => a - b);
        for (const bin of bins) {
          const arrived = between(rand, 0, 25);
          const claimed = Math.min(queued + arrived, between(rand, 0, 25));
          const dropped = Math.min(queued + arrived - claimed, rand() < 0.1 ? between(rand, 0, 3) : 0);
          if (arrived + claimed + dropped === 0) continue;
          rows.push({queue: name, tier, bin_s: bin, queued, arrived, claimed, dropped});
          queued += arrived - claimed - dropped;
        }
      }
    }
  }
  return rows;
}

export const TABLES = {
  "backfill-requests": requests,
  "backfill-load": poolLoad,
  "backfill-queue": queue,
  ...NIGHTLY_TABLES
};

export function makeFixtures(dir) {
  const registry = load(readFileSync(new URL("../src/data/_queries.yaml", import.meta.url), "utf8"));
  mkdirSync(dir, {recursive: true});
  const written = {};
  for (const [name, rows] of Object.entries(TABLES)) {
    const entry = registry.find((query) => query.name === name);
    if (!entry) throw new Error(`No _queries.yaml entry named "${name}"`);
    const data = rows();
    writeFileSync(join(dir, `${entry.queryId}.json`), JSON.stringify(data));
    written[name] = data.length;
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? ".fixtures";
  console.log(JSON.stringify({dir, rows: makeFixtures(dir)}));
}

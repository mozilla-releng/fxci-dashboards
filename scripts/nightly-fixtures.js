// Stand-ins for the two Ship to Nightly queries, shaped like the real results: about
// 17,000 landings over 90 days, two Nightlies a day, about 10 tree closures a day. The
// sources lag the present by different amounts, as the real ones do, so the newest
// landings are in flight or unmatched, and the page's handling of those is tested.
// Everything is relative to a fixed moment.
import {between, normal, pick, random, revision, taskId} from "./fixture-random.js";

const HOUR = 3600;
const DAY = 86400;
export const NOW_S = Date.parse("2026-11-27T12:00:00Z") / 1000;
const FIRST_S = Math.floor(NOW_S / DAY) * DAY - 90 * DAY;
const WATERMARKS = {
  lando_until_s: NOW_S - Math.round(12.4 * HOUR),
  treeherder_until_s: NOW_S - Math.round(7.5 * HOUR),
  fxci_until_s: NOW_S - HOUR,
  commit_maps_until_s: NOW_S - 13 * HOUR
};
const JOBS_UNTIL_S = NOW_S - Math.round(6.2 * HOUR);

const PEOPLE = ["alice", "bob", "carol", "dave", "erin", "frank", "grace", "heidi", "ivan", "judy", "mallory", "niaj", "olivia", "peggy", "rupert", "sybil", "trent", "victor", "wendy", "xavier", "yolanda", "zed", "amir", "bianca"];
const SHERIFFS = ["sheriff-a", "sheriff-b", "sheriff-c"];
const TAGS = [["checkin_test", 0.4], ["waiting_for_coverage", 0.5], ["checkin_compilation", 0.07], ["infra", 0.015], ["merges", 0.01], ["other", 0.005]];
const STACK_SIZES = [[1, 0.6], [2, 0.12], [3, 0.08], [4, 0.07], [5, 0.06], [6, 0.03], [8, 0.02], [12, 0.02]];

function weighted(rand, table) {
  let at = rand();
  for (const [value, weight] of table) {
    at -= weight;
    if (at < 0) return value;
  }
  return table[0][0];
}

function treeClosures(rand) {
  const rows = [];
  let at = FIRST_S + between(rand, 0, 6 * HOUR);
  for (;;) {
    const length = Math.min(8 * HOUR, Math.max(300, Math.round(0.6 * HOUR * Math.exp(0.78 * normal(rand)))));
    if (at + length > NOW_S - HOUR) break;
    rows.push({start_s: at, end_s: at + length, status: "closed", reason_tag: weighted(rand, TAGS)});
    at += length + Math.round(-Math.log(1 - rand()) * 1.6 * HOUR) + 600;
  }
  const waiting = Math.floor(rows.length / 2);
  rows[waiting] = {...rows[waiting], status: "approval required", reason_tag: "waiting_for_coverage"};
  return rows;
}

// A Nightly builds the last merge before its cron, and none is started when nothing was
// merged since the previous one.
function nightlies(rand, mergeList) {
  const list = [];
  let lastPush = 0;
  for (let day = FIRST_S - DAY; day < NOW_S; day += DAY) {
    for (const hour of [10, 22]) {
      const started = day + hour * HOUR + between(rand, -60, 60);
      if (started > JOBS_UNTIL_S) continue;
      const merge = mergeList.findLast(({merged_s}) => merged_s <= started - 120);
      if (!merge || merge.merged_s === lastPush) continue;
      const pushed = merge.merged_s;
      lastPush = pushed;
      const failed = rand() < 0.06;
      const published = started + between(rand, 100 * 60, 190 * 60);
      list.push({
        decision_id: taskId(rand),
        last_task_id: taskId(rand),
        started_s: started,
        pushed_s: pushed,
        failed,
        published_s: failed || published > WATERMARKS.fxci_until_s ? null : published
      });
    }
  }
  return list;
}

// The last merge is just after the newest Nightly that the job table has: what landed
// before it waits for the next Nightly, and what lands after it is not merged yet.
const LAST_MERGE_S = NOW_S - Math.round(13.5 * HOUR);

function merges(rand) {
  const list = [];
  for (let day = FIRST_S; day < LAST_MERGE_S; day += DAY) {
    const weekday = new Date(day * 1000).getUTCDay();
    const count = weekday === 0 || weekday === 6 ? between(rand, 0, 1) : between(rand, 4, 7);
    for (let index = 0; index < count; index++) {
      const merged = day + between(rand, 3 * HOUR, 23 * HOUR);
      if (merged < LAST_MERGE_S - HOUR) list.push({merged_s: merged, central_rev: revision(rand), merged_by: pick(rand, SHERIFFS)});
    }
  }
  list.push({merged_s: LAST_MERGE_S, central_rev: revision(rand), merged_by: pick(rand, SHERIFFS)});
  return list.sort((a, b) => a.merged_s - b.merged_s);
}

function overlap(closures, from, to) {
  let seconds = 0;
  for (const {start_s, end_s, status} of closures) {
    if (status !== "closed" || end_s <= from || start_s >= to) continue;
    seconds += Math.min(end_s, to) - Math.max(start_s, from);
  }
  return seconds;
}

function closureEnd(closures, at) {
  const closure = closures.find(({start_s, end_s, status}) => status === "closed" && start_s <= at && at < end_s);
  return closure ? closure.end_s : at;
}

function journeys(rand, closures, nightlyList, mergeList) {
  const rows = [];
  let revisionId = 340000;
  for (let day = FIRST_S; day < NOW_S; day += DAY) {
    const weekday = new Date(day * 1000).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const jobs = weekend ? between(rand, 8, 35) : between(rand, 110, 180);
    for (let index = 0; index < jobs; index++) {
      const requested = day + (weekend ? between(rand, 0, DAY - 1) : between(rand, 6 * HOUR, DAY - 1));
      if (requested > WATERMARKS.lando_until_s) continue;
      const jobId = 80000 + rows.length;
      const stack = weighted(rand, STACK_SIZES);
      const resumed = closureEnd(closures, requested);
      const started = resumed + between(rand, 40, 400);
      const landed = started + between(rand, 40, 140);
      const pushed = landed + between(rand, 8, 40);
      const pushVisible = landed <= WATERMARKS.commit_maps_until_s && pushed <= WATERMARKS.treeherder_until_s;
      const merge = pushVisible ? mergeList.find(({merged_s}) => merged_s >= pushed + 60) : null;
      const merged = merge && merge.merged_s <= WATERMARKS.treeherder_until_s ? merge : null;
      const nightly = merged ? nightlyList.find(({failed, pushed_s}) => !failed && pushed_s >= merged.merged_s) : null;
      const backoutAt = pushVisible && rand() < 0.07 ? pushed + between(rand, 600, 5 * HOUR) : null;
      const backedOut = backoutAt !== null && backoutAt <= JOBS_UNTIL_S;
      const autolandRev = pushVisible ? revision(rand) : null;
      const failedAttempts = rand() < 0.07 ? between(rand, 1, 3) : 0;
      const requester = pick(rand, PEOPLE);
      const backoutBy = backedOut ? pick(rand, SHERIFFS) : null;
      const bug = 1900000 + between(rand, 0, 99999);
      for (let position = 0; position < stack; position++) {
        const created = requested - between(rand, HOUR, 10 * DAY);
        rows.push({
          revision_id: revisionId++,
          bug_id: rand() < 0.01 ? null : rand() < 0.7 ? bug : 1900000 + between(rand, 0, 99999),
          job_id: jobId,
          stack_size: stack,
          stack_index: position,
          requested_by: requester,
          failed_attempts: failedAttempts,
          autoland_rev: autolandRev,
          central_rev: merged ? merged.central_rev : null,
          merged_by: merged ? merged.merged_by : null,
          phab_created_s: created,
          phab_approved_s: rand() < 0.04 ? null : requested - between(rand, 600, 2 * DAY),
          land_requested_s: requested,
          lando_started_s: started <= WATERMARKS.lando_until_s ? started : null,
          autoland_pushed_s: pushVisible ? pushed : null,
          merged_s: merged ? merged.merged_s : null,
          nightly_started_s: nightly ? nightly.started_s : null,
          nightly_published_s: nightly ? nightly.published_s : null,
          nightly_decision_id: nightly ? nightly.decision_id : null,
          nightly_last_task_id: nightly && nightly.published_s ? nightly.last_task_id : null,
          queue_closed_s: started <= WATERMARKS.lando_until_s ? overlap(closures, requested, started) : null,
          autoland_closed_s: merged ? overlap(closures, pushed, merged.merged_s) : null,
          backed_out: backedOut,
          backout_by: backoutBy,
          backout_s: backedOut ? backoutAt : null,
          ...WATERMARKS
        });
      }
    }
  }
  return rows.sort((a, b) => a.land_requested_s - b.land_requested_s || a.revision_id - b.revision_id);
}

// What the real query finds for most closures: the pushes that were backed out, each
// with its backout. It has its own stream, so that it leaves the rest of the data as it was.
function withBackouts(closures) {
  const rand = random(11);
  return closures.map((closure) => {
    const pairs = closure.status === "closed" && rand() < 0.83 ? Array.from({length: between(rand, 1, 3)}, () => `${revision(rand)}:${revision(rand)}`) : [];
    return {...closure, backouts: pairs.join(" ")};
  });
}

// The commit of each landing, in git and in hg, which only exists in hg once it is on autoland.
// It has its own stream, so that it leaves the rest of the data as it was.
function withCommits(rows) {
  const rand = random(13);
  return rows.map((row) => ({...row, git_rev: revision(rand), hg_rev: row.autoland_rev ? revision(rand) : null}));
}

// When the CI of the push on autoland and of its merge to main completed. A push has one
// duration for all the landings it carried, and what the source has not recorded yet is not
// there. It has its own stream, so that it leaves the rest of the data as it was.
function withCi(rows) {
  const rand = random(17);
  const durations = new Map();
  const durationOf = (rev, low, high) => {
    if (!durations.has(rev)) durations.set(rev, between(rand, low, high));
    return durations.get(rev);
  };
  const recorded = (done) => Math.min(done, WATERMARKS.treeherder_until_s);
  return rows.map((row) => ({
    ...row,
    autoland_ci_done_s: row.autoland_rev ? recorded(row.autoland_pushed_s + durationOf(row.autoland_rev, 50 * 60, 4 * HOUR)) : null,
    central_ci_done_s: row.central_rev ? recorded(row.merged_s + durationOf(row.central_rev, 90 * 60, 21 * HOUR)) : null
  }));
}

let cached;
function everything() {
  if (!cached) {
    const rand = random(7);
    const closures = treeClosures(rand);
    const mergeList = merges(rand);
    const nightlyList = nightlies(rand, mergeList);
    cached = {
      "nightly-journeys": withCi(withCommits(journeys(rand, closures, nightlyList, mergeList))),
      "nightly-treestatus": withBackouts(closures)
    };
  }
  return cached;
}

export const NIGHTLY_TABLES = {
  "nightly-journeys": () => everything()["nightly-journeys"],
  "nightly-treestatus": () => everything()["nightly-treestatus"]
};

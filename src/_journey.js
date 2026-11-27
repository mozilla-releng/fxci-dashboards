// The journey of a landing from "Land" to the Nightly that ships it, and the rules about
// what counts: stage durations, status, cohorts and the freshness of each source. Free of
// imports, so the unit tests can load it.

// Percentiles over the landings that are done would drop the slow ones, so a tile only
// counts landings that had time to finish. 48 hours is more than land to publish takes
// for 99 of 100 landings.
export const PUBLISH_HORIZON_S = 48 * 3600;
export const UNMATCHED_AFTER_S = 7 * 86400;

const STAGES = [
  ["queue", "landoStarted"],
  ["lando", "pushed"],
  ["autoland", "merged"],
  ["waiting", "nightlyStarted"],
  ["build", "published"]
];

export const STAGE_INFO = [
  {key: "queue", title: "Lando queue", color: "#6fbf8e"},
  {key: "lando", title: "Lando landing", color: "#237a4b"},
  {key: "autoland", title: "On autoland until merged to main", color: "#e0902c"},
  {key: "waiting", title: "Merged to main until the Nightly starts", color: "#cf5b82"},
  {key: "build", title: "Nightly build and publish", color: "#5b6abf"}
];

// The Lando queue is told apart by whether the tree was closed, which is what held up
// most of a long wait.
export const CANDLE_SEGMENTS = [
  {key: "queueOpen", title: "Lando queue", color: "#6fbf8e"},
  {key: "queueClosed", title: "Lando queue, while autoland was closed", color: "#e07b7b"},
  {key: "lando", title: "Lando landing", color: "#237a4b"},
  {key: "autolandCi", title: "CI on autoland", color: "#c46a10"},
  {key: "autoland", title: "On autoland, after its CI, until merged to main", color: "#f0c27a"},
  {key: "mainCi", title: "CI on main, until the Nightly starts", color: "#b5365e"},
  {key: "waiting", title: "Merged to main, after its CI, until the Nightly starts", color: "#eba9bd"},
  {key: "build", title: "Nightly build and publish", color: "#5b6abf"}
];

const between = (later, earlier) => (later == null || earlier == null ? null : later - earlier);

export function quantile(values, share) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const at = (sorted.length - 1) * share;
  const below = Math.floor(at);
  return sorted[below] + (at - below) * ((sorted[below + 1] ?? sorted[below]) - sorted[below]);
}

export function journeyOf(row) {
  return {
    revision: row.revision_id,
    bug: row.bug_id,
    job: row.job_id,
    stack: {size: row.stack_size, index: row.stack_index},
    requester: row.requested_by ?? "unknown",
    failedAttempts: row.failed_attempts,
    gitRev: row.git_rev,
    hgRev: row.hg_rev,
    autolandRev: row.autoland_rev,
    centralRev: row.central_rev,
    mergedBy: row.merged_by,
    phabCreated: row.phab_created_s,
    phabApproved: row.phab_approved_s,
    requested: row.land_requested_s,
    landoStarted: row.lando_started_s,
    pushed: row.autoland_pushed_s,
    merged: row.merged_s,
    autolandCiDone: row.autoland_ci_done_s,
    centralCiDone: row.central_ci_done_s,
    nightlyStarted: row.nightly_started_s,
    published: row.nightly_published_s,
    decisionId: row.nightly_decision_id,
    lastTaskId: row.nightly_last_task_id,
    queueClosed: row.queue_closed_s,
    autolandClosed: row.autoland_closed_s,
    backedOut: row.backed_out,
    backoutBy: row.backout_by,
    backout: row.backout_s
  };
}

export function durationsOf(journey) {
  return {
    queue: between(journey.landoStarted, journey.requested),
    lando: between(journey.pushed, journey.landoStarted),
    autoland: between(journey.merged, journey.pushed),
    waiting: between(journey.nightlyStarted, journey.merged),
    build: between(journey.published, journey.nightlyStarted),
    ciAutoland: between(journey.autolandCiDone, journey.pushed),
    ciMain: between(journey.centralCiDone, journey.merged),
    total: between(journey.published, journey.requested)
  };
}

export function statusOf(journey, {landoUntil}) {
  if (journey.backedOut) return "backed out";
  if (journey.published !== null) return "shipped";
  return landoUntil - journey.requested > UNMATCHED_AFTER_S ? "unmatched" : "in flight";
}

export const inCohort = (journey, untilS, horizonS) => journey.requested <= untilS - horizonS;

export function parseRevision(text) {
  const match = /^\s*D?(\d{1,9})\s*$/i.exec(text ?? "");
  return match ? Number(match[1]) : null;
}

const REVISION_START = /^[0-9a-f]{6,40}$/;

// A landing matches when each word of the query is in its D number, its bug or its
// requester, or starts one of its revisions: the commit that landed, in git and in hg,
// and the pushes it went through on autoland and on main.
export function matchesQuery(journey, query) {
  const label = `d${journey.revision}`;
  const revisions = [journey.gitRev, journey.hgRev, journey.autolandRev, journey.centralRev].map((rev) => rev ?? "");
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(
      (term) =>
        label.includes(term) ||
        String(journey.bug ?? "").includes(term) ||
        journey.requester.toLowerCase().includes(term) ||
        (REVISION_START.test(term) && revisions.some((rev) => rev.startsWith(term)))
    );
}

const STAGE_ORDER = STAGES.map(([stage]) => stage);
const OPEN_ENDS = {queue: "landoUntil", lando: "commitMapsUntil", autoland: "treeherderUntil", waiting: "treeherderUntil", build: "fxciUntil"};

// The stages a landing went through, each from where it began to where it ended, and where
// the journey ends: when a Nightly publishes it, at its backout, or, for a landing still
// on its way, at what the source of its next event has recorded, which is not the present.
// A stage that began at or after that end is left out, and `open` is a stage that is still
// going on at the end.
export function spansOf(journey, marks) {
  const bounds = [journey.requested, journey.landoStarted, journey.pushed, journey.merged, journey.nightlyStarted, journey.published];
  const openAt = bounds.indexOf(null);
  let end;
  let kind = "open";
  if (journey.backedOut) {
    end = journey.backout;
    kind = "backed out";
  } else if (openAt === -1) {
    end = journey.published;
    kind = "shipped";
  } else {
    const watermark = marks[OPEN_ENDS[STAGE_ORDER[openAt - 1]]];
    end = Math.max(watermark ?? bounds[openAt - 1], bounds[openAt - 1]);
  }
  const spans = STAGE_ORDER.flatMap((key, index) => {
    const start = bounds[index];
    if (start === null || start >= end) return [];
    return [{key, start, end: Math.min(bounds[index + 1] ?? end, end), open: kind === "open" && bounds[index + 1] === null}];
  });
  return {spans, end, kind};
}

const backoutKindOf = (journey) => (journey.merged !== null && journey.backout >= journey.merged ? "backed out on main" : "backed out on autoland");

// What a landing's bar is made of, in seconds, and how it ends. The Lando queue is told
// apart by whether the tree was closed, the time on autoland and the time after the merge
// by whether the CI of the push was still going on, and a backout by whether the landing
// had been merged to main by then.
export function candleOf(journey, marks) {
  const {spans, end, kind: spansKind} = spansOf(journey, marks);
  const kind = spansKind === "backed out" ? backoutKindOf(journey) : spansKind;
  const seconds = (stage) => {
    const span = spans.find(({key}) => key === stage);
    return span ? span.end - span.start : 0;
  };
  const queueClosed = Math.min(journey.queueClosed ?? 0, seconds("queue"));
  const inCi = (stage, doneAt) => {
    const span = spans.find(({key}) => key === stage);
    return span && doneAt !== null ? Math.min(span.end - span.start, Math.max(0, doneAt - span.start)) : 0;
  };
  const autolandCi = inCi("autoland", journey.autolandCiDone);
  const mainCi = inCi("waiting", journey.centralCiDone);
  return {
    segments: {
      queueOpen: seconds("queue") - queueClosed,
      queueClosed,
      lando: seconds("lando"),
      autolandCi,
      autoland: seconds("autoland") - autolandCi,
      mainCi,
      waiting: seconds("waiting") - mainCi,
      build: seconds("build")
    },
    total: end - journey.requested,
    end,
    kind
  };
}

export function formatDuration(seconds) {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole} s`;
  const minutes = Math.round(whole / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function watermarksOf(rows) {
  const [first] = rows;
  return {
    landoUntil: first?.lando_until_s ?? null,
    treeherderUntil: first?.treeherder_until_s ?? null,
    fxciUntil: first?.fxci_until_s ?? null,
    commitMapsUntil: first?.commit_maps_until_s ?? null
  };
}

export function mergesOf(journeys) {
  const merges = new Map();
  for (const {centralRev, merged, mergedBy, centralCiDone} of journeys) {
    if (centralRev === null || merged === null) continue;
    const merge = merges.get(centralRev) ?? {rev: centralRev, merged, by: mergedBy, ciDone: centralCiDone, landed: 0};
    merge.landed += 1;
    merges.set(centralRev, merge);
  }
  return [...merges.values()].sort((a, b) => a.merged - b.merged);
}

export function nightliesOf(journeys) {
  const nightlies = new Map();
  for (const {decisionId, nightlyStarted, published} of journeys) {
    if (decisionId === null || nightlyStarted === null) continue;
    const nightly = nightlies.get(decisionId) ?? {decisionId, started: nightlyStarted, published, landed: 0};
    if (published !== null) nightly.landed += 1;
    nightlies.set(decisionId, nightly);
  }
  return [...nightlies.values()].sort((a, b) => a.started - b.started);
}

// What went on while the tree was closed from startS to endS: the revisions that asked to
// land and the longest they waited in the Lando queue, and the ones backed out.
export function closureSummary(journeys, startS, endS) {
  const requested = journeys.filter(({requested: at}) => at >= startS && at < endS);
  const waits = requested.map((journey) => between(journey.landoStarted, journey.requested)).filter((wait) => wait !== null);
  const backedOut = [...new Set(journeys.filter(({backedOut: out, backout}) => out && backout >= startS && backout < endS).map(({revision}) => revision))];
  return {requested: requested.length, longestWait: waits.length ? Math.max(...waits) : null, backedOut};
}

// The pushes to autoland that a closure was most likely about, each with the push that
// backed it out when that is known, from the space separated "broken:backout" pairs of the
// tree status query.
export function parseBackouts(text) {
  return (text ?? "")
    .split(/\s+/)
    .map((pair) => pair.split(":"))
    .filter(([broken]) => broken)
    .map(([broken, fix]) => ({broken, fix: fix ?? ""}));
}

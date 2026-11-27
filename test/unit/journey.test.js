import assert from "node:assert/strict";
import {describe, test} from "node:test";
import {
  candleOf,
  CANDLE_SEGMENTS,
  closureSummary,
  durationsOf,
  formatDuration,
  inCohort,
  journeyOf,
  matchesQuery,
  mergesOf,
  nightliesOf,
  parseBackouts,
  parseRevision,
  PUBLISH_HORIZON_S,
  quantile,
  spansOf,
  STAGE_INFO,
  statusOf,
  UNMATCHED_AFTER_S,
  watermarksOf
} from "../../src/_journey.js";
import {HOUR, row, T0} from "../fixtures/journey-rows.js";

describe("quantile", () => {
  test("is nothing for no value", () => {
    assert.equal(quantile([], 0.5), undefined);
  });

  test("is the value itself for one value", () => {
    assert.equal(quantile([7], 0.95), 7);
  });

  test("interpolates between the values, like d3.quantile", () => {
    assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
    assert.ok(Math.abs(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9) - 9.1) < 1e-9);
    assert.equal(quantile([1, 2, 3, 4], 0), 1);
    assert.equal(quantile([1, 2, 3, 4], 1), 4);
  });

  test("does not need the values sorted, and leaves them as they were", () => {
    const values = [4, 1, 3, 2];
    assert.equal(quantile(values, 0.5), 2.5);
    assert.deepEqual(values, [4, 1, 3, 2]);
  });

  test("ignores a value that is not there", () => {
    assert.equal(quantile([1, null, 3, undefined, NaN], 0.5), 2);
  });
});

describe("journeyOf", () => {
  test("names what the row holds", () => {
    const journey = journeyOf(row());
    assert.equal(journey.revision, 345001);
    assert.equal(journey.bug, 2022026);
    assert.equal(journey.job, 85061);
    assert.equal(journey.requester, "alice");
    assert.equal(journey.requested, T0);
    assert.equal(journey.published, T0 + 10 * HOUR);
    assert.equal(journey.stack.size, 2);
    assert.equal(journey.stack.index, 1);
    assert.equal(journey.backedOut, false);
  });

  test("keeps a stage that has not happened as null", () => {
    const journey = journeyOf(row({merged_s: null, nightly_started_s: null, nightly_published_s: null, central_rev: null}));
    assert.equal(journey.merged, null);
    assert.equal(journey.published, null);
  });

  test("calls a requester that is not known by a name, so a search can still read it", () => {
    assert.equal(journeyOf(row({requested_by: null})).requester, "unknown");
  });
});

describe("durationsOf", () => {
  test("measures each stage between its two moments", () => {
    const durations = durationsOf(journeyOf(row()));
    assert.equal(durations.queue, 300);
    assert.equal(durations.lando, 120);
    assert.equal(durations.autoland, 6 * HOUR - 420);
    assert.equal(durations.waiting, 2 * HOUR);
    assert.equal(durations.build, 2 * HOUR);
    assert.equal(durations.total, 10 * HOUR);
  });

  test("measures the CI of the push from the push, and of the merge from the merge", () => {
    const durations = durationsOf(journeyOf(row()));
    assert.equal(durations.ciAutoland, 2 * HOUR);
    assert.equal(durations.ciMain, 3 * HOUR);
    const unrecorded = durationsOf(journeyOf(row({autoland_ci_done_s: null, merged_s: null, central_ci_done_s: null})));
    assert.equal(unrecorded.ciAutoland, null);
    assert.equal(unrecorded.ciMain, null);
  });

  test("has no duration for a stage that did not end, nor for one that did not begin", () => {
    const durations = durationsOf(journeyOf(row({merged_s: null, nightly_started_s: null, nightly_published_s: null})));
    assert.equal(durations.queue, 300);
    assert.equal(durations.autoland, null);
    assert.equal(durations.waiting, null);
    assert.equal(durations.build, null);
    assert.equal(durations.total, null);
  });
});

describe("statusOf", () => {
  const marks = {landoUntil: T0 + 30 * 86400};

  test("is shipped once a Nightly has published it", () => {
    assert.equal(statusOf(journeyOf(row()), marks), "shipped");
  });

  test("is backed out whatever else happened, because the backout ends its journey", () => {
    assert.equal(statusOf(journeyOf(row({backed_out: true, backout_by: "sheriff-b", backout_s: T0 + HOUR})), marks), "backed out");
  });

  test("is in flight while a stage is yet to come", () => {
    const journey = journeyOf(row({land_requested_s: marks.landoUntil - 2 * 86400, nightly_published_s: null}));
    assert.equal(statusOf(journey, marks), "in flight");
  });

  test("is unmatched when nothing came of it for more than 7 days", () => {
    const old = (seconds) => journeyOf(row({land_requested_s: marks.landoUntil - seconds, merged_s: null, nightly_started_s: null, nightly_published_s: null}));
    assert.equal(statusOf(old(UNMATCHED_AFTER_S), marks), "in flight");
    assert.equal(statusOf(old(UNMATCHED_AFTER_S + 1), marks), "unmatched");
  });
});

describe("inCohort", () => {
  test("keeps the landings that had the whole horizon to finish", () => {
    const until = T0;
    assert.equal(inCohort({requested: until - PUBLISH_HORIZON_S}, until, PUBLISH_HORIZON_S), true);
    assert.equal(inCohort({requested: until - PUBLISH_HORIZON_S + 1}, until, PUBLISH_HORIZON_S), false);
  });
});

describe("watermarksOf", () => {
  test("reads the newest row of each source", () => {
    const marks = watermarksOf([row()]);
    assert.equal(marks.landoUntil, T0 + 30 * 86400);
    assert.equal(marks.treeherderUntil, T0 + 30 * 86400 + 4 * HOUR);
    assert.equal(marks.fxciUntil, T0 + 30 * 86400 + 11 * HOUR);
    assert.equal(marks.commitMapsUntil, T0 + 30 * 86400 - HOUR);
  });
});

describe("mergesOf", () => {
  test("lists each merge to main once, whatever number of revisions it carried", () => {
    const journeys = [
      journeyOf(row({revision_id: 1, central_rev: "x"})),
      journeyOf(row({revision_id: 2, central_rev: "x"})),
      journeyOf(row({revision_id: 3, central_rev: "y", merged_s: T0 + 9 * HOUR}))
    ];
    assert.deepEqual(mergesOf(journeys).map(({rev, merged}) => [rev, merged]), [["x", T0 + 6 * HOUR], ["y", T0 + 9 * HOUR]]);
  });

  test("gives when the CI of each merge completed", () => {
    const journeys = [journeyOf(row({central_rev: "x", central_ci_done_s: T0 + 9 * HOUR})), journeyOf(row({central_rev: "y", merged_s: T0 + 9 * HOUR, central_ci_done_s: null}))];
    assert.deepEqual(mergesOf(journeys).map(({rev, ciDone}) => [rev, ciDone]), [["x", T0 + 9 * HOUR], ["y", null]]);
  });

  test("counts the revisions each merge carried", () => {
    const journeys = [
      journeyOf(row({revision_id: 1, central_rev: "x"})),
      journeyOf(row({revision_id: 2, central_rev: "x"})),
      journeyOf(row({revision_id: 3, central_rev: "y", merged_s: T0 + 9 * HOUR}))
    ];
    assert.deepEqual(mergesOf(journeys).map(({rev, landed}) => [rev, landed]), [["x", 2], ["y", 1]]);
  });

  test("leaves out the landings that are not merged yet", () => {
    assert.deepEqual(mergesOf([journeyOf(row({central_rev: null, merged_s: null}))]), []);
  });
});

describe("nightliesOf", () => {
  test("lists each Nightly once, when it started, with the revisions it published", () => {
    const journeys = [
      journeyOf(row({revision_id: 1, nightly_decision_id: "late", nightly_started_s: T0 + 9 * HOUR})),
      journeyOf(row({revision_id: 2, nightly_decision_id: "early"})),
      journeyOf(row({revision_id: 3, nightly_decision_id: "early"})),
      journeyOf(row({revision_id: 4, nightly_decision_id: "late", nightly_started_s: T0 + 9 * HOUR, nightly_published_s: null}))
    ];
    assert.deepEqual(nightliesOf(journeys).map(({decisionId, started, landed}) => [decisionId, started, landed]), [
      ["early", T0 + 8 * HOUR, 2],
      ["late", T0 + 9 * HOUR, 1]
    ]);
  });

  test("leaves out the landings that no Nightly has started on", () => {
    assert.deepEqual(nightliesOf([journeyOf(row({nightly_decision_id: null, nightly_started_s: null, nightly_published_s: null}))]), []);
  });
});

describe("the stages", () => {
  test("have a title and a colour each, in the order of the journey", () => {
    assert.deepEqual(STAGE_INFO.map(({key}) => key), ["queue", "lando", "autoland", "waiting", "build"]);
    assert.ok(STAGE_INFO.every(({title, color}) => title && /^#[0-9a-f]{6}$/i.test(color)));
    assert.equal(new Set(STAGE_INFO.map(({color}) => color)).size, STAGE_INFO.length);
  });
});

describe("parseRevision", () => {
  test("reads a D number, with or without the D", () => {
    assert.equal(parseRevision("D343744"), 343744);
    assert.equal(parseRevision("d343744"), 343744);
    assert.equal(parseRevision("343744"), 343744);
    assert.equal(parseRevision(" D343744 "), 343744);
  });

  test("reads nothing else", () => {
    for (const text of [null, undefined, "", "D", "Dabc", "12ab", "D1 D2", "-5", "D99999999999"]) assert.equal(parseRevision(text), null, String(text));
  });
});

describe("matchesQuery", () => {
  const journey = journeyOf(row({revision_id: 343744, bug_id: 2022026, requested_by: "Alice", git_rev: "a311ac37c550d7cc", hg_rev: "9f0e1d2c3b4a5968", autoland_rev: "31dcede4f177", central_rev: "c64776bf9a03"}));

  test("finds a landing by its D number, with or without the D", () => {
    assert.equal(matchesQuery(journey, "D343744"), true);
    assert.equal(matchesQuery(journey, "343744"), true);
    assert.equal(matchesQuery(journey, "d3437"), true);
    assert.equal(matchesQuery(journey, "D343745"), false);
  });

  test("finds a landing by its bug or its requester", () => {
    assert.equal(matchesQuery(journey, "2022026"), true);
    assert.equal(matchesQuery(journey, "ali"), true);
  });

  test("finds a landing by the start of its git or hg revision, or of its pushes", () => {
    assert.equal(matchesQuery(journey, "a311ac3"), true);
    assert.equal(matchesQuery(journey, "9f0e1d2c3b4a5968"), true);
    assert.equal(matchesQuery(journey, "31dcede"), true);
    assert.equal(matchesQuery(journey, "c64776"), true);
    assert.equal(matchesQuery(journey, "A311AC3"), true);
  });

  test("does not find a revision by its middle, or by too few characters", () => {
    assert.equal(matchesQuery(journey, "dcede"), false);
    assert.equal(matchesQuery(journey, "311ac3"), false);
    assert.equal(matchesQuery(journey, "c647"), false);
  });

  test("wants every word to match", () => {
    assert.equal(matchesQuery(journey, "alice 2022026"), true);
    assert.equal(matchesQuery(journey, "alice 1"), false);
    assert.equal(matchesQuery(journey, "alice bob"), false);
  });

  test("matches everything for an empty query, and copes with what is missing", () => {
    assert.equal(matchesQuery(journey, ""), true);
    assert.equal(matchesQuery(journey, "   "), true);
    const bare = journeyOf(row({bug_id: null, git_rev: null, hg_rev: null, autoland_rev: null, central_rev: null}));
    assert.equal(matchesQuery(bare, "zzz"), false);
    assert.equal(matchesQuery(bare, "abcdef"), false);
    assert.equal(matchesQuery(bare, "345001"), true);
  });
});

describe("the candle segments", () => {
  test("go from what happens first to what happens last", () => {
    assert.deepEqual(CANDLE_SEGMENTS.map(({key}) => key), ["queueOpen", "queueClosed", "lando", "autolandCi", "autoland", "mainCi", "waiting", "build"]);
    assert.ok(CANDLE_SEGMENTS.every(({title, color}) => title && /^#[0-9a-f]{6}$/i.test(color)));
    assert.equal(new Set(CANDLE_SEGMENTS.map(({color}) => color)).size, CANDLE_SEGMENTS.length);
  });
});

describe("candleOf", () => {
  const marks = {landoUntil: T0 + 30 * 86400, treeherderUntil: T0 + 30 * 86400 - 5 * HOUR, fxciUntil: T0 + 30 * 86400 - 11 * HOUR, commitMapsUntil: T0 + 30 * 86400 - HOUR};
  const candle = (overrides = {}) => candleOf(journeyOf(row(overrides)), marks);
  const sum = (segments) => Object.values(segments).reduce((total, seconds) => total + seconds, 0);

  test("stacks every stage up to the publication for a landing that shipped", () => {
    const {segments, total, end, kind} = candle();
    assert.deepEqual(segments, {queueOpen: 300, queueClosed: 0, lando: 120, autolandCi: 2 * HOUR, autoland: 4 * HOUR - 420, mainCi: 2 * HOUR, waiting: 0, build: 2 * HOUR});
    assert.equal(kind, "shipped");
    assert.equal(end, T0 + 10 * HOUR);
    assert.equal(total, 10 * HOUR);
    assert.equal(sum(segments), total);
  });

  test("splits the Lando queue into what waited for the tree to open and the rest", () => {
    const {segments} = candle({queue_closed_s: 200});
    assert.equal(segments.queueOpen, 100);
    assert.equal(segments.queueClosed, 200);
  });

  test("does not count more closed time than the Lando queue lasted", () => {
    const {segments, total} = candle({queue_closed_s: 99999});
    assert.equal(segments.queueClosed, 300);
    assert.equal(segments.queueOpen, 0);
    assert.equal(sum(segments), total);
  });

  test("ends a backed out landing at its backout, and drops what came after", () => {
    const {segments, kind, end, total} = candle({backed_out: true, backout_by: "sheriff-b", backout_s: T0 + 5 * HOUR});
    assert.equal(kind, "backed out on autoland");
    assert.equal(end, T0 + 5 * HOUR);
    assert.equal(segments.mainCi + segments.waiting, 0);
    assert.equal(segments.build, 0);
    assert.equal(segments.autolandCi + segments.autoland, 5 * HOUR - 420);
    assert.equal(sum(segments), total);
  });

  test("tells a backout after the merge to main from one before it", () => {
    const backout = (at) => candle({backed_out: true, backout_by: "sheriff-b", backout_s: at}).kind;
    assert.equal(backout(T0 + 6 * HOUR - 1), "backed out on autoland");
    assert.equal(backout(T0 + 6 * HOUR), "backed out on main");
    assert.equal(backout(T0 + 9 * HOUR), "backed out on main");
    const unmerged = candle({backed_out: true, backout_by: "sheriff-b", backout_s: T0 + 5 * HOUR, merged_s: null, nightly_started_s: null, nightly_published_s: null});
    assert.equal(unmerged.kind, "backed out on autoland");
  });

  test("cuts the stage that a backout interrupted", () => {
    const {segments, total} = candle({backed_out: true, backout_by: "sheriff-b", backout_s: T0 + 9 * HOUR});
    assert.equal(segments.mainCi + segments.waiting, 2 * HOUR);
    assert.equal(segments.build, HOUR);
    assert.equal(sum(segments), total);
  });

  test("splits the time on autoland into its CI and the wait after it", () => {
    const {segments, total} = candle({autoland_ci_done_s: T0 + 3 * HOUR});
    assert.equal(segments.autolandCi, 3 * HOUR - 420);
    assert.equal(segments.autoland, 3 * HOUR);
    assert.equal(sum(segments), total);
  });

  test("splits the time after the merge into the CI on main and the wait after it", () => {
    const {segments, total} = candle({central_ci_done_s: T0 + 7 * HOUR});
    assert.equal(segments.mainCi, HOUR);
    assert.equal(segments.waiting, HOUR);
    assert.equal(sum(segments), total);
  });

  test("does not count CI that went on after its stage ended", () => {
    const late = candle({autoland_ci_done_s: T0 + 9 * HOUR, central_ci_done_s: T0 + 40 * HOUR});
    assert.equal(late.segments.autolandCi, 6 * HOUR - 420);
    assert.equal(late.segments.autoland, 0);
    assert.equal(late.segments.mainCi, 2 * HOUR);
    assert.equal(late.segments.waiting, 0);
    assert.equal(sum(late.segments), late.total);
  });

  test("counts it all as waiting when no CI was recorded", () => {
    const {segments, total} = candle({autoland_ci_done_s: null, central_ci_done_s: null});
    assert.equal(segments.autolandCi + segments.mainCi, 0);
    assert.equal(segments.autoland, 6 * HOUR - 420);
    assert.equal(segments.waiting, 2 * HOUR);
    assert.equal(sum(segments), total);
  });

  test("runs a landing in flight up to what its next event's source has recorded", () => {
    const waiting = candle({nightly_started_s: null, nightly_published_s: null, nightly_decision_id: null});
    assert.equal(waiting.kind, "open");
    assert.equal(waiting.end, marks.treeherderUntil);
    assert.equal(waiting.segments.mainCi + waiting.segments.waiting, marks.treeherderUntil - (T0 + 6 * HOUR));
    assert.equal(waiting.segments.build, 0);
    assert.equal(sum(waiting.segments), waiting.total);

    const queued = candle({lando_started_s: null, autoland_pushed_s: null, merged_s: null, nightly_started_s: null, nightly_published_s: null});
    assert.equal(queued.end, marks.landoUntil);
    assert.equal(queued.segments.queueOpen + queued.segments.queueClosed, marks.landoUntil - T0);
    assert.equal(sum(queued.segments), queued.total);

    const building = candle({nightly_published_s: null});
    assert.equal(building.end, marks.fxciUntil);
    assert.equal(building.segments.build, marks.fxciUntil - (T0 + 8 * HOUR));
  });

  test("never ends before the stage began, when its source is behind", () => {
    const behind = candleOf(journeyOf(row({lando_started_s: T0 + 300, autoland_pushed_s: null, merged_s: null, nightly_started_s: null, nightly_published_s: null})), {...marks, commitMapsUntil: T0 + 100});
    assert.equal(behind.end, T0 + 300);
    assert.equal(behind.segments.lando, 0);
    assert.equal(sum(behind.segments), behind.total);
  });
});

describe("spansOf", () => {
  const marks = {landoUntil: T0 + 30 * 86400, treeherderUntil: T0 + 30 * 86400 - 5 * HOUR, fxciUntil: T0 + 30 * 86400 - 11 * HOUR, commitMapsUntil: T0 + 30 * 86400 - HOUR};
  const spans = (overrides = {}) => spansOf(journeyOf(row(overrides)), marks);

  test("lists the stages a landing went through, each beginning where the last ended", () => {
    const {spans: list, end, kind} = spans();
    assert.deepEqual(list.map(({key}) => key), ["queue", "lando", "autoland", "waiting", "build"]);
    for (let index = 1; index < list.length; index++) assert.equal(list[index].start, list[index - 1].end);
    assert.equal(list[0].start, T0);
    assert.equal(list.at(-1).end, end);
    assert.equal(kind, "shipped");
    assert.ok(list.every(({open}) => !open));
  });

  test("stops at the stage a landing is in, and draws it up to what is recorded", () => {
    const {spans: list, kind} = spans({nightly_started_s: null, nightly_published_s: null});
    assert.deepEqual(list.map(({key}) => key), ["queue", "lando", "autoland", "waiting"]);
    assert.equal(kind, "open");
    assert.equal(list.at(-1).open, true);
    assert.equal(list.at(-1).end, marks.treeherderUntil);
    assert.ok(list.slice(0, -1).every(({open}) => !open));
  });

  test("cuts the stage that a backout interrupted, and leaves out the ones after it", () => {
    const {spans: list, end} = spans({backed_out: true, backout_by: "sheriff-b", backout_s: T0 + 9 * HOUR});
    assert.deepEqual(list.map(({key}) => key), ["queue", "lando", "autoland", "waiting", "build"]);
    assert.equal(list.at(-1).end, T0 + 9 * HOUR);
    assert.equal(end, T0 + 9 * HOUR);
    assert.ok(list.every(({open}) => !open));
    assert.deepEqual(spans({backed_out: true, backout_by: "sheriff-b", backout_s: T0 + 5 * HOUR}).spans.map(({key}) => key), ["queue", "lando", "autoland"]);
  });

  test("leaves out a stage that has not begun when its source is behind", () => {
    const behind = spansOf(journeyOf(row({lando_started_s: T0 + 300, autoland_pushed_s: null, merged_s: null, nightly_started_s: null, nightly_published_s: null})), {...marks, commitMapsUntil: T0 + 100});
    assert.deepEqual(behind.spans.map(({key}) => key), ["queue"]);
  });
});

describe("formatDuration", () => {
  test("says seconds, minutes, or hours and minutes", () => {
    assert.deepEqual([0, 59, 60, 90, 3599, 3600, 11940, 70 * 3600 + 300].map(formatDuration), ["0 s", "59 s", "1 min", "2 min", "1 h 0 min", "1 h 0 min", "3 h 19 min", "70 h 5 min"]);
  });
});

describe("closureSummary", () => {
  const at = (overrides) => journeyOf(row(overrides));
  const journeys = [
    at({revision_id: 1, land_requested_s: T0 - 1800, lando_started_s: T0 - 1800 + 60, autoland_pushed_s: T0 - 1800 + 120, autoland_rev: "before"}),
    at({revision_id: 2, land_requested_s: T0 + HOUR, lando_started_s: T0 + 3 * HOUR, autoland_pushed_s: T0 + 2 * HOUR + 1800, autoland_rev: "during-a"}),
    at({revision_id: 3, land_requested_s: T0 + 2 * HOUR, lando_started_s: T0 + 3 * HOUR, autoland_pushed_s: T0 + 2 * HOUR + 2400, autoland_rev: "during-b"}),
    at({revision_id: 4, land_requested_s: T0 - 5 * HOUR, lando_started_s: T0 - 5 * HOUR + 60, autoland_pushed_s: T0 - 5 * HOUR + 120, autoland_rev: "long-before", backed_out: true, backout_by: "sheriff-a", backout_s: T0 + 2 * HOUR}),
    at({revision_id: 5, land_requested_s: T0 + 9 * HOUR, lando_started_s: T0 + 9 * HOUR + 60, autoland_pushed_s: T0 + 9 * HOUR + 120, autoland_rev: "after"})
  ];
  const closed = [T0, T0 + 3 * HOUR];

  test("counts the revisions that asked to land during it, and the longest wait of them", () => {
    const summary = closureSummary(journeys, ...closed);
    assert.equal(summary.requested, 2);
    assert.equal(summary.longestWait, 2 * HOUR);
  });

  test("lists the revisions that were backed out during it, once each", () => {
    const stack = [...journeys, at({revision_id: 4, backed_out: true, backout_by: "sheriff-a", backout_s: T0 + 2 * HOUR})];
    assert.deepEqual(closureSummary(stack, ...closed).backedOut, [4]);
  });

  test("has nothing to say about a closure that nothing happened in", () => {
    assert.deepEqual(closureSummary(journeys, T0 + 20 * HOUR, T0 + 21 * HOUR), {requested: 0, longestWait: null, backedOut: []});
  });

  test("does not count a wait for a landing that has not left the Lando queue", () => {
    const unpushed = [at({autoland_rev: null, autoland_pushed_s: null, land_requested_s: T0 + HOUR, lando_started_s: null})];
    const summary = closureSummary(unpushed, ...closed);
    assert.equal(summary.requested, 1);
    assert.equal(summary.longestWait, null);
  });
});

describe("parseBackouts", () => {
  test("pairs each push that was backed out with its backout", () => {
    assert.deepEqual(parseBackouts("aaa:bbb ccc:ddd"), [{broken: "aaa", fix: "bbb"}, {broken: "ccc", fix: "ddd"}]);
  });

  test("is nothing for a closure without any", () => {
    assert.deepEqual(parseBackouts(""), []);
    assert.deepEqual(parseBackouts(null), []);
  });

  test("keeps a push whose backout is not known, and leaves out a backout without its push", () => {
    assert.deepEqual(parseBackouts("aaa: :bbb ccc:ddd"), [{broken: "aaa", fix: ""}, {broken: "ccc", fix: "ddd"}]);
  });
});

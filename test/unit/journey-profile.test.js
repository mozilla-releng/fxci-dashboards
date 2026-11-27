import assert from "node:assert/strict";
import {describe, test} from "node:test";
import {journeyOf} from "../../src/_journey.js";
import {journeyProfile} from "../../src/_journey-profile.js";
import {HOUR, row, T0} from "../fixtures/journey-rows.js";

const marks = {landoUntil: T0 + 30 * 86400, treeherderUntil: T0 + 30 * 86400 - 5 * HOUR, fxciUntil: T0 + 30 * 86400 - 11 * HOUR, commitMapsUntil: T0 + 30 * 86400 - HOUR};
const profileOf = (overrides = {}, {closures = []} = {}) => journeyProfile(journeyOf(row(overrides)), {marks, closures});

const INVISIBLE = /[​-‍⁠-⁤⁪-⁭]/g;
const strings = (profile, thread, column) => profile.threads[thread].markers[column].map((value) => (column === "name" ? profile.shared.stringArray[value].replace(INVISIBLE, "") : value));
const rowsOf = (profile, thread) => strings(profile, thread, "name").filter((name) => name !== "Clock (UTC)");
const dataOf = (profile, thread, name) => profile.threads[thread].markers.data.filter((_, index) => strings(profile, thread, "name")[index] === name);

describe("journeyProfile", () => {
  test("has a track for the journey, one for the tree status and one for the events", () => {
    assert.deepEqual(profileOf().threads.map(({name}) => name), ["Journey", "Autoland tree status", "Events"]);
  });

  test("is well formed: every column as long as its table, every name a string that exists", () => {
    const profile = profileOf({}, {closures: [{start_s: T0 + HOUR, end_s: T0 + 2 * HOUR, status: "closed", reason_tag: "checkin_test"}]});
    for (const {markers} of profile.threads) {
      for (const column of ["name", "startTime", "endTime", "phase", "category", "data"]) assert.equal(markers[column].length, markers.length, column);
      assert.ok(markers.name.every((index) => typeof profile.shared.stringArray[index] === "string"));
    }
  });

  test("has a row for the review, the approval and each stage of a landing that shipped, in order", () => {
    assert.deepEqual(rowsOf(profileOf(), 0), [
      "Review",
      "Approved, until Land",
      "Lando queue",
      "Lando landing",
      "On autoland until merged to main",
      "Merged to main until the Nightly starts",
      "Nightly build and publish"
    ]);
  });

  test("has no row for a review that is not known", () => {
    const rows = rowsOf(profileOf({phab_created_s: null, phab_approved_s: null}), 0);
    assert.equal(rows[0], "Lando queue");
    assert.ok(!rows.includes("Review"));
  });

  test("has no row for a review that was not approved", () => {
    assert.ok(!rowsOf(profileOf({phab_approved_s: null}), 0).includes("Approved, until Land"));
  });

  test("has no row for an approval that came after Land, since when it was approved before is not known", () => {
    const rows = rowsOf(profileOf({phab_approved_s: T0 + HOUR}), 0);
    assert.ok(!rows.includes("Review"));
    assert.ok(!rows.includes("Approved, until Land"));
    assert.equal(rows[0], "Lando queue");
  });

  test("stops at the stage of a landing that is in flight, and says it is so far", () => {
    const profile = profileOf({nightly_started_s: null, nightly_published_s: null, nightly_build_id: null});
    const rows = rowsOf(profile, 0);
    assert.equal(rows.at(-1), "Merged to main until the Nightly starts");
    assert.match(dataOf(profile, 0, "Merged to main until the Nightly starts")[0].label, /so far/);
    assert.ok(!rows.includes("Nightly build and publish"));
  });

  test("says how long each stage took", () => {
    const profile = profileOf();
    assert.equal(dataOf(profile, 0, "Lando queue")[0].took, "5 min");
    assert.equal(dataOf(profile, 0, "Nightly build and publish")[0].took, "2 h 0 min");
  });

  test("ends a backed out landing at its backout, with the backout among the events", () => {
    const profile = profileOf({backed_out: true, backout_by: "sheriff-b", backout_s: T0 + 5 * HOUR});
    assert.deepEqual(rowsOf(profile, 0).slice(-3), ["Lando queue", "Lando landing", "On autoland until merged to main"]);
    assert.ok(rowsOf(profile, 2).includes("Backed out"));
    assert.match(dataOf(profile, 2, "Backed out")[0].label, /sheriff-b/);
    assert.ok(!rowsOf(profile, 2).includes("Merged to main"));
  });

  test("marks the events of a landing that shipped, in the order they happened", () => {
    assert.deepEqual(rowsOf(profileOf(), 2), ["Land requested", "Merged to main", "Nightly started", "Nightly published"]);
  });

  test("shows only the closures of the tree that overlap the journey", () => {
    const closures = [
      {start_s: T0 - 5 * HOUR, end_s: T0 - 4 * HOUR, status: "closed", reason_tag: "checkin_test"},
      {start_s: T0 + HOUR, end_s: T0 + 2 * HOUR, status: "closed", reason_tag: "checkin_compilation"},
      {start_s: T0 + 40 * HOUR, end_s: T0 + 41 * HOUR, status: "closed", reason_tag: "infra"},
      {start_s: T0 + 8 * HOUR, end_s: T0 + 9 * HOUR, status: "approval required", reason_tag: "waiting_for_coverage"}
    ];
    const profile = profileOf({}, {closures});
    assert.deepEqual(rowsOf(profile, 1), ["Autoland closed", "Autoland: approval required"]);
    const [closed] = dataOf(profile, 1, "Autoland closed");
    assert.match(closed.label, /checkin compilation/);
    assert.equal(closed.took, "1 h 0 min");
  });

  test("counts a closure that has not ended up to the end of the journey", () => {
    const profile = profileOf({}, {closures: [{start_s: T0 + 8 * HOUR, end_s: null, status: "closed", reason_tag: null}]});
    assert.equal(dataOf(profile, 1, "Autoland closed")[0].took, "2 h 0 min");
  });

  test("starts when the review did, but not more than two days before Land, or an hour before it without a review", () => {
    assert.equal(profileOf({phab_created_s: T0 - 86400}).meta.startTime, (T0 - 86400) * 1000);
    assert.equal(profileOf({phab_created_s: T0 - 10 * 86400}).meta.startTime, (T0 - 2 * 86400) * 1000);
    assert.equal(profileOf({phab_created_s: null, phab_approved_s: null}).meta.startTime, (T0 - HOUR) * 1000);
  });

  test("is titled with the revision and its bug", () => {
    assert.match(profileOf().meta.product, /D345001/);
    assert.match(profileOf().meta.product, /bug 2022026/);
    assert.ok(!/bug/.test(profileOf({bug_id: null}).meta.product));
  });
});

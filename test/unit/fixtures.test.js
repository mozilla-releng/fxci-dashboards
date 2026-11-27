import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {after, before, describe, test} from "node:test";
import {load} from "js-yaml";
import {makeFixtures} from "../../scripts/make-fixtures.js";
import {rowsToParquet} from "../../src/data/_parquet.js";
import {checkShape} from "../../src/data/_shape.js";

const NAMES = ["nightly-journeys", "nightly-treestatus"];

describe("the fixtures of the Ship to Nightly queries", () => {
  const entries = {};
  const tables = {};
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "fxci-fixtures-"));
    makeFixtures(dir);
    const registry = load(readFileSync(new URL("../../src/data/_queries.yaml", import.meta.url), "utf8"));
    for (const name of NAMES) {
      entries[name] = registry.find((query) => query.name === name);
      tables[name] = JSON.parse(readFileSync(join(dir, `${entries[name].queryId}.json`), "utf8"));
    }
  });

  after(() => rmSync(dir, {recursive: true, force: true}));

  test("keep the promises the registry makes about each query", () => {
    for (const name of NAMES) checkShape(entries[name], tables[name]);
  });

  test("have a value in every column, so that Parquet can type it, and encode as Parquet", () => {
    for (const name of NAMES) {
      for (const column of Object.keys(tables[name][0])) {
        assert.ok(tables[name].some((row) => row[column] !== null), `${name}.${column} is empty in every row`);
      }
      assert.ok(rowsToParquet(tables[name]).length > 0);
    }
  });

  test("have columns that only the registry lists", () => {
    for (const name of NAMES) {
      const registered = [...entries[name].columns].sort();
      assert.deepEqual(Object.keys(tables[name][0]).sort(), registered, `${name}: the fixture and the registry disagree about the columns`);
    }
  });

  test("hold no email address", () => {
    for (const name of NAMES) assert.ok(!JSON.stringify(tables[name]).includes("@"), name);
  });

  describe("of the journeys", () => {
    const journeys = () => tables["nightly-journeys"];

    test("have one row for each revision and landing job", () => {
      const keys = new Set(journeys().map((row) => `${row.revision_id}/${row.job_id}`));
      assert.equal(keys.size, journeys().length);
    });

    test("go through the stages in order", () => {
      const stages = ["land_requested_s", "lando_started_s", "autoland_pushed_s", "merged_s", "nightly_started_s", "nightly_published_s"];
      for (const row of journeys()) {
        const times = stages.map((stage) => row[stage]).filter((time) => time !== null);
        assert.deepEqual(times, [...times].sort((a, b) => a - b), `revision ${row.revision_id}`);
      }
    });

    test("have no stage later than what its source has recorded", () => {
      for (const row of journeys()) {
        if (row.lando_started_s !== null) assert.ok(row.lando_started_s <= row.lando_until_s);
        if (row.autoland_pushed_s !== null) assert.ok(row.autoland_pushed_s <= row.treeherder_until_s);
        if (row.merged_s !== null) assert.ok(row.merged_s <= row.treeherder_until_s);
        if (row.nightly_published_s !== null) assert.ok(row.nightly_published_s <= row.fxci_until_s);
      }
    });

    test("share the stages of a landing job between the revisions of its stack", () => {
      const first = new Map();
      for (const row of journeys()) {
        const reference = first.get(row.job_id) ?? first.set(row.job_id, row).get(row.job_id);
        for (const column of ["land_requested_s", "lando_started_s", "autoland_pushed_s", "merged_s", "requested_by"]) {
          assert.equal(row[column], reference[column], `job ${row.job_id} ${column}`);
        }
      }
    });

    test("count a closure only within a stage that has finished", () => {
      for (const row of journeys()) {
        assert.equal(row.queue_closed_s === null, row.lando_started_s === null);
        assert.equal(row.autoland_closed_s === null, row.merged_s === null);
        if (row.queue_closed_s !== null) assert.ok(row.queue_closed_s <= row.lando_started_s - row.land_requested_s);
        if (row.autoland_closed_s !== null) assert.ok(row.autoland_closed_s <= row.merged_s - row.autoland_pushed_s);
      }
    });

    test("give each landing its own commit, in hg only once it is on autoland", () => {
      const rows = journeys();
      const hash = /^[0-9a-f]{40}$/;
      assert.ok(rows.every((row) => hash.test(row.git_rev)));
      assert.equal(new Set(rows.map((row) => row.git_rev)).size, rows.length);
      for (const row of rows) assert.equal(row.hg_rev === null, row.autoland_rev === null, `revision ${row.revision_id}`);
      assert.ok(rows.filter((row) => row.hg_rev !== null).every((row) => hash.test(row.hg_rev)));
    });

    test("record the CI of a push and of its merge once it has started, the same for each landing it carried", () => {
      const rows = journeys();
      for (const row of rows) {
        assert.equal(row.autoland_ci_done_s === null, row.autoland_rev === null, `revision ${row.revision_id}`);
        assert.equal(row.central_ci_done_s === null, row.central_rev === null, `revision ${row.revision_id}`);
        if (row.autoland_ci_done_s !== null) assert.ok(row.autoland_ci_done_s >= row.autoland_pushed_s && row.autoland_ci_done_s <= row.treeherder_until_s);
        if (row.central_ci_done_s !== null) assert.ok(row.central_ci_done_s >= row.merged_s && row.central_ci_done_s <= row.treeherder_until_s);
      }
      const doneBy = new Map();
      for (const row of rows.filter((landing) => landing.central_rev)) {
        assert.equal(doneBy.get(row.central_rev) ?? row.central_ci_done_s, row.central_ci_done_s);
        doneBy.set(row.central_rev, row.central_ci_done_s);
      }
    });

    test("have a landing in every state the page shows", () => {
      const rows = journeys();
      const has = (name, test) => assert.ok(rows.some(test), `no row is ${name}`);
      has("shipped", (row) => row.nightly_published_s !== null && !row.backed_out);
      has("backed out", (row) => row.backed_out && row.backout_by !== null && row.backout_s !== null);
      has("relanded after a failed attempt", (row) => row.failed_attempts > 0);
      has("pushed but not merged yet", (row) => row.autoland_pushed_s !== null && row.merged_s === null);
      has("merged but waiting for a Nightly", (row) => row.merged_s !== null && row.nightly_started_s === null);
      has("landed in Lando but not on autoland yet", (row) => row.autoland_pushed_s === null);
      has("without a bug", (row) => row.bug_id === null);
      has("without an approval", (row) => row.phab_approved_s === null);
      has("in a stack", (row) => row.stack_size > 1);
      has("after a closure of the tree", (row) => row.queue_closed_s > 0);
    });

    test("cover about 90 days with some thousand landings", () => {
      const days = (Math.max(...journeys().map((row) => row.land_requested_s)) - Math.min(...journeys().map((row) => row.land_requested_s))) / 86400;
      assert.ok(days > 85 && days < 91, `${days} days`);
      assert.ok(journeys().length > 10000 && journeys().length < 30000, `${journeys().length} rows`);
    });
  });

  describe("of the tree closures", () => {
    test("do not overlap and are ordered", () => {
      const closures = tables["nightly-treestatus"];
      for (let index = 1; index < closures.length; index++) assert.ok(closures[index].start_s >= closures[index - 1].end_s);
      assert.ok(closures.every((row) => row.end_s > row.start_s));
      assert.ok(closures.some((row) => row.status === "approval required"));
    });

    test("list the backouts of most closures as pairs of revisions, and none for the others", () => {
      const closures = tables["nightly-treestatus"];
      const closed = closures.filter((row) => row.status === "closed");
      const traced = closed.filter((row) => row.backouts !== "");
      assert.ok(traced.length / closed.length > 0.7 && traced.length < closed.length, `${traced.length} of ${closed.length}`);
      assert.ok(traced.every((row) => row.backouts.split(" ").every((pair) => /^[0-9a-f]{40}:[0-9a-f]{40}$/.test(pair))));
      assert.ok(closures.filter((row) => row.status !== "closed").every((row) => row.backouts === ""));
    });
  });
});

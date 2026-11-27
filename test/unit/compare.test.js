import assert from "node:assert/strict";
import {describe, test} from "node:test";
import {apartLibraries, diffFacts, markdownTable, median, overBudget, percentile} from "../perf/compare.js";

const FACTS = {charts: 12, tiles: [["Backfill requests", "260"]], libs: {d3: "7.9.2"}};

describe("diffFacts", () => {
  test("finds nothing between identical facts", () => {
    assert.deepEqual(diffFacts(FACTS, structuredClone(FACTS)), []);
  });

  test("names the path of a changed number", () => {
    const actual = structuredClone(FACTS);
    actual.charts = 13;
    assert.deepEqual(diffFacts(FACTS, actual), [{path: "charts", expected: 12, actual: 13}]);
  });

  test("names the path of a changed value inside an array", () => {
    const actual = structuredClone(FACTS);
    actual.tiles[0][1] = "261";
    assert.deepEqual(diffFacts(FACTS, actual), [{path: "tiles.0.1", expected: "260", actual: "261"}]);
  });

  test("finds a missing and an added key", () => {
    const actual = {...structuredClone(FACTS), extra: 1};
    delete actual.libs;
    const paths = diffFacts(FACTS, actual).map(({path}) => path);
    assert.deepEqual(paths.sort(), ["extra", "libs"]);
  });

  test("finds an array that became shorter", () => {
    const actual = structuredClone(FACTS);
    actual.tiles = [];
    assert.deepEqual(diffFacts(FACTS, actual), [{path: "tiles.0", expected: ["Backfill requests", "260"], actual: undefined}]);
  });

  test("tells an array from an object", () => {
    assert.equal(diffFacts({a: []}, {a: {}}).length, 1);
  });
});

describe("apartLibraries", () => {
  test("sets the differences of the libraries apart from those of the page", () => {
    const actual = structuredClone(FACTS);
    actual.libs.d3 = "7.9.3";
    actual.charts = 13;
    const {libraries, facts} = apartLibraries(diffFacts(FACTS, actual));
    assert.deepEqual(libraries.map(({path}) => path), ["libs.d3"]);
    assert.deepEqual(facts.map(({path}) => path), ["charts"]);
  });

  test("counts a list of libraries that is gone as a difference of the libraries", () => {
    const actual = structuredClone(FACTS);
    delete actual.libs;
    assert.deepEqual(apartLibraries(diffFacts(FACTS, actual)).libraries.map(({path}) => path), ["libs"]);
  });

  test("does not take a fact whose name starts with libs for a library", () => {
    const {libraries, facts} = apartLibraries([{path: "libsonly", expected: 1, actual: 2}]);
    assert.deepEqual([libraries.length, facts.length], [0, 1]);
  });
});

describe("overBudget", () => {
  test("passes what is at or under its ceiling", () => {
    assert.deepEqual(overBudget({ready_ms: 100, hover_ms: 5}, {ready_ms: 100, hover_ms: 1}), []);
  });

  test("reports what is over", () => {
    assert.deepEqual(overBudget({ready_ms: 100}, {ready_ms: 101}), [{metric: "ready_ms", value: 101, ceiling: 100}]);
  });

  test("counts a metric that was not measured as over", () => {
    assert.equal(overBudget({ready_ms: 100}, {}).length, 1);
    assert.equal(overBudget({ready_ms: 100}, {ready_ms: NaN}).length, 1);
  });
});

describe("statistics", () => {
  test("percentile and median", () => {
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
    assert.ok(Number.isNaN(percentile([], 0.5)));
  });
});

describe("markdownTable", () => {
  test("rounds numbers to one decimal", () => {
    assert.equal(markdownTable(["a", "b"], [["x", 1.234]]), "| a | b |\n| --- | --- |\n| x | 1.2 |");
  });
});

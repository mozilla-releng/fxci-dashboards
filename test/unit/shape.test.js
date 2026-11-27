import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {describe, test} from "node:test";
import {load} from "js-yaml";
import {checkShape} from "../../src/data/_shape.js";

describe("checkShape", () => {
  const entry = {name: "demo", columns: ["a", "b"], minRows: 2};

  test("accepts rows that have every column and are enough", () => {
    checkShape(entry, [{a: 1, b: null}, {a: 2, b: 3}]);
  });

  test("rejects fewer rows than the query must have, naming the query and both numbers", () => {
    assert.throws(() => checkShape(entry, [{a: 1, b: 2}]), /demo: 1 row.*2/);
  });

  test("rejects a missing column, naming it", () => {
    assert.throws(() => checkShape(entry, [{a: 1}, {a: 2}]), /demo.*\bb\b/);
  });

  test("names every missing column", () => {
    assert.throws(() => checkShape(entry, [{c: 1}, {c: 2}]), /a, b/);
  });

  test("accepts any rows for a query that promises nothing", () => {
    checkShape({name: "plain"}, []);
    checkShape({name: "plain"}, [{anything: 1}]);
  });

  test("rejects an empty result for a query that lists columns, since it has none to read", () => {
    assert.throws(() => checkShape({name: "demo", columns: ["a"]}, []), /demo: 0 rows.*1/);
  });
});

describe("the registry of queries", () => {
  const registry = load(readFileSync(new URL("../../src/data/_queries.yaml", import.meta.url), "utf8"));
  const deploy = readFileSync(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");

  test("passes the secret of every query to the build step of the deploy", () => {
    for (const {name, secretEnv} of registry) {
      assert.match(deploy, new RegExp(`${secretEnv}: \\$\\{\\{ secrets\\.${secretEnv} \\}\\}`), `${name}: ${secretEnv} is not passed to the build in deploy.yml`);
    }
  });

  test("gives every query its own name, id and secret", () => {
    for (const key of ["name", "queryId", "secretEnv"]) {
      const values = registry.map((entry) => entry[key]);
      assert.equal(new Set(values).size, values.length, `two queries share a ${key}`);
    }
  });

  test("lists the columns and the least rows of the Ship to Nightly queries", () => {
    for (const name of ["nightly-journeys", "nightly-treestatus"]) {
      const entry = registry.find((query) => query.name === name);
      assert.ok(entry, `${name} is not in the registry`);
      assert.ok(entry.columns?.length > 0, `${name} lists no columns`);
      assert.ok(entry.minRows > 0, `${name} has no least number of rows`);
    }
  });
});

import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, test} from "node:test";
import {fetchRows} from "../../src/data/_stmo.js";

const VARS = ["STMO_FIXTURES_DIR", "QUICK_DEPLOYED_BY", "REDASH_API_KEY", "REDASH_API_KEY_TEST"];

describe("fetchRows", () => {
  let dir;
  let saved;

  beforeEach(async () => {
    saved = Object.fromEntries(VARS.map((name) => [name, process.env[name]]));
    for (const name of VARS) delete process.env[name];
    dir = await mkdtemp(join(tmpdir(), "stmo-fixtures-"));
  });

  afterEach(async () => {
    for (const name of VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    await rm(dir, {recursive: true, force: true});
  });

  test("returns the rows of <dir>/<queryId>.json", async () => {
    await writeFile(join(dir, "42.json"), JSON.stringify([{a: 1}, {a: 2}]));
    process.env.STMO_FIXTURES_DIR = dir;
    assert.deepEqual(await fetchRows(42, "REDASH_API_KEY_TEST"), [{a: 1}, {a: 2}]);
  });

  test("returns no rows for a query without a fixture", async () => {
    process.env.STMO_FIXTURES_DIR = dir;
    assert.deepEqual(await fetchRows(43, "REDASH_API_KEY_TEST"), []);
  });

  test("needs no API key in fixture mode", async () => {
    await writeFile(join(dir, "42.json"), "[]");
    process.env.STMO_FIXTURES_DIR = dir;
    await assert.doesNotReject(fetchRows(42, "REDASH_API_KEY_TEST"));
  });

  test("refuses to run in a deploy, even with a fixture present", async () => {
    await writeFile(join(dir, "42.json"), "[]");
    process.env.STMO_FIXTURES_DIR = dir;
    process.env.QUICK_DEPLOYED_BY = "github:mozilla-releng/fxci-dashboards";
    await assert.rejects(fetchRows(42, "REDASH_API_KEY_TEST"), /must not be set in a deploy/);
  });

  test("rejects a fixture that is not an array of rows", async () => {
    await writeFile(join(dir, "42.json"), JSON.stringify({rows: []}));
    process.env.STMO_FIXTURES_DIR = dir;
    await assert.rejects(fetchRows(42, "REDASH_API_KEY_TEST"), /not an array of rows/);
  });

  test("rejects a fixture that is not JSON", async () => {
    await writeFile(join(dir, "42.json"), "not json");
    process.env.STMO_FIXTURES_DIR = dir;
    await assert.rejects(fetchRows(42, "REDASH_API_KEY_TEST"), SyntaxError);
  });

  test("still needs a key when fixture mode is off", async () => {
    await assert.rejects(fetchRows(42, "REDASH_API_KEY_TEST"), /Neither REDASH_API_KEY_TEST nor REDASH_API_KEY is set/);
  });
});

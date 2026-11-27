// The config the tests build with (test/perf/run.js): the real one, written to
// dist-ci so that a manual `quick deploy ./dist` can never pick up fixture data,
// and without the weekly task files of the archive queries, which only a Gantt
// click fetches at runtime.
import {readFileSync} from "node:fs";
import {load} from "js-yaml";
import config from "./observablehq.config.js";

const queries = load(readFileSync(new URL("./src/data/_queries.yaml", import.meta.url), "utf8"));

export default {
  ...config,
  output: "dist-ci",
  async *dynamicPaths() {
    for (const query of queries) if (!query.archive) yield `/data/${query.name}.parquet`;
  }
};

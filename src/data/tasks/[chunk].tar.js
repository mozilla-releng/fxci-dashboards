// Parameterized data loader -> builds data/tasks/<chunk>.tar for the per-run queries
// of _queries.yaml marked `archive`. Framework extracts the weekly Parquet files of
// the queues of the chunk from it, to data/tasks/<chunk>/<queue>-<week>.parquet.
import {parseArgs} from "node:util";
import {readFileSync} from "node:fs";
import {load} from "js-yaml";
import {fetchRows} from "../_stmo.js";
import {tasksTar} from "../_tasks.js";

const {
  values: {chunk}
} = parseArgs({options: {chunk: {type: "string"}}});

const queries = load(readFileSync(new URL("../_queries.yaml", import.meta.url), "utf8"));
const entry = queries.find((q) => q.name === `backfill-tasks-${chunk}`);
if (!entry) throw new Error(`No _queries.yaml entry named "backfill-tasks-${chunk}"`);

process.stdout.write(tasksTar(chunk, await fetchRows(entry.queryId, entry.secretEnv)));

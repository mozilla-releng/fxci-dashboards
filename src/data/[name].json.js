// Parameterized data loader -> builds data/<name>.json for any entry in
// _queries.yaml (see that file for the registry format and secret
// conventions). One loader file for every STMO-backed dashboard query:
// adding a query's data step is just adding a row to _queries.yaml, no new
// loader file needed.
import {parseArgs} from "node:util";
import {readFileSync} from "node:fs";
import {load} from "js-yaml";
import {fetchRows} from "./_stmo.js";

const {
  values: {name}
} = parseArgs({options: {name: {type: "string"}}});

const queries = load(readFileSync(new URL("./_queries.yaml", import.meta.url), "utf8"));
const entry = queries.find((q) => q.name === name);
if (!entry) throw new Error(`No _queries.yaml entry named "${name}"`);

const rows = await fetchRows(entry.queryId, entry.secretEnv);
process.stdout.write(JSON.stringify(rows));

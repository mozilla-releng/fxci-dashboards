// Data loader -> builds data/gecko2github-workerpool.json from a cached STMO
// query. Median clone time by worker pool, per vcs type. See _queries.md for
// the query registry.
import {fetchRows} from "./_stmo.js";

const QUERY_ID = 123299;

const rows = await fetchRows(QUERY_ID);
process.stdout.write(JSON.stringify(rows));

// Data loader -> builds data/gecko2github-gittasks.json from a cached STMO
// query. Per-task detail for gecko tasks checking out via git. See
// _queries.md for the query registry.
import {fetchRows} from "./_stmo.js";

const QUERY_ID = 123298;

const rows = await fetchRows(QUERY_ID);
process.stdout.write(JSON.stringify(rows));

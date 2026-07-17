// Data loader -> builds data/gecko2github-trend.json from a cached STMO query.
// Daily hg vs git VCS checkout time percentiles. See _queries.md for the query
// registry.
import {fetchRows} from "./_stmo.js";

const QUERY_ID = 123300;

const rows = await fetchRows(QUERY_ID);
process.stdout.write(JSON.stringify(rows));

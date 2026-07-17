// Shared helper for data loaders that read cached STMO (Redash) query results.
// Leading underscore keeps this out of Framework's page routing.
//
// Fetches the last SERVER-SIDE CACHED result for a query — it does not
// re-execute the query. Never call a Redash /refresh endpoint from a loader;
// that forces re-execution and defeats the point of reading the cache.
const REDASH = "https://sql.telemetry.mozilla.org";

export async function fetchRows(queryId) {
  const key = process.env.REDASH_API_KEY;
  if (!key) throw new Error("REDASH_API_KEY is not set");
  const res = await fetch(`${REDASH}/api/queries/${queryId}/results.json?api_key=${key}`);
  if (!res.ok) throw new Error(`STMO query ${queryId}: ${res.status} ${res.statusText}`);
  const body = await res.json();
  return body.query_result.data.rows;
}

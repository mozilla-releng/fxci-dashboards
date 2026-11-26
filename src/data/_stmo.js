// Shared helper for data loaders that read cached STMO (Redash) query results.
// Leading underscore keeps this out of Framework's page routing.
//
// Fetches the last SERVER-SIDE CACHED result for a query — it does not
// re-execute the query. Never call a Redash /refresh endpoint from a loader;
// that forces re-execution and defeats the point of reading the cache.
//
// Each query has its own Redash API key (scoped to that query's cached
// results only, nothing else) — callers pass the env var holding it rather
// than a single shared key, so one leaked/rotated key can't affect others.
// CI always sets the per-query var; for local dev, a personal REDASH_API_KEY
// works as a fallback so you don't need to fetch a key per query.
//
// The server builds a whole result before it sends it, about 0.08 s per MB of
// JSON, and closed one download 30 s in, in the middle of the body. A result of
// over about a million rows is within seconds of that, so keep queries below it,
// and retry a download that fails on the network, not one the server refuses.
const REDASH = "https://sql.telemetry.mozilla.org";
const ATTEMPTS = 3;

async function downloadRows(queryId, key) {
  const res = await fetch(`${REDASH}/api/queries/${queryId}/results.json?api_key=${key}`);
  if (!res.ok) throw new Error(`STMO query ${queryId}: ${res.status} ${res.statusText}`);
  const body = await res.json();
  return body.query_result.data.rows;
}

export async function fetchRows(queryId, envVar) {
  const key = process.env[envVar] ?? process.env.REDASH_API_KEY;
  if (!key) throw new Error(`Neither ${envVar} nor REDASH_API_KEY is set`);
  for (let attempt = 1; ; attempt++) {
    try {
      return await downloadRows(queryId, key);
    } catch (error) {
      if (!(error instanceof TypeError) || attempt === ATTEMPTS) throw error;
      console.error(`STMO query ${queryId}: attempt ${attempt} of ${ATTEMPTS} failed (${error.message}), retrying`);
    }
  }
}

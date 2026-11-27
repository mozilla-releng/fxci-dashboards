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
//
// With STMO_FIXTURES_DIR set, results come from <dir>/<queryId>.json instead (a
// missing file is an empty result), so a build needs no keys and no network. It
// is for tests only, so it refuses to run in a deploy (QUICK_DEPLOYED_BY is set
// by deploy.yml).
import {readFile} from "node:fs/promises";

const REDASH = "https://sql.telemetry.mozilla.org";
const ATTEMPTS = 3;

async function downloadRows(queryId, key) {
  const res = await fetch(`${REDASH}/api/queries/${queryId}/results.json?api_key=${key}`);
  if (!res.ok) throw new Error(`STMO query ${queryId}: ${res.status} ${res.statusText}`);
  const body = await res.json();
  return body.query_result.data.rows;
}

async function fixtureRows(dir, queryId) {
  if (process.env.QUICK_DEPLOYED_BY) throw new Error("STMO_FIXTURES_DIR must not be set in a deploy");
  let text;
  try {
    text = await readFile(`${dir}/${queryId}.json`, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error(`Fixture for STMO query ${queryId} is not an array of rows`);
  return rows;
}

export async function fetchRows(queryId, envVar) {
  if (process.env.STMO_FIXTURES_DIR) return fixtureRows(process.env.STMO_FIXTURES_DIR, queryId);
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

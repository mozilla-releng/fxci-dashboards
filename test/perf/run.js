// npm run test:perf [-- --record] [--browser firefox|chromium] [--repeat 3] [--skip-build]
//
// Builds the whole site from fixtures (scripts/make-fixtures.js), opens the
// pages of scenarios.js in a browser and compares what they show with
// expected.json, and what they cost with budgets.json. --record writes
// expected.json from this run instead.
import {spawnSync} from "node:child_process";
import {appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";
import {fileURLToPath} from "node:url";
import {chromium, firefox} from "playwright";
import {makeFixtures} from "../../scripts/make-fixtures.js";
import {frameCount, framesSince, hover, legend, openPage, pageFacts, pin, serve, settle, zoom} from "./browser.js";
import {apartLibraries, diffFacts, markdownTable, median, overBudget, percentile} from "./compare.js";
import {SCENARIOS} from "./scenarios.js";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUT = join(ROOT, "dist-ci");
const FIXTURES = join(ROOT, ".fixtures");
const RESULTS = join(ROOT, "perf-results");
const EXPECTED = join(ROOT, "test/perf/expected.json");
const BUDGETS = join(ROOT, "test/perf/budgets.json");
const CACHE_DATA = join(ROOT, "src/.observablehq/cache/data");
const STASH = `${CACHE_DATA}.real`;

const {values: options} = parseArgs({
  options: {
    record: {type: "boolean", default: false},
    browser: {type: "string", default: process.env.PERF_BROWSER ?? "firefox"},
    repeat: {type: "string", default: "3"},
    "skip-build": {type: "boolean", default: false}
  }
});

// The data loaders cache what they wrote under the cache's data directory and
// reuse it for as long as the loader file is unchanged, whatever the
// environment says. A build from fixtures must not reuse real data, nor leave
// its own for a build with real data, so the real cache is put aside meanwhile.
function stashCache() {
  if (existsSync(STASH)) throw new Error(`${STASH} is left from a run that died: move it back to ${CACHE_DATA}, or delete it, and run again`);
  if (existsSync(CACHE_DATA)) renameSync(CACHE_DATA, STASH);
}

function restoreCache() {
  rmSync(CACHE_DATA, {recursive: true, force: true});
  if (existsSync(STASH)) renameSync(STASH, CACHE_DATA);
}

function build() {
  rmSync(OUT, {recursive: true, force: true});
  const rows = makeFixtures(FIXTURES);
  console.log(`fixtures: ${JSON.stringify(rows)}`);
  const result = spawnSync("npx", ["observable", "build", "--config", "observablehq.ci.config.js"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {...process.env, STMO_FIXTURES_DIR: FIXTURES, OBSERVABLE_TELEMETRY_DISABLE: "1", NODE_USE_ENV_PROXY: "1"}
  });
  if (result.status !== 0) throw new Error(`The build failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
}

function libraries() {
  const npm = join(OUT, "_npm");
  const names = [...readdirSync(npm), ...readdirSync(join(npm, "@observablehq")).map((name) => `@observablehq/${name}`)];
  return names.filter((name) => /^(d3|htl|@observablehq\/plot|apache-arrow|parquet-wasm)@/.test(name)).sort();
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function runOnce(browser, origin, scenario, screenshot) {
  const {page, errors, started, close} = await openPage(browser, origin, scenario.path, scenario.stubs);
  try {
    await page.waitForSelector(scenario.charts, {state: "attached", timeout: 60000});
    const ready_ms = await settle(page, {root: scenario.root, since: started});
    const load = await pageFacts(page, scenario);
    if (screenshot) await page.screenshot({path: screenshot, fullPage: true});
    const loadFrames = await framesSince(page, 0);

    const interactionStart = await frameCount(page);
    const hovered = {};
    let hover_p95_ms = 0;
    for (const target of scenario.hover) {
      const {times, tooltips} = await hover(page, {selector: scenario.charts, index: target.chart, tooltip: scenario.tooltip});
      hovered[target.name] = {tooltips};
      hover_p95_ms = Math.max(hover_p95_ms, percentile(times, 0.95));
    }
    const pinned = await pin(page, {selector: scenario.charts, index: scenario.pin.chart, tooltip: scenario.tooltip, ring: scenario.ring});
    const legendUse = await legend(page, {root: scenario.root, ...scenario.legend});
    const zoomed = await zoom(page, {selector: scenario.charts, index: scenario.zoom.chart, from: scenario.zoom.from, to: scenario.zoom.to, root: scenario.root});
    const after = await pageFacts(page, scenario);
    const interactionFrames = await framesSince(page, interactionStart);

    return {
      facts: {load, hover: hovered, pin: pinned, legend: legendUse, zoom: {range: zoomed.range, ...after}, errors},
      timings: {
        ready_ms,
        hover_p95_ms,
        zoom_ms: zoomed.ms,
        frame_load_max_ms: Math.max(...loadFrames),
        frame_interact_max_ms: Math.max(...interactionFrames)
      }
    };
  } finally {
    await close();
  }
}

async function runScenario(browser, origin, scenario, repeat) {
  const runs = [];
  for (let attempt = 0; attempt < repeat; attempt++) {
    runs.push(await runOnce(browser, origin, scenario, attempt === 0 ? join(RESULTS, `${slug(scenario.name)}.png`) : null));
  }
  for (const [attempt, run] of runs.entries()) {
    const differences = diffFacts(runs[0].facts, run.facts);
    if (differences.length) throw new Error(`"${scenario.name}" showed different facts on run ${attempt + 1}: ${JSON.stringify(differences.slice(0, 5))}`);
  }
  const timings = Object.fromEntries(Object.keys(runs[0].timings).map((metric) => [metric, median(runs.map((run) => run.timings[metric]))]));
  return {facts: runs[0].facts, timings};
}

async function main() {
  const repeat = Number(options.repeat);
  const launcher = {firefox, chromium}[options.browser];
  if (!launcher) throw new Error(`Unknown browser "${options.browser}"`);
  mkdirSync(RESULTS, {recursive: true});

  const restore = () => restoreCache();
  process.on("SIGINT", () => (restore(), process.exit(130)));
  process.on("SIGTERM", () => (restore(), process.exit(143)));

  stashCache();
  let actual;
  const timings = {};
  try {
    if (!options["skip-build"]) build();
    const server = await serve(OUT);
    try {
      // Classic scrollbars take room from the page and overlay ones do not, which
      // would make the charts as wide as the platform decides. Overlay everywhere.
      const browser = await launcher.launch({headless: true, args: options.browser === "chromium" ? ["--hide-scrollbars"] : [], firefoxUserPrefs: {"ui.useOverlayScrollbars": 1}});
      try {
        actual = {libs: libraries(), scenarios: {}};
        for (const scenario of SCENARIOS) {
          const result = await runScenario(browser, server.origin, scenario, repeat);
          actual.scenarios[scenario.name] = result.facts;
          timings[scenario.name] = result.timings;
        }
      } finally {
        await browser.close();
      }
    } finally {
      await server.close();
    }
  } finally {
    restoreCache();
  }
  writeFileSync(join(RESULTS, "results.json"), `${JSON.stringify({browser: options.browser, repeat, facts: actual, timings}, null, 2)}\n`);

  const budgets = JSON.parse(readFileSync(BUDGETS, "utf8"));
  const rows = Object.entries(timings).flatMap(([scenario, values]) =>
    Object.entries(budgets).map(([metric, ceiling]) => [scenario, metric, values[metric], ceiling, values[metric] <= ceiling ? "ok" : "OVER"])
  );
  const table = markdownTable(["scenario", "metric", "median", "ceiling", ""], rows);
  console.log(`\n${table}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Perf checks (${options.browser}, median of ${repeat})\n\n${table}\n`);

  if (options.record) {
    const broken = ({errors, load, zoom, pin: pinned, legend: legendUse}) =>
      errors.length || load.inlineErrors || zoom.inlineErrors || !(pinned.found && pinned.stays && pinned.releasedByEscape && pinned.releasedByClick) || !legendUse.restored;
    const failing = Object.entries(actual.scenarios).filter(([, facts]) => broken(facts));
    if (failing.length) throw new Error(`Not recording a run with page errors, a tooltip that does not pin and release, or a legend that does not restore: ${failing.map(([name]) => name).join(", ")}`);
    writeFileSync(EXPECTED, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`Recorded ${EXPECTED}`);
    return 0;
  }

  const {libraries: otherLibraries, facts: differences} = apartLibraries(diffFacts(JSON.parse(readFileSync(EXPECTED, "utf8")), actual));
  for (const {path, expected, actual: found} of differences.slice(0, 40)) console.error(`facts differ at ${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(found)}`);
  if (otherLibraries.length) {
    const warning = `The build resolved other libraries than the recorded ones (${otherLibraries.map(({path, expected, actual: found}) => `${path}: ${JSON.stringify(expected)}, now ${JSON.stringify(found)}`).join("; ")}). That does not fail the run: if a count or a digest differs, look here first.`;
    console.warn(`warning: ${warning}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n> ${warning}\n`);
  }
  const over = Object.entries(timings).flatMap(([scenario, values]) => overBudget(budgets, values).map((entry) => ({scenario, ...entry})));
  for (const {scenario, metric, value, ceiling} of over) console.error(`over budget: ${scenario}: ${metric} ${value} > ${ceiling}`);
  return differences.length || over.length ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error.stack ?? error);
    process.exitCode = 1;
  }
);

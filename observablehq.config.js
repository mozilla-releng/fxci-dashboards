// See https://observablehq.com/framework/config for documentation.
import {readFileSync} from "node:fs";
import {load} from "js-yaml";

// Query registry (see src/data/_queries.yaml) — drives which data/<name>.json
// outputs the parameterized loader (src/data/[name].json.js) must produce.
const queries = load(readFileSync(new URL("./src/data/_queries.yaml", import.meta.url), "utf8"));

export default {
  // The app's title; used in the sidebar and webpage titles.
  title: "Firefox-CI Dashboards",

  // Enumerates the concrete data/<name>.json paths for the parameterized
  // loader — Framework can't discover these on its own since [name].json.js
  // matches no fixed path.
  async *dynamicPaths() {
    for (const q of queries) yield `/data/${q.name}.json`;
  },

  // The pages and sections in the sidebar. Add one entry per dashboard.
  pages: [
    {name: "Overview", path: "/"},
    {
      name: "VCS",
      open: true,
      pages: [
        {name: "Checkout Caches", path: "/checkout-caches"},
        {name: "Gecko2Github Migration", path: "/gecko2github"}
      ]
    }
  ],

  // Extra <head> content.
  head: `<meta name="description" content="Static dashboards for the Firefox-CI Taskcluster instance.">
  <link rel="icon" href="favicon.png" type="image/png" sizes="256x256">`,

  // The path to the source root.
  root: "src",

  // Compact, wide, grid-friendly look suited to dashboards.
  theme: "dashboard",

  header: `<div style="display:flex;align-items:center;gap:0.5rem;">
    <strong>Firefox-CI Dashboards</strong>
    <span style="opacity:0.6;">Metrics related to <a href="https://firefox-ci-tc.services.mozilla.com" target="_blank" rel="noopener" style="color:inherit;">firefox-ci-tc.services.mozilla.com</a></span>
  </div>`,

  footer: `<div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;">
    <span>Data refreshed periodically from STMO. See README for how to add a dashboard.</span>
    <a href="https://github.com/mozilla-releng/fxci-dashboards" target="_blank" rel="noopener" aria-label="GitHub repository" style="display:inline-flex;color:inherit;position:relative;z-index:2;">
      <svg viewBox="0 0 16 16" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path></svg>
    </a>
  </div>`,

  // Path to the output root for build.
  output: "dist",

  // Framework always writes pages as literal `<path>.html` files, but by
  // default generates internal links without the extension (relying on the
  // host to rewrite `/foo` -> `/foo.html`, as GitHub Pages does). Quick's
  // static server serves files literally, so keep the extension in links too.
  preserveExtension: true,

  toc: true,
  sidebar: true,
  search: true,

  // Dashboards aren't a linear doc flow, so the auto prev/next pager adds
  // noise rather than useful navigation.
  pager: false
};

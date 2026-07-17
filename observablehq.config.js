// See https://observablehq.com/framework/config for documentation.
export default {
  // The app's title; used in the sidebar and webpage titles.
  title: "Firefox-CI Dashboards",

  // The pages and sections in the sidebar. Add one entry per dashboard.
  pages: [
    {name: "Overview", path: "/"},
    {
      name: "VCS",
      open: true,
      pages: [{name: "Gecko2Github Migration", path: "/gecko2github"}]
    }
  ],

  // Extra <head> content.
  head: '<meta name="description" content="Static dashboards for the Firefox-CI Taskcluster instance.">',

  // The path to the source root.
  root: "src",

  // Compact, wide, grid-friendly look suited to dashboards.
  theme: "dashboard",

  header: `<div style="display:flex;align-items:center;gap:0.5rem;">
    <strong>Firefox-CI Dashboards</strong>
    <span style="opacity:0.6;">Taskcluster metrics — build-time snapshots</span>
  </div>`,

  footer: "Data refreshed periodically from STMO. See README for how to add a dashboard.",

  // Path to the output root for build.
  output: "dist",

  // Framework always writes pages as literal `<path>.html` files, but by
  // default generates internal links without the extension (relying on the
  // host to rewrite `/foo` -> `/foo.html`, as GitHub Pages does). Quick's
  // static server serves files literally, so keep the extension in links too.
  preserveExtension: true,

  toc: true,
  sidebar: true,
  search: true
};

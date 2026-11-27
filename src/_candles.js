// A chart with a bar per item at its time, stacked from what happened first to what
// happened last, and a dot at its top, which is the end-to-end time.
import * as d3 from "npm:d3";
import * as Plot from "npm:@observablehq/plot";
import {html} from "npm:htl";
import {dateAxis, MARGINS} from "./_time-charts.js";
import {attachPlotHover, nearestBar} from "./_tooltip.js";

// The scales come from `maxHours`, so that filtering the items does not rescale the
// chart, and what is taller than it is cut there. Segments hidden by the legend are left
// out and the others close ranks, so the dot is at the top of what is left. When some
// `highlighted` items are given, the others are dimmed and those are drawn again over them. The bars of a segment are one path, because
// the time the page takes to react to the pointer grows with the number of elements.
// `extraHit` finds what is under the pointer when no bar is, for what the chart draws
// besides the bars.
export function candleChart({
  items,
  segments,
  hidden,
  domain,
  width,
  height,
  maxHours,
  durationsOf = (item) => item.chain.durations,
  barWidth = 5,
  hitRadius = 8,
  tooltip,
  show,
  extraHit = null,
  highlighted = [],
  before = [],
  after = null,
  drawnHours = (item, topHours) => topHours(item)
}) {
  const visible = segments.filter(({key}) => !hidden.has(key));
  const topHours = (item) => Math.min(maxHours, d3.sum(visible, ({key}) => durationsOf(item)[key]) / 3600);
  const ends = visible.length ? items : [];
  const barsOf = (list) =>
    list.flatMap((item) => {
      let from = 0;
      return visible.flatMap(({key}) => {
        if (from >= maxHours) return [];
        const to = Math.min(maxHours, from + durationsOf(item)[key] / 3600);
        const bar = [
          {time: item.time, key, hours: from},
          {time: item.time, key, hours: to},
          {time: item.time, key, hours: null}
        ];
        from = to;
        return bar;
      });
    });
  const barOptions = {x: "time", y: "hours", z: "key", stroke: "key", strokeWidth: barWidth, strokeLinecap: "butt"};
  const dimmed = highlighted.length > 0;
  const plot = Plot.plot({
    width,
    height,
    marginTop: MARGINS.top,
    marginBottom: MARGINS.bottom,
    marginLeft: MARGINS.left,
    marginRight: MARGINS.right,
    x: dateAxis(domain, width),
    y: {domain: [0, maxHours * 1.05], grid: true, label: "hours"},
    color: {domain: segments.map(({key}) => key), range: segments.map(({color}) => color)},
    marks: [
      Plot.ruleY([0], {strokeOpacity: 0.3}),
      ...before,
      Plot.line(barsOf(items), {...barOptions, strokeOpacity: dimmed ? 0.2 : 1}),
      ...(dimmed ? [Plot.line(barsOf(highlighted), barOptions)] : []),
      ...(after ? after({topHours, ends}) : [Plot.dot(ends, {x: "time", y: topHours, r: 3, fill: "currentColor"})])
    ]
  });
  const x = plot.scale("x");
  const y = plot.scale("y");
  const points = ends.map((item) => ({item, x: x.apply(item.time), y: y.apply(drawnHours(item, topHours)), baseline: y.apply(0)}));
  attachPlotHover(tooltip, plot, (px, py) => nearestBar(points, px, py, {barWidth, hitRadius}) ?? extraHit?.(px, py) ?? null, show);
  return plot;
}

// From the top down, the way the bar reads. A segment may have a `link`, which makes
// the link to what it was about from the item, and goes at the end of its line, and a
// `note`, a line of its own under it for a part of it.
export const segmentLines = (segments, {durations, subject, format}) =>
  [...segments]
    .reverse()
    .filter(({applies}) => !applies || applies(subject))
    .flatMap(({key, title, color, link, note}) => {
      const anchor = link?.(subject);
      const line = html`<span class=${anchor ? "bw-tt-links" : null}><i class="bw-swatch" style="background:${color}"></i>${title}: <b>${format(durations[key] / 3600)}</b>${anchor ? [" ", anchor] : ""}</span>`;
      const detail = note?.(subject);
      return detail ? [line, detail] : [line];
    });

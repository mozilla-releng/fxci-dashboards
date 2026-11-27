// A chart with a bar per item at its time, stacked from what happened first to what
// happened last, and a dot at its top, which is the end-to-end time.
import * as d3 from "npm:d3";
import * as Plot from "npm:@observablehq/plot";
import {html} from "npm:htl";
import {dateAxis, MARGINS} from "./_time-charts.js";
import {attachPlotHover, nearestBar} from "./_tooltip.js";

// The scales come from `maxHours`, so that filtering the items does not rescale the
// chart. Segments hidden by the legend are left out and the others close ranks, so
// the dot is at the top of what is left.
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
  before = [],
  after = null,
  drawnHours = (item, topHours) => topHours(item)
}) {
  const visible = segments.filter(({key}) => !hidden.has(key));
  const topHours = (item) => d3.sum(visible, ({key}) => durationsOf(item)[key]) / 3600;
  const ends = visible.length ? items : [];
  const bars = items.flatMap((item) => {
    let from = 0;
    return visible.map(({key}) => {
      const to = from + durationsOf(item)[key] / 3600;
      const bar = {time: item.time, key, from, to};
      from = to;
      return bar;
    });
  });
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
      Plot.ruleX(bars, {x: "time", y1: "from", y2: "to", stroke: "key", strokeWidth: barWidth}),
      ...(after ? after({topHours, ends}) : [Plot.dot(ends, {x: "time", y: topHours, r: 3, fill: "currentColor"})])
    ]
  });
  const x = plot.scale("x");
  const y = plot.scale("y");
  const points = ends.map((item) => ({item, x: x.apply(item.time), y: y.apply(drawnHours(item, topHours)), baseline: y.apply(0)}));
  attachPlotHover(tooltip, plot, (px, py) => nearestBar(points, px, py, {barWidth, hitRadius}), show);
  return plot;
}

// From the top down, the way the bar reads.
export const segmentLines = (segments, {durations, subject, format}) =>
  [...segments]
    .reverse()
    .filter(({applies}) => !applies || applies(subject))
    .map(({key, title, color}) => html`<span><i class="bw-swatch" style="background:${color}"></i>${title}: <b>${format(durations[key] / 3600)}</b></span>`);

// The numbers at the top of a page, each for the whole range and for each day of
// it, in tiles that share the time axis of the charts below.
import * as d3 from "npm:d3";
import * as Plot from "npm:@observablehq/plot";
import {html} from "npm:htl";
import {chartBox, DAY_MS, formatDay} from "./_time-charts.js";
import {attachPlotHover} from "./_tooltip.js";

const METRIC_HEIGHT = 84;
const METRIC_TOP = 18;
const METRIC_BOTTOM = 4;
const METRIC_GAP = 12;
const METRIC_MIN_WIDTH = 110;
const STYLE_ID = "bw-metrics-styles";

const STYLES = `
.bw-metrics {
  display: grid;
  gap: 0.75rem 12px;
  margin: 0.5rem 0 0;
}
.bw-metric-title {
  min-height: 3.6em;
  font-size: 0.8rem;
  line-height: 1.2;
  color: var(--theme-foreground-muted, #888);
}
.bw-metric-value {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.2;
}
.bw-metric-multi {
  display: flex;
  gap: 0.7rem;
  font-size: 0.95rem;
  line-height: 1.9;
  white-space: nowrap;
}
.bw-metric-multi small {
  font-size: 0.7rem;
  font-weight: 400;
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

export const countOf = (n, noun, plural = `${noun}s`) => `${n} ${n === 1 ? noun : plural}`;

function metricTile(metric, {items, domain, tileWidth, tooltip, timeOf, noun, eventRules}) {
  const days = d3.utcDay.range(domain[0], domain[1]);
  const byDay = d3.group(items, (item) => +d3.utcDay.floor(timeOf(item)));
  const perDay = days.map((day) => {
    const ofDay = byDay.get(+day) ?? [];
    return {day, items: ofDay, values: metric.series.map((series) => series.value(ofDay))};
  });
  const steps = [...perDay, {day: domain[1], items: [], values: perDay[perDay.length - 1]?.values ?? []}];
  const top = Math.max(d3.max(perDay, (entry) => d3.max(entry.values)) ?? 0, 1e-9) * 1.1;
  const single = metric.series.length === 1;
  const plot = Plot.plot({
    width: tileWidth,
    height: METRIC_HEIGHT,
    marginTop: METRIC_TOP,
    marginBottom: METRIC_BOTTOM,
    marginLeft: 0,
    marginRight: 0,
    x: {type: "utc", domain, axis: null},
    y: {domain: [0, top], axis: null},
    marks: [
      Plot.ruleY([0], {strokeOpacity: 0.3}),
      ...eventRules(domain),
      ...metric.series.flatMap(({color}, index) => {
        const options = {x: "day", y: (entry) => entry.values[index], curve: "step-after", defined: (entry) => entry.values[index] != null};
        return [
          ...(single ? [Plot.areaY(steps, {...options, fill: color, fillOpacity: 0.25})] : []),
          Plot.lineY(steps, {...options, stroke: color, strokeWidth: 1.2})
        ];
      })
    ]
  });
  const xScale = plot.scale("x");
  const find = (px, py) => {
    const index = Math.floor((+xScale.invert(px) - +domain[0]) / DAY_MS);
    return px >= 0 && px <= tileWidth && py >= METRIC_TOP && py <= METRIC_HEIGHT - METRIC_BOTTOM && index >= 0 && index < days.length ? {entry: perDay[index], x: px} : null;
  };
  const show = (event, {entry}) => {
    const line = (series, index) => {
      const value = entry.values[index];
      const text = value == null ? "–" : metric.format(value);
      return single
        ? html`<span>${metric.title}: <b>${text}</b></span>`
        : html`<span><i class="bw-swatch" style="background:${series.color}"></i>${series.title}: <b>${text}</b></span>`;
    };
    const content = html`<span><b>${formatDay(entry.day)}</b></span>
      ${metric.series.map(line)}
      ${metric.countless ? "" : html`<span class="bw-tt-pool">${countOf(entry.items.length, noun)}</span>`}`;
    if (tooltip.open(event, `${metric.key}:${+entry.day}`, content)) tooltip.hideRing();
  };
  attachPlotHover(tooltip, plot, find, show);
  const totalOf = (series) => {
    const {value, format} = metric.headline ?? {value: series.value, format: metric.format};
    const total = value(items, days.length);
    return total == null ? "–" : format(total);
  };
  const values = single
    ? html`<div class="bw-metric-value">${totalOf(metric.series[0])}</div>`
    : html`<div class="bw-metric-value bw-metric-multi">${metric.series.map((series) => html`<span style="color:${series.color}"><small>${series.title}</small> ${totalOf(series)}</span>`)}</div>`;
  return html`<div class="bw-metric" style="width:${tileWidth}px">
    <div class="bw-metric-title">${metric.title}</div>
    ${values}
    ${chartBox(plot, METRIC_HEIGHT, {left: 0, right: 0, top: METRIC_TOP, bottom: METRIC_BOTTOM, daily: true})}
  </div>`;
}

export function metricsRow({items, metrics, domain, width, tooltip, timeOf = (item) => item.time, noun = "item", eventRules = () => []}) {
  ensureStyles();
  const units = d3.sum(metrics, ({span = 1}) => span);
  const fits = (columns) => Math.floor((width - (columns - 1) * METRIC_GAP) / columns);
  const columns = d3.range(units, 0, -1).find((n) => fits(n) >= METRIC_MIN_WIDTH) ?? 1;
  const unitWidth = fits(columns);
  const widthOf = ({span = 1}) => Math.min(span, columns) * unitWidth + (Math.min(span, columns) - 1) * METRIC_GAP;
  return html`<div class="bw-metrics" style="grid-template-columns:repeat(${columns}, ${unitWidth}px)">${metrics.map((metric) => {
    const tile = metricTile(metric, {items, domain, tileWidth: widthOf(metric), tooltip, timeOf, noun, eventRules});
    tile.style.gridColumn = `span ${Math.min(metric.span ?? 1, columns)}`;
    return tile;
  })}</div>`;
}

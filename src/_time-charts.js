// What charts that share a time axis have in common: the axis, a box that tells
// where a chart's plot area is, a line at the pointer and a selection across all of
// them, and the markers of events.
import * as d3 from "npm:d3";
import * as Plot from "npm:@observablehq/plot";
import {html} from "npm:htl";

export const MARGINS = {top: 18, bottom: 22, left: 44, right: 40};
export const DAY_MS = 86400000;
export const formatDay = d3.utcFormat("%-d %b");
export const formatTime = d3.utcFormat("%-d %b %H:%M UTC");

const TICK_DAYS = [1, 2, 7, 14, 28, 56];
const TICK_SPACING = 90;
const DRAG_PIXELS = 4;
const STYLE_ID = "bw-time-charts-styles";

const STYLES = `
.bw-chart {
  position: relative;
  -webkit-user-select: none;
  user-select: none;
  cursor: crosshair;
}
.bw-selection {
  position: absolute;
  top: var(--plot-top);
  z-index: 2;
  display: none;
  height: var(--plot-height);
  background: rgba(47, 116, 208, 0.18);
  border-left: 1px solid rgba(47, 116, 208, 0.7);
  border-right: 1px solid rgba(47, 116, 208, 0.7);
  pointer-events: none;
}
.bw-crosshair {
  position: absolute;
  top: var(--plot-top);
  z-index: 2;
  display: none;
  width: 0;
  height: var(--plot-height);
  border-left: 1px solid rgba(128, 128, 128, 0.8);
  pointer-events: none;
}
.bw-crosshair span {
  position: absolute;
  top: -15px;
  left: 0;
  transform: translateX(-50%);
  padding: 0 4px;
  border-radius: 3px;
  background: var(--theme-background, #fff);
  color: var(--theme-foreground-muted, #888);
  font-size: 10px;
  white-space: nowrap;
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

export function dateTicks(domain, width) {
  const days = (domain[1] - domain[0]) / DAY_MS;
  const room = Math.max(2, (width - MARGINS.left - MARGINS.right) / TICK_SPACING);
  return d3.utcDay.range(domain[0], domain[1], TICK_DAYS.find((step) => days / step <= room) ?? TICK_DAYS[TICK_DAYS.length - 1]);
}

export const dateAxis = (domain, width) => ({type: "utc", domain, ticks: dateTicks(domain, width), tickFormat: formatDay, label: null});

export const eventRule = (domain, hidden, {key, date}) =>
  hidden.has(key) || date < domain[0] || date > domain[1] ? null : Plot.ruleX([date], {stroke: "currentColor", strokeOpacity: 0.5, strokeDasharray: "2 3"});

export function chartBox(content, height, {left = MARGINS.left, right = MARGINS.right, top = MARGINS.top, bottom = MARGINS.bottom, daily = false} = {}) {
  ensureStyles();
  return html`<div class="bw-chart" data-left="${left}" data-right="${right}" data-daily="${daily}" style="--plot-top:${top}px;--plot-height:${height - top - bottom}px">${content}<div class="bw-selection"></div><div class="bw-crosshair"><span></span></div></div>`;
}

export function syncCharts(section, domain, select, tooltip) {
  const boxes = [...section.querySelectorAll(".bw-chart")];
  const span = domain[1] - domain[0];
  const edges = (box) => {
    const rect = box.getBoundingClientRect();
    return {rect, left: Number(box.dataset.left), right: rect.width - Number(box.dataset.right)};
  };
  const fractionAt = (box, clientX) => {
    const {rect, left, right} = edges(box);
    return (clientX - rect.left - left) / (right - left);
  };
  const place = (box, element, fraction) => {
    const {left, right} = edges(box);
    element.style.left = `${left + fraction * (right - left)}px`;
  };

  const lines = boxes.map((box) => ({box, line: box.querySelector(".bw-crosshair")}));
  const hideLines = () => {
    if (!tooltip.state.pinned) for (const {line} of lines) line.style.display = "none";
  };
  section.addEventListener("pointermove", (event) => {
    const box = event.target.closest?.(".bw-chart");
    if (!box || drag) return hideLines();
    const fraction = fractionAt(box, event.clientX);
    if (fraction < 0 || fraction > 1) return hideLines();
    const time = new Date(+domain[0] + fraction * span);
    for (const {box: other, line} of lines) {
      line.style.display = "block";
      place(other, line, fraction);
      line.firstElementChild.textContent = other.dataset.daily === "true" ? formatDay(time) : formatTime(time);
    }
  });
  section.addEventListener("pointerleave", hideLines);

  let drag = null;
  const showSelection = (from, to) => {
    for (const box of boxes) {
      const selection = box.querySelector(".bw-selection");
      selection.style.display = from === null ? "none" : "block";
      if (from === null) continue;
      const {left, right} = edges(box);
      selection.style.left = `${left + from * (right - left)}px`;
      selection.style.width = `${(to - from) * (right - left)}px`;
    }
  };
  const clamp = (fraction) => Math.min(1, Math.max(0, fraction));
  const move = (event) => {
    if (!drag.active && Math.abs(event.clientX - drag.startX) < DRAG_PIXELS) return;
    if (!drag.active) {
      drag.active = true;
      tooltip.state.dragging = true;
      tooltip.hide();
      for (const {line} of lines) line.style.display = "none";
    }
    const fractions = [drag.fraction, clamp(fractionAt(drag.box, event.clientX))].sort((a, b) => a - b);
    drag.range = fractions;
    showSelection(...fractions);
  };
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancel);
    const {active, range} = drag;
    drag = null;
    tooltip.state.dragging = false;
    if (active) tooltip.hide();
    showSelection(null);
    if (!active || !range || range[1] - range[0] <= 0) return;
    // The click that follows a drag is not one.
    const swallow = (event) => event.stopPropagation();
    window.addEventListener("click", swallow, {capture: true, once: true});
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    select(new Date(+domain[0] + range[0] * span), new Date(+domain[0] + range[1] * span));
  };
  const cancel = () => {
    drag.active = false;
    end();
  };
  section.addEventListener("pointerdown", (event) => {
    const box = event.target.closest?.(".bw-chart");
    if (event.button !== 0 || !box) return;
    const fraction = fractionAt(box, event.clientX);
    if (fraction < 0 || fraction > 1) return;
    drag = {box, fraction, startX: event.clientX, active: false, range: null};
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
  });
}

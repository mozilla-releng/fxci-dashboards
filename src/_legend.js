// Legends whose entries hide and show the series of a chart, the state of what is
// hidden, and the charts that collapse under their title.
import {html, svg} from "npm:htl";
import {MARGINS} from "./_time-charts.js";

const STYLE_ID = "bw-legend-styles";
const SCROLL_RELEASE_MS = 10000;

const STYLES = `
.bw-legends {
  margin: 0.75rem 0 1.25rem;
  font-family: var(--sans-serif);
}
.bw-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 1.25rem;
  margin: 0.35rem 0;
  font-size: 0.85rem;
  color: var(--theme-foreground-muted, #888);
}
.bw-legend button {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.bw-legend button.bw-legend-title {
  min-width: 9rem;
  justify-content: flex-start;
  font-weight: 600;
}
.bw-legend button:hover {
  color: var(--theme-foreground, #000);
}
.bw-legend button[aria-pressed="false"] {
  opacity: 0.4;
  text-decoration: line-through;
}
.bw-title {
  box-sizing: border-box;
  margin: 0;
  text-align: left;
}
.bw-title h2 {
  margin: 1.5rem 0 0;
  max-width: none;
  font-size: 1.6rem;
  line-height: 1.2;
}
.bw-collapse {
  padding: 0;
  text-align: left;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.bw-collapse span {
  text-align: left;
  display: inline-block;
  width: 1em;
  color: var(--theme-foreground-muted, #888);
}
.bw-chart-legends {
  margin: 0.25rem 0 0.5rem;
  padding: 0 ${MARGINS.right}px 0 ${MARGINS.left}px;
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

export const LEGEND_MARKERS = {
  dot: (color) => svg`<svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="${color}"></circle></svg>`,
  cross: (color) => svg`<svg width="10" height="10" aria-hidden="true"><path d="M1 1L9 9M1 9L9 1" stroke="${color}" stroke-width="1.6"></path></svg>`,
  diamond: (color) => svg`<svg width="10" height="10" aria-hidden="true"><path d="M5 0.8L9.2 5L5 9.2L0.8 5Z" fill="none" stroke="${color}" stroke-width="1.6"></path></svg>`,
  triangle: (color) => svg`<svg width="10" height="10" aria-hidden="true"><path d="M5 0.9L9.3 9H0.7Z" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"></path></svg>`,
  square: (color) => svg`<svg width="10" height="10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" fill="none" stroke="${color}" stroke-width="1.6"></rect></svg>`,
  swatch: (color, alpha) => svg`<svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="${color}" fill-opacity="${Math.min(1, alpha + 0.2)}"></rect></svg>`,
  event: () => svg`<svg width="18" height="10" aria-hidden="true"><path d="M0 5H18" stroke="currentColor" stroke-opacity="0.6" stroke-width="1.4" stroke-dasharray="2 3"></path></svg>`
};

// Redrawing replaces the charts, which for a moment leaves the page shorter and
// would scroll it back up, so the box of the charts keeps its height until they are
// drawn and the page then goes back to where it was.
export function hiddenKeysState(boxId) {
  const input = Object.assign(document.createElement("div"), {value: new Set()});
  const keepingScroll = (change) => {
    const box = document.getElementById(boxId);
    const top = window.scrollY;
    box.style.minHeight = `${box.offsetHeight}px`;
    const release = () => {
      observer.disconnect();
      clearTimeout(timer);
      requestAnimationFrame(() => {
        box.style.minHeight = "";
        window.scrollTo({top});
      });
    };
    const observer = new MutationObserver(release);
    const timer = setTimeout(release, SCROLL_RELEASE_MS);
    observer.observe(box, {childList: true, subtree: true});
    change();
  };
  const setHiddenKeys = (toHide, toShow) => {
    const next = new Set(input.value);
    for (const key of toHide) next.add(key);
    for (const key of toShow) next.delete(key);
    keepingScroll(() => {
      input.value = next;
      input.dispatchEvent(new Event("input"));
    });
  };
  const setHidden = (keys, hide) => (hide ? setHiddenKeys(keys, []) : setHiddenKeys([], keys));
  return {input, setHiddenKeys, setHidden};
}

function legendRow({title, entries}, hidden, scope, {setHidden, setHiddenKeys}, otherGroups = []) {
  // Scoped to the chart, so hiding a series in one chart leaves the same series of another in place.
  const keyOf = (key) => `${scope}:${key}`;
  const keys = entries.map((entry) => keyOf(entry.key));
  const anyVisible = keys.some((key) => !hidden.has(key));
  const titleButton = html`<button type="button" class="bw-legend-title" aria-pressed="${String(anyVisible)}">${title}</button>`;
  // Double-clicking the title shows only this group of the legend, or all of them
  // again if it already was the only one.
  const otherKeys = otherGroups.flatMap((group) => group.entries.map((entry) => keyOf(entry.key)));
  const showOnlyGroup = () => {
    const alone = otherKeys.every((other) => hidden.has(other));
    setHiddenKeys(alone ? [] : otherKeys, [...keys, ...(alone ? otherKeys : [])]);
  };
  titleButton.onclick = (event) => (event.detail === 2 ? showOnlyGroup() : setHidden(keys, anyVisible));
  const showOnly = (key) => {
    const others = keys.filter((other) => other !== key);
    const alone = others.every((other) => hidden.has(other));
    setHiddenKeys(alone ? [] : others, [key, ...(alone ? others : [])]);
  };
  return html`<div class="bw-legend">${titleButton}${entries.map(({key, title, marker}) => {
    const button = html`<button type="button" aria-pressed="${String(!hidden.has(keyOf(key)))}">${marker()}${title}</button>`;
    // The first click of a double click toggles the entry, and the second shows it alone.
    button.onclick = (event) => (event.detail === 2 ? showOnly(keyOf(key)) : setHidden([keyOf(key)], !hidden.has(keyOf(key))));
    return button;
  })}</div>`;
}

export function legendRows(groups, hidden, scope, state) {
  ensureStyles();
  return html`<div class="bw-legends bw-chart-legends">${groups.map((group) => legendRow(group, hidden, scope, state, groups.filter((other) => other !== group)))}</div>`;
}

// Aligned with the left edge of the chart, where its axis labels start.
function columnTitles(width, {chartKey, title}, collapsed, setHidden) {
  const button = html`<button type="button" class="bw-collapse" aria-expanded="${String(!collapsed)}"><span aria-hidden="true">${collapsed ? "▸" : "▾"}</span> ${title}</button>`;
  button.onclick = () => setHidden([chartKey], !collapsed);
  return html`<div class="bw-title" style="width:${width}px"><h2>${button}</h2></div>`;
}

// A chart is drawn again only when something it shows changed, so hiding a series
// in one chart leaves the others as they were and they do not flash or cost time.
export function collapsibleBlock(item, {hidden, state, width, context, cache, body}) {
  ensureStyles();
  const {setHidden} = state;
  const collapsed = hidden.has(item.chartKey);
  const prefix = `${item.chartKey}:`;
  const ownKeys = [...hidden].filter((key) => key.startsWith(prefix)).sort();
  const signature = JSON.stringify([...context, collapsed, ownKeys]);
  const cached = cache.get(item.chartKey);
  if (cached?.signature === signature) return cached.node;
  const title = columnTitles(width, item, collapsed, setHidden);
  let node;
  if (collapsed) {
    node = html`<div>${title}</div>`;
  } else {
    const ownHidden = {has: (key) => hidden.has(`${item.chartKey}:${key}`)};
    const {groups, content} = body(item, ownHidden);
    node = html`<div>${title}${groups ? legendRows(groups, hidden, item.chartKey, state) : ""}${content}</div>`;
  }
  cache.set(item.chartKey, {signature, node});
  return node;
}

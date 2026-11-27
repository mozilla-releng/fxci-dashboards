// One tooltip shared by every chart of a page, and the hover and click on a Plot
// chart that drive it. Free of imports and of anything that touches the page
// until createTooltip runs, so the pure parts can be tested.

const STYLE_ID = "bw-tooltip-styles";
const HIDE_DELAY_MS = 220;
const GAP = 14;

const STYLES = `
#bw-tooltip {
  position: fixed;
  z-index: 1000;
  display: none;
  max-width: 520px;
  padding: 8px 12px;
  border-radius: 4px;
  background: #2a2a2a;
  color: white;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.7;
}
#bw-tooltip span,
#bw-tooltip a {
  display: block;
  color: inherit;
  text-decoration: none;
  overflow-wrap: anywhere;
}
#bw-tooltip a {
  color: #7ecfff;
}
#bw-tooltip a:hover {
  text-decoration: underline;
}
#bw-tooltip .bw-tt-sep {
  margin: 4px 0;
  border-top: 1px solid #555;
}
#bw-tooltip .bw-tt-expired {
  color: #f2c14e;
}
#bw-tooltip .bw-tt-blocked {
  color: #ff8a8f;
}
#bw-tooltip .bw-tt-pool {
  font-size: 0.9em;
  color: #bbb;
}
#bw-tooltip .bw-tt-sub {
  padding-left: 16px;
}
#bw-tooltip .bw-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  border-radius: 2px;
}
#bw-tooltip .bw-tt-links a {
  display: inline;
  margin-right: 0.6em;
}
#bw-ring {
  position: fixed;
  z-index: 999;
  display: none;
  width: 12px;
  height: 12px;
  transform: translate(-50%, -50%);
  border: 1.5px solid currentColor;
  border-radius: 50%;
  pointer-events: none;
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

function overlay(id) {
  let element = document.getElementById(id);
  if (!element) {
    element = document.createElement("div");
    element.id = id;
    document.body.append(element);
  }
  return element;
}

// Clicking pins the tooltip, so the pointer can travel to its links. `invalidation`
// ends the listeners on the document when the cell that created it runs again.
export function createTooltip({invalidation = null} = {}) {
  ensureStyles();
  const element = overlay("bw-tooltip");
  const ring = overlay("bw-ring");
  const state = {key: null, hideTimer: null, pinned: false, dragging: false};

  const hide = () => {
    state.key = null;
    state.pinned = false;
    element.style.display = "none";
    ring.style.display = "none";
  };

  const scheduleHide = () => {
    if (state.pinned) return;
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  };

  element.onpointerenter = () => clearTimeout(state.hideTimer);
  element.onpointerleave = scheduleHide;
  const onClick = (event) => {
    if (!element.contains(event.target)) hide();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") hide();
  };
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  invalidation?.then(() => {
    document.removeEventListener("click", onClick);
    document.removeEventListener("keydown", onKeydown);
  });

  function open(event, key, content) {
    if (state.pinned || state.dragging) return false;
    clearTimeout(state.hideTimer);
    if (state.key === key) return false;
    state.key = key;

    element.replaceChildren(content);
    element.style.display = "block";
    const {offsetWidth, offsetHeight} = element;
    const flipX = event.clientX + GAP + offsetWidth > window.innerWidth;
    const flipY = event.clientY + GAP + offsetHeight > window.innerHeight;
    element.style.left = `${flipX ? event.clientX - offsetWidth - GAP : event.clientX + GAP}px`;
    element.style.top = `${flipY ? event.clientY - offsetHeight - GAP : event.clientY + GAP}px`;
    return true;
  }

  function showRing(chartRect, {x, y}, size) {
    ring.style.width = `${size}px`;
    ring.style.height = `${size}px`;
    ring.style.left = `${chartRect.left + x}px`;
    ring.style.top = `${chartRect.top + y}px`;
    ring.style.display = "block";
  }

  const hideRing = () => {
    ring.style.display = "none";
  };

  return {state, open, hide, scheduleHide, showRing, hideRing};
}

export function attachPlotHover(tooltip, plot, find, show) {
  const hitAt = (event) => {
    const rect = plot.getBoundingClientRect();
    return {point: find(event.clientX - rect.left, event.clientY - rect.top), rect};
  };
  plot.addEventListener("pointermove", (event) => {
    const {point, rect} = hitAt(event);
    plot.style.cursor = point ? "pointer" : "";
    if (point) show(event, point, rect);
    else tooltip.scheduleHide();
  });
  plot.addEventListener("pointerleave", tooltip.scheduleHide);
  plot.addEventListener("click", (event) => {
    event.stopPropagation();
    const {point, rect} = hitAt(event);
    tooltip.state.pinned = false;
    if (!point) return tooltip.hide();
    show(event, point, rect);
    tooltip.state.pinned = true;
  });
}

// Of the dots the pointer is inside, the smallest, so a small dot on top of a big
// one stays reachable.
export function nearestDot(points, x, y, hitRadius) {
  const distanceTo = (point) => Math.hypot(point.x - x, point.y - y);
  const inside = points.filter((point) => distanceTo(point) <= point.radius);
  if (inside.length) return inside.reduce((best, point) => (point.radius < best.radius ? point : best));
  const near = points.filter((point) => distanceTo(point) <= hitRadius);
  return near.length ? near.reduce((best, point) => (distanceTo(point) < distanceTo(best) ? point : best)) : null;
}

export function nearestBar(points, x, y, {barWidth, hitRadius}) {
  const near = points.filter((point) => Math.abs(point.x - x) <= barWidth && y >= point.y - hitRadius && y <= point.baseline + hitRadius);
  return near.length ? near.reduce((best, point) => (Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best)) : null;
}

// The window opens inside the click so popup blockers allow it.
export function timelineLink(text, open, filename) {
  const link = document.createElement("a");
  link.href = "#";
  link.textContent = text;
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    if (link.dataset.busy) return;
    link.dataset.busy = "true";
    const label = link.textContent;
    try {
      const result = await open((count) => {
        link.textContent = `→ Loading ${count} tasks…`;
      });
      link.textContent = label;
      if (!result.opened) {
        link.href = result.downloadUrl;
        link.download = filename;
        link.textContent = "→ Popup blocked: download the profile, then drop it on profiler.firefox.com";
      }
    } catch (error) {
      link.textContent = `${text} failed: ${error.message}`;
    } finally {
      delete link.dataset.busy;
    }
  });
  return link;
}

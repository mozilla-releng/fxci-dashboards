// UTC throughout: the brush charts' x scale and every downstream row filter
// key off "YYYY-MM-DD" strings parsed as UTC midnight.
import * as d3 from "npm:d3";

const MS_PER_DAY = 86400000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STYLE_ID = "date-range-style";

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function parseDay(s) {
  if (!s || !DAY_PATTERN.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daySpan(a, b) {
  return Math.round((b - a) / MS_PER_DAY) + 1;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Pages style ".filter-bar form input { width: 100% }", and this <style>
  // lands in <head> while theirs is in <body> — so these have to out-specify
  // those rules rather than merely follow them.
  style.textContent = `
.filter-bar > div.filter-daterange {
  flex: 0 0 auto;
}
form.date-range {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.date-range-row,
.date-range-presets {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  white-space: nowrap;
}
.date-range-presets {
  gap: 0.25rem;
}
.filter-bar form.date-range input[type="date"] {
  width: auto;
  min-width: 0;
  font: 13px/1.2 var(--sans-serif);
  color: inherit;
}
.date-range-preset {
  font: 12px/1.2 var(--sans-serif);
  color: inherit;
  padding: 2px 9px;
  border: solid 1px var(--theme-foreground-faintest, #ddd);
  border-radius: 999px;
  background: var(--theme-background, #fff);
  cursor: pointer;
}
.date-range-preset:hover:not(:disabled) {
  background: var(--theme-background-alt, rgba(128, 128, 128, 0.1));
}
.date-range-preset[aria-pressed="true"] {
  border-color: var(--theme-foreground-muted, #888);
  background: var(--theme-background-alt, rgba(128, 128, 128, 0.12));
  font-weight: 600;
}
.date-range-preset:disabled {
  opacity: 0.4;
  cursor: default;
}
`;
  document.head.append(style);
}

export function dateRangeControl({minDay, maxDay, from, to, presets = [7, 30, 90]}) {
  ensureStyles();

  const windowStart = parseDay(minDay);
  const windowEnd = parseDay(maxDay);
  if (!windowStart || !windowEnd) {
    throw new Error(`dateRangeControl needs YYYY-MM-DD bounds, got ${minDay} – ${maxDay}`);
  }
  const windowSpan = daySpan(windowStart, windowEnd);

  function clampToWindow(d) {
    return d < windowStart ? windowStart : d > windowEnd ? windowEnd : d;
  }

  function floorToDay(d) {
    return parseDay(isoDate(d));
  }

  function normalize(v) {
    if (!v) return null;
    let [a, b] = [floorToDay(v[0]), floorToDay(v[1])];
    if (a > b) [a, b] = [b, a];
    a = clampToWindow(a);
    b = clampToWindow(b);
    // A whole-window range *is* the default, so collapse it: an edge-to-edge
    // brush and the All preset then produce identical state.
    return +a === +windowStart && +b === +windowEnd ? null : [a, b];
  }

  // Stricter than normalize(): a reversed or unparseable ?from=/?to= is a
  // broken link rather than an intent, so fall back to the full window.
  function parseInitialRange() {
    const f = parseDay(from);
    const t = parseDay(to);
    if (!f || !t || f > t || t < windowStart || f > windowEnd) return null;
    return normalize([f, t]);
  }

  const form = document.createElement("form");
  form.className = "date-range";
  form.setAttribute("aria-label", "Date range");
  form.addEventListener("submit", (event) => event.preventDefault());

  // No child may get a `name`: the form's legacy named getter would shadow
  // the .value / .setRange expandos this contract depends on.
  function dateBox(label) {
    const el = document.createElement("input");
    el.type = "date";
    el.min = minDay;
    el.max = maxDay;
    el.setAttribute("aria-label", label);
    return el;
  }
  const fromBox = dateBox("From");
  const toBox = dateBox("To");

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  // The pages' own class, which each styles differently — inheriting theirs
  // keeps every filter bar looking as it did.
  resetButton.className = "filter-reset";
  resetButton.textContent = "Reset";
  resetButton.addEventListener("click", () => commit(null));

  const row = document.createElement("div");
  row.className = "date-range-row";
  row.append(fromBox, " – ", toBox, resetButton);

  // Anchored on maxDay, not today: this is a build-time snapshot of a rolling
  // query, so "last 7 days" off today's date could land on empty data.
  const presetButtons = presets.map((days) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-range-preset";
    button.textContent = `${days}d`;
    button.disabled = days >= windowSpan;
    button.addEventListener("click", () => {
      commit(normalize([new Date(+windowEnd - (days - 1) * MS_PER_DAY), windowEnd]));
    });
    return {days, button};
  });

  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = "date-range-preset";
  allButton.textContent = "All";
  allButton.addEventListener("click", () => commit(null));

  const presetRow = document.createElement("div");
  presetRow.className = "date-range-presets";
  presetRow.append(...presetButtons.map((p) => p.button), allButton);

  function paint(range) {
    const [a, b] = range ?? [windowStart, windowEnd];
    fromBox.value = isoDate(a);
    toBox.value = isoDate(b);
    resetButton.disabled = !range;
    allButton.setAttribute("aria-pressed", String(!range));
    for (const {days, button} of presetButtons) {
      const active = !!range && +range[1] === +windowEnd && daySpan(range[0], range[1]) === days;
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function commit(range) {
    form.value = range;
    paint(range);
    form.dispatchEvent(new Event("input", {bubbles: true}));
  }

  for (const box of [fromBox, toBox]) {
    // Generators.input listens on the form and "input" bubbles, so a raw
    // keystroke here would publish a stale form.value.
    box.addEventListener("input", (event) => event.stopPropagation());
    // "change", not "input": a date box reads "" until y/m/d are all filled
    // and fires "input" per component, which flashes the full window mid-edit.
    box.addEventListener("change", () => {
      const edited = parseDay(box.value);
      const other = parseDay(box === fromBox ? toBox.value : fromBox.value);
      // An empty box means that edge of the window, so no edit can empty the
      // range; crossing the other box pushes it rather than swapping, so the
      // value just typed stays put.
      let a = (box === fromBox ? edited : other) ?? windowStart;
      let b = (box === fromBox ? other : edited) ?? windowEnd;
      if (box === fromBox) b = b < a ? a : b;
      else a = a > b ? b : a;
      commit(normalize([a, b]));
    });
  }

  form.setRange = (v) => commit(normalize(v));

  form.append(row, presetRow);
  form.value = parseInitialRange();
  paint(form.value);
  return form;
}

export function attachDateBrush(plot, {height, dateRange, setDateRange}) {
  // Scoped to a direct child: Plot's legend renders its own swatch <svg>s
  // earlier in DOM order, so a plain querySelector("svg") grabs one of those.
  const svg = plot.tagName === "svg" ? plot : plot.querySelector(":scope > svg");
  const xScale = plot.scale("x");
  if (!svg || !xScale) return plot;

  const [x0, x1] = xScale.range;
  const plotHeight = +svg.getAttribute("height") || height;

  const brush = d3
    .brushX()
    .extent([
      [x0, 0],
      [x1, plotHeight]
    ])
    .on("end", (event) => {
      // Programmatic moves have no sourceEvent; restoring the selection below
      // would otherwise re-enter this handler.
      if (!event.sourceEvent) return;
      setDateRange(event.selection ? event.selection.map(xScale.invert) : null);
    });

  const gBrush = d3.select(svg).append("g").attr("class", "date-brush").call(brush);
  if (dateRange) {
    gBrush.call(brush.move, dateRange.map(xScale.apply));
  }

  return plot;
}

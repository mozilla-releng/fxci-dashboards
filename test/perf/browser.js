// What a scenario does in the browser: serve the built site, open a page with
// every error captured and every request outside the site stubbed or refused,
// wait for it to stop changing, and read its facts and timings.
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {extname, join, normalize, sep} from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png"
};

export async function serve(root) {
  const server = createServer(async (request, response) => {
    const path = normalize(join(root, decodeURIComponent(new URL(request.url, "http://localhost").pathname)));
    if (!path.startsWith(root + sep)) return response.writeHead(403).end();
    try {
      const body = await readFile(path);
      response.writeHead(200, {"content-type": TYPES[extname(path)] ?? "application/octet-stream"}).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve))};
}

// Firefox has no Long Tasks API, so the main thread's stalls are read from the
// gaps between animation frames.
const FRAME_SAMPLER = () => {
  window.__frames = [];
  let last = performance.now();
  const tick = (now) => {
    window.__frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

// The theme asks Google for its fonts. They change nothing the tests look at, so
// they get an empty answer instead of the network.
const FONT_HOSTS = ["https://fonts.googleapis.com/", "https://fonts.gstatic.com/"];

export async function openPage(browser, origin, path, stubs = {}) {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => message.type() === "error" && errors.push(`console: ${message.text()}`));
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => response.url().startsWith(origin) && response.status() >= 400 && errors.push(`${response.status()} ${response.url()}`));
  await page.route(
    (url) => !url.href.startsWith(origin),
    (route) => {
      const url = route.request().url();
      if (FONT_HOSTS.some((host) => url.startsWith(host))) return route.fulfill({status: 200, contentType: "text/css", body: ""});
      const stub = Object.entries(stubs).find(([prefix]) => url.startsWith(prefix));
      if (stub) return route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(stub[1])});
      errors.push(`request outside the site: ${url}`);
      return route.abort();
    }
  );
  await page.addInitScript(FRAME_SAMPLER);
  const started = Date.now();
  await page.goto(`${origin}${path}`, {waitUntil: "load"});
  return {page, errors, started, close: () => context.close()};
}

const signature = (root) => {
  const element = document.querySelector(root);
  return element ? `${element.querySelectorAll("*").length}|${element.querySelectorAll("svg").length}|${element.innerText.length}` : "";
};

// Resolves once what is in `root` has not changed for `quiet` ms, with how long
// after `since` it last changed.
export async function settle(page, {root, since, quiet = 700, timeout = 60000}) {
  let last = "";
  let changedAt = Date.now();
  const deadline = Date.now() + timeout;
  for (;;) {
    const now = await page.evaluate(signature, root);
    if (now !== last) {
      last = now;
      changedAt = Date.now();
    } else if (now && Date.now() - changedAt >= quiet) {
      return changedAt - since;
    }
    if (Date.now() > deadline) throw new Error(`${root} did not settle within ${timeout} ms`);
    await page.waitForTimeout(100);
  }
}

export const frameCount = (page) => page.evaluate(() => window.__frames.length);
export const framesSince = (page, from) => page.evaluate((from) => window.__frames.slice(from), from);

// What a page looks like in one value: a digest of the HTML of its charts, with
// the class names Plot derives from its styles left out.
const digest = (html) => createHash("sha256").update(html.replace(/plot-[0-9a-f]+/g, "plot")).digest("hex").slice(0, 16);

// The computed styles that do not depend on how much room the page has, which
// the browser and its fonts decide: no widths, heights or offsets.
const STYLE_PROPERTIES = [
  "display", "position", "visibility", "opacity", "zIndex", "cursor", "pointerEvents", "userSelect", "overflow", "whiteSpace",
  "marginTop", "marginBottom", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderTopStyle", "borderTopColor", "borderLeftWidth", "borderLeftStyle", "borderLeftColor", "borderTopLeftRadius",
  "color", "backgroundColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "textAlign", "textDecorationLine",
  "flexWrap", "alignItems", "justifyContent", "rowGap", "columnGap"
];

export async function pageFacts(page, {root, tiles}) {
  // Where the pointer is decides which element is hovered, and when the browser
  // applies that is not fixed, so it is parked away from the charts first.
  await page.mouse.move(2, 2);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const {html, styles, ...facts} = await page.evaluate(
    ({root, tiles, properties}) => {
      const box = document.querySelector(root);
      const text = (element) => element.innerText.replace(/\s+/g, " ").trim();
      const styled = [...box.querySelectorAll("*")]
        .filter((element) => !element.closest("svg") || element.tagName === "svg")
        .map((element) => {
          const style = getComputedStyle(element);
          return `${element.tagName}.${element.getAttribute("class") ?? ""}|${properties.map((property) => style[property]).join("|")}`;
        });
      return {
        html: box.outerHTML,
        styles: styled.join("\n"),
        tiles: tiles ? [...box.querySelectorAll(tiles.item)].map((tile) => [text(tile.querySelector(tiles.title)), text(tile.querySelector(tiles.value))]) : [],
        svgs: box.querySelectorAll("svg").length,
        circles: box.querySelectorAll("svg circle").length,
        lines: box.querySelectorAll("svg line").length,
        paths: box.querySelectorAll("svg path").length,
        anchors: box.querySelectorAll("a").length,
        nodes: box.querySelectorAll("*").length,
        bodyNodes: document.body.querySelectorAll("*").length,
        inlineErrors: document.querySelectorAll(".observablehq--error").length
      };
    },
    {root, tiles, properties: STYLE_PROPERTIES}
  );
  return {...facts, html: digest(html), styles: digest(styles)};
}

// Moves the pointer across a chart in `count` steps and times what each move
// costs the page's handlers. The events are dispatched in the page, so the
// times leave out the round trip to the test.
export function hover(page, {selector, index, tooltip, count = 200}) {
  return page.evaluate(
    ({selector, index, tooltip, count}) => {
      const chart = document.querySelectorAll(selector)[index];
      chart.scrollIntoView({block: "center"});
      const svg = chart.querySelector("svg");
      const rect = svg.getBoundingClientRect();
      const label = document.querySelector(tooltip);
      const times = [];
      const tooltips = new Set();
      for (let step = 0; step < count; step++) {
        const clientX = rect.x + 60 + ((rect.width - 120) * step) / count;
        const clientY = rect.y + rect.height / 2;
        const started = performance.now();
        svg.dispatchEvent(new PointerEvent("pointermove", {clientX, clientY, bubbles: true, pointerId: 1, pointerType: "mouse"}));
        times.push(performance.now() - started);
        if (label.textContent.trim()) tooltips.add(label.textContent.replace(/\s+/g, " ").trim());
      }
      svg.dispatchEvent(new PointerEvent("pointerleave", {clientX: rect.x - 10, clientY: rect.y - 10, pointerId: 1, pointerType: "mouse"}));
      return {times, tooltips: tooltips.size};
    },
    {selector, index, tooltip, count}
  );
}

const isShown = (page, selector) => page.evaluate((selector) => getComputedStyle(document.querySelector(selector)).display !== "none", selector);

// Clicks a point of a chart with a tooltip to pin it, moves the pointer away and
// checks the tooltip stays, then releases it with Escape and with a click
// elsewhere.
const TOOLTIP_STYLE = ["position", "zIndex", "maxWidth", "paddingTop", "paddingLeft", "borderTopLeftRadius", "backgroundColor", "color", "fontFamily", "fontSize", "lineHeight", "display"];
const RING_STYLE = ["position", "zIndex", "width", "height", "borderTopWidth", "borderTopColor", "borderTopLeftRadius", "transform", "pointerEvents", "display"];

// How the shown tooltip and its ring look, and what the tooltip says.
async function shownLook(page, {tooltip, ring}) {
  const look = await page.evaluate(
    ({tooltip, ring, tooltipProps, ringProps}) => {
      const style = (selector, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(document.querySelector(selector))[name]]));
      return {tooltip: style(tooltip, tooltipProps), ring: style(ring, ringProps), content: document.querySelector(tooltip).innerHTML};
    },
    {tooltip, ring, tooltipProps: TOOLTIP_STYLE, ringProps: RING_STYLE}
  );
  return {...look, content: digest(look.content)};
}

export async function pin(page, {selector, index, tooltip, ring}) {
  const box = await page.evaluate(
    ({selector, index}) => {
      const chart = document.querySelectorAll(selector)[index];
      chart.scrollIntoView({block: "center"});
      const rect = chart.getBoundingClientRect();
      return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
    },
    {selector, index}
  );
  const y = box.y + box.height / 2;
  // A tooltip left by an earlier hover would pass for a hit at the first point.
  await page.waitForFunction((selector) => getComputedStyle(document.querySelector(selector)).display === "none", tooltip);
  let x = null;
  for (let step = 0; step < 60 && x === null; step++) {
    const candidate = box.x + 60 + ((box.width - 120) * step) / 60;
    await page.mouse.move(candidate, y);
    if (await isShown(page, tooltip)) x = candidate;
  }
  if (x === null) return {found: false};
  const look = await shownLook(page, {tooltip, ring});

  const away = async () => {
    await page.mouse.move(box.x + box.width / 2, Math.max(2, box.y - 40));
    await page.waitForTimeout(400);
  };
  await page.mouse.click(x, y);
  await away();
  const stays = await isShown(page, tooltip);
  await page.keyboard.press("Escape");
  const releasedByEscape = !(await isShown(page, tooltip));

  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await away();
  await page.mouse.click(2, 2);
  const releasedByClick = !(await isShown(page, tooltip));
  return {found: true, stays, releasedByEscape, releasedByClick, ...look};
}

// Uses the legend and the title of one block of charts the way a person does,
// and undoes each step: hides an entry and shows it again, shows one entry alone
// with a double click and all of them again with another, then collapses the
// block and expands it. After each step, which buttons are pressed, how many
// charts the block has, and a digest of what the charts look like.
export async function legend(page, {root, block, entry}) {
  const blockAt = `${root} section > div:nth-child(${block + 1})`;
  const button = (index) => page.locator(`${blockAt} .bw-legend`).first().locator("button").nth(index);
  const look = async () => {
    const facts = await pageFacts(page, {root, tiles: null});
    return {circles: facts.circles, lines: facts.lines, nodes: facts.nodes, html: facts.html, styles: facts.styles};
  };
  const state = async (extra = {}) => ({
    ...(await page.evaluate((blockAt) => {
      const element = document.querySelector(blockAt);
      return {pressed: [...element.querySelector(".bw-legend")?.querySelectorAll("button") ?? []].map((entryButton) => entryButton.getAttribute("aria-pressed")), charts: element.querySelectorAll(".bw-chart").length};
    }, blockAt)),
    ...(await look()),
    ...extra
  });
  const act = async (action) => {
    await action();
    await settle(page, {root, since: Date.now(), quiet: 500});
  };

  await act(() => button(entry).click());
  const hidden = await state();
  await act(() => button(entry).click());
  const shown = await state();
  await act(() => button(entry + 1).dblclick());
  const alone = await state();
  await act(() => button(entry + 1).dblclick());
  const all = await state();
  await act(() => page.locator(`${blockAt} .bw-collapse`).click());
  const collapsed = await state();
  await act(() => page.locator(`${blockAt} .bw-collapse`).click());
  const expanded = await state();
  // The pointer leaves its crosshair and hover state behind, so the page is not
  // quite what it was at the start: what must hold is that undoing a step returns
  // to the state the first undo reached.
  return {hidden, shown, alone, all, collapsed, expanded, restored: all.html === shown.html && expanded.html === shown.html};
}

// Drags across a chart, the way a person zooms, and times the redraw.
export async function zoom(page, {selector, index, from, to, root}) {
  const box = await page.evaluate(
    ({selector, index}) => {
      const chart = document.querySelectorAll(selector)[index];
      chart.scrollIntoView({block: "center"});
      const rect = chart.getBoundingClientRect();
      return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
    },
    {selector, index}
  );
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, y, {steps: 5});
  const released = Date.now();
  await page.mouse.up();
  const ms = await settle(page, {root, since: released});
  const params = new URL(page.url()).searchParams;
  return {ms, range: [params.get("from"), params.get("to")]};
}

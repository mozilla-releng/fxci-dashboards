// A landing's journey as a profile for the Firefox Profiler: a track of its stages, one of
// the closures of the autoland tree while it went on, and one of the events that mark it.
import {intervalProfile} from "./_interval-profile.js";
import {formatDuration, spansOf, STAGE_INFO} from "./_journey.js";

const DAY_S = 86400;
const HOUR_S = 3600;
const TITLES = Object.fromEntries(STAGE_INFO.map(({key, title}) => [key, title]));
const CATEGORIES = {queue: "Lando", lando: "Lando", autoland: "Autoland", waiting: "Nightly", build: "Nightly"};
const COLORS = {queue: "green", lando: "teal", autoland: "orange", waiting: "yellow", build: "blue"};
const FIELDS = [
  {key: "label", label: "What", format: "string"},
  {key: "took", label: "Took", format: "string"}
];

const ms = (seconds) => seconds * 1000;
const interval = ({row, category, order, start, end, label, color, took = ""}) => ({row, category, order, start: ms(start), end: ms(end), label, color, took});

function reviewIntervals({phabCreated, phabApproved, requested}) {
  if (phabCreated === null || phabApproved === null || phabApproved > requested) return [];
  return [
    interval({row: "Review", category: "Before Land", order: 0, start: phabCreated, end: phabApproved, label: "Review", color: "grey", took: formatDuration(phabApproved - phabCreated)}),
    interval({row: "Approved, until Land", category: "Before Land", order: 1, start: phabApproved, end: requested, label: "Approved, until Land", color: "grey", took: formatDuration(requested - phabApproved)})
  ];
}

function closureIntervals(closures, requested, end) {
  return closures
    .filter(({start_s, end_s}) => start_s < end && (end_s ?? Infinity) > requested)
    .map(({start_s, end_s, status, reason_tag}) => {
      const closed = status === "closed";
      const from = Math.max(start_s, requested);
      const to = Math.min(end_s ?? end, end);
      const reason = reason_tag ? `: ${reason_tag.replaceAll("_", " ")}` : "";
      return interval({
        row: closed ? "Autoland closed" : "Autoland: approval required",
        category: "Tree status",
        order: closed ? 0 : 1,
        start: from,
        end: to,
        label: closed ? `Autoland closed${reason}` : `Autoland: approval required${reason}`,
        color: closed ? "red" : "yellow",
        took: formatDuration(to - from)
      });
    });
}

function eventIntervals(journey, end) {
  const events = [
    ["Land requested", journey.requested, "Land requested", "lightblue"],
    ["Merged to main", journey.merged, "Merged to main", "lightblue"],
    ["Nightly started", journey.nightlyStarted, "Nightly started", "lightblue"],
    ["Nightly published", journey.published, "Nightly published", "lightblue"],
    ["Backed out", journey.backedOut ? journey.backout : null, `Backed out by ${journey.backoutBy}`, "red"]
  ];
  return events
    .filter(([, time]) => time !== null && time <= end)
    .map(([row, time, label, color], order) => interval({row, category: "Events", order, start: time, end: time, label, color}));
}

export function journeyProfile(journey, {marks, closures}) {
  const {spans, end} = spansOf(journey, marks);
  const stages = spans.map(({key, start, end: stop, open}, index) =>
    interval({row: TITLES[key], category: CATEGORIES[key], order: index + 2, start, end: stop, label: `${TITLES[key]}${open ? ", so far" : ""}`, color: COLORS[key], took: formatDuration(stop - start)})
  );
  const startS = journey.phabCreated === null ? journey.requested - HOUR_S : Math.max(journey.phabCreated, journey.requested - 2 * DAY_S);
  return intervalProfile({
    title: `D${journey.revision}${journey.bug ? `, bug ${journey.bug}` : ""}: from Land to a Nightly`,
    startMs: ms(startS),
    fields: FIELDS,
    tracks: [
      {name: "Journey", intervals: [...reviewIntervals(journey), ...stages]},
      {name: "Autoland tree status", intervals: closureIntervals(closures, journey.requested, end)},
      {name: "Events", intervals: eventIntervals(journey, end)}
    ]
  });
}

import {clockIntervals, formatClockTime, markerTable, processedProfile, thread, UPSTREAM_ORDER} from "./_task-profile.js";

const CLOCK_ROW = "Clock (UTC)";

// The chart lists rows by category, then by row name, so `order` (0 to 11) puts an
// invisible prefix on a row name to sort it where wanted.
export function intervalProfile({title, startMs, tracks, fields, clock = true}) {
  const strings = [];
  const categories = clock ? [{name: CLOCK_ROW, color: "grey"}] : [];
  const categoryOf = (name) => {
    let index = categories.findIndex((category) => category.name === name);
    if (index < 0) index = categories.push({name, color: "grey"}) - 1;
    return index;
  };
  const endMs = tracks.reduce((latest, {intervals}) => intervals.reduce((end, interval) => Math.max(end, interval.end), latest), startMs + 3600_000);
  const relative = (ms) => Math.max(ms, startMs) - startMs;

  const threads = tracks.map(({name, intervals}, id) => {
    const {table, add} = markerTable(strings, id);
    if (clock && id === 0) {
      for (const interval of clockIntervals(startMs, endMs)) {
        add({row: CLOCK_ROW, category: 0, start: relative(interval.start), end: interval.end - startMs, type: "Interval", data: {label: interval.label, color: interval.color, from: interval.from, to: interval.to}});
      }
    }
    for (const {row, category, order, start, end, ...data} of intervals) {
      add({
        row: order === undefined ? row : `${UPSTREAM_ORDER[Math.max(0, Math.min(order, UPSTREAM_ORDER.length - 1))]}${row}`,
        category: categoryOf(category),
        start: relative(start),
        end: relative(end),
        type: "Interval",
        data: {from: formatClockTime(start), to: formatClockTime(end), ...data}
      });
    }
    return thread({name, id, markers: table});
  });

  const timeFields = ["from", "to"].filter((key) => !fields.some((field) => field.key === key)).map((key) => ({key, label: key === "from" ? "From" : "To", format: "string"}));
  return processedProfile({
    title,
    startTime: startMs,
    strings,
    categories,
    markerSchema: [
      {
        name: "Interval",
        display: ["marker-chart", "marker-table"],
        colorField: "color",
        chartLabel: "{marker.data.label}",
        tableLabel: "{marker.data.label}",
        tooltipLabel: "{marker.data.label}",
        fields: [...fields, ...timeFields]
      }
    ],
    threads
  });
}

// The pure parts of the perf run: what differs from the recorded facts, what is
// over its budget, and how a result is printed. No browser here, so unit tests
// can load it.

export function diffFacts(expected, actual, path = "") {
  if (Object.is(expected, actual)) return [];
  const bothObjects = expected && actual && typeof expected === "object" && typeof actual === "object";
  if (!bothObjects || Array.isArray(expected) !== Array.isArray(actual)) return [{path: path || "(root)", expected, actual}];
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  return keys.flatMap((key) => diffFacts(expected[key], actual[key], path ? `${path}.${key}` : key));
}

const isLibrary = ({path}) => path === "libs" || path.startsWith("libs.");

// The build resolves unpinned libraries to their latest version, so a new release must
// not fail pages that did not change. A rendering change it causes still shows in the
// digests of the page.
export function apartLibraries(differences) {
  return {libraries: differences.filter(isLibrary), facts: differences.filter((difference) => !isLibrary(difference))};
}

// A metric that was not measured counts as over, so a budget cannot pass by omission.
export function overBudget(budgets, timings) {
  return Object.entries(budgets)
    .filter(([metric, ceiling]) => !(timings[metric] <= ceiling))
    .map(([metric, ceiling]) => ({metric, value: timings[metric], ceiling}));
}

export function percentile(values, share) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

export const median = (values) => percentile(values, 0.5);

const round = (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : value);

export function markdownTable(headers, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map((row) => line(row.map((cell) => (typeof cell === "number" ? round(cell) : cell))))].join("\n");
}

export const TIERS = ["highest", "very-high", "high", "medium", "low", "very-low", "lowest"];
// What a run is: a backfill, any other perf task, or any other task.
export const KINDS = ["backfill", "perf", "other"];
export const KIND_TITLES = {backfill: "backfill tasks", perf: "other perf tasks", other: "other tasks"};
// Only the runs of the low tiers are told apart by kind.
export const LOW_TIERS = ["low", "very-low", "lowest"];
// What a run can wait behind, from the first in line: each higher tier, and each
// kind of run in each low tier.
export const LAYERS = TIERS.flatMap((tier) =>
  LOW_TIERS.includes(tier) ? KINDS.map((kind) => ({key: `${tier}_${kind}`, tier, kind, label: `${tier}, ${KIND_TITLES[kind]}`})) : [{key: tier, tier, kind: null, label: tier}]
);

const BIN_SECONDS = 300;
const cache = new WeakMap();

// queue -> tier -> kind -> the series of that queue, tier and kind.
export function indexQueueSeries(table) {
  if (cache.has(table)) return cache.get(table);
  // Reading an Arrow column row by row costs seconds on a table this size, so the
  // columns are read once, into plain arrays.
  const queues = [...table.getChild("queue")];
  // The tier column holds the tier, followed by :backfill or :perf for the low
  // tiers' runs of those kinds, and nothing for the others.
  const tiers = [...table.getChild("tier")];
  const bins = table.getChild("bin_s").toArray();
  const queued = table.getChild("queued").toArray();
  const arrived = table.getChild("arrived").toArray();
  const claimed = table.getChild("claimed").toArray();
  const dropped = table.getChild("dropped").toArray();

  const index = new Map();
  for (let i = 0; i < bins.length; i++) {
    const queue = queues[i];
    const [tier, kind = "other"] = tiers[i].split(":");
    if (!index.has(queue)) index.set(queue, new Map());
    const byTier = index.get(queue);
    if (!byTier.has(tier)) byTier.set(tier, new Map());
    const byKind = byTier.get(tier);
    if (!byKind.has(kind)) byKind.set(kind, {bins: [], queued: [], arrived: [], claimed: [], dropped: []});
    const series = byKind.get(kind);
    series.bins.push(bins[i]);
    series.queued.push(queued[i]);
    series.arrived.push(arrived[i]);
    series.claimed.push(claimed[i]);
    series.dropped.push(dropped[i]);
  }
  cache.set(table, index);
  return index;
}

function firstIndexAtOrAfter(series, binSeconds) {
  let low = 0;
  let high = series.bins.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (series.bins[middle] < binSeconds) low = middle + 1;
    else high = middle;
  }
  return low;
}

function seriesQueuedAtStart(series, binSeconds) {
  const at = firstIndexAtOrAfter(series, binSeconds);
  if (at < series.bins.length && series.bins[at] === binSeconds) return series.queued[at];
  const before = at - 1;
  return before < 0 ? 0 : series.queued[before] + series.arrived[before] - series.claimed[before] - series.dropped[before];
}

function seriesEventsAt(series, binSeconds) {
  const at = firstIndexAtOrAfter(series, binSeconds);
  const found = at < series.bins.length && series.bins[at] === binSeconds;
  return found ? {arrived: series.arrived[at], claimed: series.claimed[at], dropped: series.dropped[at]} : {arrived: 0, claimed: 0, dropped: 0};
}

// What a tier held, or did, over all the kinds of run in it.
function queuedAtStart(byKind, binSeconds) {
  let total = 0;
  for (const series of byKind?.values() ?? []) total += seriesQueuedAtStart(series, binSeconds);
  return total;
}

function queuedByKind(byKind, binSeconds) {
  return Object.fromEntries(KINDS.map((kind) => [kind, byKind?.get(kind) ? seriesQueuedAtStart(byKind.get(kind), binSeconds) : 0]));
}

function eventsAt(byKind, binSeconds) {
  const total = {arrived: 0, claimed: 0, dropped: 0};
  for (const series of byKind?.values() ?? []) {
    const events = seriesEventsAt(series, binSeconds);
    total.arrived += events.arrived;
    total.claimed += events.claimed;
    total.dropped += events.dropped;
  }
  return total;
}

// Tasks ahead of a run in its queue, per 5-minute bin from the time it was
// scheduled until it left the queue. Workers take queued runs by priority, then
// oldest first, so the runs ahead are all the queued runs of a higher tier plus
// the runs of its own tier that were queued before it. Claims take the oldest
// runs of a tier, so every claim of the run's tier since it was scheduled came
// from the runs ahead of it. Runs that leave unclaimed (cancelled, deadline
// exceeded) can be of any age, so only the share of the tier's queue that is
// older than the run is taken off. The run's own bin is counted up to the moment
// it was scheduled, assuming the bin's events are spread evenly. The result is an
// estimate.
export function aheadSeries(index, {queue, tier, scheduledMs, endMs}) {
  const byTier = index.get(queue);
  const rank = TIERS.indexOf(tier);
  if (!byTier || rank < 0) return [];

  const ownSeries = byTier.get(tier);
  const firstBin = Math.floor(scheduledMs / 1000 / BIN_SECONDS) * BIN_SECONDS;
  const elapsed = (scheduledMs / 1000 - firstBin) / BIN_SECONDS;
  const first = eventsAt(ownSeries, firstBin);
  let own = Math.max(0, queuedAtStart(ownSeries, firstBin) + elapsed * (first.arrived - first.claimed - first.dropped));
  const samples = [];
  for (let bin = firstBin; bin * 1000 < endMs; bin += BIN_SECONDS) {
    if (bin > firstBin) {
      const previous = bin - BIN_SECONDS;
      const {claimed, dropped} = eventsAt(ownSeries, previous);
      const total = queuedAtStart(ownSeries, previous);
      const olderShare = total > 0 ? Math.min(1, own / total) : 0;
      const remaining = previous === firstBin ? 1 - elapsed : 1;
      own = Math.max(0, own - remaining * (claimed + dropped * olderShare));
    }
    const counts = Object.fromEntries(LAYERS.map(({key}) => [key, 0]));
    for (const higher of TIERS.slice(0, rank)) {
      if (LOW_TIERS.includes(higher)) {
        const byKindNow = queuedByKind(byTier.get(higher), bin);
        for (const kind of KINDS) counts[`${higher}_${kind}`] = byKindNow[kind];
      } else {
        counts[higher] = queuedAtStart(byTier.get(higher), bin);
      }
    }
    if (LOW_TIERS.includes(tier)) {
      // The runs ahead in its own tier are of every kind, in the proportions of the tier's queue.
      const byKindNow = queuedByKind(ownSeries, bin);
      const total = KINDS.reduce((sum, kind) => sum + byKindNow[kind], 0);
      for (const kind of KINDS) counts[`${tier}_${kind}`] = Math.round(total > 0 ? (own * byKindNow[kind]) / total : kind === "other" ? own : 0);
    } else {
      counts[tier] = Math.round(own);
    }
    samples.push({
      startMs: Math.max(bin * 1000, scheduledMs),
      endMs: Math.min((bin + BIN_SECONDS) * 1000, endMs),
      counts,
      ahead: Object.values(counts).reduce((sum, count) => sum + count, 0)
    });
  }
  return samples;
}

// The mean number of runs a series had queued in each bucket of `bucketSeconds`
// from `firstBin`. The series only has the bins in which runs arrived or left, so
// the count carries on from one bin to the next.
function bucketMeans(series, {firstBin, bucketSeconds, bucketCount}) {
  const binsPerBucket = bucketSeconds / BIN_SECONDS;
  const means = new Float32Array(bucketCount);
  const after = (i) => Math.max(0, series.queued[i] + series.arrived[i] - series.claimed[i] - series.dropped[i]);
  let next = firstIndexAtOrAfter(series, firstBin);
  let level = next > 0 ? after(next - 1) : 0;
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    let sum = 0;
    for (let k = 0; k < binsPerBucket; k++) {
      const bin = firstBin + (bucket * binsPerBucket + k) * BIN_SECONDS;
      for (; next < series.bins.length && series.bins[next] < bin; next++) level = after(next);
      sum += level;
    }
    means[bucket] = sum / binsPerBucket;
  }
  return means;
}

// How many runs of a queue were waiting, per priority tier and kind of run, as the
// mean over each bucket of `bucketSeconds` from `fromSeconds`. `kinds` is
// tier -> kind -> buckets and `tiers` tier -> buckets, over all kinds. The result is
// null for a queue without any runs.
export function queuedPerBucket(index, queue, {fromSeconds, toSeconds, bucketSeconds}) {
  const byTier = index.get(queue);
  if (!byTier) return null;
  const firstBin = Math.floor(fromSeconds / BIN_SECONDS) * BIN_SECONDS;
  const buckets = {firstBin, bucketSeconds, bucketCount: Math.ceil((toSeconds - firstBin) / bucketSeconds)};
  const tiers = new Map();
  const kinds = new Map();
  for (const tier of TIERS) {
    const total = new Float32Array(buckets.bucketCount);
    const ofKind = new Map();
    for (const kind of KINDS) {
      const series = byTier.get(tier)?.get(kind);
      const means = series ? bucketMeans(series, buckets) : new Float32Array(buckets.bucketCount);
      ofKind.set(kind, means);
      means.forEach((mean, bucket) => {
        total[bucket] += mean;
      });
    }
    tiers.set(tier, total);
    kinds.set(tier, ofKind);
  }
  return {...buckets, tiers, kinds};
}

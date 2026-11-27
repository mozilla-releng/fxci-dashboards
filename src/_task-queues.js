// Every run that went through the task queues of the perf-backfill-waits page, one row per
// run, for the "Gantt of the queue" profiles. Imported by the page, the data loader,
// the build config and the script that writes the SQL, so that they agree on the
// queues, the days and the files.
//
// A result of 5.7 million runs is too large to download from STMO as one query, so
// the queues are split in chunks, a query and a data loader each. A chunk is a list of
// queues, and the weeks of the days below it covers (all, unless it says otherwise): the
// busiest queue is in two. Results of over about 1.4 million rows failed to download.
// A loader writes one Parquet file per queue and week, which the page fetches for the
// day it opens.

export const FIRST_DAY = "2026-06-14";
export const LAST_DAY = "2026-11-24";

export const WEEK_SECONDS = 7 * 86400;
// A run waits at most until its deadline, and the default deadline is a day, so the
// runs of the week before can still be queued. Runs with a longer deadline are rare.
export const LOOKBACK_WEEKS = 1;

export const weekOf = (epochSeconds) => Math.floor(epochSeconds / WEEK_SECONDS);

const dayStartSeconds = (day) => Date.parse(`${day}T00:00:00Z`) / 1000;
export const FIRST_WEEK = weekOf(dayStartSeconds(FIRST_DAY));
export const LAST_WEEK = weekOf(dayStartSeconds(LAST_DAY) + 86399);
const SPLIT_WEEK = FIRST_WEEK + 12;

export const TASK_CHUNKS = {
  a: {queues: ["releng-hardware/gecko-t-osx-1500-m4"], lastWeek: SPLIT_WEEK - 1},
  b: {queues: ["gecko-3/b-linux-docker-amd", "gecko-3/b-win2022", "gecko-3/b-linux-docker-xlarge-amd"]},
  c: {queues: ["releng-hardware/gecko-t-osx-1400-r8"]},
  d: {
    queues: [
      "releng-hardware/win11-64-24h2-hw",
      "proj-autophone/gecko-t-lambda-perf-a55",
      "releng-hardware/win11-64-24h2-hw-ref",
      "releng-hardware/gecko-3-b-osx-arm64"
    ]
  },
  e: {queues: ["releng-hardware/gecko-t-linux-talos-2404"]},
  f: {queues: ["releng-hardware/gecko-t-osx-1500-m4"], firstWeek: SPLIT_WEEK}
};

export const chunkWeeks = (chunk) => ({first: TASK_CHUNKS[chunk].firstWeek ?? FIRST_WEEK, last: TASK_CHUNKS[chunk].lastWeek ?? LAST_WEEK});

export const queueSlug = (queue) => queue.replaceAll("/", "_");
export const chunkFor = (queue, week) =>
  Object.keys(TASK_CHUNKS).find(
    (chunk) => TASK_CHUNKS[chunk].queues.includes(queue) && chunkWeeks(chunk).first <= week && week <= chunkWeeks(chunk).last
  );

export const taskFileName = (queue, week) => `${queueSlug(queue)}-${week}.parquet`;
export const taskFilePath = (queue, week) => `data/tasks/${chunkFor(queue, week)}/${taskFileName(queue, week)}`;

export function* taskFilePaths(chunk) {
  const {first, last} = chunkWeeks(chunk);
  for (const queue of TASK_CHUNKS[chunk].queues) for (let week = first; week <= last; week++) yield `/${taskFilePath(queue, week)}`;
}

export const hasTaskRows = (queue, fromSeconds, toSeconds) =>
  Object.values(TASK_CHUNKS).some((chunk) => chunk.queues.includes(queue)) &&
  toSeconds >= dayStartSeconds(FIRST_DAY) &&
  fromSeconds < dayStartSeconds(LAST_DAY) + 86400;

// The weeks to read for the runs queued during [fromSeconds, toSeconds).
export function weeksFor(fromSeconds, toSeconds) {
  const first = Math.max(FIRST_WEEK, weekOf(fromSeconds) - LOOKBACK_WEEKS);
  const last = Math.min(LAST_WEEK, weekOf(toSeconds));
  return Array.from({length: Math.max(0, last - first + 1)}, (_, index) => first + index);
}

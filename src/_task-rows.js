import {hasTaskRows, taskFilePath, weeksFor} from "./_task-queues.js";

// Every run of a task queue, read from the weekly files of the loader
// (src/data/tasks/[chunk].tar.js). The files are not FileAttachments, since the page
// only knows which ones it needs when a Gantt is opened, so they are fetched by their
// path and decoded the way FileAttachment(...).parquet() does.
let decoder;
const decodeParquet = async (buffer) => {
  decoder ??= Promise.all([
    import("npm:apache-arrow"),
    import("npm:parquet-wasm").then(
      async (Parquet) => (await Parquet.default(import.meta.resolve("npm:parquet-wasm/esm/parquet_wasm_bg.wasm")), Parquet)
    )
  ]);
  const [Arrow, Parquet] = await decoder;
  return Arrow.tableFromIPC(Parquet.readParquet(new Uint8Array(buffer)).intoIPCStream());
};

// The build copies the files to their own path, and the preview server serves them
// under /_file/ only.
const ROOTS = ["", "_file/"];
let workingRoot = 0;
async function fetchFile(path) {
  let response;
  for (let root = workingRoot; root < ROOTS.length; root++) {
    response = await fetch(new URL(`${ROOTS[root]}${path}`, document.baseURI));
    if (response.ok) {
      workingRoot = root;
      return response;
    }
  }
  throw new Error(`${path}: ${response.status} ${response.statusText}`);
}

const weeks = new Map();
function readWeek(queue, week) {
  const path = taskFilePath(queue, week);
  if (!weeks.has(path)) {
    weeks.set(
      path,
      (async () => {
        const response = await fetchFile(path);
        const table = await decodeParquet(await response.arrayBuffer());
        const column = (name) => table.getChild(name).toArray();
        const [id, label, tier, kind, scheduled, left, claimed] = ["id", "label", "tier", "kind", "scheduled", "left", "claimed"].map(column);
        // The push of a task is "<repository>/<revision>", empty when the task has none. These
        // columns are missing from files made before they existed.
        const optional = (name) => table.getChild(name)?.toArray() ?? [];
        const [push, pusher, requester, requestPush] = ["push", "pusher", "requester", "requestPush"].map(optional);
        return Array.from({length: table.numRows}, (_, row) => ({
          id: id[row],
          label: label[row],
          tier: tier[row],
          kind: kind[row],
          scheduled: scheduled[row],
          left: left[row],
          claimed: claimed[row] === 1,
          push: push[row] ?? null,
          pusher: pusher[row] ?? null,
          requester: requester[row] ?? null,
          requestPush: requestPush[row] ?? null
        }));
      })().catch((error) => {
        weeks.delete(path);
        throw error;
      })
    );
  }
  return weeks.get(path);
}

export const hasRunRows = (queue, fromMs, toMs) => hasTaskRows(queue, fromMs / 1000, toMs / 1000);

// The runs that were queued at some time in [fromMs, toMs): scheduled before its end,
// and claimed or dropped after its start (`left` is 0 for a run still queued).
export async function queuedRuns(queue, fromMs, toMs) {
  const fromSeconds = fromMs / 1000;
  const toSeconds = toMs / 1000;
  const perWeek = await Promise.all(weeksFor(fromSeconds, toSeconds).map((week) => readWeek(queue, week)));
  return perWeek.flat().filter((run) => run.scheduled < toSeconds && (run.left === 0 || run.left > fromSeconds) && run.left !== run.scheduled);
}

// Turns the rows of one chunk of the per-run query (see src/_task-queues.js for the
// columns) into the weekly Parquet files of each of its queues. A queue and week
// without a run still get a file: the build lists every file the page can ask for,
// and the page reads them all the same.
import {Int32, Table as ArrowTable, tableToIPC, Uint8, Utf8, vectorFromArray} from "apache-arrow";
import {Compression, Table, WriterPropertiesBuilder, writeParquet} from "parquet-wasm/node";
import {chunkWeeks, TASK_CHUNKS, taskFileName, weekOf} from "../_task-queues.js";
import {tar} from "./_tar.js";

const writerProps = () => new WriterPropertiesBuilder().setCompression(Compression.ZSTD).build();

// The push, pusher, requester and request push of a row are ids of words, which are
// the rows with a negative queue (see the query), so that each name and revision is in
// the result once.
function parquetOf(rows, words) {
  const column = (key, type) =>
    vectorFromArray(
      rows.map((row) => row[key]),
      type
    );
  const word = (key) =>
    vectorFromArray(
      rows.map((row) => (row[key] == null ? null : words.get(row[key]))),
      new Utf8()
    );
  const table = new ArrowTable({
    id: column("i", new Utf8()),
    label: column("l", new Utf8()),
    tier: column("t", new Utf8()),
    kind: column("k", new Utf8()),
    scheduled: column("s", new Int32()),
    left: column("e", new Int32()),
    claimed: column("c", new Uint8()),
    push: word("v"),
    pusher: word("u"),
    requester: word("w"),
    requestPush: word("x")
  });
  return Buffer.from(writeParquet(Table.fromIPCStream(tableToIPC(table, "stream")), writerProps()));
}

export function tasksTar(chunk, allRows) {
  const {queues} = TASK_CHUNKS[chunk];
  const {first, last} = chunkWeeks(chunk);
  const words = new Map(allRows.filter((row) => row.q < 0).map((row) => [row.s, row.i]));
  const rows = allRows.filter((row) => row.q >= 0);
  const perQueueWeek = new Map();
  for (const row of rows) {
    const key = `${row.q}:${weekOf(row.s)}`;
    if (!perQueueWeek.has(key)) perQueueWeek.set(key, []);
    perQueueWeek.get(key).push(row);
  }
  const files = [];
  queues.forEach((queue, index) => {
    for (let week = first; week <= last; week++) {
      files.push({
        name: taskFileName(queue, week),
        data: parquetOf(perQueueWeek.get(`${index}:${week}`) ?? [], words)
      });
    }
  });
  return tar(files);
}

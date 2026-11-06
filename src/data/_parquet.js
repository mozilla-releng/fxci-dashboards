// Shared helper for encoding loader rows as Parquet instead of raw JSON —
// the STMO usage query alone is ~335k rows / 69MB as JSON but ~3MB as
// Parquet (dictionary-encoded, compressed columns), and large JSON payloads
// were failing to load client-side once deployed (fine on the loopback dev
// server, but not over the network). Client side reads it back via
// FileAttachment(...).parquet(), which Framework backs with the same
// apache-arrow/parquet-wasm pair used here.
import {tableFromJSON, tableToIPC} from "apache-arrow";
import {Compression, Table, WriterPropertiesBuilder, writeParquet} from "parquet-wasm/node";

// parquet-wasm writes uncompressed by default; ZSTD roughly halves file size
// (gecko2github-gittasks: 36.5MB -> 20.2MB).
const writerProps = () => new WriterPropertiesBuilder().setCompression(Compression.ZSTD).build();

export function rowsToParquet(rows) {
  const ipc = tableToIPC(tableFromJSON(rows), "stream");
  return Buffer.from(writeParquet(Table.fromIPCStream(ipc), writerProps()));
}

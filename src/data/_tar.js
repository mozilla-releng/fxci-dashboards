// A minimal tar writer: Framework extracts the files of a .tar a data loader prints,
// each to its own path, and Node has no archive writer of its own.
const BLOCK = 512;

function header(name, size) {
  const block = Buffer.alloc(BLOCK);
  if (Buffer.byteLength(name) > 100) throw new Error(`tar entry name too long: ${name}`);
  block.write(name, 0, "utf8");
  block.write("0000644\0", 100);
  block.write("0000000\0", 108);
  block.write("0000000\0", 116);
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  block.write("00000000000\0", 136);
  block.write("        ", 148);
  block.write("0", 156);
  block.write("ustar\0", 257);
  block.write("00", 263);
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  block.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
  return block;
}

export function tar(files) {
  const parts = [];
  for (const {name, data} of files) {
    parts.push(header(name, data.length), data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

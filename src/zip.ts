// A minimal store-only (uncompressed) ZIP writer — just enough of the
// format to bundle a handful of files for "download all", with no
// dependency (plan/PLAN.md S-006 "store-only zip, no dependency"). Not a
// general-purpose ZIP library: no compression, no directories, no >4 GB
// entries (fine for four WAVs + one JSON).

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time fields ZIP uses, from a JS Date (local time; only
 * cosmetic — archive tools show it as the entry's modified time). */
function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosYear = Math.max(0, date.getFullYear() - 1980);
  const dt = (dosYear << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dt };
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  pushUint16(v: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    this.push(b);
  }

  pushUint32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.push(b);
  }

  pushAscii(s: string): void {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    this.push(b);
  }

  get offset(): number {
    return this.length;
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

/** Builds a store-only ZIP archive (uncompressed entries) as a single
 * Uint8Array. Total entry count and offsets must fit in 32 bits — true for
 * any realistic use of this app. */
export function buildZip(entries: readonly ZipEntry[], now: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(now);
  const writer = new ByteWriter();
  const centralRecords: { entry: ZipEntry; crc: number; offset: number }[] = [];

  for (const entry of entries) {
    const crc = crc32(entry.data);
    const offset = writer.offset;
    centralRecords.push({ entry, crc, offset });

    writer.pushUint32(0x04034b50); // local file header signature
    writer.pushUint16(20); // version needed to extract
    writer.pushUint16(0); // flags
    writer.pushUint16(0); // compression = stored
    writer.pushUint16(time);
    writer.pushUint16(date);
    writer.pushUint32(crc);
    writer.pushUint32(entry.data.length); // compressed size
    writer.pushUint32(entry.data.length); // uncompressed size
    writer.pushUint16(entry.name.length);
    writer.pushUint16(0); // extra field length
    writer.pushAscii(entry.name);
    writer.push(entry.data);
  }

  const centralDirStart = writer.offset;
  for (const { entry, crc, offset } of centralRecords) {
    writer.pushUint32(0x02014b50); // central directory header signature
    writer.pushUint16(20); // version made by
    writer.pushUint16(20); // version needed to extract
    writer.pushUint16(0); // flags
    writer.pushUint16(0); // compression = stored
    writer.pushUint16(time);
    writer.pushUint16(date);
    writer.pushUint32(crc);
    writer.pushUint32(entry.data.length);
    writer.pushUint32(entry.data.length);
    writer.pushUint16(entry.name.length);
    writer.pushUint16(0); // extra field length
    writer.pushUint16(0); // comment length
    writer.pushUint16(0); // disk number start
    writer.pushUint16(0); // internal attributes
    writer.pushUint32(0); // external attributes
    writer.pushUint32(offset);
    writer.pushAscii(entry.name);
  }
  const centralDirSize = writer.offset - centralDirStart;

  writer.pushUint32(0x06054b50); // end of central directory signature
  writer.pushUint16(0); // disk number
  writer.pushUint16(0); // disk with central directory
  writer.pushUint16(entries.length); // entries on this disk
  writer.pushUint16(entries.length); // total entries
  writer.pushUint32(centralDirSize);
  writer.pushUint32(centralDirStart);
  writer.pushUint16(0); // comment length

  return writer.toBytes();
}

export function zipBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes.slice()], { type: "application/zip" });
}

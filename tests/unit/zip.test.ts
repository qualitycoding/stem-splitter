import { describe, expect, it } from "vitest";
import { buildZip } from "../../src/zip";

// Full round-trip validation against a real unzip implementation lives in
// research/spikes or manual QA (Python's zipfile), since this project has
// no unzip dependency to assert against in-process. This test checks the
// structural invariants a reader relies on: correct local-header/CRC/size
// fields and a central directory that points at the right offsets.
describe("buildZip", () => {
  function readUint32LE(bytes: Uint8Array, offset: number): number {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
  }
  function readUint16LE(bytes: Uint8Array, offset: number): number {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
  }

  it("writes a local file header + data for each entry, in order, starting at offset 0", () => {
    const enc = new TextEncoder();
    const entries = [
      { name: "a.txt", data: enc.encode("hello world") },
      { name: "dir/b.json", data: enc.encode('{"x":1}') },
    ];
    const zip = buildZip(entries);

    expect(readUint32LE(zip, 0)).toBe(0x04034b50); // first local file header signature
    let offset = 0;
    for (const entry of entries) {
      expect(readUint32LE(zip, offset)).toBe(0x04034b50);
      const nameLength = readUint16LE(zip, offset + 26);
      const compressedSize = readUint32LE(zip, offset + 18);
      expect(nameLength).toBe(entry.name.length);
      expect(compressedSize).toBe(entry.data.length); // stored, not compressed
      const nameStart = offset + 30;
      const name = new TextDecoder().decode(zip.subarray(nameStart, nameStart + nameLength));
      expect(name).toBe(entry.name);
      const dataStart = nameStart + nameLength;
      expect(zip.slice(dataStart, dataStart + entry.data.length)).toEqual(entry.data);
      offset = dataStart + entry.data.length;
    }
  });

  it("ends with a valid End Of Central Directory record", () => {
    const enc = new TextEncoder();
    const entries = [{ name: "only.bin", data: enc.encode("x".repeat(50)) }];
    const zip = buildZip(entries);
    const eocdSignature = 0x06054b50;
    let eocdOffset = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (readUint32LE(zip, i) === eocdSignature) {
        eocdOffset = i;
        break;
      }
    }
    expect(eocdOffset).toBeGreaterThanOrEqual(0);
    expect(readUint16LE(zip, eocdOffset + 10)).toBe(1); // total entries
    const centralDirSize = readUint32LE(zip, eocdOffset + 12);
    const centralDirOffset = readUint32LE(zip, eocdOffset + 16);
    expect(centralDirOffset + centralDirSize).toBe(eocdOffset);
    expect(readUint32LE(zip, centralDirOffset)).toBe(0x02014b50); // central directory header signature
  });

  it("produces an empty archive (just EOCD) for zero entries", () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    expect(readUint32LE(zip, 0)).toBe(0x06054b50);
  });
});

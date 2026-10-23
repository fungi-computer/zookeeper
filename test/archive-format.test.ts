import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ARCHIVE_CHUNK_BYTES,
  measureArchive,
  prepareArchiveWrite,
} from "../src/index.js";
import { goldenArchiveText, goldenSource } from "../src/testing.js";

const drain = async (chunks: AsyncIterable<Uint8Array>) => {
  const parts: Uint8Array[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return parts;
};
const join = (parts: readonly Uint8Array[]) =>
  Buffer.concat(parts).toString("utf8");

describe("Zookeeper compaction archive format", () => {
  const goldenSha =
    "e74f0dd4426f4e59fabc2ba944dd9be246905e0431f8be43409a1786f3145cee";

  it("encodes the golden view to the golden bytes, length, sha256 and key", async () => {
    const write = prepareArchiveWrite("session-1", goldenSource);
    expect(join(await drain(write.chunks()))).toBe(goldenArchiveText);
    expect(write.byteLength).toBe(Buffer.byteLength(goldenArchiveText));
    expect(write.sha256).toBe(goldenSha);
    expect(write.materialKey).toBe(goldenSha.slice(0, 32));
    expect(write.sessionId).toBe("session-1");
    expect(write.contextRevision).toBe("row-42");
  });

  it("is re-iterable and yields identical bytes on each pass", async () => {
    const write = prepareArchiveWrite("s", goldenSource);
    const first = join(await drain(write.chunks()));
    expect(join(await drain(write.chunks()))).toBe(first);
  });

  it("keys the material by content, so changed material changes the key", () => {
    const changed = prepareArchiveWrite("s", {
      ...goldenSource,
      turnPrefixMessages: [],
    });
    const same = prepareArchiveWrite("s", goldenSource);
    expect(changed.materialKey).not.toBe(same.materialKey);
    expect(prepareArchiveWrite("other", goldenSource).materialKey).toBe(
      same.materialKey,
    );
  });

  it("never yields a chunk over 64 KiB and reassembles to the declared digest", async () => {
    const big = "x".repeat(ARCHIVE_CHUNK_BYTES * 3 + 17);
    const write = prepareArchiveWrite("s", {
      ...goldenSource,
      messagesToSummarize: [{ role: "user", content: big, timestamp: 1 }],
    });
    const parts = await drain(write.chunks());
    expect(parts.length).toBeGreaterThan(3);
    for (const part of parts) {
      expect(part.byteLength).toBeLessThanOrEqual(ARCHIVE_CHUNK_BYTES);
    }
    expect(parts.reduce((n, part) => n + part.byteLength, 0)).toBe(
      write.byteLength,
    );
    expect(
      createHash("sha256").update(Buffer.concat(parts)).digest("hex"),
    ).toBe(write.sha256);
  });

  it("pass 1 walks the lines once, in order, and retains no bytes", () => {
    const pulled: number[] = [];
    const lines = {
      [Symbol.iterator]: function* () {
        for (const n of [1, 2, 3]) {
          pulled.push(n);
          yield new TextEncoder().encode(`line${String(n)}\n`);
        }
      },
    };
    const measured = measureArchive(lines);
    expect(pulled).toEqual([1, 2, 3]);
    const sha256 = createHash("sha256")
      .update("line1\nline2\nline3\n")
      .digest("hex");
    expect(measured).toStrictEqual({
      byteLength: 18,
      sha256,
      materialKey: sha256.slice(0, 32),
    });
  });

  it("keeps R2, R2Bucket and node:fs out of src", () => {
    for (const file of readdirSync(new URL("../src", import.meta.url))) {
      const text = readFileSync(
        new URL("../src/" + file, import.meta.url),
        "utf8",
      );
      expect(text).not.toMatch(/R2|R2Bucket|node:fs/u);
    }
  });
});

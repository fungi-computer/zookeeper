import { describe, expect, it } from "vitest";

import { ARCHIVE_SEGMENT_MAX, archiveSessionSegment } from "../src/index.js";

const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

const ids = [
  "main",
  "session_abc-DEF_123",
  "-leading-dash",
  "../escape",
  "a/b",
  "a b",
  ".hidden",
  "e.main",
  "e..2e",
  "héllo \u{1F344}",
  "a.b",
  "a_b",
  "x".repeat(ARCHIVE_SEGMENT_MAX + 1),
  "y".repeat(256),
  "é".repeat(256),
];

describe("archive Session segment", () => {
  it("keeps a plain id as it is", () => {
    expect(archiveSessionSegment("main")).toBe("main");
    expect(archiveSessionSegment("session_abc-DEF_123")).toBe(
      "session_abc-DEF_123",
    );
  });

  it("turns every client-chosen id into one safe, bounded segment", () => {
    for (const id of ids) {
      const segment = archiveSessionSegment(id);
      expect(segment, id).toMatch(SAFE_SEGMENT);
      expect(segment.length, id).toBeLessThanOrEqual(ARCHIVE_SEGMENT_MAX);
      expect(segment, id).not.toContain("/");
    }
  });

  it("never gives two ids the same segment", () => {
    const segments = ids.map(archiveSessionSegment);
    expect(new Set(segments).size).toBe(ids.length);
    // The encoded form of one id is not another id's plain form.
    expect(archiveSessionSegment("e.2e")).not.toBe(archiveSessionSegment("."));
  });

  it("is stable and reversible below the bound", () => {
    expect(archiveSessionSegment("../escape")).toBe("e..2e.2e.2fescape");
    expect(archiveSessionSegment("-a")).toBe("e.-a");
    expect(archiveSessionSegment("é")).toBe("e..c3.a9");
  });

  it("hashes an id too long to encode, deterministically", () => {
    const long = "é".repeat(256);
    expect(archiveSessionSegment(long)).toMatch(/^h\.[0-9a-f]{64}$/);
    expect(archiveSessionSegment(long)).toBe(archiveSessionSegment(long));
  });

  it("has no segment for the empty id", () => {
    expect(archiveSessionSegment("")).toBe("");
  });
});

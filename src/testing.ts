import type { ArchiveSource } from "./archive-format.js";

/** One compaction view whose archive bytes are pinned by the golden test. */
export const goldenSource: ArchiveSource = {
  contextRevision: "row-42",
  firstKeptEntryId: "entry-9",
  messagesToSummarize: [
    { role: "user", content: "héllo \u{1F344}", timestamp: 1 },
    { role: "user", content: "second", timestamp: 2 },
  ],
  turnPrefixMessages: [{ role: "user", content: "prefix", timestamp: 3 }],
};

export const goldenArchiveText = [
  '{"format":"zookeeper.compaction-archive/1","version":1,"contextRevision":"row-42","firstKeptEntryId":"entry-9","counts":{"history":2,"turn_prefix":1}}',
  '{"section":"history","message":{"role":"user","content":"héllo \u{1F344}","timestamp":1}}',
  '{"section":"history","message":{"role":"user","content":"second","timestamp":2}}',
  '{"section":"turn_prefix","message":{"role":"user","content":"prefix","timestamp":3}}',
  "",
].join("\n");

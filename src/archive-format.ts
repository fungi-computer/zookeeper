import type { BorrowedCompactionViewV0 } from "@fungi.computer/shiitake";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type { ArchiveWriteV1 } from "./archive-writer.js";

/** Format name written in the first line of every archive. */
export const ARCHIVE_FORMAT = "zookeeper.compaction-archive/1";
/** Largest chunk a writer is handed. */
export const ARCHIVE_CHUNK_BYTES = 64 * 1024;

/** The part of a borrowed compaction view that leaves the model context. */
export type ArchiveSource = Pick<
  BorrowedCompactionViewV0,
  "contextRevision" | "messagesToSummarize" | "turnPrefixMessages"
> &
  Readonly<{ firstKeptEntryId: string }>;

/** Size and identity of an archive; carries no bytes. */
export type ArchiveMeasure = Readonly<{
  byteLength: number;
  sha256: string;
  materialKey: string;
}>;

const encoder = new TextEncoder();

type ArchiveMessage = ArchiveSource["messagesToSummarize"][number];
type ArchiveLine =
  | Readonly<{
      format: typeof ARCHIVE_FORMAT;
      version: 1;
      contextRevision: string;
      firstKeptEntryId: string;
      counts: Readonly<{ history: number; turn_prefix: number }>;
    }>
  | Readonly<{ section: "history" | "turn_prefix"; message: ArchiveMessage }>;

/**
 * NDJSON lines: a header, then history messages, then turn-prefix messages.
 * The summary and usage are model output kept in the compaction entry, so
 * they are not archived.
 */
function* archiveLines(source: ArchiveSource): Iterable<Uint8Array> {
  const line = (value: ArchiveLine) =>
    encoder.encode(`${JSON.stringify(value)}\n`);
  yield line({
    format: ARCHIVE_FORMAT,
    version: 1,
    contextRevision: source.contextRevision,
    firstKeptEntryId: source.firstKeptEntryId,
    counts: {
      history: source.messagesToSummarize.length,
      turn_prefix: source.turnPrefixMessages.length,
    },
  });
  for (const message of source.messagesToSummarize) {
    yield line({ section: "history", message });
  }
  for (const message of source.turnPrefixMessages) {
    yield line({ section: "turn_prefix", message });
  }
}

/** Pass 1: hash and count the lines one at a time, retaining none. */
export function measureArchive(lines: Iterable<Uint8Array>): ArchiveMeasure {
  const hash = sha256.create();
  let byteLength = 0;
  for (const bytes of lines) {
    hash.update(bytes);
    byteLength += bytes.byteLength;
  }
  const digest = bytesToHex(hash.digest());
  return { byteLength, sha256: digest, materialKey: digest.slice(0, 32) };
}

function* sliceChunks(source: ArchiveSource): Generator<Uint8Array> {
  for (const bytes of archiveLines(source)) {
    for (let at = 0; at < bytes.byteLength; at += ARCHIVE_CHUNK_BYTES) {
      yield bytes.subarray(at, at + ARCHIVE_CHUNK_BYTES);
    }
  }
}

function archiveChunks(source: ArchiveSource): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: () => {
      const chunks = sliceChunks(source);
      return { next: () => Promise.resolve(chunks.next()) };
    },
  };
}

/**
 * Prepare one archive write: pass 1 measures, and `chunks()` is pass 2,
 * re-encoding on demand so no full copy is ever held.
 */
export function prepareArchiveWrite(
  sessionId: string,
  source: ArchiveSource,
): ArchiveWriteV1 {
  const measure = measureArchive(archiveLines(source));
  return {
    sessionId,
    contextRevision: source.contextRevision,
    ...measure,
    chunks: () => archiveChunks(source),
  };
}

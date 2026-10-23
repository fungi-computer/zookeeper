import type { Effect } from "effect";

/**
 * One archive handed to a host's writer. `chunks` is re-iterable; each chunk
 * is at most 64 KiB and the chunks total exactly `byteLength` bytes whose
 * SHA-256 is `sha256`.
 */
export type ArchiveWriteV1 = Readonly<{
  sessionId: string;
  contextRevision: string;
  /** First 32 hex characters of `sha256`: the content digest key. */
  materialKey: string;
  byteLength: number;
  /** Lowercase hex SHA-256 of the archive bytes. */
  sha256: string;
  chunks: () => AsyncIterable<Uint8Array>;
}>;

/** What a writer proves it stored; encoded by the host as the opaque receipt. */
export type ArchiveReceiptV1 = Readonly<{
  key: string;
  sha256: string;
  byteLength: number;
}>;

/**
 * Writer failure. `conflict` is different bytes under an existing key,
 * `invalid` a chunk over the bound or a stream that disagrees with the
 * declared length or digest, `unavailable` a store that could not be written.
 */
export type ArchiveWriteError = Readonly<{
  _tag: "ArchiveWriteError";
  reason: "unavailable" | "conflict" | "invalid";
}>;

/** Host-owned storage port; Zookeeper owns the bytes, the host owns the place. */
export type ArchiveWriter = Readonly<{
  write: (
    input: ArchiveWriteV1,
  ) => Effect.Effect<ArchiveReceiptV1, ArchiveWriteError>;
}>;

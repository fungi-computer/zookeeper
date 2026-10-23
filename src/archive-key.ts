import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Longest path or key segment a writer is handed for a Session. */
export const ARCHIVE_SEGMENT_MAX = 200;

const plain = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const literal = /^[A-Za-z0-9_-]$/;
const encoder = new TextEncoder();

/**
 * The one place a Session id becomes a path or key segment, shared by every
 * host writer. Shiitake lets a client name its Session with any text up to 256
 * characters, but a segment must be one safe path element.
 *
 * - A plain id (letters, digits, `_`, `-`, not starting with `-`) is kept.
 * - Any other id is `e.` followed by its UTF-8 bytes, each byte outside the
 *   plain alphabet written as `.xx` (lowercase hex). A plain id never contains
 *   `.`, so an encoded segment can never equal a plain one, and `.` always
 *   begins an escape, so two ids never share a segment and the id is
 *   recoverable.
 * - A segment that would pass {@link ARCHIVE_SEGMENT_MAX} is `h.` and the
 *   SHA-256 of the id's UTF-8 bytes: bounded, collision-free in practice, and
 *   not reversible.
 *
 * The empty id has no segment; it returns `""`, which writers refuse.
 */
export function archiveSessionSegment(sessionId: string): string {
  if (sessionId === "") return "";
  if (plain.test(sessionId) && sessionId.length <= ARCHIVE_SEGMENT_MAX)
    return sessionId;
  const bytes = encoder.encode(sessionId);
  let encoded = "e.";
  for (const byte of bytes) {
    const character = String.fromCharCode(byte);
    encoded +=
      byte < 0x80 && literal.test(character)
        ? character
        : `.${byte.toString(16).padStart(2, "0")}`;
    if (encoded.length > ARCHIVE_SEGMENT_MAX)
      return `h.${bytesToHex(sha256(bytes))}`;
  }
  return encoded;
}

import {
  defineExtension,
  ExtensionId,
  type BorrowedCompactionViewV0,
  type CompactionHandoffErrorV0,
  type CompactionHandoffResultV0,
  type CompactionHandoffV0,
  type ExtensionGrantV0,
  type RosteredExtensionV0,
} from "@fungi.computer/shiitake/extensions";
import * as Effect from "effect/Effect";

import { prepareArchiveWrite } from "./archive-format.js";
import type { ArchiveReceiptV1, ArchiveWriter } from "./archive-writer.js";

const id = ExtensionId.make("zookeeper-compaction");

/** The one grant Zookeeper's handoff needs; a host appends it beside the extension. */
export const zookeeperCompactionGrant: ExtensionGrantV0 = {
  id,
  capabilities: ["compaction_handoff"],
};

/** The opaque receipt Shiitake carries: the writer's receipt as JSON. */
function encodeReceipt(receipt: ArchiveReceiptV1): string {
  return JSON.stringify(receipt);
}

/**
 * Archive exactly what leaves the model context. A write failure is a handoff
 * failure, never a policy discard, so compaction stops with the context intact.
 */
export function archiveHandoff(writer: ArchiveWriter): CompactionHandoffV0 {
  return { consume: (view) => archive(writer, view) };
}

function archive(
  writer: ArchiveWriter,
  view: BorrowedCompactionViewV0,
): Effect.Effect<CompactionHandoffResultV0, CompactionHandoffErrorV0> {
  if (
    view.messagesToSummarize.length === 0 &&
    view.turnPrefixMessages.length === 0
  )
    return Effect.succeed({ type: "discarded_by_policy" });
  const write = prepareArchiveWrite(view.sessionId, {
    contextRevision: view.contextRevision,
    firstKeptEntryId: view.result.firstKeptEntryId,
    messagesToSummarize: view.messagesToSummarize,
    turnPrefixMessages: view.turnPrefixMessages,
  });
  return writer.write(write).pipe(
    Effect.map((receipt): CompactionHandoffResultV0 => ({
      type: "accepted",
      receipt: encodeReceipt(receipt),
    })),
    Effect.mapError((error): CompactionHandoffErrorV0 => ({
      _tag: "CompactionHandoffError",
      message: `Compaction archive write failed: ${error.reason}`,
    })),
  );
}

/**
 * Zookeeper's compaction handoff over a host-bound writer. The host owns the
 * Agent and the place; the view supplies the Session.
 */
export function zookeeperCompaction(
  options: Readonly<{ writer: ArchiveWriter }>,
): RosteredExtensionV0 {
  return defineExtension({ id, version: "1.0.0" }).define({
    compaction: () => ({
      consume: archiveHandoff(options.writer).consume,
    }),
  });
}

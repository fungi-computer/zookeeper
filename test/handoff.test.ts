import type { BorrowedCompactionViewV0 } from "@fungi.computer/shiitake/extensions";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";

import {
  archiveHandoff,
  type ArchiveReceiptV1,
  type ArchiveWriteError,
  type ArchiveWriteV1,
  type ArchiveWriter,
} from "../src/index.js";
import { goldenArchiveText, goldenSource } from "../src/testing.js";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const view: BorrowedCompactionViewV0 = {
  sessionId: "session-1",
  messagesToSummarize: goldenSource.messagesToSummarize,
  turnPrefixMessages: goldenSource.turnPrefixMessages,
  result: {
    summary: "model output, not archived",
    firstKeptEntryId: goldenSource.firstKeptEntryId,
    tokensBefore: 10,
    usage,
  },
  contextRevision: goldenSource.contextRevision,
};

type Seen = Readonly<{ write: ArchiveWriteV1; text: string }>;

async function readAll(write: ArchiveWriteV1): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of write.chunks())
    text += decoder.decode(chunk, { stream: true });
  return text;
}

/** A writer that records what it was handed and answers as told. */
function fakeWriter(failure?: ArchiveWriteError) {
  const seen: Seen[] = [];
  const writer: ArchiveWriter = {
    write: (write) =>
      Effect.gen(function* () {
        const text = yield* Effect.promise(() => readAll(write));
        seen.push({ write, text });
        if (failure !== undefined) return yield* Effect.fail(failure);
        const receipt: ArchiveReceiptV1 = {
          key: `${write.sessionId}/${write.contextRevision}-${write.materialKey}`,
          sha256: write.sha256,
          byteLength: write.byteLength,
        };
        return receipt;
      }),
  };
  return { writer, seen };
}

describe("Zookeeper compaction handoff", () => {
  it("archives exactly what leaves the context and returns the writer's receipt", async () => {
    const { writer, seen } = fakeWriter();
    const result = await Effect.runPromise(
      archiveHandoff(writer).consume(view),
    );
    expect(seen).toHaveLength(1);
    const [only] = seen;
    if (only === undefined) return;
    expect(only.text).toBe(goldenArchiveText);
    expect(only.write.sessionId).toBe("session-1");
    expect(result.type).toBe("accepted");
    if (result.type !== "accepted") return;
    expect(JSON.parse(result.receipt)).toEqual({
      key: `session-1/row-42-${only.write.materialKey}`,
      sha256: only.write.sha256,
      byteLength: Buffer.byteLength(goldenArchiveText),
    });
  });

  it("hands the same material key to the writer on a retry", async () => {
    const { writer, seen } = fakeWriter();
    const handoff = archiveHandoff(writer);
    await Effect.runPromise(handoff.consume(view));
    await Effect.runPromise(handoff.consume(view));
    expect(seen[1]?.write.materialKey).toBe(seen[0]?.write.materialKey);
  });

  it("discards by policy, writing nothing, only when nothing leaves the context", async () => {
    const { writer, seen } = fakeWriter();
    const result = await Effect.runPromise(
      archiveHandoff(writer).consume({
        ...view,
        messagesToSummarize: [],
        turnPrefixMessages: [],
      }),
    );
    expect(result).toEqual({ type: "discarded_by_policy" });
    expect(seen).toHaveLength(0);
  });

  it.each(["unavailable", "conflict", "invalid"] as const)(
    "fails the handoff, never a discard, when the writer reports %s",
    async (reason) => {
      const { writer } = fakeWriter({ _tag: "ArchiveWriteError", reason });
      const exit = await Effect.runPromise(
        Effect.exit(archiveHandoff(writer).consume(view)),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) return;
      expect(Exit.findErrorOption(exit)).toMatchObject({
        value: {
          _tag: "CompactionHandoffError",
          message: `Compaction archive write failed: ${reason}`,
        },
      });
    },
  );
});

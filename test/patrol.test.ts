import type { ColdSessionPage, ColdSessionRow } from "@fungi.computer/shiitake";
import { describe, expect, it } from "vitest";

import { openPatrol, type PatrolReport } from "../src/index.js";

const budgetBytes = 1_000;
const overWaterline = 600;

const row = (
  sessionId: string,
  bytes: number,
  idle = true,
): ColdSessionRow => ({ sessionId, bytes, lastActivityAt: 1, idle });

function patrolOver(
  input: Readonly<{
    usedBytes?: number;
    page?: () => Promise<ColdSessionPage>;
    now?: () => number;
    cadenceMs?: number;
  }>,
) {
  const reports: PatrolReport[] = [];
  const reads: unknown[] = [];
  const patrol = openPatrol({
    budget: { usedBytes: () => input.usedBytes ?? 0, budgetBytes },
    readColdSessions: (request) => {
      reads.push(request);
      return input.page?.() ?? Promise.resolve({ sessions: [] });
    },
    report: (report) => {
      reports.push(report);
    },
    now: input.now ?? (() => 0),
    cadenceMs: input.cadenceMs ?? 300_000,
  });
  return { patrol, reports, reads };
}

describe("Zookeeper patrol", () => {
  // Retained ZKT T2/CA1: a quiet store is not work.
  it("T2/CA1: a quiet store gives nextWakeAt null and run reads no Sessions", async () => {
    const { patrol, reports, reads } = patrolOver({ usedBytes: 100 });
    expect(patrol.pending()).toEqual({ due: false, nextWakeAt: null });
    await patrol.run();
    expect(reads).toEqual([]);
    expect(reports).toEqual([
      { status: "quiet", usedBytes: 100, waterlineBytes: 500 },
    ]);
  });

  it("T2/CA1: a store over the waterline wakes once, later, and is not due now", () => {
    const { patrol } = patrolOver({
      usedBytes: overWaterline,
      now: () => 10_000,
    });
    expect(patrol.pending()).toEqual({ due: false, nextWakeAt: 310_000 });
  });

  // Retained ZKT EW2: the alarm-storm guard.
  it("EW2: a due time is never in the past, even for a zero cadence", () => {
    let now = 50_000;
    const { patrol } = patrolOver({
      usedBytes: overWaterline,
      now: () => now,
      cadenceMs: 0,
    });
    for (const at of [50_000, 50_001, 90_000]) {
      now = at;
      const { nextWakeAt } = patrol.pending();
      expect(nextWakeAt).not.toBeNull();
      expect(nextWakeAt).toBeGreaterThanOrEqual(now + 1_000);
    }
  });

  it("totals the Sessions of one page and says when colder ones remain", async () => {
    const { patrol, reports } = patrolOver({
      usedBytes: overWaterline,
      page: () =>
        Promise.resolve({
          sessions: [row("a", 10), row("b", 30, false)],
          next: "cursor",
        }),
    });
    await patrol.run();
    expect(reports).toEqual([
      {
        status: "measured",
        usedBytes: overWaterline,
        waterlineBytes: 500,
        sessions: 2,
        sessionBytes: 40,
        idleBytes: 10,
        more: true,
      },
    ]);
  });

  it("rejects a budget that is not a positive whole number of bytes", () => {
    for (const budgetBytes of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        openPatrol({
          budget: { usedBytes: () => 0, budgetBytes },
          readColdSessions: () => Promise.resolve({ sessions: [] }),
          report: () => undefined,
        }),
      ).toThrow(expect.objectContaining({ cause: "invalid" }));
    }
  });

  it("reads exactly one bounded page per pass", async () => {
    const { patrol, reads } = patrolOver({ usedBytes: overWaterline });
    await patrol.run();
    expect(reads).toEqual([{ limit: 50 }]);
  });

  it("reports, and does not throw, when the Session page cannot be read", async () => {
    const { patrol, reports } = patrolOver({
      usedBytes: overWaterline,
      page: () => Promise.reject(new TypeError("page failed")),
    });
    await expect(patrol.run()).resolves.toBeUndefined();
    expect(reports).toEqual([
      { status: "unavailable", source: "cold-sessions", failure: "TypeError" },
    ]);
  });

  it("treats an unreadable store size as no wake, and reports it on run", async () => {
    const reports: PatrolReport[] = [];
    const patrol = openPatrol({
      budget: { usedBytes: () => Number.NaN, budgetBytes },
      readColdSessions: () => Promise.resolve({ sessions: [] }),
      report: (report) => {
        reports.push(report);
      },
    });
    expect(patrol.pending().nextWakeAt).toBeNull();
    await patrol.run();
    expect(reports).toEqual([
      {
        status: "unavailable",
        source: "store-size",
        failure: "InvalidStoreSize",
      },
    ]);
  });
});

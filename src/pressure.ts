import {
  ShiitakeError,
  type StoragePressureCheck,
} from "@fungi.computer/shiitake";
import * as Schema from "effect/Schema";

/**
 * Provisional disk thresholds, as fractions of the host's budget. At
 * `refuseAt` new Sessions and new prompts are refused; once refusing, they
 * are admitted again only below `readmitBelow`, so admission does not flap
 * while usage hovers at the threshold. The gap is the room the work already
 * admitted keeps for finishing: its writes never pass through Shiitake's
 * refusal door.
 */
const storagePressureThresholds = Object.freeze({
  refuseAt: 0.8,
  readmitBelow: 0.75,
});

const decodeBudgetBytes = Schema.decodeUnknownResult(
  Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
);
const decodeUsedBytes = Schema.decodeUnknownResult(
  Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
);

/** A Durable Object's disk budget, with the platform's own measure of it. */
export type StorageBudget = Readonly<{
  /**
   * Bytes the owner database occupies now, read from the platform, such as
   * Cloudflare's `ctx.storage.sql.databaseSize`.
   */
  usedBytes: () => number;
  /** The host's budget for those bytes. */
  budgetBytes: number;
}>;

/**
 * A Durable Object's disk quota: 10 GB per object on Cloudflare Workers Paid.
 * Every Shiitake host measures against it, so the number has one owner.
 */
export const durableObjectStorageBudgetBytes = 10_000_000_000;

/** The storage a Cloudflare Durable Object reports its own SQLite size on. */
export type DurableObjectSizedStorage = Readonly<{
  sql: Readonly<{ databaseSize: number }>;
}>;

/**
 * The one budget a Durable Object's pressure check and patrol both measure:
 * the platform's own `databaseSize` against the per-object quota.
 */
export function durableObjectStorageBudget(
  storage: DurableObjectSizedStorage,
): StorageBudget {
  return {
    usedBytes: () => storage.sql.databaseSize,
    budgetBytes: durableObjectStorageBudgetBytes,
  };
}

/**
 * The budget as a positive whole number of bytes. Pressure and the patrol both
 * measure against it, so a bad budget fails when they open, never later as a
 * NaN threshold.
 */
export function checkedBudgetBytes(budget: StorageBudget): number {
  const budgetBytes = decodeBudgetBytes(budget.budgetBytes);
  if (budgetBytes._tag === "Failure")
    throw new ShiitakeError(
      "contract",
      "invalid",
      "Storage budget must be a positive whole number of bytes",
    );
  return budgetBytes.success;
}

/**
 * Open the storage-pressure check for Shiitake's `storagePressure` option.
 * It reports pressure at 80% of the budget and keeps reporting it until
 * usage falls below 75%.
 */
export function openStoragePressure(
  budget: StorageBudget,
): StoragePressureCheck {
  const limit = checkedBudgetBytes(budget);
  let refusing = false;
  return Object.freeze({
    underPressure: () => {
      const used = decodeUsedBytes(budget.usedBytes());
      if (used._tag === "Failure")
        throw new ShiitakeError(
          "store",
          "unavailable",
          "Owner storage size is unavailable",
        );
      const fraction = used.success / limit;
      refusing = refusing
        ? fraction >= storagePressureThresholds.readmitBelow
        : fraction >= storagePressureThresholds.refuseAt;
      return refusing;
    },
  });
}

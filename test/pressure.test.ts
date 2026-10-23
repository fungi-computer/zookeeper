import { ShiitakeError } from "@fungi.computer/shiitake";
import { describe, expect, it } from "vitest";

import {
  durableObjectStorageBudget,
  durableObjectStorageBudgetBytes,
  openStoragePressure,
} from "../src/index.js";

describe("Zookeeper storage pressure", () => {
  it("reports pressure at 80%, keeps reporting until below 75%, then clears", () => {
    let used = 0;
    const pressure = openStoragePressure({
      usedBytes: () => used,
      budgetBytes: 1_000,
    });
    const under = (bytes: number) => {
      used = bytes;
      return pressure.underPressure();
    };
    expect(under(790)).toBe(false);
    expect(under(800)).toBe(true);
    expect(under(780)).toBe(true);
    expect(under(750)).toBe(true);
    expect(under(749)).toBe(false);
    expect(under(790)).toBe(false);
  });

  it("rejects a budget that is not a positive whole number of bytes", () => {
    for (const budgetBytes of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        openStoragePressure({ usedBytes: () => 0, budgetBytes }),
      ).toThrow(expect.objectContaining({ cause: "invalid" }));
    }
  });

  it("fails closed with a typed store error when the measurement is unreadable", () => {
    for (const bytes of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const pressure = openStoragePressure({
        usedBytes: () => bytes,
        budgetBytes: 1_000,
      });
      expect(() => pressure.underPressure()).toThrow(ShiitakeError);
      expect(() => pressure.underPressure()).toThrow(
        expect.objectContaining({ boundary: "store", cause: "unavailable" }),
      );
    }
  });

  it("measures a Durable Object's own databaseSize against the 10 GB quota", () => {
    const storage = { sql: { databaseSize: 0 } };
    const budget = durableObjectStorageBudget(storage);
    expect(budget.budgetBytes).toBe(10_000_000_000);
    expect(durableObjectStorageBudgetBytes).toBe(10_000_000_000);
    const pressure = openStoragePressure(budget);
    const underPressureAt = (percent: number) => {
      storage.sql.databaseSize =
        (durableObjectStorageBudgetBytes / 100) * percent;
      return pressure.underPressure();
    };
    expect(underPressureAt(50)).toBe(false);
    expect(underPressureAt(80)).toBe(true);
    expect(underPressureAt(76)).toBe(true);
    expect(underPressureAt(74)).toBe(false);
  });
});

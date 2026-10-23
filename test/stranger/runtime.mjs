import assert from "node:assert/strict";
import { openStoragePressure } from "@fungi.computer/zookeeper";
import { goldenSource } from "@fungi.computer/zookeeper/testing";

let usedBytes = 0;
const pressure = openStoragePressure({
  usedBytes: () => usedBytes,
  budgetBytes: 100,
});
assert.equal(pressure.underPressure(), false);
usedBytes = 80;
assert.equal(pressure.underPressure(), true);
usedBytes = 75;
assert.equal(pressure.underPressure(), true);
usedBytes = 74;
assert.equal(pressure.underPressure(), false);
assert.equal(goldenSource.contextRevision, "row-42");

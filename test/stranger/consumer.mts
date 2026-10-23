import {
  durableObjectStorageBudget,
  openStoragePressure,
  type StorageBudget,
} from "@fungi.computer/zookeeper";
import { goldenSource } from "@fungi.computer/zookeeper/testing";

const budget: StorageBudget = durableObjectStorageBudget({
  sql: { databaseSize: 0 },
});
const refusing: boolean = openStoragePressure(budget).underPressure();
const revision: string = goldenSource.contextRevision;
void refusing;
void revision;

import type {
  ColdSessionPage,
  ColdSessionPageRequest,
} from "@fungi.computer/shiitake";
import * as Schema from "effect/Schema";

import { checkedBudgetBytes, type StorageBudget } from "./pressure.js";

/**
 * Provisional. The patrol has work once the store holds more than this
 * fraction of the host's budget; it is below the refusal door's 80%, so the
 * patrol sees a growing store before admission is refused.
 */
const patrolWaterlineFraction = 0.5;
/** Provisional. How soon the patrol looks again while the store stays over. */
const defaultCadenceMs = 5 * 60_000;
/** A wake is never closer than this, whatever cadence the host asks for. */
const minimumCadenceMs = 1_000;
/** Sessions measured in one pass: one bounded page, never a walk of the store. */
const patrolPageLimit = 50;

const decodeBytes = Schema.decodeUnknownResult(
  Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
);

/** What one patrol pass measured. The patrol evicts nothing. */
export type PatrolReport =
  | Readonly<{ status: "quiet"; usedBytes: number; waterlineBytes: number }>
  | Readonly<{
      status: "measured";
      usedBytes: number;
      waterlineBytes: number;
      /** Sessions read in this page. */
      sessions: number;
      /** Bytes of the Sessions read. */
      sessionBytes: number;
      /** Bytes of the counted Sessions that are idle. */
      idleBytes: number;
      /** True when colder Sessions remain beyond this page. */
      more: boolean;
    }>
  | Readonly<{
      status: "unavailable";
      /** What could not be read: the platform's size or the Session page. */
      source: "store-size" | "cold-sessions";
      /** The failure's name only; no stored data. */
      failure: string;
    }>;

/**
 * The patrol as Shiitake host work: structurally Cloudflare's
 * `CloudflareHostWork`, declared here so Zookeeper takes no Cloudflare types.
 */
export type PatrolWork = Readonly<{
  /** Read synchronously inside the alarm transaction. */
  pending: () => Readonly<{ due: boolean; nextWakeAt: number | null }>;
  /** One bounded pass, requested on every durable wake. */
  run: () => Promise<void>;
}>;

/** What the patrol needs from its host. */
export type PatrolOptions = Readonly<{
  /** The platform's synchronous size of the store, and the host's budget. */
  budget: StorageBudget;
  /** The owner's bounded, read-only page of Sessions, coldest first. */
  readColdSessions: (
    request: ColdSessionPageRequest,
  ) => Promise<ColdSessionPage>;
  /** Receives what each pass measured; the host logs it. */
  report: (report: PatrolReport) => void;
  now?: () => number;
  cadenceMs?: number;
}>;

type StoreMeasure =
  | Readonly<{ ok: true; usedBytes: number }>
  | Readonly<{ ok: false; failure: string }>;

type PageRead =
  | Readonly<{ ok: true; page: ColdSessionPage }>
  | Readonly<{ ok: false; failure: string }>;

/**
 * Open the patrol as Shiitake host work. `pending` is read synchronously inside
 * the alarm transaction, so it uses only the platform's synchronous size of the
 * store: it reports a wake only while the store is over the waterline, and
 * `null` when it is quiet. `run` is one bounded pass that measures and
 * reports. It evicts nothing.
 */
export function openPatrol(options: PatrolOptions): PatrolWork {
  const now = options.now ?? Date.now;
  const cadenceMs = Math.max(
    options.cadenceMs ?? defaultCadenceMs,
    minimumCadenceMs,
  );
  const waterlineBytes =
    checkedBudgetBytes(options.budget) * patrolWaterlineFraction;
  const measureStore = (): StoreMeasure => {
    try {
      const used = decodeBytes(options.budget.usedBytes());
      return used._tag === "Success"
        ? { ok: true, usedBytes: used.success }
        : { ok: false, failure: "InvalidStoreSize" };
    } catch (error) {
      return {
        ok: false,
        failure: error instanceof Error ? error.name : "NonErrorThrown",
      };
    }
  };

  const readPage = async (): Promise<PageRead> => {
    try {
      return {
        ok: true,
        page: await options.readColdSessions({ limit: patrolPageLimit }),
      };
    } catch (error) {
      return {
        ok: false,
        failure: error instanceof Error ? error.name : "NonErrorThrown",
      };
    }
  };

  return Object.freeze({
    pending: () => {
      const store = measureStore();
      // An unreadable size gives no wake, so the patrol idles until the next
      // commit asks again; Zookeeper's pressure check refuses admission
      // meanwhile. `run` reports the failure on any wake that does happen.
      const over = store.ok && store.usedBytes > waterlineBytes;
      return { due: false, nextWakeAt: over ? now() + cadenceMs : null };
    },
    run: async () => {
      const store = measureStore();
      if (!store.ok) {
        options.report({
          status: "unavailable",
          source: "store-size",
          failure: store.failure,
        });
        return;
      }
      const { usedBytes } = store;
      if (usedBytes <= waterlineBytes) {
        options.report({ status: "quiet", usedBytes, waterlineBytes });
        return;
      }
      const read = await readPage();
      if (!read.ok) {
        options.report({
          status: "unavailable",
          source: "cold-sessions",
          failure: read.failure,
        });
        return;
      }
      const { page } = read;
      let sessionBytes = 0;
      let idleBytes = 0;
      for (const row of page.sessions) {
        sessionBytes += row.bytes;
        if (row.idle) idleBytes += row.bytes;
      }
      options.report({
        status: "measured",
        usedBytes,
        waterlineBytes,
        sessions: page.sessions.length,
        sessionBytes,
        idleBytes,
        more: page.next !== undefined,
      });
    },
  });
}

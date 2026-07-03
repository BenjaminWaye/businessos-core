/**
 * Replay: rebuild accounting state from the shared event log.
 *
 * Reuses the kernel's `EventStore` directly — this module has no database of
 * its own. It fetches the same per-company event stream the M2 domain reads,
 * and folds only the event types it understands.
 */

import type { EventStore } from "@businessos/kernel";
import { projectAccounting } from "./projection.js";
import type { AccountingState } from "./types.js";

export async function replayAccounting(
  store: EventStore,
  companyId: string,
): Promise<AccountingState> {
  const events = await store.byCompany(companyId);
  return projectAccounting(events);
}

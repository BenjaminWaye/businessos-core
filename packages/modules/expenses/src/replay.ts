/**
 * Replay: rebuild expenses state from the shared event log.
 *
 * Reuses the kernel's `EventStore` directly — this module has no database of
 * its own. It fetches the same per-company event stream every other module
 * reads, and folds only the event types it understands.
 */

import type { EventStore } from "@businessos/kernel";
import { projectExpenses } from "./projection.js";
import type { ExpensesState } from "./types.js";

export async function replayExpenses(store: EventStore, companyId: string): Promise<ExpensesState> {
  const events = await store.byCompany(companyId);
  return projectExpenses(events);
}

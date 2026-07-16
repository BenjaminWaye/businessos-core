/**
 * Replay: rebuild payroll state from the shared event log. Reuses the
 * kernel's `EventStore` directly -- this module has no database of its own.
 */

import type { EventStore } from "@businessos/kernel";
import { projectPayroll } from "./projection.js";
import type { PayrollState } from "./types.js";

export async function replayPayroll(store: EventStore, companyId: string): Promise<PayrollState> {
  const events = await store.byCompany(companyId);
  return projectPayroll(events);
}

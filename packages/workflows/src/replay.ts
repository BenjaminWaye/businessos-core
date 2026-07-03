/**
 * Replay: rebuild workflow/task state from the shared event log. Reuses the
 * kernel's EventStore directly, same pattern as accounting-se.
 */

import type { EventStore } from "@businessos/kernel";
import { projectWorkflows } from "./projection.js";
import type { WorkflowState } from "./types.js";

export async function replayWorkflows(store: EventStore, companyId: string): Promise<WorkflowState> {
  const events = await store.byCompany(companyId);
  return projectWorkflows(events);
}

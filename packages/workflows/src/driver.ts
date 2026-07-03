/**
 * Driver: the only place that actually appends what the engine decides.
 *
 * `react()` in engine.ts is pure — it returns event drafts, it does not
 * persist them. This function is the thin, deliberately dumb wiring a real
 * caller (the API layer, the demo script) uses after appending a business
 * event: replay current workflow state, ask the engine to react, append
 * whatever it produced. If the engine produces nothing (the event doesn't
 * match any trigger or waiting step), this is a no-op.
 */

import type { EventStore, StoredEvent } from "@businessos/kernel";
import type { CommandDeps } from "./commands.js";
import type { WorkflowDefinition } from "./definitions.js";
import { react } from "./engine.js";
import { projectWorkflows } from "./projection.js";

export async function reactToEvent(
  store: EventStore,
  triggerEvent: StoredEvent,
  registry: readonly WorkflowDefinition[],
  deps: CommandDeps,
): Promise<void> {
  const priorEvents = await store.byCompany(triggerEvent.companyId);
  const state = projectWorkflows(priorEvents);
  const reactions = react(state, triggerEvent, registry, deps);
  if (reactions.length > 0) {
    await store.append(reactions);
  }
}

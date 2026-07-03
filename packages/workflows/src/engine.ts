/**
 * Engine: the reactive core of the workflow system.
 *
 *   event received -> match triggers/current steps -> emit workflow/task events
 *
 * `react` is a pure function: same WorkflowState + same incoming event + same
 * registry + same deps -> same emitted events, every time. It never appends
 * anything itself and never calls any external system — it only decides
 * which events *should* be appended. The caller (driver.ts, or a test) is
 * responsible for actually persisting them. This is what "no side effects,
 * tasks are the only output" means in code: the only thing this function
 * produces is TaskCreated/WorkflowStarted/WorkflowStepAdvanced/
 * WorkflowCompleted event drafts.
 *
 * Two things happen for every incoming event, independently:
 *   1. Any existing instance whose *current* step is waiting on this exact
 *      event type (and whose correlation value matches) advances by exactly
 *      one step. An event that doesn't match is silently ignored — not
 *      queued, not reordered, no error. This is what makes "invalid"
 *      sequences (e.g. a payment before the invoice was ever sent) behave
 *      consistently: nothing happens, deterministically.
 *   2. Any workflow definition triggered by this event type starts a new
 *      instance, UNLESS one already exists for the same
 *      (definitionId, correlationValue) pair — this makes `react` safe to
 *      call twice with the same event without creating duplicate instances.
 */

import type { EventDraft, StoredEvent } from "@businessos/kernel";
import type { CommandDeps } from "./commands.js";
import { advanceWorkflow, completeWorkflow, createTask, startWorkflow } from "./commands.js";
import type { WorkflowDefinition } from "./definitions.js";
import type { WorkflowState } from "./types.js";

export function react(
  state: WorkflowState,
  event: StoredEvent,
  registry: readonly WorkflowDefinition[],
  deps: CommandDeps,
): EventDraft[] {
  const emitted: EventDraft[] = [];

  // 1. Advance existing instances waiting on this event type.
  for (const instance of state.instances) {
    if (instance.status !== "waiting") continue;

    const definition = registry.find((d) => d.id === instance.workflowDefinitionId);
    if (!definition) continue; // unknown/retired definition — ignore, don't crash replay

    const stepIndex = definition.steps.findIndex((s) => s.id === instance.currentStep);
    const nextStep = definition.steps[stepIndex + 1];
    if (!nextStep || nextStep.onEvent !== event.type) continue;
    if (definition.correlationKey(event.payload) !== instance.correlationValue) continue;
    if (nextStep.condition && !nextStep.condition({ instance }, event.payload)) continue;

    emitted.push(advanceWorkflow(event.companyId, instance.id, nextStep, event.id, deps));
    if (nextStep.createTask) {
      emitted.push(createTask(event.companyId, instance.id, nextStep.createTask, event.payload, deps));
    }
    const isLastStep = stepIndex + 1 === definition.steps.length - 1;
    if (isLastStep) {
      emitted.push(completeWorkflow(event.companyId, instance.id, deps));
    }
  }

  // 2. Start new instances triggered by this event type.
  for (const definition of registry) {
    if (!definition.triggers.includes(event.type)) continue;

    const correlationValue = definition.correlationKey(event.payload);
    const alreadyExists = state.instances.some(
      (i) => i.workflowDefinitionId === definition.id && i.correlationValue === correlationValue,
    );
    if (alreadyExists) continue; // idempotent — safe if react() is ever called twice for the same event

    const started = startWorkflow(event.companyId, definition, correlationValue, event.id, deps);
    emitted.push(started);

    const firstStep = definition.steps[0]!; // startWorkflow already validated steps is non-empty
    if (firstStep.createTask) {
      emitted.push(
        createTask(event.companyId, started.payload.workflowInstanceId, firstStep.createTask, event.payload, deps),
      );
    }
    if (definition.steps.length === 1) {
      emitted.push(completeWorkflow(event.companyId, started.payload.workflowInstanceId, deps));
    }
  }

  return emitted;
}

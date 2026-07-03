/**
 * Command -> Event pipeline for the workflow module.
 *
 * Two kinds of commands here:
 *   - Engine-internal (startWorkflow, advanceWorkflow, completeWorkflow,
 *     createTask): only ever called by `engine.ts` in reaction to a business
 *     event. Never called directly by API/demo code.
 *   - Task lifecycle (startTask, applyTaskResult, failWorkflow): called by
 *     whatever is actually doing the work — a human today, an execution
 *     agent in a later milestone. The engine never calls these; per the
 *     milestone rule, the engine creates tasks but never executes them.
 */

import { randomUUID } from "node:crypto";
import type { EventDraft } from "@businessos/kernel";
import type { WorkflowDefinition, WorkflowStep } from "./definitions.js";
import type {
  Task,
  TaskCreated,
  TaskResult,
  TaskStatusChanged,
  WorkflowCompleted,
  WorkflowFailed,
  WorkflowInstance,
  WorkflowStarted,
  WorkflowStepAdvanced,
} from "./types.js";

export interface CommandDeps {
  newId: () => string;
  now: () => string;
}

export function defaultDeps(): CommandDeps {
  return { newId: () => randomUUID(), now: () => new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Engine-internal: workflow progression
// ---------------------------------------------------------------------------

export function startWorkflow(
  companyId: string,
  definition: WorkflowDefinition,
  correlationValue: string,
  triggerEventId: string,
  deps: CommandDeps,
): EventDraft<WorkflowStarted> {
  const startingStep = definition.steps[0];
  if (!startingStep) {
    throw new Error(`startWorkflow: definition "${definition.id}" has no steps`);
  }
  return {
    id: deps.newId(),
    companyId,
    type: "WorkflowStarted",
    occurredAt: deps.now(),
    payload: {
      workflowInstanceId: deps.newId(),
      workflowDefinitionId: definition.id,
      correlationValue,
      triggerEventId,
      startingStepId: startingStep.id,
    },
  };
}

export function advanceWorkflow(
  companyId: string,
  workflowInstanceId: string,
  step: WorkflowStep,
  triggerEventId: string,
  deps: CommandDeps,
): EventDraft<WorkflowStepAdvanced> {
  return {
    id: deps.newId(),
    companyId,
    type: "WorkflowStepAdvanced",
    occurredAt: deps.now(),
    payload: { workflowInstanceId, stepId: step.id, triggerEventId },
  };
}

export function completeWorkflow(
  companyId: string,
  workflowInstanceId: string,
  deps: CommandDeps,
): EventDraft<WorkflowCompleted> {
  return {
    id: deps.newId(),
    companyId,
    type: "WorkflowCompleted",
    occurredAt: deps.now(),
    payload: { workflowInstanceId },
  };
}

export function createTask(
  companyId: string,
  workflowInstanceId: string,
  taskDef: { type: string; payload: (eventPayload: unknown) => unknown },
  eventPayload: unknown,
  deps: CommandDeps,
): EventDraft<TaskCreated> {
  return {
    id: deps.newId(),
    companyId,
    type: "TaskCreated",
    occurredAt: deps.now(),
    payload: {
      taskId: deps.newId(),
      workflowInstanceId,
      type: taskDef.type,
      payload: taskDef.payload(eventPayload),
    },
  };
}

// ---------------------------------------------------------------------------
// Operator-invoked: workflow failure (manual — no automatic trigger exists yet)
// ---------------------------------------------------------------------------

export interface FailWorkflowInput {
  companyId: string;
  reason: string;
}

export function failWorkflow(
  instance: WorkflowInstance,
  input: FailWorkflowInput,
  deps: CommandDeps,
): EventDraft<WorkflowFailed> {
  if (instance.status === "completed" || instance.status === "failed") {
    throw new Error(`failWorkflow: instance ${instance.id} is already ${instance.status}`);
  }
  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "WorkflowFailed",
    occurredAt: deps.now(),
    payload: { workflowInstanceId: instance.id, reason: input.reason },
  };
}

// ---------------------------------------------------------------------------
// Task lifecycle: created -> in_progress -> completed / failed / blocked
// ---------------------------------------------------------------------------

export interface StartTaskInput {
  companyId: string;
}

/** created -> in_progress. Called by whatever begins working the task. */
export function startTask(
  task: Task,
  input: StartTaskInput,
  deps: CommandDeps,
): EventDraft<TaskStatusChanged> {
  if (task.status !== "created") {
    throw new Error(`startTask: task ${task.id} must be "created" to start (is "${task.status}")`);
  }
  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "TaskStatusChanged",
    occurredAt: deps.now(),
    payload: { taskId: task.id, status: "in_progress" },
  };
}

export interface ApplyTaskResultInput {
  companyId: string;
  result: TaskResult;
}

/** in_progress -> completed / failed / blocked, per the reported TaskResult. */
export function applyTaskResult(
  task: Task,
  input: ApplyTaskResultInput,
  deps: CommandDeps,
): EventDraft<TaskStatusChanged> {
  if (task.status !== "in_progress") {
    throw new Error(
      `applyTaskResult: task ${task.id} must be "in_progress" to apply a result (is "${task.status}")`,
    );
  }
  if (input.result.taskId !== task.id) {
    throw new Error(
      `applyTaskResult: result is for task ${input.result.taskId}, not ${task.id}`,
    );
  }
  const status = input.result.status === "requires_human_input" ? "blocked" : input.result.status;
  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "TaskStatusChanged",
    occurredAt: deps.now(),
    payload: { taskId: task.id, status, output: input.result.output },
  };
}

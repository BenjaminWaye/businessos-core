/**
 * @businessos/workflows — public surface (Milestone 4).
 *
 * Deterministic workflow + task engine: converts business events into
 * trackable tasks, no external execution, no side effects. Built entirely on
 * the kernel's public API (EventStore, EventDraft, StoredEvent) and shares
 * its event log with M2/M3 — the kernel has no idea workflows exist.
 */

export type {
  Task,
  TaskStatus,
  TaskResult,
  TaskCreated,
  TaskStatusChanged,
  WorkflowInstance,
  WorkflowInstanceStatus,
  WorkflowStarted,
  WorkflowStepAdvanced,
  WorkflowCompleted,
  WorkflowFailed,
  WorkflowState,
  WorkflowEventMap,
  WorkflowEventType,
} from "./types.js";
export { initialWorkflowState } from "./types.js";

export type { TaskDefinition, WorkflowStep, WorkflowDefinition } from "./definitions.js";
export { invoiceWorkflow, WORKFLOW_REGISTRY, definitionById } from "./definitions.js";

export type {
  CommandDeps,
  FailWorkflowInput,
  StartTaskInput,
  ApplyTaskResultInput,
} from "./commands.js";
export {
  defaultDeps,
  startWorkflow,
  advanceWorkflow,
  completeWorkflow,
  createTask,
  failWorkflow,
  startTask,
  applyTaskResult,
} from "./commands.js";

export { projectWorkflows } from "./projection.js";
export { replayWorkflows } from "./replay.js";
export { react } from "./engine.js";
export { reactToEvent } from "./driver.js";

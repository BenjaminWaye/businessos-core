/**
 * Milestone 4 — workflow + task domain.
 *
 * As with the accounting module, none of this is stored directly: it's
 * reconstructed by folding this module's own events (see projection.ts).
 * Every event payload is self-contained (carries everything needed to fold
 * it) — the projection never needs to consult the workflow definition
 * registry, only the engine (engine.ts) does, at reaction time.
 */

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export type TaskStatus = "created" | "in_progress" | "completed" | "failed" | "blocked";

export interface Task {
  id: string;
  type: string;
  status: TaskStatus;
  payload: unknown;
  workflowInstanceId: string;
  createdAt: string;
  output?: unknown;
}

/** Reported by whatever executes a task (a human, or in a later milestone, an execution agent). Never produced by the engine itself. */
export interface TaskResult {
  taskId: string;
  status: "completed" | "failed" | "requires_human_input";
  output?: unknown;
}

export interface TaskCreated {
  taskId: string;
  workflowInstanceId: string;
  type: string;
  payload: unknown;
}

export interface TaskStatusChanged {
  taskId: string;
  status: TaskStatus;
  output?: unknown;
}

// ---------------------------------------------------------------------------
// Workflow instance
// ---------------------------------------------------------------------------

/**
 * `active` exists in the type for forward compatibility (e.g. a future
 * milestone with genuinely asynchronous step execution) but this engine
 * currently never produces it: step execution is a synchronous pure
 * function, so an instance goes straight from nonexistent to `waiting`
 * (more steps remain) or `completed` (last step reached) within the same
 * reaction. See the module README section in the main README for why.
 */
export type WorkflowInstanceStatus = "active" | "waiting" | "completed" | "failed";

export interface WorkflowInstance {
  id: string;
  workflowDefinitionId: string;
  /** Value extracted from the triggering event's payload (e.g. an invoiceId) used to route later events to this instance. */
  correlationValue: string;
  status: WorkflowInstanceStatus;
  currentStep: string;
  /**
   * The event type that would advance this instance past its current step,
   * or null if it's not waiting on anything (terminal, or the current step
   * is the last one). Persisted explicitly on WorkflowStarted/
   * WorkflowStepAdvanced at the moment each step is entered — the engine
   * treats this as the authoritative answer to "what is this instance
   * waiting for", rather than re-deriving it from whatever WorkflowDefinition
   * happens to be loaded in code at reaction time. That keeps the log
   * self-explaining: if a workflow definition is ever edited later (a step
   * reordered, an onEvent changed), replay of *existing* instances still
   * matches what actually happened live, because the wait condition was
   * captured as data, not re-inferred from mutable code.
   */
  waitingForEvent: string | null;
  createdAt: string;
}

export interface WorkflowStarted {
  workflowInstanceId: string;
  workflowDefinitionId: string;
  correlationValue: string;
  /** Id of the business event that triggered this workflow — audit trail only. */
  triggerEventId: string;
  /** The first step's id — steps[0] always executes synchronously at start. */
  startingStepId: string;
  /** See WorkflowInstance.waitingForEvent. */
  waitingForEvent: string | null;
}

export interface WorkflowStepAdvanced {
  workflowInstanceId: string;
  stepId: string;
  triggerEventId: string;
  /** See WorkflowInstance.waitingForEvent. */
  waitingForEvent: string | null;
}

export interface WorkflowCompleted {
  workflowInstanceId: string;
}

export interface WorkflowFailed {
  workflowInstanceId: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface WorkflowState {
  instances: WorkflowInstance[];
  tasks: Task[];
}

export function initialWorkflowState(): WorkflowState {
  return { instances: [], tasks: [] };
}

export interface WorkflowEventMap {
  WorkflowStarted: WorkflowStarted;
  WorkflowStepAdvanced: WorkflowStepAdvanced;
  WorkflowCompleted: WorkflowCompleted;
  WorkflowFailed: WorkflowFailed;
  TaskCreated: TaskCreated;
  TaskStatusChanged: TaskStatusChanged;
}

export type WorkflowEventType = keyof WorkflowEventMap;

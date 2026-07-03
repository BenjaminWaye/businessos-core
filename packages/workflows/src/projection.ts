/**
 * Projection: events -> WorkflowState. Pure, deterministic, exactly the same
 * shape as the kernel's and accounting-se's projections. Notably it does NOT
 * take the workflow definition registry — every event payload carries
 * everything needed to fold it (e.g. WorkflowStarted carries the resolved
 * `startingStepId`), so replay never depends on which workflow versions
 * happen to be registered in code at replay time.
 */

import { compareEvents, type StoredEvent } from "@businessos/kernel";
import {
  initialWorkflowState,
  type Task,
  type TaskCreated,
  type TaskStatusChanged,
  type WorkflowCompleted,
  type WorkflowFailed,
  type WorkflowInstance,
  type WorkflowStarted,
  type WorkflowState,
  type WorkflowStepAdvanced,
} from "./types.js";

function apply(state: WorkflowState, event: StoredEvent): WorkflowState {
  switch (event.type) {
    case "WorkflowStarted": {
      const p = event.payload as WorkflowStarted;
      const instance: WorkflowInstance = {
        id: p.workflowInstanceId,
        workflowDefinitionId: p.workflowDefinitionId,
        correlationValue: p.correlationValue,
        status: "waiting",
        currentStep: p.startingStepId,
        createdAt: event.occurredAt,
      };
      return { ...state, instances: [...state.instances, instance] };
    }

    case "WorkflowStepAdvanced": {
      const p = event.payload as WorkflowStepAdvanced;
      return {
        ...state,
        instances: state.instances.map((i) =>
          i.id === p.workflowInstanceId ? { ...i, currentStep: p.stepId } : i,
        ),
      };
    }

    case "WorkflowCompleted": {
      const p = event.payload as WorkflowCompleted;
      return {
        ...state,
        instances: state.instances.map((i) =>
          i.id === p.workflowInstanceId ? { ...i, status: "completed" } : i,
        ),
      };
    }

    case "WorkflowFailed": {
      const p = event.payload as WorkflowFailed;
      return {
        ...state,
        instances: state.instances.map((i) =>
          i.id === p.workflowInstanceId ? { ...i, status: "failed" } : i,
        ),
      };
    }

    case "TaskCreated": {
      const p = event.payload as TaskCreated;
      const task: Task = {
        id: p.taskId,
        type: p.type,
        status: "created",
        payload: p.payload,
        workflowInstanceId: p.workflowInstanceId,
        createdAt: event.occurredAt,
      };
      return { ...state, tasks: [...state.tasks, task] };
    }

    case "TaskStatusChanged": {
      const p = event.payload as TaskStatusChanged;
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === p.taskId
            ? { ...t, status: p.status, ...(p.output !== undefined ? { output: p.output } : {}) }
            : t,
        ),
      };
    }

    // Business events (InvoiceCreated, InvoiceSent, ...) are ignored here —
    // reacting to them is engine.ts's job, not the projection's. The
    // projection only folds this module's own events.
    default:
      return state;
  }
}

export function projectWorkflows(events: readonly StoredEvent[]): WorkflowState {
  return [...events].sort(compareEvents).reduce(apply, initialWorkflowState());
}

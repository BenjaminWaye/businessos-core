/**
 * Workflow definitions: static, in-code descriptions of a business process.
 *
 * These are never persisted as events — they're the "program" the engine
 * runs, analogous to the BAS chart of accounts in accounting-se: fixed,
 * versioned in code, read by the engine at reaction time. `condition` and
 * `payload` are plain functions, which is fine precisely because they never
 * appear in the event log — only their *results* (task payloads, which step
 * advanced) are ever persisted.
 *
 * Step model: `steps[0]` has no `onEvent` and runs synchronously the instant
 * the workflow starts. Every subsequent step is gated by `onEvent` (must
 * match the incoming event's type) and `condition` (if present). Steps run
 * strictly in order — an event that doesn't match the *current* step's next
 * step is ignored, not queued or reordered.
 */

import type { WorkflowInstance } from "./types.js";

export interface TaskDefinition {
  type: string;
  /** Pure derivation of the task's payload from the triggering event's payload. */
  payload: (eventPayload: any) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface WorkflowStep {
  id: string;
  /** Event type that causes this step to execute. Omitted only for steps[0]. */
  onEvent?: string;
  /** Task to create when this step executes. */
  createTask?: TaskDefinition;
  /** Optional pure guard. If it returns false, the event is ignored — the instance stays on its current step. */
  condition?: (context: { instance: WorkflowInstance }, eventPayload: any) => boolean; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  /** Event types that can start a brand new instance of this workflow. */
  triggers: string[];
  /** Extract the correlation id (e.g. invoiceId) from an event's payload. */
  correlationKey: (payload: any) => string; // eslint-disable-line @typescript-eslint/no-explicit-any
  steps: WorkflowStep[];
}

/**
 * InvoiceCreated -> SendInvoiceTask
 * InvoiceSent    -> MonitorPaymentTask
 * PaymentRegistered -> workflow completed
 */
export const invoiceWorkflow: WorkflowDefinition = {
  id: "invoice-workflow",
  name: "Invoice to Payment",
  triggers: ["InvoiceCreated"],
  correlationKey: (payload) => payload.invoiceId,
  steps: [
    {
      id: "send",
      createTask: {
        type: "SendInvoiceTask",
        payload: (p) => ({ invoiceId: p.invoiceId, customerId: p.customerId }),
      },
    },
    {
      id: "monitor",
      onEvent: "InvoiceSent",
      createTask: {
        type: "MonitorPaymentTask",
        payload: (p) => ({ invoiceId: p.invoiceId }),
      },
    },
    {
      id: "complete",
      onEvent: "PaymentRegistered",
    },
  ],
};

export const WORKFLOW_REGISTRY: readonly WorkflowDefinition[] = [invoiceWorkflow];

export function definitionById(
  registry: readonly WorkflowDefinition[],
  id: string,
): WorkflowDefinition | undefined {
  return registry.find((d) => d.id === id);
}

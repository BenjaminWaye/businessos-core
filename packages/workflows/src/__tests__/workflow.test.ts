/**
 * Workflow engine tests (pure — no database).
 *
 * Covers the milestone's test requirements 10.1-10.3: trigger, multi-event
 * progression, and deterministic/consistent handling of invalid sequences.
 * (10.4 replay is covered separately in replay.test.ts, DB-backed.)
 */

import { describe, expect, it } from "vitest";
import type { EventDraft, StoredEvent } from "@businessos/kernel";
import { react } from "../engine.js";
import { projectWorkflows } from "../projection.js";
import { WORKFLOW_REGISTRY, type WorkflowDefinition } from "../definitions.js";
import { initialWorkflowState, type WorkflowState } from "../types.js";
import { fakeEvent, fixedDeps } from "./helpers.js";

const COMPANY = "acme";

/** Turn drafts into stored events with sequential seq numbers, fold into state. */
function foldDrafts(drafts: EventDraft[], startSeq = 1): WorkflowState {
  const stored: StoredEvent[] = drafts.map((d, i) => ({ ...d, seq: startSeq + i }));
  return projectWorkflows(stored);
}

const invoiceCreated = fakeEvent({
  id: "evt-created",
  type: "InvoiceCreated",
  payload: { invoiceId: "inv-1", customerId: "cust-1", amount: 100000, currency: "SEK", dueDate: "2026-12-31" },
});
const invoiceSent = fakeEvent({
  id: "evt-sent",
  type: "InvoiceSent",
  payload: { invoiceId: "inv-1" },
});
const paymentRegistered = fakeEvent({
  id: "evt-paid",
  type: "PaymentRegistered",
  payload: { paymentId: "pay-1", invoiceId: "inv-1", amount: 100000, currency: "SEK" },
});

describe("10.1 — workflow trigger", () => {
  it("InvoiceCreated starts a workflow instance and creates SendInvoiceTask", () => {
    const emitted = react(initialWorkflowState(), invoiceCreated, WORKFLOW_REGISTRY, fixedDeps());

    expect(emitted.map((e) => e.type)).toEqual(["WorkflowStarted", "TaskCreated"]);
    const started = emitted[0]!;
    expect(started.payload).toMatchObject({
      workflowDefinitionId: "invoice-workflow",
      correlationValue: "inv-1",
      triggerEventId: "evt-created",
      startingStepId: "send",
    });
    const taskCreated = emitted[1]!;
    expect(taskCreated.payload).toMatchObject({
      type: "SendInvoiceTask",
      payload: { invoiceId: "inv-1", customerId: "cust-1" },
    });

    const state = foldDrafts(emitted);
    expect(state.instances).toHaveLength(1);
    expect(state.instances[0]).toMatchObject({ status: "waiting", currentStep: "send" });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ type: "SendInvoiceTask", status: "created" });
  });

  it("an unrelated event triggers nothing", () => {
    const unrelated = fakeEvent({ id: "evt-x", type: "CustomerCreated", payload: {} });
    expect(react(initialWorkflowState(), unrelated, WORKFLOW_REGISTRY, fixedDeps())).toEqual([]);
  });
});

describe("10.2 — multi-event progression", () => {
  it("InvoiceCreated -> InvoiceSent -> PaymentRegistered completes the workflow", () => {
    const deps = fixedDeps();
    let allDrafts: EventDraft[] = [];

    let state = initialWorkflowState();
    let reactions = react(state, invoiceCreated, WORKFLOW_REGISTRY, deps);
    allDrafts = [...allDrafts, ...reactions];
    state = foldDrafts(allDrafts);
    expect(state.instances[0]?.status).toBe("waiting");

    reactions = react(state, invoiceSent, WORKFLOW_REGISTRY, deps);
    expect(reactions.map((e) => e.type)).toEqual(["WorkflowStepAdvanced", "TaskCreated"]);
    allDrafts = [...allDrafts, ...reactions];
    state = foldDrafts(allDrafts);
    expect(state.instances[0]).toMatchObject({ status: "waiting", currentStep: "monitor" });
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks[1]).toMatchObject({ type: "MonitorPaymentTask", status: "created" });

    reactions = react(state, paymentRegistered, WORKFLOW_REGISTRY, deps);
    expect(reactions.map((e) => e.type)).toEqual(["WorkflowStepAdvanced", "WorkflowCompleted"]);
    allDrafts = [...allDrafts, ...reactions];
    state = foldDrafts(allDrafts);
    expect(state.instances[0]).toMatchObject({ status: "completed", currentStep: "complete" });
    // No task is created for the final step — it just closes out the workflow.
    expect(state.tasks).toHaveLength(2);
  });

  it("independent invoices get independent instances, correlated separately", () => {
    const deps = fixedDeps();
    const otherInvoiceCreated = fakeEvent({
      id: "evt-created-2",
      type: "InvoiceCreated",
      payload: { invoiceId: "inv-2", customerId: "cust-2", amount: 5000, currency: "SEK", dueDate: "2026-12-31" },
    });

    let drafts = react(initialWorkflowState(), invoiceCreated, WORKFLOW_REGISTRY, deps);
    let state = foldDrafts(drafts);
    drafts = [...drafts, ...react(state, otherInvoiceCreated, WORKFLOW_REGISTRY, deps)];
    state = foldDrafts(drafts);

    expect(state.instances).toHaveLength(2);

    // Sending invoice 1 must not affect invoice 2's instance.
    drafts = [...drafts, ...react(state, invoiceSent, WORKFLOW_REGISTRY, deps)];
    state = foldDrafts(drafts);
    const inv1 = state.instances.find((i) => i.correlationValue === "inv-1")!;
    const inv2 = state.instances.find((i) => i.correlationValue === "inv-2")!;
    expect(inv1.currentStep).toBe("monitor");
    expect(inv2.currentStep).toBe("send");
  });
});

describe("10.3 — invalid/out-of-order sequences are handled consistently", () => {
  it("an event that doesn't match the current waiting step is silently ignored", () => {
    const deps = fixedDeps();
    const drafts = react(initialWorkflowState(), invoiceCreated, WORKFLOW_REGISTRY, deps);
    const state = foldDrafts(drafts); // instance is "waiting" at step "send", expects InvoiceSent next

    // PaymentRegistered arrives "too early" — before InvoiceSent was ever processed.
    const reactions = react(state, paymentRegistered, WORKFLOW_REGISTRY, deps);
    expect(reactions).toEqual([]);
    expect(foldDrafts(drafts).instances[0]?.currentStep).toBe("send"); // unchanged
  });

  it("an event with a non-matching correlation value does not advance the instance", () => {
    const deps = fixedDeps();
    const drafts = react(initialWorkflowState(), invoiceCreated, WORKFLOW_REGISTRY, deps);
    const state = foldDrafts(drafts);

    const sentForDifferentInvoice = fakeEvent({
      id: "evt-sent-other",
      type: "InvoiceSent",
      payload: { invoiceId: "some-other-invoice" },
    });
    expect(react(state, sentForDifferentInvoice, WORKFLOW_REGISTRY, deps)).toEqual([]);
  });

  it("reacting to the same triggering event twice does not create a duplicate instance", () => {
    const deps = fixedDeps();
    const first = react(initialWorkflowState(), invoiceCreated, WORKFLOW_REGISTRY, deps);
    const state = foldDrafts(first);

    // Same event processed again (e.g. an at-least-once delivery retry).
    const second = react(state, invoiceCreated, WORKFLOW_REGISTRY, deps);
    expect(second).toEqual([]);
  });

  it("is deterministic: re-running the same sequence from scratch yields identical state", () => {
    // Each run gets its own fixedDeps() instance (fresh id counter) — this
    // proves *the engine* is deterministic given equivalent inputs, not that
    // reusing one mutable counter across two runs happens to agree.
    function runSequence(): WorkflowState {
      const deps = fixedDeps();
      let drafts: EventDraft[] = [];
      let state = initialWorkflowState();
      for (const event of [invoiceCreated, invoiceSent, paymentRegistered]) {
        drafts = [...drafts, ...react(state, event, WORKFLOW_REGISTRY, deps)];
        state = foldDrafts(drafts);
      }
      return state;
    }
    expect(runSequence()).toEqual(runSequence());
  });
});

describe("condition-gated steps", () => {
  const gatedWorkflow: WorkflowDefinition = {
    id: "gated-workflow",
    name: "Gated",
    triggers: ["ThingCreated"],
    correlationKey: (p) => p.thingId,
    steps: [
      { id: "start" },
      {
        id: "only-if-large",
        onEvent: "ThingFlagged",
        condition: (_ctx, payload) => payload.amount > 1000,
        createTask: { type: "ReviewTask", payload: (p) => ({ thingId: p.thingId }) },
      },
    ],
  };
  const registry = [gatedWorkflow];

  it("does not advance when the condition fails", () => {
    const deps = fixedDeps();
    const created = fakeEvent({ id: "e1", type: "ThingCreated", payload: { thingId: "t1" } });
    const state = foldDrafts(react(initialWorkflowState(), created, registry, deps));

    const smallFlag = fakeEvent({ id: "e2", type: "ThingFlagged", payload: { thingId: "t1", amount: 100 } });
    expect(react(state, smallFlag, registry, deps)).toEqual([]);
  });

  it("advances when the condition passes", () => {
    const deps = fixedDeps();
    const created = fakeEvent({ id: "e1", type: "ThingCreated", payload: { thingId: "t1" } });
    const state = foldDrafts(react(initialWorkflowState(), created, registry, deps));

    const bigFlag = fakeEvent({ id: "e2", type: "ThingFlagged", payload: { thingId: "t1", amount: 5000 } });
    const reactions = react(state, bigFlag, registry, deps);
    expect(reactions.map((e) => e.type)).toEqual(["WorkflowStepAdvanced", "TaskCreated", "WorkflowCompleted"]);
  });
});


/**
 * Replay test (10.4, DB-backed) — proves the full loop against real Postgres:
 *
 *   business events (M2) -> engine reacts -> workflow/task events appended
 *     -> event log -> replay -> identical workflows + tasks
 *
 * Also proves M2 and M4 events coexist in the same log without interfering,
 * the same architectural claim M3's posting.test.ts makes for accounting.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  EventStore,
  createCustomer,
  createInvoice,
  sendInvoice,
  registerPayment,
  replayCompany,
  defaultDeps as kernelDeps,
  type Pool,
} from "@businessos/kernel";
import { reactToEvent } from "../driver.js";
import { replayWorkflows } from "../replay.js";
import { WORKFLOW_REGISTRY } from "../definitions.js";
import { defaultDeps as workflowDeps } from "../commands.js";
import { resetEvents, testPool } from "./helpers.js";

const pool: Pool = testPool();
const store = new EventStore(pool);

beforeEach(() => resetEvents(pool));
afterAll(() => pool.end());

const COMPANY = "00000000-0000-0000-0000-000000000050";

async function runInvoiceToPayment(): Promise<string> {
  const kDeps = kernelDeps();
  const wDeps = workflowDeps();

  const customer = createCustomer({ companyId: COMPANY, name: "Ada" }, kDeps);
  const [storedCustomer] = await store.append([customer]);
  await reactToEvent(store, storedCustomer!, WORKFLOW_REGISTRY, wDeps);

  const invoiceDraft = createInvoice(
    { companyId: COMPANY, customerId: customer.payload.customerId, amount: 100000, dueDate: "2026-12-31" },
    kDeps,
  );
  const [storedInvoiceCreated] = await store.append([invoiceDraft]);
  await reactToEvent(store, storedInvoiceCreated!, WORKFLOW_REGISTRY, wDeps);

  let business = await replayCompany(store, COMPANY);
  let invoice = business.invoices.find((i) => i.id === invoiceDraft.payload.invoiceId)!;
  const sentDraft = sendInvoice(invoice, { companyId: COMPANY }, kDeps);
  const [storedSent] = await store.append([sentDraft]);
  await reactToEvent(store, storedSent!, WORKFLOW_REGISTRY, wDeps);

  business = await replayCompany(store, COMPANY);
  invoice = business.invoices.find((i) => i.id === invoice.id)!;
  const paymentDraft = registerPayment(invoice, { companyId: COMPANY, amount: 100000 }, kDeps);
  const [storedPayment] = await store.append([paymentDraft]);
  await reactToEvent(store, storedPayment!, WORKFLOW_REGISTRY, wDeps);

  return invoiceDraft.payload.invoiceId;
}

describe("replay (10.4)", () => {
  it("reacts to real M2 events end-to-end and reaches a completed workflow", async () => {
    const invoiceId = await runInvoiceToPayment();

    const workflows = await replayWorkflows(store, COMPANY);
    expect(workflows.instances).toHaveLength(1);
    const instance = workflows.instances[0]!;
    expect(instance).toMatchObject({
      workflowDefinitionId: "invoice-workflow",
      correlationValue: invoiceId,
      status: "completed",
    });

    expect(workflows.tasks).toHaveLength(2);
    expect(workflows.tasks.map((t) => t.type).sort()).toEqual(["MonitorPaymentTask", "SendInvoiceTask"]);
    expect(workflows.tasks.every((t) => t.status === "created")).toBe(true);
  });

  it("replaying twice yields identical workflow state", async () => {
    await runInvoiceToPayment();
    const first = await replayWorkflows(store, COMPANY);
    const second = await replayWorkflows(store, COMPANY);
    expect(second).toEqual(first);
  });

  it("business state (M2) and workflow state (M4) both replay correctly from the same log", async () => {
    await runInvoiceToPayment();

    const business = await replayCompany(store, COMPANY);
    const workflows = await replayWorkflows(store, COMPANY);

    expect(business.invoices[0]?.status).toBe("paid");
    expect(workflows.instances[0]?.status).toBe("completed");

    const rawTypes = (await store.byCompany(COMPANY)).map((e) => e.type);
    // M2 business events and M4 workflow/task events genuinely interleave in one log.
    expect(rawTypes).toContain("InvoiceCreated");
    expect(rawTypes).toContain("WorkflowStarted");
    expect(rawTypes).toContain("TaskCreated");
    expect(rawTypes).toContain("WorkflowCompleted");
  });

  it("an event with no matching workflow (e.g. CustomerCreated alone) leaves workflow state empty", async () => {
    const kDeps = kernelDeps();
    const wDeps = workflowDeps();
    const customer = createCustomer({ companyId: COMPANY, name: "Solo" }, kDeps);
    const [stored] = await store.append([customer]);
    await reactToEvent(store, stored!, WORKFLOW_REGISTRY, wDeps);

    const workflows = await replayWorkflows(store, COMPANY);
    expect(workflows.instances).toEqual([]);
    expect(workflows.tasks).toEqual([]);
  });
});

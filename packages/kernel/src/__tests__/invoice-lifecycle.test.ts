/**
 * Milestone 2 — invoice/payment lifecycle tests.
 *
 * Covers the business rules that make this a real domain model rather than a
 * generic event log:
 *   - draft -> sent -> partially_paid -> paid, folded from events
 *   - payments cannot exceed the remaining balance
 *   - payments are rejected before the invoice is sent
 *   - overdue is derived at read time from `asOf`, never persisted as an event
 *   - the whole thing replays identically from the DB
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../event-store.js";
import { replayCompany } from "../replay.js";
import {
  createCustomer,
  createInvoice,
  sendInvoice,
  registerPayment,
} from "../commands.js";
import type { Invoice } from "../state.js";
import type { Pool } from "../db.js";
import { fixedDeps, resetEvents, testPool } from "./helpers.js";

const pool: Pool = testPool();
const store = new EventStore(pool);

beforeEach(() => resetEvents(pool));
afterAll(() => pool.end());

const COMPANY = "00000000-0000-0000-0000-000000000020";
const ASOF = "2026-06-01T00:00:00.000Z";
const FUTURE_DUE_DATE = "2026-12-31T00:00:00.000Z";
const PAST_DUE_DATE = "2025-01-01T00:00:00.000Z";

/** Create a customer + draft invoice for `amount` (minor units), return the invoice id. */
async function seedDraftInvoice(
  deps = fixedDeps(),
  amount = 100000,
  dueDate = FUTURE_DUE_DATE,
): Promise<{ customerId: string; invoiceId: string }> {
  const customer = createCustomer({ companyId: COMPANY, name: "Ada" }, deps);
  const invoice = createInvoice(
    { companyId: COMPANY, customerId: customer.payload.customerId, amount, dueDate },
    deps,
  );
  await store.append([customer, invoice]);
  return { customerId: customer.payload.customerId, invoiceId: invoice.payload.invoiceId };
}

async function getInvoice(invoiceId: string, asOf = ASOF): Promise<Invoice> {
  const state = await replayCompany(store, COMPANY, asOf);
  const invoice = state.invoices.find((i) => i.id === invoiceId);
  if (!invoice) throw new Error(`invoice ${invoiceId} not found`);
  return invoice;
}

describe("invoice lifecycle", () => {
  it("Test 1: create -> send -> pay in full -> status is paid", async () => {
    const deps = fixedDeps();
    const { invoiceId } = await seedDraftInvoice(deps, 100000);

    let invoice = await getInvoice(invoiceId);
    expect(invoice.status).toBe("draft");

    await store.append([sendInvoice(invoice, { companyId: COMPANY }, deps)]);
    invoice = await getInvoice(invoiceId);
    expect(invoice.status).toBe("sent");

    await store.append([
      registerPayment(invoice, { companyId: COMPANY, amount: 100000 }, deps),
    ]);
    invoice = await getInvoice(invoiceId);
    expect(invoice.status).toBe("paid");
    expect(invoice.amountPaid).toBe(100000);

    // The payment record is self-contained: it carries the currency it was
    // paid in (snapshotted from the invoice), not just a bare amount.
    const state = await replayCompany(store, COMPANY);
    expect(state.payments).toEqual([
      expect.objectContaining({ invoiceId, amount: 100000, currency: "SEK" }),
    ]);
  });

  it("Test 2: partial payment leaves the invoice partially_paid", async () => {
    const deps = fixedDeps();
    const { invoiceId } = await seedDraftInvoice(deps, 1000);
    let invoice = await getInvoice(invoiceId);

    await store.append([sendInvoice(invoice, { companyId: COMPANY }, deps)]);
    invoice = await getInvoice(invoiceId);

    await store.append([
      registerPayment(invoice, { companyId: COMPANY, amount: 400 }, deps),
    ]);
    invoice = await getInvoice(invoiceId);

    expect(invoice.status).toBe("partially_paid");
    expect(invoice.amountPaid).toBe(400);
  });

  it("Test 3: a sent, unpaid invoice past its due date is overdue at read time", async () => {
    const deps = fixedDeps();
    const { invoiceId } = await seedDraftInvoice(deps, 1000, PAST_DUE_DATE);
    let invoice = await getInvoice(invoiceId, "2024-01-01T00:00:00.000Z"); // before due date
    expect(invoice.status).toBe("draft");

    await store.append([sendInvoice(invoice, { companyId: COMPANY }, deps)]);

    // As of a time before the due date: just "sent", not overdue.
    invoice = await getInvoice(invoiceId, "2024-06-01T00:00:00.000Z");
    expect(invoice.status).toBe("sent");

    // As of a time after the due date, with no payment: derived as overdue.
    invoice = await getInvoice(invoiceId, ASOF);
    expect(invoice.status).toBe("overdue");

    // The raw log never contains an overdue event — confirm only the two
    // commands we issued were persisted.
    const events = await store.byCompany(COMPANY);
    expect(events.map((e) => e.type)).toEqual(["CustomerCreated", "InvoiceCreated", "InvoiceSent"]);
  });

  it("a partially paid, overdue invoice is still overdue (not just sent)", async () => {
    const deps = fixedDeps();
    const { invoiceId } = await seedDraftInvoice(deps, 1000, PAST_DUE_DATE);
    let invoice = await getInvoice(invoiceId, "2024-01-01T00:00:00.000Z");
    await store.append([sendInvoice(invoice, { companyId: COMPANY }, deps)]);
    invoice = await getInvoice(invoiceId, "2024-01-01T00:00:00.000Z");
    await store.append([
      registerPayment(invoice, { companyId: COMPANY, amount: 100 }, deps),
    ]);

    invoice = await getInvoice(invoiceId, ASOF);
    expect(invoice.status).toBe("overdue");
    expect(invoice.amountPaid).toBe(100);
  });

  it("a paid invoice is never overdue, even past its due date", async () => {
    const deps = fixedDeps();
    const { invoiceId } = await seedDraftInvoice(deps, 1000, PAST_DUE_DATE);
    let invoice = await getInvoice(invoiceId, "2024-01-01T00:00:00.000Z");
    await store.append([sendInvoice(invoice, { companyId: COMPANY }, deps)]);
    invoice = await getInvoice(invoiceId, "2024-01-01T00:00:00.000Z");
    await store.append([
      registerPayment(invoice, { companyId: COMPANY, amount: 1000 }, deps),
    ]);

    invoice = await getInvoice(invoiceId, ASOF);
    expect(invoice.status).toBe("paid");
  });

  it("rejects a payment before the invoice has been sent", async () => {
    const deps = fixedDeps();
    const { invoiceId } = await seedDraftInvoice(deps, 1000);
    const invoice = await getInvoice(invoiceId);

    expect(() =>
      registerPayment(invoice, { companyId: COMPANY, amount: 100 }, deps),
    ).toThrow(/has not been sent/);
  });

  it("rejects a payment that exceeds the remaining balance", async () => {
    const deps = fixedDeps();
    const { invoiceId } = await seedDraftInvoice(deps, 1000);
    let invoice = await getInvoice(invoiceId);
    await store.append([sendInvoice(invoice, { companyId: COMPANY }, deps)]);
    invoice = await getInvoice(invoiceId);

    expect(() =>
      registerPayment(invoice, { companyId: COMPANY, amount: 1001 }, deps),
    ).toThrow(/exceeds remaining balance/);
  });

  it("rejects a second payment that would exceed the balance after a partial payment", async () => {
    const deps = fixedDeps();
    const { invoiceId } = await seedDraftInvoice(deps, 1000);
    let invoice = await getInvoice(invoiceId);
    await store.append([sendInvoice(invoice, { companyId: COMPANY }, deps)]);
    invoice = await getInvoice(invoiceId);
    await store.append([
      registerPayment(invoice, { companyId: COMPANY, amount: 700 }, deps),
    ]);
    invoice = await getInvoice(invoiceId);

    expect(() =>
      registerPayment(invoice, { companyId: COMPANY, amount: 400 }, deps),
    ).toThrow(/exceeds remaining balance/);
  });

  it("rejects payment on an already fully paid invoice", async () => {
    const deps = fixedDeps();
    const { invoiceId } = await seedDraftInvoice(deps, 1000);
    let invoice = await getInvoice(invoiceId);
    await store.append([sendInvoice(invoice, { companyId: COMPANY }, deps)]);
    invoice = await getInvoice(invoiceId);
    await store.append([
      registerPayment(invoice, { companyId: COMPANY, amount: 1000 }, deps),
    ]);
    invoice = await getInvoice(invoiceId);

    expect(() =>
      registerPayment(invoice, { companyId: COMPANY, amount: 1 }, deps),
    ).toThrow(/already fully paid/);
  });

  it("rejects sending an invoice that is not a draft", async () => {
    const deps = fixedDeps();
    const { invoiceId } = await seedDraftInvoice(deps, 1000);
    let invoice = await getInvoice(invoiceId);
    await store.append([sendInvoice(invoice, { companyId: COMPANY }, deps)]);
    invoice = await getInvoice(invoiceId);

    expect(() => sendInvoice(invoice, { companyId: COMPANY }, deps)).toThrow(
      /must be "draft" to send/,
    );
  });

  it("Test 5: full lifecycle replays identically from the DB log", async () => {
    const deps = fixedDeps();
    const { invoiceId } = await seedDraftInvoice(deps, 1000);
    let invoice = await getInvoice(invoiceId);
    await store.append([sendInvoice(invoice, { companyId: COMPANY }, deps)]);
    invoice = await getInvoice(invoiceId);
    await store.append([
      registerPayment(invoice, { companyId: COMPANY, amount: 400 }, deps),
    ]);

    const first = await replayCompany(store, COMPANY, ASOF);
    const second = await replayCompany(store, COMPANY, ASOF);
    expect(second).toEqual(first);

    const invoiceState = first.invoices.find((i) => i.id === invoiceId);
    expect(invoiceState).toMatchObject({ status: "partially_paid", amountPaid: 400 });
  });
});

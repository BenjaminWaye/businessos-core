/**
 * Ordering invariance (pure — no database).
 *
 * The projection sorts events into canonical order (by global sequence) before
 * folding. Therefore the order events are *handed to* `project` must not affect
 * the result: any permutation of the same events yields identical state.
 *
 * This is what makes it safe to load events from anywhere, in any order, and
 * still rebuild the exact same reality.
 */

import { describe, expect, it } from "vitest";
import { project } from "../projection.js";
import type { StoredEvent } from "../types.js";

const ASOF = "2026-06-01T00:00:00.000Z";

/** All permutations of an array (small inputs only). */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}

const events: StoredEvent[] = [
  {
    seq: 1,
    id: "e1",
    companyId: "acme",
    type: "CustomerCreated",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { customerId: "c1", name: "Ada", email: null },
  },
  {
    seq: 2,
    id: "e2",
    companyId: "acme",
    type: "CustomerCreated",
    occurredAt: "2026-01-02T00:00:00.000Z",
    payload: { customerId: "c2", name: "Grace", email: null },
  },
  {
    seq: 3,
    id: "e3",
    companyId: "acme",
    type: "CustomerUpdated",
    occurredAt: "2026-01-03T00:00:00.000Z",
    payload: { customerId: "c1", name: "Ada Lovelace" },
  },
  {
    seq: 4,
    id: "e4",
    companyId: "acme",
    type: "InvoiceCreated",
    occurredAt: "2026-01-04T00:00:00.000Z",
    payload: { invoiceId: "i1", customerId: "c1", amount: 1000, currency: "SEK", dueDate: "2026-02-01" },
  },
  {
    seq: 5,
    id: "e5",
    companyId: "acme",
    type: "InvoiceSent",
    occurredAt: "2026-01-05T00:00:00.000Z",
    payload: { invoiceId: "i1" },
  },
  {
    seq: 6,
    id: "e6",
    companyId: "acme",
    type: "PaymentRegistered",
    occurredAt: "2026-01-06T00:00:00.000Z",
    payload: { paymentId: "p1", invoiceId: "i1", amount: 400, currency: "SEK" },
  },
];

describe("ordering invariance", () => {
  it("produces identical state regardless of input order", () => {
    const canonical = project(events, ASOF);

    for (const permutation of permutations(events)) {
      expect(project(permutation, ASOF)).toEqual(canonical);
    }
  });

  it("respects the canonical order, not the input order, for the update", () => {
    // Even if the update is handed in first, it must apply after the create.
    const reversed = [...events].reverse();
    const state = project(reversed, ASOF);
    const ada = state.customers.find((c) => c.id === "c1");
    expect(ada?.name).toBe("Ada Lovelace");
  });

  it("respects canonical order for invoice + payment regardless of input order", () => {
    // dueDate (2026-02-01) is before ASOF (2026-06-01), so a sent-but-not-
    // fully-paid invoice is correctly derived as overdue, not just partially_paid.
    for (const permutation of permutations(events)) {
      const invoice = project(permutation, ASOF).invoices.find((i) => i.id === "i1");
      expect(invoice).toMatchObject({ status: "overdue", amountPaid: 400 });
    }
  });
});

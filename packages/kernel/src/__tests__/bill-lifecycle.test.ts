/**
 * Bill (accounts payable) lifecycle tests — mirrors invoice-lifecycle.test.ts
 * for the supplier side of the ledger.
 *
 * Lifecycle: received -> approved -> partially_paid/paid, folded from events.
 * `overdue` is derived at read time, never persisted, same as invoices.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../event-store.js";
import { replayCompany } from "../replay.js";
import {
  createSupplier,
  receiveBill,
  approveBill,
  registerBillPayment,
} from "../commands.js";
import type { Bill } from "../state.js";
import type { Pool } from "../db.js";
import { fixedDeps, resetEvents, testPool } from "./helpers.js";

const pool: Pool = testPool();
const store = new EventStore(pool);

beforeEach(() => resetEvents(pool));
afterAll(() => pool.end());

const COMPANY = "00000000-0000-0000-0000-000000000030";
const ASOF = "2026-06-01T00:00:00.000Z";
const FUTURE_DUE_DATE = "2026-12-31T00:00:00.000Z";
const PAST_DUE_DATE = "2025-01-01T00:00:00.000Z";

async function seedReceivedBill(
  deps = fixedDeps(),
  amount = 100000,
  dueDate = FUTURE_DUE_DATE,
): Promise<{ supplierId: string; billId: string }> {
  const supplier = createSupplier({ companyId: COMPANY, name: "Acme Supplies" }, deps);
  const bill = receiveBill(
    { companyId: COMPANY, supplierId: supplier.payload.supplierId, amount, dueDate },
    deps,
  );
  await store.append([supplier, bill]);
  return { supplierId: supplier.payload.supplierId, billId: bill.payload.billId };
}

async function getBill(billId: string, asOf = ASOF): Promise<Bill> {
  const state = await replayCompany(store, COMPANY, asOf);
  const bill = state.bills.find((b) => b.id === billId);
  if (!bill) throw new Error(`bill ${billId} not found`);
  return bill;
}

describe("bill lifecycle", () => {
  it("receive -> approve -> pay in full -> status is paid", async () => {
    const deps = fixedDeps();
    const { billId } = await seedReceivedBill(deps, 100000);

    let bill = await getBill(billId);
    expect(bill.status).toBe("received");

    await store.append([approveBill(bill, { companyId: COMPANY }, deps)]);
    bill = await getBill(billId);
    expect(bill.status).toBe("approved");

    await store.append([
      registerBillPayment(bill, { companyId: COMPANY, amount: 100000 }, deps),
    ]);
    bill = await getBill(billId);
    expect(bill.status).toBe("paid");
    expect(bill.amountPaid).toBe(100000);

    const state = await replayCompany(store, COMPANY);
    expect(state.billPayments).toEqual([
      expect.objectContaining({ billId, amount: 100000, currency: "SEK" }),
    ]);
  });

  it("partial payment leaves the bill partially_paid", async () => {
    const deps = fixedDeps();
    const { billId } = await seedReceivedBill(deps, 1000);
    let bill = await getBill(billId);
    await store.append([approveBill(bill, { companyId: COMPANY }, deps)]);
    bill = await getBill(billId);

    await store.append([
      registerBillPayment(bill, { companyId: COMPANY, amount: 400 }, deps),
    ]);
    bill = await getBill(billId);

    expect(bill.status).toBe("partially_paid");
    expect(bill.amountPaid).toBe(400);
  });

  it("an approved, unpaid bill past its due date is overdue at read time", async () => {
    const deps = fixedDeps();
    const { billId } = await seedReceivedBill(deps, 1000, PAST_DUE_DATE);
    let bill = await getBill(billId, "2024-01-01T00:00:00.000Z");
    expect(bill.status).toBe("received");

    await store.append([approveBill(bill, { companyId: COMPANY }, deps)]);

    bill = await getBill(billId, "2024-06-01T00:00:00.000Z");
    expect(bill.status).toBe("approved");

    bill = await getBill(billId, ASOF);
    expect(bill.status).toBe("overdue");

    const events = await store.byCompany(COMPANY);
    expect(events.map((e) => e.type)).toEqual([
      "SupplierCreated",
      "BillReceived",
      "BillApproved",
    ]);
  });

  it("a paid bill is never overdue, even past its due date", async () => {
    const deps = fixedDeps();
    const { billId } = await seedReceivedBill(deps, 1000, PAST_DUE_DATE);
    let bill = await getBill(billId, "2024-01-01T00:00:00.000Z");
    await store.append([approveBill(bill, { companyId: COMPANY }, deps)]);
    bill = await getBill(billId, "2024-01-01T00:00:00.000Z");
    await store.append([
      registerBillPayment(bill, { companyId: COMPANY, amount: 1000 }, deps),
    ]);

    bill = await getBill(billId, ASOF);
    expect(bill.status).toBe("paid");
  });

  it("rejects a payment before the bill has been approved", async () => {
    const deps = fixedDeps();
    const { billId } = await seedReceivedBill(deps, 1000);
    const bill = await getBill(billId);

    expect(() =>
      registerBillPayment(bill, { companyId: COMPANY, amount: 100 }, deps),
    ).toThrow(/has not been approved/);
  });

  it("rejects a payment that exceeds the remaining balance", async () => {
    const deps = fixedDeps();
    const { billId } = await seedReceivedBill(deps, 1000);
    let bill = await getBill(billId);
    await store.append([approveBill(bill, { companyId: COMPANY }, deps)]);
    bill = await getBill(billId);

    expect(() =>
      registerBillPayment(bill, { companyId: COMPANY, amount: 1001 }, deps),
    ).toThrow(/exceeds remaining balance/);
  });

  it("rejects approving a bill that is not received", async () => {
    const deps = fixedDeps();
    const { billId } = await seedReceivedBill(deps, 1000);
    let bill = await getBill(billId);
    await store.append([approveBill(bill, { companyId: COMPANY }, deps)]);
    bill = await getBill(billId);

    expect(() => approveBill(bill, { companyId: COMPANY }, deps)).toThrow(
      /must be "received" to approve/,
    );
  });

  it("full lifecycle replays identically from the DB log", async () => {
    const deps = fixedDeps();
    const { billId } = await seedReceivedBill(deps, 1000);
    let bill = await getBill(billId);
    await store.append([approveBill(bill, { companyId: COMPANY }, deps)]);
    bill = await getBill(billId);
    await store.append([
      registerBillPayment(bill, { companyId: COMPANY, amount: 400 }, deps),
    ]);

    const first = await replayCompany(store, COMPANY, ASOF);
    const second = await replayCompany(store, COMPANY, ASOF);
    expect(second).toEqual(first);

    const billState = first.bills.find((b) => b.id === billId);
    expect(billState).toMatchObject({ status: "partially_paid", amountPaid: 400 });
  });

  it("invoices (AR) and bills (AP) coexist independently in the same company", async () => {
    const deps = fixedDeps();
    const { billId } = await seedReceivedBill(deps, 1000);
    const state = await replayCompany(store, COMPANY, ASOF);
    expect(state.invoices).toEqual([]);
    expect(state.bills).toHaveLength(1);
    expect(state.bills[0]!.id).toBe(billId);
  });
});

/**
 * Translator tests (pure — no database).
 *
 * Proves the M2 -> accounting bridge: every generated draft is itself
 * balanced (debit sum === credit sum === the gross amount), and the VAT
 * split is exact — net + vat always equals the gross amount, no rounding
 * leftover, because vat is derived by subtraction rather than computed
 * independently.
 */

import { describe, expect, it } from "vitest";
import type { Bill, BillPayment, Invoice, Payment } from "@businessos/kernel";
import {
  billApprovedToVerification,
  billPaymentToVerification,
  invoiceSentToVerification,
  paymentToVerification,
} from "../translator.js";

function sumRows(rows: { debit: number; credit: number }[]): { debit: number; credit: number } {
  return rows.reduce(
    (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
    { debit: 0, credit: 0 },
  );
}

const invoice: Invoice = {
  id: "inv-1",
  customerId: "cust-1",
  amount: 100000,
  currency: "SEK",
  dueDate: "2026-12-31",
  status: "sent",
  amountPaid: 0,
  createdAt: "2026-02-01T00:00:00.000Z",
};

const payment: Payment = {
  id: "pay-1",
  invoiceId: "inv-1",
  amount: 40000,
  currency: "SEK",
  registeredAt: "2026-02-10T00:00:00.000Z",
};

const bill: Bill = {
  id: "bill-1",
  supplierId: "sup-1",
  amount: 50000,
  currency: "SEK",
  dueDate: "2026-12-31",
  status: "approved",
  amountPaid: 0,
  createdAt: "2026-02-05T00:00:00.000Z",
};

const billPayment: BillPayment = {
  id: "bp-1",
  billId: "bill-1",
  amount: 50000,
  currency: "SEK",
  registeredAt: "2026-02-15T00:00:00.000Z",
};

describe("invoiceSentToVerification", () => {
  it("is balanced and splits the gross amount into 80% net + 20% VAT", () => {
    const draft = invoiceSentToVerification(invoice, "evt-1");
    const totals = sumRows(draft.rows);
    expect(totals.debit).toBe(totals.credit);
    expect(totals.debit).toBe(invoice.amount);

    const net = draft.rows.find((r) => r.account === "3001")!.credit;
    const vat = draft.rows.find((r) => r.account === "2611")!.credit;
    expect(net + vat).toBe(invoice.amount);
    expect(net).toBe(80000);
    expect(vat).toBe(20000);
  });

  it("carries the source event id for audit purposes", () => {
    expect(invoiceSentToVerification(invoice, "evt-1").sourceEventId).toBe("evt-1");
  });
});

describe("paymentToVerification", () => {
  it("moves the paid amount from receivables to bank, balanced", () => {
    const draft = paymentToVerification(payment, "evt-2");
    const totals = sumRows(draft.rows);
    expect(totals.debit).toBe(totals.credit);
    expect(totals.debit).toBe(payment.amount);
    expect(draft.rows).toEqual([
      { account: "1930", debit: payment.amount, credit: 0 },
      { account: "1510", debit: 0, credit: payment.amount },
    ]);
  });
});

describe("billApprovedToVerification", () => {
  it("is balanced and splits the gross amount into net purchase + input VAT", () => {
    const draft = billApprovedToVerification(bill, "evt-3");
    const totals = sumRows(draft.rows);
    expect(totals.debit).toBe(totals.credit);
    expect(totals.debit).toBe(bill.amount);

    const net = draft.rows.find((r) => r.account === "4010")!.debit;
    const vat = draft.rows.find((r) => r.account === "2641")!.debit;
    expect(net + vat).toBe(bill.amount);
  });
});

describe("billPaymentToVerification", () => {
  it("moves the paid amount from payables to bank, balanced", () => {
    const draft = billPaymentToVerification(billPayment, "evt-4");
    const totals = sumRows(draft.rows);
    expect(totals.debit).toBe(totals.credit);
    expect(totals.debit).toBe(billPayment.amount);
  });
});

describe("VAT split exactness", () => {
  it("net + vat equals the gross amount for a range of odd amounts", () => {
    for (const amount of [1, 3, 7, 99, 101, 12345, 999999]) {
      const draft = invoiceSentToVerification({ ...invoice, amount }, "evt");
      const net = draft.rows.find((r) => r.account === "3001")!.credit;
      const vat = draft.rows.find((r) => r.account === "2611")!.credit;
      expect(net + vat).toBe(amount);
    }
  });
});

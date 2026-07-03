/**
 * Financial report tests (pure — no database).
 *
 * The key thing being proven here isn't arithmetic, it's an invariant: since
 * every verification is balanced (debit = credit), the accounting identity
 *   assets = equity + liabilities + (revenue - costs)
 * falls out automatically — it is never "made to balance" by the reports.
 */

import { describe, expect, it } from "vitest";
import { balanceSheet, computeVatReport, incomeStatement, ledger, trialBalance } from "../reports.js";
import type { Verification } from "../types.js";

function v(id: string, date: string, rows: Verification["rows"]): Verification {
  return {
    id,
    series: "A",
    number: Number(id),
    date,
    description: `V${id}`,
    rows,
    sourceEventId: null,
    reversed: false,
    reversedBy: null,
    createdAt: `${date}T00:00:00.000Z`,
  };
}

// A small but non-trivial ledger: a sale (with VAT), a purchase (with VAT),
// a customer payment, and a supplier payment.
const verifications: Verification[] = [
  // Sale of 1000 kr, VAT-inclusive: 800 net + 200 VAT.
  v("1", "2026-02-01", [
    { account: "1510", debit: 100000, credit: 0 },
    { account: "3001", debit: 0, credit: 80000 },
    { account: "2611", debit: 0, credit: 20000 },
  ]),
  // Customer pays the invoice in full.
  v("2", "2026-02-10", [
    { account: "1930", debit: 100000, credit: 0 },
    { account: "1510", debit: 0, credit: 100000 },
  ]),
  // Purchase of 500 kr, VAT-inclusive: 400 net + 100 VAT.
  v("3", "2026-02-05", [
    { account: "4010", debit: 40000, credit: 0 },
    { account: "2641", debit: 10000, credit: 0 },
    { account: "2440", debit: 0, credit: 50000 },
  ]),
  // We pay the supplier in full.
  v("4", "2026-02-15", [
    { account: "2440", debit: 50000, credit: 0 },
    { account: "1930", debit: 0, credit: 50000 },
  ]),
];

describe("ledger / trialBalance", () => {
  it("sums debit and credit per account", () => {
    const lines = ledger(verifications);
    const bank = lines.find((l) => l.account === "1930")!;
    expect(bank.debit).toBe(100000);
    expect(bank.credit).toBe(50000);
    expect(bank.balance).toBe(50000);
  });

  it("trial balance always has total debit === total credit", () => {
    const tb = trialBalance(verifications);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.balanced).toBe(true);
  });

  it("an empty ledger is trivially balanced", () => {
    expect(trialBalance([]).balanced).toBe(true);
  });
});

describe("the accounting identity", () => {
  it("assets == equity/liabilities + (revenue - costs), always", () => {
    const bs = balanceSheet(verifications);
    const is = incomeStatement(verifications);
    expect(bs.totalAssets).toBe(bs.totalEquityAndLiabilities + is.result);
  });

  it("holds for an arbitrary set of additional balanced verifications", () => {
    const extra: Verification[] = [
      ...verifications,
      v("5", "2026-02-20", [
        { account: "1930", debit: 12345, credit: 0 },
        { account: "3001", debit: 0, credit: 9876 },
        { account: "2611", debit: 0, credit: 2469 },
      ]),
    ];
    const bs = balanceSheet(extra);
    const is = incomeStatement(extra);
    expect(bs.totalAssets).toBe(bs.totalEquityAndLiabilities + is.result);
  });
});

describe("incomeStatement", () => {
  it("reports revenue and costs net of VAT", () => {
    const is = incomeStatement(verifications);
    expect(is.totalRevenue).toBe(80000);
    expect(is.totalCosts).toBe(40000);
    expect(is.result).toBe(40000);
  });
});

describe("computeVatReport", () => {
  it("nets output VAT against input VAT for the period", () => {
    const report = computeVatReport(verifications, "2026-02-01", "2026-02-28");
    expect(report.outputVat).toBe(20000);
    expect(report.inputVat).toBe(10000);
    expect(report.toPay).toBe(10000);
  });

  it("excludes verifications outside the period", () => {
    const report = computeVatReport(verifications, "2026-03-01", "2026-03-31");
    expect(report).toEqual({ outputVat: 0, inputVat: 0, toPay: 0 });
  });
});

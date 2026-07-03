/**
 * Financial reports: pure functions over a list of verifications.
 *
 * Every verification is balanced (debit = credit, enforced by
 * `createVerification`), so these reports are never "made to balance" after
 * the fact — the accounting identity `assets = equity + liabilities +
 * (revenue - costs)` falls straight out of that invariant (see the
 * `balanceSheet` docstring and the reports test suite).
 *
 * Reversed verifications are NOT excluded here: a reversal is a normal
 * verification with mirrored rows, so including both the original and the
 * reversal is what makes them net to zero. There is no filtering to get
 * right.
 */

import { accountClass, findAccount } from "./accounts.js";
import type { Verification } from "./types.js";

export interface LedgerLine {
  account: string;
  name: string;
  debit: number;
  credit: number;
  /** debit - credit. Positive for a net debit balance. */
  balance: number;
}

/** Per-account totals across a set of verifications, sorted by account code. */
export function ledger(verifications: readonly Verification[]): LedgerLine[] {
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const v of verifications) {
    for (const row of v.rows) {
      const t = totals.get(row.account) ?? { debit: 0, credit: 0 };
      t.debit += row.debit;
      t.credit += row.credit;
      totals.set(row.account, t);
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([account, t]) => ({
      account,
      name: findAccount(account)?.name ?? account,
      debit: t.debit,
      credit: t.credit,
      balance: t.debit - t.credit,
    }));
}

export interface TrialBalance {
  lines: LedgerLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

/** Every account's balance, plus the debit/credit totals that must match. */
export function trialBalance(verifications: readonly Verification[]): TrialBalance {
  const lines = ledger(verifications);
  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
  return { lines, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

export interface FinancialReportLine {
  account: string;
  name: string;
  amount: number;
}

export interface IncomeStatement {
  revenue: FinancialReportLine[];
  costs: FinancialReportLine[];
  totalRevenue: number;
  totalCosts: number;
  /** totalRevenue - totalCosts (net profit for the period, before tax). */
  result: number;
}

/** Revenue accounts (3xxx) are credit-normal; costs (4-7xxx) are debit-normal. */
export function incomeStatement(verifications: readonly Verification[]): IncomeStatement {
  const revenue: FinancialReportLine[] = [];
  const costs: FinancialReportLine[] = [];
  for (const line of ledger(verifications)) {
    const cls = findAccount(line.account)?.class ?? accountClass(line.account);
    if (cls === "revenue") revenue.push({ ...line, amount: -line.balance });
    else if (cls === "cost") costs.push({ ...line, amount: line.balance });
  }
  const totalRevenue = revenue.reduce((sum, l) => sum + l.amount, 0);
  const totalCosts = costs.reduce((sum, l) => sum + l.amount, 0);
  return { revenue, costs, totalRevenue, totalCosts, result: totalRevenue - totalCosts };
}

export interface BalanceSheet {
  assets: FinancialReportLine[];
  equityAndLiabilities: FinancialReportLine[];
  totalAssets: number;
  totalEquityAndLiabilities: number;
}

/**
 * Pre-closing balance sheet: the period's net result has not been swept into
 * an equity account yet (that would be a real posting, e.g. at fiscal
 * year-end), so `totalAssets === totalEquityAndLiabilities + result`
 * (`result` from `incomeStatement`) always holds — direct consequence of
 * every verification balancing. Proven in the reports test suite.
 */
export function balanceSheet(verifications: readonly Verification[]): BalanceSheet {
  const assets: FinancialReportLine[] = [];
  const equityAndLiabilities: FinancialReportLine[] = [];
  for (const line of ledger(verifications)) {
    const cls = findAccount(line.account)?.class ?? accountClass(line.account);
    if (cls === "asset") assets.push({ ...line, amount: line.balance });
    else if (cls === "equity_liability") {
      equityAndLiabilities.push({ ...line, amount: -line.balance });
    }
  }
  return {
    assets,
    equityAndLiabilities,
    totalAssets: assets.reduce((sum, l) => sum + l.amount, 0),
    totalEquityAndLiabilities: equityAndLiabilities.reduce((sum, l) => sum + l.amount, 0),
  };
}

export interface VatReportComputed {
  outputVat: number;
  inputVat: number;
  toPay: number;
}

const OUTPUT_VAT_ACCOUNT = "2611";
const INPUT_VAT_ACCOUNT = "2641";

/** Sums output/input VAT accounts for verifications dated within [periodStart, periodEnd]. */
export function computeVatReport(
  verifications: readonly Verification[],
  periodStart: string,
  periodEnd: string,
): VatReportComputed {
  const inPeriod = verifications.filter((v) => v.date >= periodStart && v.date <= periodEnd);
  const lines = ledger(inPeriod);
  const outputVat = -(lines.find((l) => l.account === OUTPUT_VAT_ACCOUNT)?.balance ?? 0) || 0;
  const inputVat = lines.find((l) => l.account === INPUT_VAT_ACCOUNT)?.balance ?? 0;
  return { outputVat, inputVat, toPay: outputVat - inputVat };
}

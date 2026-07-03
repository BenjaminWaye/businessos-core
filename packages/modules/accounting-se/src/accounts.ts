/**
 * BAS chart of accounts (Sweden).
 *
 * A curated subset of the real BAS 2025 standard — just enough accounts to
 * post the transactions this module actually generates (sales, purchases,
 * VAT, bank, receivables/payables). Not the full ~300-account chart; a real
 * company's chart of accounts would be configured, not hardcoded, but a
 * fixed subset is enough to prove the accounting model end-to-end.
 *
 * BAS account numbers are structured by leading digit:
 *   1xxx assets, 2xxx equity & liabilities, 3xxx revenue, 4-7xxx costs,
 *   8xxx financial items / appropriations / tax.
 */

export type AccountClass = "asset" | "equity_liability" | "revenue" | "cost" | "financial";

export interface BasAccount {
  code: string;
  name: string;
  class: AccountClass;
}

export const BAS_ACCOUNTS: readonly BasAccount[] = [
  { code: "1510", name: "Kundfordringar", class: "asset" },
  { code: "1930", name: "Företagskonto/bank", class: "asset" },
  { code: "2440", name: "Leverantörsskulder", class: "equity_liability" },
  { code: "2611", name: "Utgående moms 25%", class: "equity_liability" },
  { code: "2641", name: "Ingående moms 25%", class: "equity_liability" },
  { code: "3001", name: "Försäljning inom Sverige, 25% moms", class: "revenue" },
  { code: "4010", name: "Inköp material och varor, 25% moms", class: "cost" },
];

export function findAccount(code: string): BasAccount | undefined {
  return BAS_ACCOUNTS.find((a) => a.code === code);
}

/** Classify a code by its leading digit even if it's outside the curated subset. */
export function accountClass(code: string): AccountClass {
  switch (code[0]) {
    case "1":
      return "asset";
    case "2":
      return "equity_liability";
    case "3":
      return "revenue";
    case "8":
      return "financial";
    default:
      return "cost";
  }
}

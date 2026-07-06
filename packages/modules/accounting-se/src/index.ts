/**
 * @businessos/accounting-se — public surface (Milestone 3).
 *
 * Swedish accounting module: BAS chart of accounts, double-entry
 * verifications, fiscal years, VAT/SIE reporting. Built entirely on top of
 * the kernel's public API (EventStore, EventDraft, StoredEvent) — the kernel
 * has no idea this module exists.
 */

export { BAS_ACCOUNTS, findAccount, findAccountIn, accountClass } from "./accounts.js";
export type { AccountClass, BasAccount } from "./accounts.js";

export type {
  Verification,
  VerificationRow,
  VerificationCreated,
  VerificationReversed,
  FiscalYear,
  FiscalYearOpened,
  FiscalYearClosed,
  VatReportRecord,
  VatReportGenerated,
  SieExportRecord,
  SieExported,
  CustomAccount,
  AccountCreated,
  AccountingState,
  AccountingEventMap,
  AccountingEventType,
} from "./types.js";
export { initialAccountingState } from "./types.js";

export { projectAccounting } from "./projection.js";
export { replayAccounting } from "./replay.js";

export type {
  CommandDeps,
  CreateVerificationInput,
  ReverseVerificationInput,
  OpenFiscalYearInput,
  CloseFiscalYearInput,
  RecordVatReportInput,
  RecordSieExportInput,
  CreateAccountInput,
} from "./commands.js";
export {
  defaultDeps,
  createVerification,
  reverseVerification,
  openFiscalYear,
  closeFiscalYear,
  recordVatReport,
  recordSieExport,
  createAccount,
} from "./commands.js";

export type { LedgerLine, TrialBalance, FinancialReportLine, IncomeStatement, BalanceSheet, VatReportComputed } from "./reports.js";
export { ledger, trialBalance, incomeStatement, balanceSheet, computeVatReport } from "./reports.js";

export {
  invoiceSentToVerification,
  paymentToVerification,
  billApprovedToVerification,
  billPaymentToVerification,
} from "./translator.js";

export type { SieCompanyInfo, SieFiscalYear } from "./sie.js";
export { exportSie4 } from "./sie.js";

/**
 * Command -> Event pipeline for the Swedish accounting module.
 *
 * Same shape as the kernel's commands: pure functions, no DB access. Some
 * commands (createVerification, reverseVerification, closeFiscalYear) need
 * to validate against current state — voucher numbering, locked periods,
 * "not already reversed" — so the caller loads `AccountingState` (via
 * `projectAccounting`/`replayAccounting`) and passes in the relevant slice,
 * exactly like the kernel's `sendInvoice(invoice, ...)`.
 */

import { randomUUID } from "node:crypto";
import type { EventDraft } from "@businessos/kernel";
import { findAccount } from "./accounts.js";
import type {
  AccountingState,
  FiscalYear,
  FiscalYearClosed,
  FiscalYearOpened,
  SieExported,
  VatReportGenerated,
  Verification,
  VerificationCreated,
  VerificationReversed,
  VerificationRow,
} from "./types.js";

export interface CommandDeps {
  newId: () => string;
  now: () => string;
}

export function defaultDeps(): CommandDeps {
  return { newId: () => randomUUID(), now: () => new Date().toISOString() };
}

function nextVoucherNumber(state: AccountingState, series: string): number {
  const numbers = state.verifications.filter((v) => v.series === series).map((v) => v.number);
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

/** Debit = credit, every row references a real account, amounts are sane. */
function assertBalanced(rows: readonly VerificationRow[]): void {
  if (rows.length < 2) {
    throw new Error("createVerification: at least two rows are required");
  }
  let debitSum = 0;
  let creditSum = 0;
  for (const row of rows) {
    if (!findAccount(row.account)) {
      throw new Error(`createVerification: unknown BAS account "${row.account}"`);
    }
    if (
      !Number.isInteger(row.debit) ||
      !Number.isInteger(row.credit) ||
      row.debit < 0 ||
      row.credit < 0
    ) {
      throw new Error("createVerification: debit/credit must be non-negative integers (minor units)");
    }
    const hasDebit = row.debit > 0;
    const hasCredit = row.credit > 0;
    if (hasDebit === hasCredit) {
      throw new Error(
        `createVerification: row for account ${row.account} must have exactly one of debit/credit set`,
      );
    }
    debitSum += row.debit;
    creditSum += row.credit;
  }
  if (debitSum !== creditSum) {
    throw new Error(
      `createVerification: unbalanced entry — debit ${debitSum} does not equal credit ${creditSum}`,
    );
  }
}

/** A verification cannot be posted into a closed fiscal year. */
function assertPeriodOpen(state: AccountingState, date: string): void {
  const fy = state.fiscalYears.find((f) => date >= f.startDate && date <= f.endDate);
  if (fy?.closed) {
    throw new Error(`createVerification: fiscal year ${fy.id} covering ${date} is closed`);
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface CreateVerificationInput {
  companyId: string;
  series?: string;
  date: string;
  description: string;
  rows: VerificationRow[];
  /** Id of the domain event this verification was generated from, if auto-posted. */
  sourceEventId?: string | null;
}

/** CreateVerification -> VerificationCreated. */
export function createVerification(
  state: AccountingState,
  input: CreateVerificationInput,
  deps: CommandDeps,
): EventDraft<VerificationCreated> {
  const series = input.series ?? "A";
  if (!input.description.trim()) {
    throw new Error("createVerification: description is required");
  }
  assertBalanced(input.rows);
  assertPeriodOpen(state, input.date);

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "VerificationCreated",
    occurredAt: deps.now(),
    payload: {
      verificationId: deps.newId(),
      series,
      number: nextVoucherNumber(state, series),
      date: input.date,
      description: input.description.trim(),
      rows: input.rows,
      sourceEventId: input.sourceEventId ?? null,
    },
  };
}

export interface ReverseVerificationInput {
  companyId: string;
  /** Date the reversal itself is dated (may differ from the original). */
  date: string;
  description?: string;
}

/**
 * ReverseVerification -> VerificationReversed.
 *
 * Rule: verifications are immutable. Correcting one means posting a new
 * verification with debit/credit mirrored from the original — never editing
 * or deleting it. The original stays in the ledger forever; the two entries
 * net to zero.
 */
export function reverseVerification(
  state: AccountingState,
  verification: Verification,
  input: ReverseVerificationInput,
  deps: CommandDeps,
): EventDraft<VerificationReversed> {
  if (verification.reversed) {
    throw new Error(`reverseVerification: verification ${verification.id} is already reversed`);
  }
  assertPeriodOpen(state, input.date);

  const rows: VerificationRow[] = verification.rows.map((r) => ({
    account: r.account,
    debit: r.credit,
    credit: r.debit,
  }));

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "VerificationReversed",
    occurredAt: deps.now(),
    payload: {
      verificationId: deps.newId(),
      reversesVerificationId: verification.id,
      series: verification.series,
      number: nextVoucherNumber(state, verification.series),
      date: input.date,
      description:
        input.description?.trim() ||
        `Reversal of ${verification.series}${verification.number}: ${verification.description}`,
      rows,
    },
  };
}

// ---------------------------------------------------------------------------
// Fiscal year
// ---------------------------------------------------------------------------

export interface OpenFiscalYearInput {
  companyId: string;
  startDate: string;
  endDate: string;
}

/** OpenFiscalYear -> FiscalYearOpened. */
export function openFiscalYear(
  state: AccountingState,
  input: OpenFiscalYearInput,
  deps: CommandDeps,
): EventDraft<FiscalYearOpened> {
  if (input.endDate <= input.startDate) {
    throw new Error("openFiscalYear: endDate must be after startDate");
  }
  const overlaps = state.fiscalYears.some(
    (f) => input.startDate <= f.endDate && input.endDate >= f.startDate,
  );
  if (overlaps) {
    throw new Error("openFiscalYear: overlaps an existing fiscal year");
  }

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "FiscalYearOpened",
    occurredAt: deps.now(),
    payload: { fiscalYearId: deps.newId(), startDate: input.startDate, endDate: input.endDate },
  };
}

export interface CloseFiscalYearInput {
  companyId: string;
}

/** CloseFiscalYear -> FiscalYearClosed. Locks every verification date within it. */
export function closeFiscalYear(
  fiscalYear: FiscalYear,
  input: CloseFiscalYearInput,
  deps: CommandDeps,
): EventDraft<FiscalYearClosed> {
  if (fiscalYear.closed) {
    throw new Error(`closeFiscalYear: fiscal year ${fiscalYear.id} is already closed`);
  }
  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "FiscalYearClosed",
    occurredAt: deps.now(),
    payload: { fiscalYearId: fiscalYear.id },
  };
}

// ---------------------------------------------------------------------------
// VAT report / SIE export — audit records
// ---------------------------------------------------------------------------

export interface RecordVatReportInput {
  companyId: string;
  periodStart: string;
  periodEnd: string;
  outputVat: number;
  inputVat: number;
}

/**
 * RecordVatReport -> VatReportGenerated. Records that a VAT report was
 * generated for a period; the report content itself is computed on demand by
 * `computeVatReport` (see reports.ts) — this event is only the audit trail.
 */
export function recordVatReport(
  input: RecordVatReportInput,
  deps: CommandDeps,
): EventDraft<VatReportGenerated> {
  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "VatReportGenerated",
    occurredAt: deps.now(),
    payload: {
      reportId: deps.newId(),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      outputVat: input.outputVat,
      inputVat: input.inputVat,
      toPay: input.outputVat - input.inputVat,
    },
  };
}

export interface RecordSieExportInput {
  companyId: string;
  fiscalYearId: string;
}

/** RecordSieExport -> SieExported. Audit trail that a SIE4 file was generated. */
export function recordSieExport(
  input: RecordSieExportInput,
  deps: CommandDeps,
): EventDraft<SieExported> {
  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "SieExported",
    occurredAt: deps.now(),
    payload: { exportId: deps.newId(), fiscalYearId: input.fiscalYearId },
  };
}

/**
 * Milestone 3 — Swedish accounting domain.
 *
 * Verifications, fiscal years, VAT/SIE audit records. None of these are
 * stored directly: they are reconstructed by folding events through this
 * module's own projection (see projection.ts) — the same pattern as the
 * kernel's Customer/Invoice projection, just a different projection over the
 * same shared event log. The kernel itself has no idea accounting exists.
 */

// ---------------------------------------------------------------------------
// Verification (verifikation) — the atomic unit of double-entry bookkeeping
// ---------------------------------------------------------------------------

export interface VerificationRow {
  /** BAS account code, e.g. "1930". */
  account: string;
  /** Minor currency units (öre). Exactly one of debit/credit must be > 0. */
  debit: number;
  credit: number;
}

export interface Verification {
  id: string;
  /** Voucher series letter, e.g. "A". */
  series: string;
  /** Sequential number within the series, starting at 1. */
  number: number;
  /** ISO 8601 date the verification is dated (accounting date, not wall clock). */
  date: string;
  description: string;
  rows: VerificationRow[];
  /**
   * Id of the domain event (from any module, e.g. InvoiceSent) this
   * verification was auto-generated from, or null for a manual entry. Purely
   * an audit trail — never used for folding logic.
   */
  sourceEventId: string | null;
  /** True once a VerificationReversed event has targeted this verification. */
  reversed: boolean;
  /** Id of the reversing verification, once reversed. */
  reversedBy: string | null;
  createdAt: string;
}

export interface VerificationCreated {
  verificationId: string;
  series: string;
  number: number;
  date: string;
  description: string;
  rows: VerificationRow[];
  sourceEventId: string | null;
}

/**
 * A reversal is itself a new, ordinary verification (with debit/credit
 * mirrored from the original) — never an edit or delete of the original. The
 * ledger keeps both entries forever; they net to zero.
 */
export interface VerificationReversed {
  /** Id of the new, reversing verification. */
  verificationId: string;
  reversesVerificationId: string;
  series: string;
  number: number;
  date: string;
  description: string;
  rows: VerificationRow[];
}

// ---------------------------------------------------------------------------
// Fiscal year
// ---------------------------------------------------------------------------

export interface FiscalYear {
  id: string;
  startDate: string;
  endDate: string;
  closed: boolean;
  createdAt: string;
}

export interface FiscalYearOpened {
  fiscalYearId: string;
  startDate: string;
  endDate: string;
}

export interface FiscalYearClosed {
  fiscalYearId: string;
}

// ---------------------------------------------------------------------------
// VAT report / SIE export — audit records of reports having been generated
// ---------------------------------------------------------------------------

export interface VatReportRecord {
  id: string;
  periodStart: string;
  periodEnd: string;
  outputVat: number;
  inputVat: number;
  toPay: number;
  generatedAt: string;
}

export interface VatReportGenerated {
  reportId: string;
  periodStart: string;
  periodEnd: string;
  outputVat: number;
  inputVat: number;
  toPay: number;
}

export interface SieExportRecord {
  id: string;
  fiscalYearId: string;
  generatedAt: string;
}

export interface SieExported {
  exportId: string;
  fiscalYearId: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface AccountingState {
  verifications: Verification[];
  fiscalYears: FiscalYear[];
  vatReports: VatReportRecord[];
  sieExports: SieExportRecord[];
}

export function initialAccountingState(): AccountingState {
  return { verifications: [], fiscalYears: [], vatReports: [], sieExports: [] };
}

export interface AccountingEventMap {
  VerificationCreated: VerificationCreated;
  VerificationReversed: VerificationReversed;
  FiscalYearOpened: FiscalYearOpened;
  FiscalYearClosed: FiscalYearClosed;
  VatReportGenerated: VatReportGenerated;
  SieExported: SieExported;
}

export type AccountingEventType = keyof AccountingEventMap;

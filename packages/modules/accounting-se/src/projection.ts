/**
 * Projection engine for the accounting module: events -> AccountingState.
 *
 * Pure and deterministic, exactly like the kernel's `project()` — same
 * canonical-ordering guarantee (sorted by global sequence before folding), no
 * hidden dependencies. It operates on the *same* event log the kernel and the
 * M2 domain use; it simply ignores event types it doesn't recognize (e.g.
 * CustomerCreated), the same way the kernel's own projection ignores
 * accounting event types. Neither module needs to know the other exists.
 *
 * Unlike the kernel's invoice projection, nothing here is time-derived (no
 * "overdue" equivalent), so there's no `asOf` parameter.
 */

import { compareEvents, type StoredEvent } from "@businessos/kernel";
import {
  initialAccountingState,
  type AccountCreated,
  type AccountingState,
  type FiscalYearClosed,
  type FiscalYearOpened,
  type SieExported,
  type VatReportGenerated,
  type Verification,
  type VerificationCreated,
  type VerificationReversed,
} from "./types.js";

function apply(state: AccountingState, event: StoredEvent): AccountingState {
  switch (event.type) {
    case "VerificationCreated": {
      const p = event.payload as VerificationCreated;
      const verification: Verification = {
        id: p.verificationId,
        series: p.series,
        number: p.number,
        date: p.date,
        description: p.description,
        rows: p.rows,
        sourceEventId: p.sourceEventId,
        reversed: false,
        reversedBy: null,
        createdAt: event.occurredAt,
      };
      return { ...state, verifications: [...state.verifications, verification] };
    }

    case "VerificationReversed": {
      const p = event.payload as VerificationReversed;
      const reversal: Verification = {
        id: p.verificationId,
        series: p.series,
        number: p.number,
        date: p.date,
        description: p.description,
        rows: p.rows,
        sourceEventId: null,
        reversed: false,
        reversedBy: null,
        createdAt: event.occurredAt,
      };
      return {
        ...state,
        verifications: [
          ...state.verifications.map((v) =>
            v.id === p.reversesVerificationId
              ? { ...v, reversed: true, reversedBy: p.verificationId }
              : v,
          ),
          reversal,
        ],
      };
    }

    case "FiscalYearOpened": {
      const p = event.payload as FiscalYearOpened;
      return {
        ...state,
        fiscalYears: [
          ...state.fiscalYears,
          {
            id: p.fiscalYearId,
            startDate: p.startDate,
            endDate: p.endDate,
            closed: false,
            createdAt: event.occurredAt,
          },
        ],
      };
    }

    case "FiscalYearClosed": {
      const p = event.payload as FiscalYearClosed;
      return {
        ...state,
        fiscalYears: state.fiscalYears.map((f) =>
          f.id === p.fiscalYearId ? { ...f, closed: true } : f,
        ),
      };
    }

    case "VatReportGenerated": {
      const p = event.payload as VatReportGenerated;
      return {
        ...state,
        vatReports: [
          ...state.vatReports,
          {
            id: p.reportId,
            periodStart: p.periodStart,
            periodEnd: p.periodEnd,
            outputVat: p.outputVat,
            inputVat: p.inputVat,
            toPay: p.toPay,
            generatedAt: event.occurredAt,
          },
        ],
      };
    }

    case "SieExported": {
      const p = event.payload as SieExported;
      return {
        ...state,
        sieExports: [
          ...state.sieExports,
          { id: p.exportId, fiscalYearId: p.fiscalYearId, generatedAt: event.occurredAt },
        ],
      };
    }

    case "AccountCreated": {
      const p = event.payload as AccountCreated;
      return {
        ...state,
        customAccounts: [
          ...state.customAccounts,
          { code: p.code, name: p.name, class: p.class, createdAt: event.occurredAt },
        ],
      };
    }

    // Non-accounting events (e.g. CustomerCreated, InvoiceSent) are ignored,
    // not an error — this log is shared with the M2 domain and any future
    // module.
    default:
      return state;
  }
}

export function projectAccounting(events: readonly StoredEvent[]): AccountingState {
  return [...events].sort(compareEvents).reduce(apply, initialAccountingState());
}
